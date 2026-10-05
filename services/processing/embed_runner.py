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


def gemini_body(texts):
    """Batch embedding request with the asymmetric document task type."""
    return {
        "requests": [
            {
                "model": "models/gemini-embedding-001",
                "content": {"parts": [{"text": text}]},
                "taskType": "RETRIEVAL_DOCUMENT",
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


def embed_texts(texts, api_key, opener=None):
    """One bounded Gemini call from this pinned region. No retries here."""
    if not api_key:
        raise ValueError("A Gemini API key is required")
    data = json.dumps(gemini_body(texts)).encode()
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
        "--record-id",
        default=os.environ.get("SULUAN_RECORD_ID"),
        help="Scope claims to one record (tests and single-paper recovery). Omit to drain the backlog.",
    )
    args = parser.parse_args()
    if not args.api or not args.audience:
        parser.error("--api and --audience (or their environment variables) are required")
    if not 1 <= args.max_claims <= 10:
        parser.error("--max-claims must be between 1 and 10")
    api_key = os.environ.get("GEMINI_API_KEY")
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
