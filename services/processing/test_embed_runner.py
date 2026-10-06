"""Unit tests for the region-stable embedding Job runner (no network)."""

import io
import json
import unittest
import urllib.error

import embed_runner
from embed_runner import (
    gemini_body,
    parse_gemini_vectors,
    process_claim,
    run_claims,
)


def vector_payload(n, dims=768, value=0.1):
    return {"embeddings": [{"values": [value] * dims} for _ in range(n)]}


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class FakeOpener:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        return FakeResponse(self.payload)


class FakeClient:
    """Mimics ServiceWorkerClient.json for claim/result flows."""

    def __init__(self, claims):
        self.claims = list(claims)
        self.posts = []
        self.last_token = ""

    def json(self, path, body=None):
        if path == "/api/internal/embeddings/claim":
            item = self.claims.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        self.posts.append((path, body))
        return {"embedded": len(body["vectors"])}


def claim_fixture(n=2):
    return {
        "claimId": "claim-1",
        "claimToken": "00000000-0000-4000-8000-000000000001",
        "items": [
            {
                "chunkId": f"00000000-0000-4000-8000-00000000000{i}",
                "keywordIndexId": "00000000-0000-4000-8000-000000000010",
                "recordId": "00000000-0000-4000-8000-000000000020",
                "sourceSha256": "a" * 64,
                "content": f"chunk text {i}",
            }
            for i in range(n)
        ],
    }


class EmbedRunnerTests(unittest.TestCase):
    def test_gemini_body_uses_document_task_and_approved_model(self):
        body = gemini_body(["hello", "world"])
        self.assertEqual(len(body["requests"]), 2)
        for request in body["requests"]:
            self.assertEqual(request["model"], "models/gemini-embedding-001")
            self.assertEqual(request["taskType"], "RETRIEVAL_DOCUMENT")
            self.assertEqual(request["outputDimensionality"], 768)

    def test_gemini_body_supports_query_task_for_evaluation(self):
        body = gemini_body(["hello"], "RETRIEVAL_QUERY")
        self.assertEqual(body["requests"][0]["taskType"], "RETRIEVAL_QUERY")

    def test_parse_accepts_matching_vectors(self):
        vectors = parse_gemini_vectors(vector_payload(2), 2)
        self.assertEqual(len(vectors), 2)
        self.assertEqual(len(vectors[0]), 768)

    def test_parse_rejects_count_or_dimension_mismatch(self):
        with self.assertRaises(ValueError):
            parse_gemini_vectors(vector_payload(1), 2)
        with self.assertRaises(ValueError):
            parse_gemini_vectors(vector_payload(2, dims=100), 2)

    def test_embed_texts_sends_api_key_header_not_query_string(self):
        opener = FakeOpener(vector_payload(1))
        vectors = embed_runner.embed_texts(
            ["chunk"], "test-key", opener=opener
        )
        self.assertEqual(len(vectors), 1)
        request = opener.requests[0]
        self.assertNotIn("key=", request.full_url)
        self.assertEqual(request.get_header("X-goog-api-key"), "test-key")

    def test_embed_texts_surfaces_provider_failure_without_retry(self):
        class FailingOpener:
            def open(self, request, timeout=None):
                raise urllib.error.HTTPError(
                    request.full_url, 400, "Bad Request", {}, io.BytesIO(b"{}")
                )

        with self.assertRaisesRegex(RuntimeError, "gemini embed failed"):
            embed_runner.embed_texts(["chunk"], "test-key", opener=FailingOpener())

    def test_process_claim_posts_raw_vectors_for_claimed_chunks(self):
        claim = claim_fixture(2)
        client = FakeClient([claim])
        original = embed_runner.embed_texts
        embed_runner.embed_texts = lambda texts, key: [[0.2] * 768 for _ in texts]
        try:
            embedded = process_claim(client, "test-key", claim)
        finally:
            embed_runner.embed_texts = original
        self.assertEqual(embedded, 2)
        path, body = client.posts[0]
        self.assertEqual(path, "/api/internal/embeddings/result")
        self.assertEqual(body["claimToken"], claim["claimToken"])
        self.assertEqual(
            [v["chunkId"] for v in body["vectors"]],
            [item["chunkId"] for item in claim["items"]],
        )

    def test_run_claims_stops_when_queue_is_empty(self):
        claim = claim_fixture(1)
        client = FakeClient([claim, None])
        original = embed_runner.embed_texts
        embed_runner.embed_texts = lambda texts, key: [[0.2] * 768 for _ in texts]
        try:
            completed, embedded = run_claims(
                client, "test-key", max_claims=5, emit=lambda *a: None
            )
        finally:
            embed_runner.embed_texts = original
        self.assertEqual((completed, embedded), (1, 1))

    def test_run_claims_stops_on_quota_exhaustion_without_retry(self):
        error = urllib.error.HTTPError(
            "https://worker.example/api/internal/embeddings/claim",
            429,
            "Too Many Requests",
            {},
            io.BytesIO(b'{"error":"quota_exhausted"}'),
        )
        client = FakeClient([error])
        messages = []
        completed, embedded = run_claims(
            client, "test-key", max_claims=5, emit=messages.append
        )
        self.assertEqual((completed, embedded), (0, 0))
        self.assertTrue(any("quota" in message for message in messages))

    def test_process_query_can_capture_diagnostics_without_document_text(self):
        class QueryClient:
            def __init__(self):
                self.calls = []

            def json(self, path, body=None):
                self.calls.append((path, body))
                if path.endswith("/query/claim"):
                    return {
                        "claimToken": "00000000-0000-4000-8000-000000000001",
                        "query": "query",
                    }
                return {
                    "semanticStatus": "ready",
                    "items": [],
                    "chunkDistances": {"record-1": [0.2, 0.3]},
                }

        client = QueryClient()
        original = embed_runner.embed_texts
        embed_runner.embed_texts = lambda texts, key, task_type="RETRIEVAL_DOCUMENT": [
            [0.2] * 768
        ]
        try:
            result, vector = embed_runner.process_query(
                client,
                "test-key",
                "query",
                include_vector=True,
                include_diagnostics=True,
            )
        finally:
            embed_runner.embed_texts = original
        self.assertEqual(result["chunkDistances"], {"record-1": [0.2, 0.3]})
        self.assertEqual(len(vector), 768)
        self.assertTrue(client.calls[0][1]["includeDiagnostics"])


if __name__ == "__main__":
    unittest.main()
