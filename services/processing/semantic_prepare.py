"""Paced local operator for manager-authorized semantic preparation."""

import argparse
import getpass
import json
import os
import time
import urllib.error

from operator_client import OperatorWorkerClient


def run_batches(client, *, max_batches=20, interval=30, sleep=time.sleep, emit=print):
    """Run explicit, idempotent batches without automatically retrying failures."""
    total = 0
    for number in range(1, max_batches + 1):
        result = client.json("/api/search/semantic/prepare", {})
        embedded = int(result.get("embedded", 0))
        total += embedded
        emit(
            f"batch {number}: embedded={embedded} "
            f"papers={int(result.get('papers', 0))} total={total}"
        )
        if result.get("stopped"):
            emit(f"stopped: {result['stopped']}")
            return total
        if not result.get("hasMore", False):
            emit("semantic preparation complete")
            return total
        if number < max_batches:
            emit(f"waiting {interval} seconds before the next paid call")
            sleep(interval)
    emit(f"stopped after the explicit {max_batches}-batch safety maximum")
    return total


def error_message(error):
    """Read only the Worker's safe operator message; never print credentials."""
    try:
        payload = json.load(error)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return f"Worker returned HTTP {error.code}"
    # The Worker truncates provider details and never includes credentials or
    # document text. Prefer that stable diagnostic over the generic operator
    # message so a stopped run can distinguish quota, billing, and availability.
    reason = payload.get("reason")
    message = payload.get("message")
    code = payload.get("error")
    detail = reason if isinstance(reason, str) else message if isinstance(message, str) else code
    return f"Worker returned HTTP {error.code}: {detail or 'request failed'}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://localhost:8787")
    parser.add_argument("--interval", type=int, default=30)
    parser.add_argument("--max-batches", type=int, default=20)
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="Explicitly allow sending the manager token to a validated HTTPS origin",
    )
    args = parser.parse_args()
    if args.interval < 30:
        parser.error("--interval must be at least 30 seconds")
    if not 1 <= args.max_batches <= 20:
        parser.error("--max-batches must be between 1 and 20")

    token = os.environ.get("SULUAN_ID_TOKEN") or getpass.getpass(
        "Manager Firebase ID token (hidden): "
    )
    client = OperatorWorkerClient(
        args.api,
        token,
        allow_remote=args.allow_remote,
    )
    try:
        run_batches(
            client,
            max_batches=args.max_batches,
            interval=args.interval,
        )
    except urllib.error.HTTPError as error:
        raise SystemExit(error_message(error)) from None
    except urllib.error.URLError:
        raise SystemExit("Worker unavailable; no automatic retry was attempted") from None


if __name__ == "__main__":
    main()
