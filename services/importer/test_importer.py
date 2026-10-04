import io
import json
import tempfile
import unittest
from pathlib import Path

from importer import (
    Catalog,
    ImportValidationError,
    WorkerClient,
    build_plan,
    deterministic_key,
    multipart_body,
    parse_manifest,
)

SCHOOL_ID = "10000000-0000-4000-8000-000000000001"
COURSE_ID = "20000000-0000-4000-8000-000000000001"


def catalog():
    return Catalog(
        [
            {
                "id": SCHOOL_ID,
                "name": "School of Business",
                "courses": [{"id": COURSE_ID, "name": "BS Tourism Management"}],
            }
        ]
    )


class ImporterTests(unittest.TestCase):
    def write_pair(self, root, stem="paper", suffix=".pdf", metadata=None):
        metadata = metadata or """---
title: A Public Research Paper
authors:
  - Dela Cruz, Juan
school: School of Business
course: BS Tourism Management
---

This body is an operator note and is not imported.
"""
        manifest = root / f"{stem}.md"
        document = root / f"{stem}{suffix}"
        manifest.write_text(metadata, encoding="utf-8")
        document.write_bytes(b"paper bytes")
        return manifest, document

    def test_parses_front_matter_and_ignores_body(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest_path, _ = self.write_pair(Path(directory))
            manifest = parse_manifest(manifest_path)
            self.assertEqual(manifest.title, "A Public Research Paper")
            self.assertEqual(manifest.authors, ("Dela Cruz, Juan",))
            self.assertNotIn("operator note", manifest.title)

    def test_rejects_unknown_manifest_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "paper.md"
            path.write_text("---\ntitle: Paper\nyear: 2020\n---\n", encoding="utf-8")
            with self.assertRaisesRegex(ImportValidationError, "Unknown manifest fields: year"):
                parse_manifest(path)

    def test_builds_resolved_plan_and_infers_unique_course_school(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_pair(
                root,
                metadata="""---
title: Tourism Paper
course: BS Tourism Management
---
""",
            )
            items, errors, warnings, skipped = build_plan(
                root, "https://worker.example", catalog()
            )
            self.assertEqual(errors, [])
            self.assertEqual(warnings, [])
            self.assertEqual(skipped, [])
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0].selection.school, "School of Business")
            self.assertEqual(items[0].selection.school_id, SCHOOL_ID)
            self.assertEqual(items[0].selection.course_id, COURSE_ID)

    def test_reports_legacy_doc_but_skips_unmanifested_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_pair(root, stem="legacy", suffix=".doc")
            (root / "orphan.pdf").write_bytes(b"paper")
            items, errors, _, skipped = build_plan(
                root, "https://worker.example", catalog()
            )
            self.assertEqual(items, [])
            self.assertTrue(any("legacy .doc is unsupported" in error for error in errors))
            self.assertEqual(skipped[0]["document"], "orphan.pdf")
            self.assertEqual(skipped[0]["reason"], "no manifest (out of import scope)")

    def test_strict_mode_rejects_unmanifested_documents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "orphan.pdf").write_bytes(b"paper")
            items, errors, _, skipped = build_plan(
                root, "https://worker.example", catalog(), strict=True
            )
            self.assertEqual(items, [])
            self.assertEqual(skipped, [])
            self.assertTrue(any("matching .md manifest is missing" in error for error in errors))

    def test_no_title_marker_always_skips_even_with_invalid_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_pair(
                root,
                stem="Abines - [NO TITLE]",
                metadata="not valid front matter",
            )
            items, errors, _, skipped = build_plan(
                root, "https://worker.example", catalog(), strict=True
            )
            self.assertEqual(items, [])
            self.assertEqual(errors, [])
            self.assertEqual(skipped[0]["reason"], "marked [NO TITLE]")

    def test_empty_folder_is_not_a_successful_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            items, errors, _, skipped = build_plan(
                Path(directory), "https://worker.example", catalog()
            )
            self.assertEqual(items, [])
            self.assertEqual(skipped, [])
            self.assertEqual(
                errors, ["No importable PDF/DOCX + Markdown pairs were found"]
            )

    def test_idempotency_key_is_stable_and_environment_scoped(self):
        path = Path("school/paper.pdf")
        first = deterministic_key("https://dev.example", path, "abc")
        self.assertEqual(first, deterministic_key("https://dev.example/", path, "abc"))
        self.assertNotEqual(first, deterministic_key("https://prod.example", path, "abc"))

    def test_multipart_uses_catalog_ids_and_omits_removed_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_pair(root)
            items, errors, _, _ = build_plan(root, "https://worker.example", catalog())
            self.assertEqual(errors, [])
            body, content_type = multipart_body(items[0])
            self.assertIn("multipart/form-data", content_type)
            self.assertIn(SCHOOL_ID.encode(), body)
            self.assertIn(COURSE_ID.encode(), body)
            self.assertNotIn(b'researchType', body)
            self.assertNotIn(b'name="year"', body)

    def test_remote_worker_requires_https_and_origin_only(self):
        with self.assertRaisesRegex(ValueError, "require HTTPS"):
            WorkerClient("http://worker.example", "token")
        with self.assertRaisesRegex(ValueError, "origin only"):
            WorkerClient("https://worker.example/api", "token")

    def test_catalog_request_sends_token_and_compatible_user_agent(self):
        captured = {}

        class Response(io.BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        class Opener:
            def open(self, request, timeout):
                captured["authorization"] = request.get_header("Authorization")
                captured["userAgent"] = request.get_header("User-agent")
                return Response(json.dumps([]).encode())

        client = WorkerClient("https://worker.example", "secret-token", Opener())
        client.catalog()
        self.assertEqual(captured["authorization"], "Bearer secret-token")
        self.assertIn("SULUAN-Legacy-Importer", captured["userAgent"])

    def test_importer_requires_manager_or_admin_profile(self):
        class Response(io.BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        class Opener:
            def open(self, request, timeout):
                return Response(json.dumps({"role": "USER"}).encode())

        client = WorkerClient("https://worker.example", "token", Opener())
        with self.assertRaisesRegex(RuntimeError, "repository manager or admin"):
            client.profile()


if __name__ == "__main__":
    unittest.main()
