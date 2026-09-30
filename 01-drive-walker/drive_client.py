"""Google Drive client wrapper for shared drive traversal and file download."""

from __future__ import annotations

import os
import random
import time
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload

from config import (
    MAX_BACKOFF_SECONDS,
    MIME_TYPE_FOLDER,
    SLEEP_EVERY_N_REQUESTS,
    SLEEP_SECONDS,
)


class DriveClientError(RuntimeError):
    """Raised when Drive client setup or calls fail."""


class DriveClient:
    def __init__(self) -> None:
        cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not cred_path:
            raise DriveClientError(
                "GOOGLE_APPLICATION_CREDENTIALS is not set. "
                "Set it to a readable service account JSON key file."
            )

        path_obj = Path(cred_path)
        if not path_obj.exists() or not path_obj.is_file():
            raise DriveClientError(
                f"Credentials file not found or not a file: {cred_path}"
            )
        if not os.access(path_obj, os.R_OK):
            raise DriveClientError(f"Credentials file is not readable: {cred_path}")

        scopes = ["https://www.googleapis.com/auth/drive.readonly"]
        credentials = service_account.Credentials.from_service_account_file(
            cred_path, scopes=scopes
        )

        self.service = build("drive", "v3", credentials=credentials, cache_discovery=False)
        self._request_count = 0

    def _tick(self) -> None:
        """Increment request counter and sleep every N requests."""
        self._request_count += 1
        if self._request_count % SLEEP_EVERY_N_REQUESTS == 0:
            time.sleep(SLEEP_SECONDS)

    def _execute(self, request) -> dict:
        """Execute a Drive API request with exponential backoff on rate errors."""
        delay = 1.0
        for attempt in range(7):
            try:
                self._tick()
                return request.execute()
            except HttpError as exc:
                if exc.resp.status in (429, 500, 503) and attempt < 6:
                    sleep_time = min(delay + random.uniform(0, 1), MAX_BACKOFF_SECONDS)
                    time.sleep(sleep_time)
                    delay *= 2
                else:
                    raise

    def get_folder_metadata(self, folder_id: str) -> dict:
        """Fetch name and basic metadata for a folder. Raises HttpError on no access."""
        request = self.service.files().get(
            fileId=folder_id,
            fields="id, name, mimeType",
            supportsAllDrives=True,
        )
        return self._execute(request)

    def list_child_items(self, folder_id: str) -> list[dict]:
        query = f"'{folder_id}' in parents and trashed = false"
        items: list[dict] = []
        page_token = None

        while True:
            request = self.service.files().list(
                q=query,
                pageSize=1000,
                fields="nextPageToken, files(id, name, mimeType, createdTime, modifiedTime)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                corpora="allDrives",
                pageToken=page_token,
            )
            response = self._execute(request)
            items.extend(response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        return items

    def list_all_files_recursive(self, folder_id: str) -> list[dict]:
        """Return all non-folder files under folder_id, recursively."""
        results: list[dict] = []
        children = self.list_child_items(folder_id)
        for item in children:
            if item.get("mimeType") == MIME_TYPE_FOLDER:
                results.extend(self.list_all_files_recursive(item["id"]))
            else:
                results.append(item)
        return results

    def export_google_doc_as_text(self, file_id: str) -> str:
        request = self.service.files().export_media(fileId=file_id, mimeType="text/plain")
        chunks: list[bytes] = []
        downloader = MediaIoBaseDownload(_BytesCollector(chunks), request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return b"".join(chunks).decode("utf-8", errors="replace")

    def download_file_bytes(self, file_id: str) -> bytes:
        request = self.service.files().get_media(fileId=file_id, supportsAllDrives=True)
        chunks: list[bytes] = []
        downloader = MediaIoBaseDownload(_BytesCollector(chunks), request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return b"".join(chunks)


class _BytesCollector:
    """Minimal writable stream-like collector for MediaIoBaseDownload."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    def write(self, data: bytes) -> int:
        self._chunks.append(data)
        return len(data)
