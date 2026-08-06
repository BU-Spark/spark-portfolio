"""LLM-backed extraction layer.

This package turns the raw text of a scraped social ``mention`` into the
*derived* artifacts described in ``docs/DATA_MODEL.md`` — ``testimonial`` rows,
their atomic ``testimonial_element`` rows, and candidate ``mention_project_link``
rows — plus aggregate ``summary`` text.

Design notes (see ``docs/ARCHITECTURE.md``):

* Extraction is a *pure function* of the mention text + the known Spark project
  names. It is re-runnable: given the same input it asks Claude to produce the
  same structured output, so testimonials can be regenerated without re-scraping.
* This layer is deliberately decoupled from the database. It returns plain
  dataclasses / dicts that *mirror* the DB entities but does NOT import the
  SQLAlchemy models. The persistence layer (owned by another module) is
  responsible for mapping these dicts onto rows.
* Anthropic (Claude) does the actual extraction via forced tool-use so the
  result is validated, structured data rather than free-form text.
"""

from __future__ import annotations

from testimonial.extraction.extractor import (
    DEFAULT_MODEL,
    CandidateProjectLink,
    ExtractedTestimonial,
    TestimonialElement,
    TestimonialExtractor,
)
from testimonial.extraction.summarizer import Summarizer

__all__ = [
    "DEFAULT_MODEL",
    "CandidateProjectLink",
    "ExtractedTestimonial",
    "TestimonialElement",
    "TestimonialExtractor",
    "Summarizer",
]
