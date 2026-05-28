# SPARK Project Data Pipeline

End-to-end pipeline for extracting, enriching, and packaging SPARK project data
from Google Drive for theme analysis and sales deck generation.

## Goal

1. **Theme analysis** — identify what kinds of problems SPARK has tackled beyond
   the generic "software eng" / "data science" buckets, to discover better
   categorizations for pitching to new clients.
2. **Single-slide marketing materials** — extract one recap slide per project
   from final deliverable decks for use in sales presentations.

---

## Stage 1 — Drive Walker (`walker.py`)

Walks the Google Shared Drive tree and produces `projects.json`.

**Drive structure discovered:**
```
Classes (root: 12YeO3Coze7EvY3lZsbELLCB3PQBMlzK4)
  └── YYYY - Season (e.g. "2026 - Spring")
        └── Course Name (e.g. "DS488/688: UX Practicum SP'26")
              └── Project Name  ← walker detects this level
```

**Project folder detection:** a folder is treated as a project if it contains
a file matching `PROJECT_DESCRIPTION_NAME_PATTERN` OR a subfolder matching
`FINAL_DELIVERABLE_FOLDER_PATTERNS`. This avoids stopping at intermediate
semester/course folders that also happen to have stray files in them.

**Output:** `projects.json`, `skipped_projects.json`, `deliverables/<slug>/`

**Known doc selection issues:**
- Many project folders contain a "Wrap Up Checklist & Continuation Notes" doc
  that gets selected as the description source. It starts with ~1500 chars of
  generic admin boilerplate but contains project-specific content further in
  (client name, problem description, recommendations).
- Standalone project description docs (preferred) follow this heading structure:
  `Client Name and Description`, `Problem Domain`, `Technical Components`, `Keywords`
- `DESCRIPTION_WORD_LIMIT` is set to 10000 so the full doc is captured even
  when good content is buried past 1500 chars.
- The regex structured field extraction (client_name, problem_domain, etc.) in
  `extract_description.py` is unreliable — don't use those fields downstream.
  Use `description_text` as the raw input to Stage 2 instead.

**Run command:**
```bash
podman run \
  -v /path/to/keys:/secrets:ro,z \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/<keyfile>.json \
  -v /path/to/output:/output:z \
  drive-project-walker \
  --root-folder-id 12YeO3Coze7EvY3lZsbELLCB3PQBMlzK4 \
  --year-min <YYYY> \
  --output-dir /output
```

---

## Stage 2 — Description Cleaner (`clean_descriptions.py`)

Strips admin boilerplate from wrap-up docs before LLM extraction.

**Status:** stub only — TODO implement boilerplate stripping.

**Input:** `projects.json`
**Output:** `projects_cleaned.json`

**Boilerplate pattern:** text starting with `"AY Spark! ... Wrap Up"` or
`"End of Semester & Project Admin"`. Good content starts at first occurrence
of `"Client Name"` or `"Fall/Spring 20XX Project Description"`.

---

## Stage 3 — LLM Enrichment (Script A — not yet built)

Calls Claude API on each project's `description_text` to extract:
- Client name and type (nonprofit, gov, startup, enterprise, etc.)
- Problem domain / industry
- Technical approach
- Thematic tags (e.g. "criminal justice", "public health", "civic tech")

**Input:** `projects_cleaned.json`
**Output:** `projects_enriched.json`

Suggested prompt approach: few-shot with 2–3 examples from known good project
descriptions. Ask for structured JSON output.

---

## Stage 4 — Slide Extractor (Script B — not yet built)

Extracts a single recap/overview slide from each downloaded PPTX or PDF.

**Input:** `projects_enriched.json` + `deliverables/` directory
**Output:** `slides/<project_slug>/recap.png` (or .pdf page)

**Libraries:** `python-pptx` for PPTX, `pymupdf` (fitz) for PDF.

**Slide selection heuristic:** first slide, or slide whose title matches
keywords: "overview", "project summary", "about", "recap", "demo day".

---

## Running the full pipeline

```bash
# Stage 1 — walk the drive
podman run ... drive-project-walker --year-min 2020 --output-dir ./output

# Stage 2 — clean descriptions
python clean_descriptions.py output/projects.json

# Stage 3 — LLM enrichment (once built)
python enrich_projects.py output/projects_cleaned.json

# Stage 4 — slide extraction (once built)
python extract_slides_recap.py output/projects_enriched.json
```
