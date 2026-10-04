"""Generate non-sensitive Stage 5 document-processing failure fixtures."""

import argparse
import io
import struct
import zipfile
import zlib
from pathlib import Path

import pymupdf


def _raster_png(width=64, height=64):
    """Return a deterministic RGB PNG containing pixels but no text layer."""
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            shade = 48 if (x // 8 + y // 8) % 2 else 208
            row.extend((shade, 96, 255 - shade))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, level=9))
        + chunk(b"IEND", b"")
    )


def build_pilot_fixtures(output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)

    image_only = output / "image-only.pdf"
    with pymupdf.open() as document:
        page = document.new_page()
        page.insert_image(page.rect, stream=_raster_png())
        image_only.write_bytes(document.tobytes())

    malformed_pdf = output / "malformed.pdf"
    malformed_pdf.write_bytes(b"%PDF-1.7\nmalformed pilot fixture\n%%EOF\n")

    encrypted_pdf = output / "encrypted.pdf"
    with pymupdf.open() as document:
        page = document.new_page()
        page.insert_text((72, 72), "Generated encrypted pilot fixture")
        encrypted_pdf.write_bytes(
            document.tobytes(
                encryption=pymupdf.PDF_ENCRYPT_AES_256,
                owner_pw="pilot-owner",
                user_pw="pilot-user",
            )
        )

    malformed_docx = output / "malformed.docx"
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "not valid package XML")
    malformed_docx.write_bytes(data.getvalue())

    return {
        "F01": image_only,
        "F02": malformed_pdf,
        "F03": encrypted_pdf,
        "F04": malformed_docx,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate SULUAN Stage 5 failure fixtures."
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    for fixture_id, path in build_pilot_fixtures(args.output).items():
        print(f"{fixture_id}\t{path}")


if __name__ == "__main__":
    main()
