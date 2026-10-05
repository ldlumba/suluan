"""Manager-authenticated Worker client for explicit local/staging operations."""

import json
import urllib.parse
import urllib.request

from runner import NoRedirect


USER_AGENT = "Mozilla/5.0 (compatible; SULUAN-Semantic-Operator/1.0)"


class OperatorWorkerClient:
    """Send a manager token only to a validated origin.

    Localhost remains the default. A remote origin requires both HTTPS and the
    caller's explicit ``allow_remote=True`` acknowledgement. Redirects are
    disabled so an Authorization header can never follow to another host.
    """

    def __init__(self, base, token, *, allow_remote=False, opener=None):
        url = urllib.parse.urlsplit(base)
        local = url.hostname in ("localhost", "127.0.0.1")
        if not local and not allow_remote:
            raise ValueError("Remote Worker access requires --allow-remote")
        if url.scheme not in (("http", "https") if local else ("https",)):
            raise ValueError("Remote Worker URLs require HTTPS")
        if url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
            raise ValueError("Use the Worker origin only")
        if not token:
            raise ValueError("A manager Firebase ID token is required")
        self.base = base.rstrip("/")
        self.token = token
        self.opener = opener or urllib.request.build_opener(NoRedirect)

    def request(self, path, body=None):
        headers = {
            "Authorization": f"Bearer {self.token}",
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
            return json.load(response)
