#!/usr/bin/env python3
"""CLI entrypoint for walking project folders in a Google Shared Drive."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from config import (
    ADMIN_FOLDER_PATTERNS,
    FINAL_DELIVERABLE_FOLDER_PATTERNS,
    MAX_TREE_DEPTH,
    MIME_TYPE_FOLDER,
    PROJECT_DESCRIPTION_NAME_PATTERN,
    SEMESTER_YEAR_PATTERN,
)
from drive_client import DriveClient, DriveClientError
from googleapiclient.errors import HttpError
from extract_description import extract_structured_fields, find_and_read_description
from extract_slides import select_and_download_deliverables, slugify


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Walk student projects in a Shared Drive")
    parser.add_argument("--root-folder-id", required=True, help="Drive folder ID to scan")
    parser.add_argument(
        "--year-min",
        type=int,
        default=None,
        help="Skip folders whose name contains a year below this value",
    )
    parser.add_argument(
        "--output-dir",
        default="./output",
        help="Output directory for JSON and downloaded deliverables",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    creds = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "(not set)")
    print(f"drive-project-walker starting", flush=True)
    print(f"  root-folder-id : {args.root_folder_id}", flush=True)
    print(f"  year-min       : {args.year_min}", flush=True)
    print(f"  output-dir     : {output_dir}", flush=True)
    print(f"  credentials    : {creds}", flush=True)

    try:
        drive_client = DriveClient()
    except DriveClientError as exc:
        print(f"ERROR (auth/credentials): {exc}", flush=True)
        return 1

    print("Credentials loaded. Testing Drive access to root folder...", flush=True)
    try:
        meta = drive_client.get_folder_metadata(args.root_folder_id)
        print(f"Access OK — root folder name: {meta.get('name', '(unknown)')}", flush=True)
    except HttpError as exc:
        status = exc.resp.status
        if status == 404:
            print(
                f"ERROR: Root folder not found (404). Check --root-folder-id and that the "
                f"service account has been added as a member of the Shared Drive.",
                flush=True,
            )
        elif status == 403:
            print(
                f"ERROR: Permission denied (403). The service account does not have access "
                f"to this folder or Shared Drive.",
                flush=True,
            )
        else:
            print(f"ERROR: Drive API returned HTTP {status}: {exc}", flush=True)
        return 1

    projects, skipped, processed_ids = _load_existing(output_dir)
    if processed_ids:
        print(f"Resuming: {len(projects)} projects and {len(skipped)} skipped already on disk.")

    walk_tree(
        drive_client=drive_client,
        folder_id=args.root_folder_id,
        folder_path="",
        year_min=args.year_min,
        output_dir=output_dir,
        projects=projects,
        skipped=skipped,
        processed_ids=processed_ids,
        depth=0,
    )

    write_outputs(output_dir, projects, skipped)
    print(
        f"\nDone. projects={len(projects)} skipped_projects={len(skipped)} output={output_dir}"
    )
    return 0


def walk_tree(
    drive_client: DriveClient,
    folder_id: str,
    folder_path: str,
    year_min: int | None,
    output_dir: Path,
    projects: list[dict],
    skipped: list[dict],
    processed_ids: set[str],
    depth: int,
) -> None:
    if depth > MAX_TREE_DEPTH:
        return

    label = folder_path or "(root)"
    print(f"  listing {label} ...", flush=True)
    try:
        children = drive_client.list_child_items(folder_id)
        print(f"  listing {label} → {len(children)} items", flush=True)
    except Exception as exc:
        if folder_path:
            skipped.append({
                "folder_name": _basename(folder_path),
                "folder_path": folder_path,
                "drive_folder_id": folder_id,
                "reason": "error",
                "detail": f"Failed to list folder: {exc}",
            })
            write_outputs(output_dir, projects, skipped)
        return

    direct_files = [c for c in children if c.get("mimeType") != MIME_TYPE_FOLDER]
    subfolders = [
        c for c in children
        if c.get("mimeType") == MIME_TYPE_FOLDER
        and not is_admin_folder(c.get("name", ""))
    ]

    if depth > 0 and _looks_like_project(direct_files, subfolders):
        process_project(
            drive_client=drive_client,
            folder_id=folder_id,
            folder_path=folder_path,
            direct_files=direct_files,
            subfolders=subfolders,
            output_dir=output_dir,
            projects=projects,
            skipped=skipped,
            processed_ids=processed_ids,
        )
    else:
        for subfolder in sorted(subfolders, key=lambda x: x.get("name", "")):
            name = subfolder.get("name", "")
            if year_min is not None:
                year = _extract_year(name)
                if year is not None and year < year_min:
                    continue
            child_path = f"{folder_path} / {name}" if folder_path else name
            if depth == 0:
                print(f"\n>>> {name}", flush=True)
            walk_tree(
                drive_client=drive_client,
                folder_id=subfolder["id"],
                folder_path=child_path,
                year_min=year_min,
                output_dir=output_dir,
                projects=projects,
                skipped=skipped,
                processed_ids=processed_ids,
                depth=depth + 1,
            )


def process_project(
    drive_client: DriveClient,
    folder_id: str,
    folder_path: str,
    direct_files: list[dict],
    subfolders: list[dict],
    output_dir: Path,
    projects: list[dict],
    skipped: list[dict],
    processed_ids: set[str],
) -> None:
    folder_name = _basename(folder_path)

    if folder_id in processed_ids:
        print(f"  {folder_path} → already processed, skipping", flush=True)
        return

    print(f"  {folder_path} ...", end=" ", flush=True)

    project_slug = slugify(folder_name)
    project_output_dir = output_dir / "deliverables" / project_slug

    # Collect all files recursively
    all_files = list(direct_files)
    for subfolder in subfolders:
        try:
            all_files.extend(drive_client.list_all_files_recursive(subfolder["id"]))
        except Exception:
            pass

    # Find project description
    try:
        description_text, description_source = find_and_read_description(drive_client, all_files)
    except Exception:
        description_text, description_source = None, None

    # Select and download deliverables
    try:
        deliverable_paths = select_and_download_deliverables(
            drive_client=drive_client,
            all_files=all_files,
            project_slug=project_slug,
            output_dir=project_output_dir,
        )
    except Exception:
        deliverable_paths = []

    processed_ids.add(folder_id)

    if not description_text and not deliverable_paths:
        print("skipped: no_content", flush=True)
        skipped.append({
            "folder_name": folder_name,
            "folder_path": folder_path,
            "drive_folder_id": folder_id,
            "reason": "no_content",
            "detail": "No project description or deliverable files found.",
        })
        write_outputs(output_dir, projects, skipped)
        return

    structured = extract_structured_fields(description_text or "")

    desc_label = f'description: "{description_source}"' if description_source else "no description"
    deliv_label = f"deliverables: {len(deliverable_paths)}" if deliverable_paths else "no deliverables"
    print(f"ok | {desc_label}, {deliv_label}", flush=True)

    projects.append({
        "project_name": folder_name,
        "folder_path": folder_path,
        "drive_folder_id": folder_id,
        "description_source": description_source,
        "client_name": structured.get("client_name"),
        "problem_domain": structured.get("problem_domain"),
        "technical_components": structured.get("technical_components", []),
        "keywords": structured.get("keywords", []),
        "description_text": description_text,
        "deliverable_files": deliverable_paths,
    })
    write_outputs(output_dir, projects, skipped)


def write_outputs(output_dir: Path, projects: list[dict], skipped: list[dict]) -> None:
    (output_dir / "projects.json").write_text(
        json.dumps(projects, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (output_dir / "skipped_projects.json").write_text(
        json.dumps(skipped, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _load_existing(output_dir: Path) -> tuple[list[dict], list[dict], set[str]]:
    projects: list[dict] = []
    skipped: list[dict] = []

    projects_file = output_dir / "projects.json"
    skipped_file = output_dir / "skipped_projects.json"

    if projects_file.exists():
        try:
            projects = json.loads(projects_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    if skipped_file.exists():
        try:
            skipped = json.loads(skipped_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    processed_ids = {
        r["drive_folder_id"] for r in projects + skipped
        if r.get("drive_folder_id")
    }
    return projects, skipped, processed_ids


def _looks_like_project(direct_files: list[dict], subfolders: list[dict]) -> bool:
    """True if this folder looks like a student project rather than an intermediate container."""
    for f in direct_files:
        if PROJECT_DESCRIPTION_NAME_PATTERN.search(f.get("name", "")):
            return True
    for sf in subfolders:
        name = sf.get("name", "")
        if any(p.search(name) for p in FINAL_DELIVERABLE_FOLDER_PATTERNS):
            return True
    return False


def is_admin_folder(name: str) -> bool:
    return any(p.search(name) for p in ADMIN_FOLDER_PATTERNS)


def _extract_year(folder_name: str) -> int | None:
    match = SEMESTER_YEAR_PATTERN.search(folder_name)
    return int(match.group(0)) if match else None


def _basename(folder_path: str) -> str:
    return folder_path.split(" / ")[-1] if " / " in folder_path else folder_path


if __name__ == "__main__":
    raise SystemExit(main())
