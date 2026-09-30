"""Project description discovery and text/metadata extraction."""

from __future__ import annotations

import io
import re

from docx import Document

from config import (
    DESCRIPTION_WORD_LIMIT,
    HEADING_FIELD_ALIASES,
    MIME_TYPE_DOCX,
    MIME_TYPE_GOOGLE_DOC,
    MIME_TYPE_PDF,
    PROJECT_DESCRIPTION_NAME_PATTERN,
)
from drive_client import DriveClient
from extract_pdf import extract_text_from_pdf_bytes


def find_and_read_description(
    drive_client: DriveClient, all_files: list[dict]
) -> tuple[str | None, str | None]:
    """
    Find the project description among all_files and return (text, source_filename).

    Search order:
    1. Google Doc / docx whose filename matches PROJECT_DESCRIPTION_NAME_PATTERN
    2. Any Google Doc / docx whose content contains "project description" (up to 5)
    3. Most recently modified Google Doc / docx (fallback)
    4. Any PDF whose content contains "project description" (up to 3)
    """
    docs = [
        f for f in all_files
        if f.get("mimeType") in {MIME_TYPE_GOOGLE_DOC, MIME_TYPE_DOCX}
    ]
    pdfs = [f for f in all_files if f.get("mimeType") == MIME_TYPE_PDF]

    docs_sorted = sorted(docs, key=lambda x: x.get("modifiedTime", ""), reverse=True)

    # 1. Filename match
    for doc in docs_sorted:
        if PROJECT_DESCRIPTION_NAME_PATTERN.search(doc.get("name", "")):
            text = _read_doc(drive_client, doc)
            if text:
                return truncate_words(text, DESCRIPTION_WORD_LIMIT), doc["name"]

    # 2. Content match in docs
    for doc in docs_sorted:
        text = _read_doc(drive_client, doc)
        if text and re.search(r"project\s+description", text, re.IGNORECASE):
            return truncate_words(text, DESCRIPTION_WORD_LIMIT), doc["name"]

    # 3. PDF content match
    pdfs_sorted = sorted(pdfs, key=lambda x: x.get("modifiedTime", ""), reverse=True)
    for pdf in pdfs_sorted[:3]:
        try:
            pdf_bytes = drive_client.download_file_bytes(pdf["id"])
            text = extract_text_from_pdf_bytes(pdf_bytes)
        except Exception:
            continue
        if text and re.search(r"project\s+description", text, re.IGNORECASE):
            return truncate_words(text, DESCRIPTION_WORD_LIMIT), pdf["name"]

    return None, None


def extract_structured_fields(description_text: str) -> dict:
    lines = [line.strip() for line in description_text.splitlines()]

    extracted: dict[str, str | list[str] | None] = {
        "client_name": None,
        "problem_domain": None,
        "technical_components": [],
        "keywords": [],
    }

    for field, aliases in HEADING_FIELD_ALIASES.items():
        value = _find_heading_value(lines, aliases)
        if value is None:
            continue
        if field in {"technical_components", "keywords"}:
            extracted[field] = _split_list_like_value(value)
        else:
            extracted[field] = value

    return extracted


def truncate_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words])


def _read_doc(drive_client: DriveClient, doc: dict) -> str | None:
    try:
        if doc.get("mimeType") == MIME_TYPE_GOOGLE_DOC:
            return drive_client.export_google_doc_as_text(doc["id"])
        elif doc.get("mimeType") == MIME_TYPE_DOCX:
            file_bytes = drive_client.download_file_bytes(doc["id"])
            document = Document(io.BytesIO(file_bytes))
            return "\n".join(p.text for p in document.paragraphs)
    except Exception:
        return None
    return None


def _find_heading_value(lines: list[str], aliases: list[str]) -> str | None:
    alias_pattern = "|".join(re.escape(alias) for alias in aliases)
    pattern = re.compile(rf"^\s*(?:{alias_pattern})\s*[:\-]\s*(.+)\s*$", re.IGNORECASE)

    for idx, line in enumerate(lines):
        if not line:
            continue
        match = pattern.match(line)
        if match:
            return match.group(1).strip()
        normalized = re.sub(r"\s+", " ", line).strip().lower()
        if normalized in {alias.lower() for alias in aliases}:
            for offset in range(idx + 1, min(idx + 4, len(lines))):
                next_line = lines[offset].strip()
                if next_line:
                    return next_line
    return None


def _split_list_like_value(value: str) -> list[str]:
    parts = re.split(r"[,;\n]|\s{2,}", value)
    cleaned = [part.strip(" -•\t") for part in parts if part.strip(" -•\t")]
    seen: set[str] = set()
    unique: list[str] = []
    for item in cleaned:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique
