"""Validated, manager-authorized legacy-paper importer for SULUAN."""

import argparse
import getpass
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import yaml

MAX_BYTES = 30 * 1024 * 1024
SUPPORTED_SUFFIXES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MANIFEST_KEYS = {"title", "authors", "school", "course"}
USER_AGENT = "Mozilla/5.0 (compatible; SULUAN-Legacy-Importer/1.0)"


class ImportValidationError(ValueError):
    pass


class ImportRequestError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a bearer token to another origin.


@dataclass(frozen=True)
class Manifest:
    path: Path
    title: str
    authors: tuple[str, ...]
    school: str | None
    course: str | None


@dataclass(frozen=True)
class CatalogSelection:
    school_id: str | None
    school: str | None
    course_id: str | None
    course: str | None


@dataclass(frozen=True)
class ImportItem:
    manifest_path: Path
    document_path: Path
    title: str
    authors: tuple[str, ...]
    selection: CatalogSelection
    size_bytes: int
    sha256: str
    idempotency_key: str


class Catalog:
    def __init__(self, payload):
        if not isinstance(payload, list):
            raise ImportValidationError("Catalog response must be a list")
        self.schools = {}
        self.course_matches = {}
        for raw_school in payload:
            if not isinstance(raw_school, dict):
                raise ImportValidationError("Catalog contains an invalid school")
            school_id = raw_school.get("id")
            school_name = raw_school.get("name")
            raw_courses = raw_school.get("courses")
            if not all(isinstance(value, str) for value in (school_id, school_name)):
                raise ImportValidationError("Catalog school is missing id or name")
            if not isinstance(raw_courses, list):
                raise ImportValidationError(f"Catalog school {school_name!r} has invalid courses")
            courses = {}
            for raw_course in raw_courses:
                if not isinstance(raw_course, dict):
                    raise ImportValidationError(f"Catalog school {school_name!r} has an invalid course")
                course_id = raw_course.get("id")
                course_name = raw_course.get("name")
                if not all(isinstance(value, str) for value in (course_id, course_name)):
                    raise ImportValidationError(f"Catalog school {school_name!r} has an incomplete course")
                courses[course_name] = course_id
                self.course_matches.setdefault(course_name, []).append(
                    (school_id, school_name, course_id)
                )
            self.schools[school_name] = (school_id, courses)

    def resolve(self, school, course):
        school_id = None
        courses = None
        if school is not None:
            found = self.schools.get(school)
            if found is None:
                raise ImportValidationError(f"Unknown school {school!r}")
            school_id, courses = found

        if course is None:
            return CatalogSelection(school_id, school, None, None)

        if courses is not None:
            course_id = courses.get(course)
            if course_id is None:
                raise ImportValidationError(
                    f"Course {course!r} does not belong to school {school!r}"
                )
            return CatalogSelection(school_id, school, course_id, course)

        matches = self.course_matches.get(course, [])
        if not matches:
            raise ImportValidationError(f"Unknown course {course!r}")
        if len(matches) != 1:
            schools = ", ".join(match[1] for match in matches)
            raise ImportValidationError(
                f"Course {course!r} is ambiguous; specify one of: {schools}"
            )
        inferred_school_id, inferred_school, course_id = matches[0]
        return CatalogSelection(
            inferred_school_id, inferred_school, course_id, course
        )


class WorkerClient:
    def __init__(self, base, token, opener=None):
        url = urllib.parse.urlsplit(base)
        local = url.hostname in ("localhost", "127.0.0.1")
        if url.scheme not in (("http", "https") if local else ("https",)):
            raise ValueError("Remote Worker URLs require HTTPS")
        if url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
            raise ValueError("Use the Worker origin only")
        if not token:
            raise ValueError("A manager Firebase ID token is required")
        self.base = base.rstrip("/")
        self.token = token
        self.opener = opener or urllib.request.build_opener(NoRedirect)

    def request(self, path, data=None, headers=None, timeout=120):
        request_headers = {
            "Authorization": f"Bearer {self.token}",
            "User-Agent": USER_AGENT,
            **(headers or {}),
        }
        request = urllib.request.Request(
            self.base + path, data=data, headers=request_headers
        )
        try:
            return self.opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read().decode(errors="replace"))
                detail = body.get("error") or body.get("message") or "request_failed"
            except Exception:
                detail = "request_failed"
            raise ImportRequestError(f"Worker returned HTTP {error.code}: {detail}") from None
        except urllib.error.URLError:
            raise ImportRequestError("Worker is unavailable; submission was not confirmed") from None

    def catalog(self):
        with self.request("/api/schools") as response:
            return Catalog(json.load(response))

    def profile(self):
        with self.request("/api/me") as response:
            profile = json.load(response)
        if not isinstance(profile, dict) or profile.get("role") not in (
            "REPOSITORY_MANAGER",
            "ADMIN",
        ):
            raise ImportRequestError(
                "The authenticated account must be a repository manager or admin"
            )
        return profile

    def submit(self, item):
        body, content_type = multipart_body(item)
        with self.request(
            "/api/submissions",
            data=body,
            headers={"Content-Type": content_type},
            timeout=180,
        ) as response:
            return response.status, json.load(response)


def parse_manifest(path):
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        raise ImportValidationError("Manifest must be UTF-8") from None
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ImportValidationError("Manifest must start with YAML front matter (---)")
    try:
        closing = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration:
        raise ImportValidationError("Manifest front matter is missing its closing ---") from None
    try:
        metadata = yaml.safe_load("\n".join(lines[1:closing])) or {}
    except yaml.YAMLError as error:
        raise ImportValidationError(f"Invalid YAML: {error.problem or 'parse error'}") from None
    if not isinstance(metadata, dict):
        raise ImportValidationError("Manifest front matter must be a mapping")
    unknown = sorted(set(metadata) - MANIFEST_KEYS)
    if unknown:
        raise ImportValidationError(f"Unknown manifest fields: {', '.join(unknown)}")

    title = metadata.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ImportValidationError("title is required")
    title = " ".join(title.split())
    if len(title) > 500:
        raise ImportValidationError("title exceeds 500 characters")

    raw_authors = metadata.get("authors", [])
    if raw_authors is None:
        raw_authors = []
    if not isinstance(raw_authors, list) or any(
        not isinstance(author, str) or not author.strip() for author in raw_authors
    ):
        raise ImportValidationError("authors must be a list of non-empty names")
    authors = tuple(" ".join(author.split()) for author in raw_authors)
    if len("\n".join(authors)) > 2000:
        raise ImportValidationError("authors exceed the 2,000-character limit")

    school = optional_string(metadata, "school")
    course = optional_string(metadata, "course")
    return Manifest(path, title, authors, school, course)


def optional_string(metadata, key):
    value = metadata.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ImportValidationError(f"{key} must be a non-empty string when present")
    return " ".join(value.split())


def file_key(root, path):
    relative = path.relative_to(root)
    return (relative.parent.as_posix().casefold(), relative.stem.casefold())


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def deterministic_key(api_base, relative_path, digest):
    identity = f"{api_base.rstrip('/')}\n{relative_path.as_posix()}\n{digest}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, identity))


def build_plan(root, api_base, catalog):
    root = root.resolve()
    manifests = [path for path in root.rglob("*.md") if path.is_file()]
    documents = [
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.casefold() in {*SUPPORTED_SUFFIXES, ".doc"}
    ]
    manifest_map = {}
    document_map = {}
    errors = []
    warnings = []
    for path in manifests:
        manifest_map.setdefault(file_key(root, path), []).append(path)
    for path in documents:
        document_map.setdefault(file_key(root, path), []).append(path)

    for key, paths in document_map.items():
        if not manifest_map.get(key):
            errors.append(f"{paths[0].relative_to(root)}: matching .md manifest is missing")
    for key, paths in manifest_map.items():
        if not document_map.get(key):
            warnings.append(f"{paths[0].relative_to(root)}: no matching document; ignored")

    items = []
    for key in sorted(set(manifest_map) & set(document_map)):
        manifest_paths = manifest_map[key]
        document_paths = document_map[key]
        label = manifest_paths[0].relative_to(root)
        if len(manifest_paths) != 1:
            errors.append(f"{label}: multiple manifests match the same stem")
            continue
        if len(document_paths) != 1:
            names = ", ".join(path.name for path in document_paths)
            errors.append(f"{label}: expected one document, found {names}")
            continue
        document_path = document_paths[0]
        if document_path.suffix.casefold() == ".doc":
            errors.append(
                f"{document_path.relative_to(root)}: legacy .doc is unsupported; convert it to .docx"
            )
            continue
        try:
            manifest = parse_manifest(manifest_paths[0])
            selection = catalog.resolve(manifest.school, manifest.course)
            size = document_path.stat().st_size
            if size == 0:
                raise ImportValidationError("document is empty")
            if size > MAX_BYTES:
                raise ImportValidationError("document exceeds the 30 MB limit")
            digest = sha256_file(document_path)
            relative_document = document_path.relative_to(root)
            items.append(
                ImportItem(
                    manifest.path,
                    document_path,
                    manifest.title,
                    manifest.authors,
                    selection,
                    size,
                    digest,
                    deterministic_key(api_base, relative_document, digest),
                )
            )
        except (ImportValidationError, OSError) as error:
            errors.append(f"{label}: {error}")
    if not items and not errors:
        errors.append("No importable PDF/DOCX + Markdown pairs were found")
    return items, errors, warnings


def multipart_body(item):
    boundary = f"----suluan-{uuid.uuid4().hex}"
    chunks = []

    def field(name, value):
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )

    field("idempotencyKey", item.idempotency_key)
    field("title", item.title)
    if item.authors:
        field("authors", "\n".join(item.authors))
    if item.selection.school_id:
        field("schoolId", item.selection.school_id)
    if item.selection.course_id:
        field("courseId", item.selection.course_id)

    safe_name = (
        item.document_path.name.replace("\\", "_")
        .replace('"', "_")
        .replace("\r", "_")
        .replace("\n", "_")
    )
    mime = SUPPORTED_SUFFIXES[item.document_path.suffix.casefold()]
    chunks.extend(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'.encode(),
            f"Content-Type: {mime}\r\n\r\n".encode(),
            item.document_path.read_bytes(),
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def report_item(root, item):
    return {
        "manifest": item.manifest_path.relative_to(root).as_posix(),
        "document": item.document_path.relative_to(root).as_posix(),
        "title": item.title,
        "authors": list(item.authors),
        "school": item.selection.school,
        "course": item.selection.course,
        "sizeBytes": item.size_bytes,
        "sha256": item.sha256,
        "idempotencyKey": item.idempotency_key,
        "status": "validated",
    }


def write_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path, help="Folder containing paired .md and PDF/DOCX files")
    parser.add_argument(
        "--api", default=os.environ.get("SULUAN_API_BASE", "http://localhost:8787")
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Upload validated papers; without this flag the command is a dry run",
    )
    parser.add_argument("--pace-seconds", type=float, default=1.0)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if not args.folder.is_dir():
        parser.error("folder must be an existing directory")
    if args.pace_seconds < 0:
        parser.error("--pace-seconds cannot be negative")

    token = os.environ.get("SULUAN_ID_TOKEN") or getpass.getpass(
        "Manager Firebase ID token (hidden): "
    )
    client = WorkerClient(args.api, token)
    try:
        client.profile()
        catalog = client.catalog()
    except ImportRequestError as error:
        raise SystemExit(str(error)) from None

    root = args.folder.resolve()
    items, errors, warnings = build_plan(root, client.base, catalog)
    report_path = (args.report or root / "suluan-import-report.json").resolve()
    report = {
        "mode": "apply" if args.apply else "dry-run",
        "api": client.base,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "validated": len(items),
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "errors": errors,
        "warnings": warnings,
        "items": [report_item(root, item) for item in items],
    }
    write_report(report_path, report)
    print(
        f"Validated {len(items)} paper(s): {len(errors)} error(s), "
        f"{len(warnings)} warning(s). Report: {report_path}"
    )
    if errors:
        raise SystemExit(2)
    if not args.apply:
        print("Dry run only; no files were uploaded. Re-run with --apply after review.")
        return

    for index, (item, result) in enumerate(zip(items, report["items"])):
        try:
            status, response = client.submit(item)
            result.update(
                {
                    "status": "created" if status == 201 else "replayed",
                    "submissionId": response["id"],
                    "submissionStatus": response["status"],
                }
            )
            write_report(report_path, report)
            print(
                f"[{index + 1}/{len(items)}] {result['status']}: "
                f"{result['document']} -> {result['submissionId']}"
            )
        except (ImportRequestError, OSError, KeyError) as error:
            result.update({"status": "failed", "error": str(error)})
            report["summary"]["uploadFailed"] = 1
            write_report(report_path, report)
            raise SystemExit(
                f"Stopped after {result['document']}: {error}. "
                "Review the report; no automatic retry was attempted."
            ) from None
        if index + 1 < len(items):
            time.sleep(args.pace_seconds)
    report["summary"]["created"] = sum(
        item["status"] == "created" for item in report["items"]
    )
    report["summary"]["replayed"] = sum(
        item["status"] == "replayed" for item in report["items"]
    )
    write_report(report_path, report)
    print("Import complete. Every confirmed submission remains PENDING for REO review.")


if __name__ == "__main__":
    main()
