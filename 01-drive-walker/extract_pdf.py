"""PDF text extraction using pdfminer.six."""

from __future__ import annotations

import io

from pdfminer.high_level import extract_text_to_fp
from pdfminer.layout import LAParams


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extract plain text from PDF bytes. Returns empty string for image-only PDFs."""
    output = io.StringIO()
    try:
        extract_text_to_fp(
            io.BytesIO(pdf_bytes),
            output,
            laparams=LAParams(),
            output_type="text",
            codec="utf-8",
        )
    except Exception:
        return ""
    return output.getvalue()
