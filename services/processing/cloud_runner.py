"""Bounded Cloud Run Job that pulls extraction claims through the Worker."""

import argparse
import base64
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from extraction import MAX_BYTES
from runner import NoRedirect, bounded_extract

METADATA_IDENTITY_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/identity"
)

# workers.dev enforces a browser-integrity check that rejects bare
# non-browser clients (Cloudflare error 1010) before the Worker runs.
# Identify the job honestly while remaining an fetchable client.
USER_AGENT = "Mozilla/5.0 (compatible; SULUAN-Processing-Job/1.0)"


class ServiceWorkerClient:
    def __init__(self, base, token_provider):
        url = urllib.parse.urlsplit(base)
        local = url.hostname in ("localhost", "127.0.0.1")
        if url.scheme not in (("http", "https") if local else ("https",)):
            raise ValueError("Remote Worker URLs require HTTPS")
        if url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
            raise ValueError("Use the Worker origin only")
        self.base = base.rstrip("/")
        self.token_provider = token_provider
        self.opener = urllib.request.build_opener(NoRedirect)
        self.last_token = ""

    def request(self, path, body=None):
        token = self.token_provider()
        self.last_token = token or ""
        headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": USER_AGENT,
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, headers=headers)
        return self.opener.open(request, timeout=90)

    def json(self, path, body=None):
        with self.request(path, body) as response:
            if response.status == 204:
                return None
            return json.load(response)


def metadata_identity_token(audience, opener=None):
    """Obtain the job service account's short-lived, audience-bound ID token."""
    query = urllib.parse.urlencode({"audience": audience, "format": "full"})
    request = urllib.request.Request(
        f"{METADATA_IDENTITY_URL}?{query}",
        headers={"Metadata-Flavor": "Google"},
    )
    client = opener or urllib.request.build_opener(NoRedirect)
    with client.open(request, timeout=10) as response:
        return response.read().decode().strip()


def decode_jwt_payload(token):
    """Decode the unverified JWT payload for diagnostics; never logs the token."""
    try:
        segment = (token or "").split(".")[1]
        padding = "=" * (-len(segment) % 4)
        return json.loads(base64.urlsafe_b64decode(segment + padding).decode())
    except Exception:
        return {}


def safe_token_summary(token):
    claims = decode_jwt_payload(token)
    return {
        key: claims[key] for key in ("aud", "email", "iss", "exp") if key in claims
    }


def read_error_body(error, limit=500):
    try:
        return error.read().decode(errors="replace")[:limit]
    except Exception:
        return ""


def format_worker_error(error, token=""):
    """Safe one-line diagnostic: status, path, Worker body, token claims only."""
    url = getattr(error, "url", "") or ""
    path = urllib.parse.urlsplit(url).path or url
    return (
        f"{path or 'request'} -> Worker returned HTTP {error.code}: "
        f"{read_error_body(error) or 'no body'} "
        f"(token={safe_token_summary(token)})"
    )


def process_claim(client, claim):
    prefix = f"/api/internal/processing/{claim['jobId']}"
    query = urllib.parse.urlencode({"claimToken": claim["claimToken"]})
    try:
        with client.request(f"{prefix}/download?{query}") as response:
            data = response.read(MAX_BYTES + 1)
            mime = response.headers.get_content_type()
        outcome = bounded_extract(data, mime)
    except urllib.error.HTTPError as error:
        print(
            f"download failed: {format_worker_error(error, client.last_token)}",
            file=sys.stderr,
        )
        outcome = {"status": "FAILED", "errorCode": "DOWNLOAD_FAILED"}
    except (OSError, urllib.error.URLError):
        outcome = {"status": "FAILED", "errorCode": "DOWNLOAD_FAILED"}
    client.json(f"{prefix}/result", {"claimToken": claim["claimToken"], **outcome})
    return outcome["status"], outcome.get("errorCode")


def run_claims(client, *, max_jobs=5, emit=print):
    completed = 0
    for _ in range(max_jobs):
        claim = client.json("/api/internal/processing/claim", {})
        if claim is None:
            emit(f"no claimable jobs; completed={completed}")
            return completed
        status, error = process_claim(client, claim)
        completed += 1
        emit(f"{claim['jobId']} {status} {error or ''}".rstrip())
    emit(f"stopped at the explicit {max_jobs}-job execution bound")
    return completed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default=os.environ.get("SULUAN_API_BASE"))
    parser.add_argument("--audience", default=os.environ.get("SULUAN_WORKER_AUDIENCE"))
    parser.add_argument(
        "--max-jobs", type=int, default=int(os.environ.get("SULUAN_MAX_JOBS", "5"))
    )
    args = parser.parse_args()
    if not args.api or not args.audience:
        parser.error("--api and --audience (or their environment variables) are required")
    if not 1 <= args.max_jobs <= 10:
        parser.error("--max-jobs must be between 1 and 10")

    host = urllib.parse.urlsplit(args.api).hostname
    if host in ("localhost", "127.0.0.1"):
        token = os.environ.get("SULUAN_SERVICE_TOKEN") or getpass.getpass(
            "Short-lived processing service token (hidden): "
        )
        token_provider = lambda: token
    else:
        token_provider = lambda: metadata_identity_token(args.audience)

    client = ServiceWorkerClient(args.api, token_provider)
    try:
        run_claims(client, max_jobs=args.max_jobs)
    except urllib.error.HTTPError as error:
        raise SystemExit(
            f"{format_worker_error(error, client.last_token)}; "
            "no automatic retry was attempted"
        ) from None
    except urllib.error.URLError:
        raise SystemExit("Worker unavailable; no automatic retry was attempted") from None


if __name__ == "__main__":
    main()
