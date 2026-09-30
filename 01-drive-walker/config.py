"""Configuration constants and pattern definitions for drive_project_walker."""

from __future__ import annotations

import re

SEMESTER_YEAR_PATTERN = re.compile(r"\b(19|20)\d{2}\b")

PROJECT_DESCRIPTION_NAME_PATTERN = re.compile(
    r"project\s*description", re.IGNORECASE
)

FINAL_DELIVERABLE_FOLDER_PATTERNS = [
    re.compile(r"final\s*deliverables?", re.IGNORECASE),
    re.compile(r"final\s*presentation", re.IGNORECASE),
    re.compile(r"final\s*deck", re.IGNORECASE),
    re.compile(r"deliverables?", re.IGNORECASE),
]

SUPPORTED_DELIVERABLE_EXTENSIONS = {".pptx", ".pdf"}

DESCRIPTION_WORD_LIMIT = 10000

HEADING_FIELD_ALIASES = {
    "client_name": [
        "client",
        "client name",
        "client name and description",
        "sponsor",
        "organization",
        "partner",
    ],
    "problem_domain": [
        "problem domain",
        "domain",
        "problem",
        "problem statement",
        "industry",
    ],
    "technical_components": [
        "technical components",
        "technology stack",
        "tech stack",
        "technologies",
        "tools",
        "methods",
    ],
    "keywords": [
        "keywords",
        "tags",
        "topics",
    ],
}

MIME_TYPE_FOLDER = "application/vnd.google-apps.folder"
MIME_TYPE_GOOGLE_DOC = "application/vnd.google-apps.document"
MIME_TYPE_DOCX = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
MIME_TYPE_PDF = "application/pdf"
MIME_TYPE_PPTX = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)

# Rate limiting
SLEEP_EVERY_N_REQUESTS = 10
SLEEP_SECONDS = 0.5
MAX_BACKOFF_SECONDS = 64

# Tree traversal
MAX_TREE_DEPTH = 8

# Folder name patterns to skip (admin/org folders, not projects)
ADMIN_FOLDER_PATTERNS = [
    re.compile(r"^\*"),
    re.compile(r"class\s+admin", re.IGNORECASE),
    re.compile(r"course\s+info", re.IGNORECASE),
    re.compile(r"^\.", ),  # hidden folders
]

# Scoring for final deliverable detection
PRESENTATION_KEYWORDS = [
    "final", "demo day", "demo-day", "presentation", "poster",
    "deliverable", "showcase", "capstone", "slide",
]

DATA_KEYWORDS = [
    "readme", "documentation", "handoff", "user flow", "journey map",
    "persona", "dataset", "analysis", "sprint", "meeting", "notes",
    "technical spec", "requirement", "report",
]
