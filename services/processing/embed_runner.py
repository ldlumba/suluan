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


def process_evaluation_batch(
    client, api_key, probes, source_sha256, *, return_artifact=False
):
    """Embed one frozen suite in one paid provider request."""
    claim = client.json(
        "/api/internal/embeddings/evaluation/claim",
        {
            "sourceSha256": source_sha256,
            "probes": [
                {"id": probe["id"], "query": probe["query"]} for probe in probes
            ],
            "viewer": "MANAGER",
            "page": 1,
            "returnArtifact": return_artifact,
        },
    )
    vectors = embed_texts(
        [probe["query"] for probe in claim["probes"]],
        api_key,
        task_type="RETRIEVAL_QUERY",
    )
    return client.json(
        "/api/internal/embeddings/evaluation/result",
        {
            "claimToken": claim["claimToken"],
            "vectors": [
                {"id": probe["id"], "values": vector}
                for probe, vector in zip(claim["probes"], vectors)
            ],
        },
    )


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
        "--query-vectors-stdout",
        action="store_true",
        help=(
            "Explicit evaluation-only NDJSON export to stdout; requires "
            "--query-file and emits one probe per line"
        ),
    )
    parser.add_argument(
        "--preflight",
        action="store_true",
        help="Verify the frozen suite, corpus, identity, and quota without calling Gemini.",
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
    if args.query_vectors_stdout and not args.query_file:
        parser.error("--query-vectors-stdout requires --query-file")
    if args.preflight and not args.query_file:
        parser.error("--preflight requires --query-file")
    # Secret Manager values are expected to be newline-free, but strip at the
    # process boundary as defense in depth. A pasted CRLF must never become an
    # invalid HTTP header (or appear in a provider error).
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key and not args.preflight:
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
            if not isinstance(probes, list) or not 1 <= len(probes) <= 20:
                parser.error("--query-file must contain between 1 and 20 probes")
            ids = [probe.get("id") for probe in probes]
            if any(not probe_id for probe_id in ids) or len(set(ids)) != len(ids):
                parser.error("--query-file probe ids must be non-empty and unique")
            if args.query_vectors_stdout:
                parser.error(
                    "--query-vectors-stdout is disabled; evaluations persist one "
                    "sanitized artifact in private R2"
                )
            if args.preflight:
                result = client.json(
                    "/api/internal/embeddings/evaluation/preflight",
                    {
                        "sourceSha256": query_file_sha256,
                        "probeCount": len(probes),
                    },
                )
                print(json.dumps(result, separators=(",", ":")))
                if not result.get("ready"):
                    raise RuntimeError("evaluation preflight did not pass")
                return
            result = process_evaluation_batch(
                client,
                api_key,
                probes,
                query_file_sha256,
                return_artifact=bool(args.query_vectors_output),
            )
            summary = {
                key: result.get(key)
                for key in (
                    "semanticStatus",
                    "runId",
                    "artifactKey",
                    "artifactSha256",
                    "sourceSha256",
                    "corpusSnapshot",
                    "probeCount",
                )
            }
            print(json.dumps(summary, separators=(",", ":")))
            if args.query_vectors_output:
                vector_artifact = result.get("artifact")
                if not isinstance(vector_artifact, dict):
                    raise RuntimeError("Worker did not return the requested artifact")
                output = os.path.abspath(args.query_vectors_output)
                directory = os.path.dirname(output)
                if directory:
                    os.makedirs(directory, exist_ok=True)
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
