"""Final deliverable detection and download."""

from __future__ import annotations

from pathlib import Path

from config import DATA_KEYWORDS, MIME_TYPE_PDF, MIME_TYPE_PPTX, PRESENTATION_KEYWORDS
from drive_client import DriveClient


def select_and_download_deliverables(
    drive_client: DriveClient,
    all_files: list[dict],
    project_slug: str,
    output_dir: Path,
) -> list[str]:
    """
    Score PDFs and PPTXs by filename, select the best candidates, download and
    rename them. Returns list of relative output paths.
    """
    media = [
        f for f in all_files
        if f.get("mimeType") in {MIME_TYPE_PDF, MIME_TYPE_PPTX}
    ]
    if not media:
        return []

    candidates = _select_candidates(media)
    if not candidates:
        return []

    output_dir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []

    for i, f in enumerate(candidates):
        ext = ".pptx" if f.get("mimeType") == MIME_TYPE_PPTX else ".pdf"
        suffix = f"-{i + 1}" if len(candidates) > 1 else ""
        local_name = f"{project_slug}-final{suffix}{ext}"
        local_path = output_dir / local_name

        try:
            file_bytes = drive_client.download_file_bytes(f["id"])
            local_path.write_bytes(file_bytes)
            paths.append(str(local_path.relative_to(output_dir.parent.parent)))
        except Exception:
            pass

    return paths


def _select_candidates(files: list[dict]) -> list[dict]:
    if len(files) == 1:
        return files

    scored = [(score_presentation(f.get("name", "")), f) for f in files]

    positive = [f for s, f in scored if s > 0]
    if positive:
        return positive

    # Nothing clearly positive — drop clearly-negative files, keep the rest
    non_negative = [f for s, f in scored if s >= 0]
    if non_negative:
        return non_negative

    # All scored negative but can't be sure — keep everything
    return files


def score_presentation(filename: str) -> int:
    name = filename.lower()
    score = 0
    for kw in PRESENTATION_KEYWORDS:
        if kw in name:
            score += 2
    for kw in DATA_KEYWORDS:
        if kw in name:
            score -= 1
    return score


def slugify(name: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in {"-", "_"} else "_" for c in name)
    return "_".join(p for p in cleaned.split("_") if p)[:120] or "unnamed_project"
