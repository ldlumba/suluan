"""Ticket-gated Cloud Run service that starts two bounded repository Jobs."""

import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cloud_runner import NoRedirect, ServiceWorkerClient, metadata_identity_token

METADATA_ACCESS_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/token"
)


def metadata_access_token(opener=None):
    request = urllib.request.Request(
        METADATA_ACCESS_TOKEN_URL,
        headers={"Metadata-Flavor": "Google"},
    )
    client = opener or urllib.request.build_opener(NoRedirect)
    with client.open(request, timeout=10) as response:
        return json.load(response)["access_token"]


def run_job(action, *, project, location, jobs, token_provider=metadata_access_token, opener=None):
    job = jobs.get(action)
    if not job:
        raise ValueError("unsupported operation")
    url = (
        f"https://run.googleapis.com/v2/projects/{project}/locations/"
        f"{location}/jobs/{job}:run"
    )
    request = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "Authorization": f"Bearer {token_provider()}",
            "Content-Type": "application/json",
            "User-Agent": "SULUAN-Operations-Dispatcher/1.0",
        },
    )
    client = opener or urllib.request.build_opener(NoRedirect)
    with client.open(request, timeout=30) as response:
        return json.load(response).get("name", "")


def dispatch(ticket, client, *, project, location, jobs, launch=run_job):
    grant = client.json("/api/internal/repository-operations/redeem", {"ticket": ticket})
    operation_id = grant["operationId"]
    try:
        execution_name = launch(
            grant["action"], project=project, location=location, jobs=jobs
        )
        client.json(
            "/api/internal/repository-operations/result",
            {
                "operationId": operation_id,
                "status": "LAUNCHED",
                "executionName": execution_name,
            },
        )
        return {"operationId": operation_id, "executionName": execution_name}
    except Exception:
        try:
            client.json(
                "/api/internal/repository-operations/result",
                {
                    "operationId": operation_id,
                    "status": "FAILED",
                    "errorCode": "job_launch_failed",
                },
            )
        finally:
            raise


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok"})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/dispatch":
            self._json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 256:
                raise ValueError("invalid body")
            body = json.loads(self.rfile.read(length))
            if set(body) != {"ticket"} or not isinstance(body["ticket"], str):
                raise ValueError("invalid body")
            base = os.environ["SULUAN_API_BASE"]
            audience = os.environ["SULUAN_WORKER_AUDIENCE"]
            client = ServiceWorkerClient(
                base, lambda: metadata_identity_token(audience)
            )
            result = dispatch(
                body["ticket"],
                client,
                project=os.environ["GOOGLE_CLOUD_PROJECT"],
                location=os.environ.get("SULUAN_JOB_LOCATION", "asia-southeast1"),
                jobs={
                    "EXTRACTION": os.environ["SULUAN_PROCESSING_JOB"],
                    "EMBEDDING": os.environ["SULUAN_EMBEDDING_JOB"],
                },
            )
            self._json(202, result)
        except ValueError:
            self._json(400, {"error": "invalid_request"})
        except urllib.error.HTTPError as error:
            if error.code == 409:
                self._json(409, {"error": "stale_ticket"})
            else:
                self._json(502, {"error": "dispatch_failed"})
        except Exception as error:
            print(
                f"dispatch failed type={type(error).__name__} "
                f"status={getattr(error, 'code', 'none')}",
                flush=True,
            )
            self._json(502, {"error": "dispatch_failed"})

    def log_message(self, format, *args):
        # Request paths/status only; tickets and bodies are never logged.
        super().log_message(format, *args)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
