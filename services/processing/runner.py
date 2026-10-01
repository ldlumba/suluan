"""Manager-authorized local job runner; cloud delivery is deliberately deferred."""
import argparse
import getpass
import json
import multiprocessing
import os
import urllib.error
import urllib.parse
import urllib.request

from extraction import ExtractionError, MAX_BYTES, extract


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a bearer token to another destination.


def extract_child(connection, data, mime):
    try:
        connection.send({"status": "EXTRACTED", "result": extract(data, mime)})
    except ExtractionError as error:
        connection.send({"status": "FAILED", "errorCode": str(error)})
    except Exception:
        connection.send({"status": "FAILED", "errorCode": "PROCESSOR_FAILED"})
    finally:
        connection.close()


def bounded_extract(data, mime, timeout=60):
    # A parser cannot hold the claim indefinitely. Spawn also isolates crashes.
    ctx = multiprocessing.get_context("spawn")
    receiver, sender = ctx.Pipe(duplex=False)
    process = ctx.Process(target=extract_child, args=(sender, data, mime))
    process.start()
    sender.close()
    try:
        if receiver.poll(timeout):
            try:
                return receiver.recv()
            except EOFError:
                return {"status": "FAILED", "errorCode": "PROCESSOR_FAILED"}
        return {"status": "FAILED", "errorCode": "PROCESSING_LIMIT"}
    finally:
        if process.is_alive():
            process.terminate()
        process.join()
        receiver.close()


class WorkerClient:
    def __init__(self, base, token):
        url = urllib.parse.urlsplit(base)
        if url.scheme != "http" or url.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("This local runner requires a localhost Worker URL")
        if url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
            raise ValueError("Use the Worker origin only")
        self.base, self.token = base.rstrip("/"), token
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, path, body=None):
        headers = {"Authorization": f"Bearer {self.token}"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, headers=headers)
        return self.opener.open(request, timeout=90)

    def json(self, path, body=None):
        with self.request(path, body) as response:
            return json.load(response)


def run_job(client, job_id):
    prefix = f"/api/processing/{job_id}"
    claim = client.json(prefix + "/claim", {})
    try:
        with client.request(f"/api/submissions/{claim['submissionId']}/download") as response:
            data = response.read(MAX_BYTES + 1)
            mime = response.headers.get_content_type()
        outcome = bounded_extract(data, mime)
    except (OSError, urllib.error.URLError):
        outcome = {"status": "FAILED", "errorCode": "DOWNLOAD_FAILED"}
    # If this POST fails, never pretend completion. The lease expires and
    # a later run can reclaim. The endpoint safely accepts identical retries.
    client.json(prefix + "/result", {"claimToken": claim["claimToken"], **outcome})
    return outcome["status"], outcome.get("errorCode")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://localhost:8787")
    parser.add_argument("--job", help="Job UUID to process; omit to list jobs")
    parser.add_argument("--retry", action="store_true", help="Explicitly requeue a failed --job first")
    args = parser.parse_args()
    if args.retry and not args.job:
        parser.error("--retry requires --job")
    if args.job:
        import uuid
        args.job = str(uuid.UUID(args.job))
    token = os.environ.get("SULUAN_ID_TOKEN") or getpass.getpass("Manager Firebase ID token (hidden): ")
    client = WorkerClient(args.api, token)
    try:
        if not args.job:
            for job in client.json("/api/processing/jobs"):
                print(job["id"], job["status"], job["errorCode"] or "", job["title"])
            return
        if args.retry:
            client.json(f"/api/processing/{args.job}/retry", {})
        status, error = run_job(client, args.job)
        print(args.job, status, error or "")
        if status == "FAILED":
            raise SystemExit(1)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Worker returned HTTP {error.code}; check authorization/job state") from None
    except urllib.error.URLError:
        raise SystemExit("Worker unavailable; completion was not confirmed") from None


if __name__ == "__main__":
    main()
