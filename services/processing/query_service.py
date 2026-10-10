"""Query-only regional service. A single-use Worker ticket authorizes paid work."""
import hashlib
import hmac
import json
import os
import urllib.error
import uuid

from cloud_runner import ServiceWorkerClient, metadata_identity_token
from embed_runner import embed_texts


def serve_query(body, client, api_key, embed=embed_texts):
    if not isinstance(body, dict) or set(body) != {"ticket", "query"}:
        raise ValueError("invalid request")
    ticket, query = body["ticket"], body["query"]
    if not isinstance(ticket, str) or str(uuid.UUID(ticket)) != ticket:
        raise ValueError("invalid ticket")
    if not isinstance(query, str) or not query.strip() or len(query) > 200:
        raise ValueError("invalid query")
    if not api_key:
        raise RuntimeError("unconfigured")
    # Authenticated callback atomically redeems once BEFORE the provider call.
    grant = client.json("/api/internal/query-tickets/redeem", {"ticket": ticket})
    expected = hashlib.sha256(query.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(grant.get("sha256", ""), expected):
        raise ValueError("query mismatch")
    values = embed([query], api_key, task_type="RETRIEVAL_QUERY")[0]
    return {"values": values}


def application(environ, start_response):
    status, payload = "404 Not Found", {"error": "not_found"}
    if environ.get("PATH_INFO") == "/health" and environ.get("REQUEST_METHOD") == "GET":
        status, payload = "200 OK", {"status": "up"}
    elif environ.get("PATH_INFO") == "/embed" and environ.get("REQUEST_METHOD") == "POST":
        try:
            length = int(environ.get("CONTENT_LENGTH") or "0")
            if not 1 <= length <= 2048:
                raise ValueError("invalid length")
            body = json.loads(environ["wsgi.input"].read(length))
            audience = os.environ["SULUAN_WORKER_AUDIENCE"]
            client = ServiceWorkerClient(
                os.environ["SULUAN_API_BASE"], lambda: metadata_identity_token(audience)
            )
            payload = serve_query(body, client, os.environ.get("GEMINI_API_KEY"))
            status = "200 OK"
        except (ValueError, TypeError):
            status, payload = "400 Bad Request", {"error": "invalid_request"}
        except urllib.error.HTTPError:
            status, payload = "403 Forbidden", {"error": "ticket_denied"}
        except Exception:
            # Never log provider bodies, queries, tickets, or credentials.
            status, payload = "503 Service Unavailable", {"error": "unavailable"}
    data = json.dumps(payload).encode()
    start_response(status, [("Content-Type", "application/json"),
                            ("Cache-Control", "no-store"), ("Content-Length", str(len(data)))])
    return [data]
