#!/usr/bin/env python3
"""
Pre-processor: clean raw description_text before passing to LLM extraction (Script A).

Input:  projects.json produced by walker.py
Output: projects_cleaned.json with description_text replaced by cleaned version

Cleaning rules discovered during 2026 run:
- Many project folders contain a "Wrap Up Checklist & Continuation Notes" doc
  that is selected as the description source. These start with admin boilerplate
  (~1500 chars of generic end-of-semester instructions) but often contain
  a project-specific section starting with a heading like:
    "Client Name and Description:"  or  "Fall 20XX Project Description"
- The actual project description template (when present as a standalone doc)
  starts with something like:
    "[SP'26] <Project Name> Project Description  SPARK – CDS – DS701 ..."
  and uses headings: Client Name and Description, Problem Domain, Technical
  Components, Keywords.
- Some folders have no description doc at all (description_text is None).
- DESCRIPTION_WORD_LIMIT is set to 10000 in config.py — text is cheap and
  the good content can be buried past 1500 chars in wrap-up docs.

TODO: implement boilerplate stripping
- Detect wrap-up docs: text[:300] matches WRAPUP_PATTERN
- Find first project-specific heading: CLIENT_HEADING_RE or SECTION_START_RE
- Slice from that heading onward
- Strip any remaining template placeholder lines (e.g. "Organization Name",
  "Link to Notion Here", "DSXXX")
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

WRAPUP_PATTERN = re.compile(
    r"AY Spark!.*Wrap Up|End of Semester & Project Admin", re.IGNORECASE
)

CLIENT_HEADING_RE = re.compile(
    r"client name", re.IGNORECASE
)

SECTION_START_RE = re.compile(
    r"(fall|spring)\s+20\d{2}\s+project description", re.IGNORECASE
)


def clean_description(text: str) -> str:
    if not text:
        return text

    # TODO: detect wrap-up boilerplate and slice to project-specific section
    # Sketch:
    # if WRAPUP_PATTERN.search(text[:300]):
    #     match = CLIENT_HEADING_RE.search(text) or SECTION_START_RE.search(text)
    #     if match:
    #         text = text[match.start():]

    return text


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: clean_descriptions.py <projects.json> [output.json]")
        return 1

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else input_path.with_name("projects_cleaned.json")

    projects = json.loads(input_path.read_text(encoding="utf-8"))

    cleaned = 0
    for p in projects:
        original = p.get("description_text") or ""
        p["description_text"] = clean_description(original)
        if p["description_text"] != original:
            cleaned += 1

    output_path.write_text(json.dumps(projects, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(projects)} projects ({cleaned} cleaned) → {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
