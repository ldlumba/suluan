"""Local extraction core; no network, database, OCR, or model calls.

Text is untrusted document data. Limits are conservative development
implementation bounds, not institutional upload/indexing policy.
"""
import hashlib
import io
import unicodedata
import zipfile

import pymupdf
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

MAX_BYTES = 30 * 1024 * 1024
MAX_TEXT = 500_000
MAX_PAGES = 1000
MAX_EXPANDED_BYTES = 100 * 1024 * 1024


class ExtractionError(Exception):
    """Stable error code only: never log document contents or parser errors."""


def normalize(text):
    text = unicodedata.normalize("NFC", text.replace("\r\n", "\n"))
    return "\n".join(line.rstrip() for line in text.replace("\x00", "").splitlines()).strip()


def extract(data, mime_type):
    if not data or len(data) > MAX_BYTES:
        raise ExtractionError("PROCESSING_LIMIT")
    parts = []
    total = 0

    def append(text):
        nonlocal total
        text = normalize(text)
        total += len(text) + 2
        if total > MAX_TEXT:
            raise ExtractionError("PROCESSING_LIMIT")
        parts.append(text)

    warnings = []
    pages = None
    try:
        if mime_type == "application/pdf":
            if not data.startswith(b"%PDF-"):
                raise ExtractionError("INVALID_DOCUMENT")
            with pymupdf.open(stream=data, filetype="pdf") as doc:
                if doc.needs_pass:
                    raise ExtractionError("ENCRYPTED_DOCUMENT")
                pages = len(doc)
                if not 0 < pages <= MAX_PAGES:
                    raise ExtractionError("PROCESSING_LIMIT")
                for page in doc:
                    text = page.get_text(sort=True)
                    if not text.strip() and not warnings:
                        warnings.append("PAGES_WITHOUT_TEXT")
                    append(text)
            parser = f"pymupdf/{pymupdf.VersionBind};suluan-extraction/1"
        elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            # Inspect the ZIP before python-docx expands XML into memory.
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                if len(entries) > 2000 or sum(e.file_size for e in entries) > MAX_EXPANDED_BYTES:
                    raise ExtractionError("PROCESSING_LIMIT")
                if any(e.flag_bits & 1 for e in entries):
                    raise ExtractionError("ENCRYPTED_DOCUMENT")
            doc = Document(io.BytesIO(data))
            # Preserve paragraph/table order. DOCX has no reliable page count.
            for block in doc.iter_inner_content():
                if isinstance(block, Paragraph):
                    append(block.text)
                elif isinstance(block, Table):
                    for row in block.rows:
                        append("\t".join(cell.text for cell in row.cells))
            parser = "python-docx/1.2.0;suluan-extraction/1"
        else:
            raise ExtractionError("INVALID_DOCUMENT")
    except ExtractionError:
        raise
    except Exception:
        raise ExtractionError("INVALID_DOCUMENT") from None
    text = "\n\n".join(parts).strip()
    if not text:
        raise ExtractionError("NO_EXTRACTABLE_TEXT")
    return {"text": text, "sha256": hashlib.sha256(data).hexdigest(),
            "parser": parser, "pageCount": pages, "warnings": warnings}
