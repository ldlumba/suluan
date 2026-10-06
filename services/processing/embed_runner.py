"""Bounded Cloud Run Job that embeds claimed chunks from a pinned region.

Cloudflare Worker egress cannot reliably satisfy Gemini's location policy, so
paid embedding calls originate here (asia-southeast1) instead of in the
Worker. The Job holds no Neon/R2 credentials: it presents the same
audience-pinned Google ID token as extraction, claims missing-chunk batches
through the Worker's internal embedding API (quota is consumed server-side in
that claim step, before any paid call), embeds exactly one bounded batch per
claim, and posts raw vectors back. Normalization and idempotent storage stay
in the Worker. One explicit invocation embeds at most ``--max-claims`` claims;
failures stop the run without any automatic retry.
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from cloud_runner import (
    ServiceWorkerClient,
    format_worker_error,
    metadata_identity_token,
)

GEMINI_BATCH_URL = (
    "https://generativelanguage.googleapis.com/v1beta/"
    "models/gemini-embedding-001:batchEmbedContents"
)

# Workers.dev edge integrity rejects bare Python clients (Cloudflare 1010)
# before the Worker runs; identify honestly while remaining fetchable.
USER_AGENT = "Mozilla/5.0 (compatible; SULUAN-Embed-Job/1.0)"

EMBED_DIMS = 768


def gemini_body(texts, task_type="RETRIEVAL_DOCUMENT"):
    """Batch embedding request with the approved asymmetric task type."""
    return {
        "requests": [
            {
                "model": "models/gemini-embedding-001",
                "content": {"parts": [{"text": text}]},
                "taskType": task_type,
                "outputDimensionality": EMBED_DIMS,
            }
            for text in texts
        ]
    }


def parse_gemini_vectors(payload, expected):
    """Extract raw vectors; the Worker normalizes and validates geometry."""
    embeddings = payload.get("embeddings")
    if not isinstance(embeddings, list) or len(embeddings) != expected:
        raise ValueError(
            f"expected {expected} embeddings, "
            f"got {len(embeddings) if isinstance(embeddings, list) else 'none'}"
        )
    vectors = []
    for entry in embeddings:
        values = entry.get("values") if isinstance(entry, dict) else None
        if not isinstance(values, list) or len(values) != EMBED_DIMS:
            raise ValueError(
                f"expected {EMBED_DIMS} dimensions, "
                f"got {len(values) if isinstance(values, list) else 0}"
            )
        vectors.append([float(v) for v in values])
    return vectors


def embed_texts(texts, api_key, opener=None, task_type="RETRIEVAL_DOCUMENT"):
    """One bounded Gemini call from this pinned region. No retries here."""
    if not api_key:
        raise ValueError("A Gemini API key is required")
    data = json.dumps(gemini_body(texts, task_type)).encode()
    request = urllib.request.Request(
        GEMINI_BATCH_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "User-Agent": USER_AGENT,
        },
    )
    client = opener or urllib.request.build_opener()
    try:
        with client.open(request, timeout=120) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = error.read().decode(errors="replace")[:300]
        except Exception:
            detail = ""
        raise RuntimeError(
            f"gemini embed failed ({error.code}): {detail}"
        ) from None
    return parse_gemini_vectors(payload, len(texts))


def process_claim(client, api_key, claim):
    vectors = embed_texts(
        [item["content"] for item in claim["items"]], api_key
    )
    body = {
        "claimToken": claim["claimToken"],
        "vectors": [
            {"chunkId": item["chunkId"], "values": vector}
            for item, vector in zip(claim["items"], vectors)
        ],
    }
    result = client.json("/api/internal/embeddings/result", body)
    return result.get("embedded", 0)


def process_query(
    client, api_key, query, *, include_vector=False, include_diagnostics=False
):
    """Embed one query and return visibility-filtered Worker ranking.

    ``include_vector`` is an explicit evaluation-only escape hatch. It lets
    offline scoring experiments reuse a paid query embedding without sending
    the vector to the Worker or including it in normal result logs.
    """
    claim = client.json(
        "/api/internal/embeddings/query/claim",
        {
            "query": query,
            "viewer": "MANAGER",
            "page": 1,
            "includeDiagnostics": include_diagnostics,
        },
    )
    vector = embed_texts(
        [claim["query"]], api_key, task_type="RETRIEVAL_QUERY"
    )[0]
    result = client.json(
        "/api/internal/embeddings/query/result",
        {"claimToken": claim["claimToken"], "values": vector},
    )
    return (result, vector) if include_vector else result


def safe_query_result(probe_id, result):
    """Keep evaluation logs free of extracted snippets and document text."""
    return {
        "id": probe_id,
        "semanticStatus": result.get("semanticStatus"),
        "page": result.get("page"),
        "hasMore": result.get("hasMore"),
        "items": [
            {
                key: item.get(key)
                for key in ("id", "title", "visibility", "distance")
            }
            for item in result.get("items", [])
        ],
    }


def run_claims(client, api_key, *, max_claims=5, record_id=None, emit=print):
    completed = 0
    embedded = 0
    body = {"recordId": record_id} if record_id else {}
    for _ in range(max_claims):
        try:
            claim = client.json("/api/internal/embeddings/claim", body)
        except urllib.error.HTTPError as error:
            if error.code == 429:
                emit("quota exhausted; existing vectors were kept")
                return completed, embedded
            raise
        if claim is None:
            emit(f"no claimable chunks; completed={completed} embedded={embedded}")
            return completed, embedded
        count = process_claim(client, api_key, claim)
        completed += 1
        embedded += count
        emit(f"{claim['claimId']} embedded={count} total={embedded}")
    emit(f"stopped at the explicit {max_claims}-claim execution bound")
    return completed, embedded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=os.environ.get("SULUAN_API_BASE"))
    parser.add_argument("--audience", default=os.environ.get("SULUAN_WORKER_AUDIENCE"))
    parser.add_argument(
        "--max-claims", type=int, default=int(os.environ.get("SULUAN_MAX_CLAIMS", "5"))
    )
    parser.add_argument(
        "--query",
        default=os.environ.get("SULUAN_QUERY"),
        help="Run one pinned-region retrieval-query evaluation instead of document claims.",
    )
    parser.add_argument(
        "--query-file",
        default=os.environ.get("SULUAN_QUERY_FILE"),
        help="Run a frozen JSON probe list in the pinned region.",
    )
    parser.add_argument(
        "--query-vectors-output",
        help=(
            "Explicit evaluation-only JSON artifact for query vectors; requires "
            "--query-file and never includes document text"
        ),
    )
    parser.add_argument(
        "--query-interval",
        type=float,
        default=float(os.environ.get("SULUAN_QUERY_INTERVAL", "3")),
    )
    parser.add_argument(
        "--record-id",
        default=os.environ.get("SULUAN_RECORD_ID"),
        help="Scope claims to one record (tests and single-paper recovery). Omit to drain the backlog.",
    )
    args = parser.parse_args()
    if not args.api or not args.audience:
        parser.error("--api and --audience (or their environment variables) are required")
    if not 1 <= args.max_claims <= 10:
        parser.error("--max-claims must be between 1 and 10")
    if args.query_file and args.query:
        parser.error("use --query or --query-file, not both")
    if args.query_vectors_output and not args.query_file:
        parser.error("--query-vectors-output requires --query-file")
    if args.query_interval < 1:
        parser.error("--query-interval must be at least 1 second")
    # Secret Manager values are expected to be newline-free, but strip at the
    # process boundary as defense in depth. A pasted CRLF must never become an
    # invalid HTTP header (or appear in a provider error).
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        parser.error("GEMINI_API_KEY environment variable is required")

    host = urllib.parse.urlsplit(args.api).hostname
    if host in ("localhost", "127.0.0.1"):
        import getpass

        token = os.environ.get("SULUAN_SERVICE_TOKEN") or getpass.getpass(
            "Short-lived embedding service token (hidden): "
        )
        token_provider = lambda: token
    else:
        token_provider = lambda: metadata_identity_token(args.audience)

    client = ServiceWorkerClient(args.api, token_provider)
    try:
        if args.query_file:
            with open(args.query_file, encoding="utf-8") as handle:
                probes = json.load(handle)
            with open(args.query_file, "rb") as handle:
                query_file_sha256 = hashlib.sha256(handle.read()).hexdigest()
            vector_artifact = {
                "sourceSha256": query_file_sha256,
                "model": "gemini-embedding-001",
                "taskType": "RETRIEVAL_QUERY",
                "dimensions": EMBED_DIMS,
                "vectors": [],
            }
            for number, probe in enumerate(probes, 1):
                result, vector = process_query(
                    client,
                    api_key,
                    probe["query"],
                    include_vector=True,
                    include_diagnostics=bool(args.query_vectors_output),
                )
                if result.get("semanticStatus") != "ready":
                    raise RuntimeError(
                        f"query {probe['id']} returned "
                        f"semanticStatus={result.get('semanticStatus')}"
                    )
                print(json.dumps(
                    safe_query_result(probe["id"], result),
                    separators=(",", ":"),
                ))
                if args.query_vectors_output:
                    vector_artifact["vectors"].append(
                        {
                            "id": probe["id"],
                            "vector": vector,
                            "chunkDistances": result.get("chunkDistances", {}),
                            "rankedItems": safe_query_result(
                                probe["id"], result
                            )["items"],
                        }
                    )
                if number < len(probes):
                    time.sleep(args.query_interval)
            if args.query_vectors_output:
                output = os.path.abspath(args.query_vectors_output)
                os.makedirs(os.path.dirname(output), exist_ok=True)
                with open(output, "w", encoding="utf-8") as handle:
                    json.dump(vector_artifact, handle, indent=2)
        elif args.query:
            result = process_query(client, api_key, args.query)
            print(json.dumps(result, separators=(",", ":")))
        else:
            run_claims(client, api_key, max_claims=args.max_claims, record_id=args.record_id)
    except urllib.error.HTTPError as error:
        raise SystemExit(
            f"{format_worker_error(error, client.last_token)}; "
            "no automatic retry was attempted"
        ) from None
    except urllib.error.URLError:
        raise SystemExit("Worker unavailable; no automatic retry was attempted") from None
    except RuntimeError as error:
        # Gemini provider failure: quota consumed at claim time is retained by
        # design, claimed chunks stay eligible (claim expires), and nothing is
        # retried here. Never include the key, chunk text, or vectors.
        raise SystemExit(f"{error}; no automatic retry was attempted") from None


if __name__ == "__main__":
    main()
