"""Claude-backed testimonial extraction.

Given the raw text of a social ``mention`` and the list of known Spark project
names, :class:`TestimonialExtractor` asks Claude to decompose the text into:

* zero or more **testimonials**, each with a ``kind``, ``sentiment``,
  ``confidence``, and an ``extracted_quote``;
* the atomic **elements** of each testimonial (quote / outcome / metric /
  project_ref / attribution / sentiment), each with optional character spans
  into the original text;
* candidate **project links** tying the mention to known Spark projects, each
  with a ``confidence`` score and ``link_method="llm"``.

These mirror the ``testimonial`` / ``testimonial_element`` / ``mention_project_link``
entities in ``docs/DATA_MODEL.md`` but are returned as plain dataclasses so this
layer stays decoupled from the DB models (per ``docs/ARCHITECTURE.md``).

Extraction uses Claude's tool-use with a forced tool call and a strict JSON
schema, so the model is constrained to emit validated structured data rather
than free-form prose. The Anthropic client is injectable for testing.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

# Latest Claude model (see the project's Anthropic SDK guidance). Opus 4.8.
DEFAULT_MODEL = "claude-opus-4-8"

# Allowed enum values, kept in sync with docs/DATA_MODEL.md.
TESTIMONIAL_KINDS = ("testimonial", "praise", "case_study", "mention")
SENTIMENTS = ("positive", "neutral", "negative")
ELEMENT_TYPES = (
    "quote",
    "outcome",
    "metric",
    "project_ref",
    "attribution",
    "sentiment",
)
# This layer only ever produces LLM-derived links/extractions; humans/auto
# methods are applied elsewhere. See docs/DATA_MODEL.md (link_method).
LINK_METHOD_LLM = "llm"


@dataclass
class TestimonialElement:
    """Mirrors a ``testimonial_element`` row (derived, regenerable).

    ``span_start`` / ``span_end`` are character offsets into the original
    ``mention.raw_text`` when the model can locate the element, else ``None``.
    """

    element_type: str
    value_text: str
    confidence: float
    value_json: dict[str, Any] | None = None
    span_start: int | None = None
    span_end: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "element_type": self.element_type,
            "value_text": self.value_text,
            "value_json": self.value_json,
            "confidence": self.confidence,
            "span_start": self.span_start,
            "span_end": self.span_end,
        }


@dataclass
class CandidateProjectLink:
    """Mirrors a ``mention_project_link`` row.

    The model references a project by *name* (matched against the known-project
    list passed in); the persistence layer resolves the name to a ``project_id``.
    ``link_method`` is always ``"llm"`` from this layer.
    """

    project_name: str
    confidence: float
    link_method: str = LINK_METHOD_LLM

    def as_dict(self) -> dict[str, Any]:
        return {
            "project_name": self.project_name,
            "confidence": self.confidence,
            "link_method": self.link_method,
        }


@dataclass
class ExtractedTestimonial:
    """Mirrors a ``testimonial`` row plus its child elements and project links.

    The ``elements`` and ``project_links`` are nested here for convenience; the
    persistence layer can flatten them onto ``testimonial_element`` and
    ``mention_project_link`` (with ``testimonial_id``) as needed.
    """

    kind: str
    sentiment: str
    confidence: float
    extracted_quote: str
    summary_text: str = ""
    model_used: str = DEFAULT_MODEL
    elements: list[TestimonialElement] = field(default_factory=list)
    project_links: list[CandidateProjectLink] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "sentiment": self.sentiment,
            "confidence": self.confidence,
            "extracted_quote": self.extracted_quote,
            "summary_text": self.summary_text,
            "model_used": self.model_used,
            "elements": [e.as_dict() for e in self.elements],
            "project_links": [link.as_dict() for link in self.project_links],
        }


# JSON schema for the forced tool call. Constrains Claude's output to validated
# structured data mirroring the DATA_MODEL entities.
_EXTRACTION_TOOL = {
    "name": "record_testimonials",
    "description": (
        "Record the testimonials, atomic testimonial elements, and candidate "
        "project links extracted from a single social mention about Spark. "
        "Return an empty 'testimonials' list if the text contains no "
        "testimonial, praise, case study, or notable mention of Spark or a "
        "Spark project."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "testimonials": {
                "type": "array",
                "description": "Zero or more testimonials found in the text.",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": list(TESTIMONIAL_KINDS),
                            "description": (
                                "testimonial = first-person endorsement; "
                                "praise = positive remark; "
                                "case_study = detailed outcome narrative; "
                                "mention = neutral reference."
                            ),
                        },
                        "sentiment": {
                            "type": "string",
                            "enum": list(SENTIMENTS),
                        },
                        "confidence": {
                            "type": "number",
                            "description": (
                                "0.0-1.0 confidence that this is a genuine "
                                "testimonial of the stated kind."
                            ),
                        },
                        "extracted_quote": {
                            "type": "string",
                            "description": (
                                "The verbatim span from the text that best "
                                "represents this testimonial."
                            ),
                        },
                        "summary_text": {
                            "type": "string",
                            "description": "A short one-line summary of this testimonial.",
                        },
                        "elements": {
                            "type": "array",
                            "description": (
                                "The atomic elements that make up this testimonial."
                            ),
                            "items": {
                                "type": "object",
                                "properties": {
                                    "element_type": {
                                        "type": "string",
                                        "enum": list(ELEMENT_TYPES),
                                    },
                                    "value_text": {
                                        "type": "string",
                                        "description": "The text of this element.",
                                    },
                                    "value_json": {
                                        "type": "object",
                                        "description": (
                                            "Optional structured payload, e.g. for "
                                            "a metric: {\"name\": \"signups\", "
                                            "\"value\": 1200, \"unit\": \"users\"}."
                                        ),
                                    },
                                    "confidence": {"type": "number"},
                                    "span_start": {
                                        "type": "integer",
                                        "description": (
                                            "Character offset where this element "
                                            "begins in the original text, if known."
                                        ),
                                    },
                                    "span_end": {
                                        "type": "integer",
                                        "description": (
                                            "Character offset where this element "
                                            "ends in the original text, if known."
                                        ),
                                    },
                                },
                                "required": ["element_type", "value_text", "confidence"],
                            },
                        },
                        "project_links": {
                            "type": "array",
                            "description": (
                                "Candidate links from this testimonial to known "
                                "Spark projects. Only reference project names from "
                                "the provided list. Omit if no project is referenced."
                            ),
                            "items": {
                                "type": "object",
                                "properties": {
                                    "project_name": {
                                        "type": "string",
                                        "description": (
                                            "Exact name from the known-project list."
                                        ),
                                    },
                                    "confidence": {
                                        "type": "number",
                                        "description": (
                                            "0.0-1.0 confidence in the mention->project link."
                                        ),
                                    },
                                },
                                "required": ["project_name", "confidence"],
                            },
                        },
                    },
                    "required": [
                        "kind",
                        "sentiment",
                        "confidence",
                        "extracted_quote",
                        "elements",
                    ],
                },
            }
        },
        "required": ["testimonials"],
    },
}

_SYSTEM_PROMPT = (
    "You extract testimonials about Spark and Spark projects from raw social "
    "media posts. Spark is a program that runs student/community projects. You "
    "decompose each post into structured testimonials, their atomic elements, "
    "and candidate links to known Spark projects. Be precise: extract only what "
    "the text supports, set honest confidence scores, and never invent project "
    "names that are not in the provided list. Always respond by calling the "
    "record_testimonials tool."
)


class MissingAPIKeyError(RuntimeError):
    """Raised when no Anthropic API key is available and no client was injected."""


class TestimonialExtractor:
    """Extracts structured testimonials from mention text using Claude.

    Args:
        client: An Anthropic client (or any object exposing a compatible
            ``messages.create``). Injected for testing. If ``None``, a real
            :class:`anthropic.Anthropic` client is constructed lazily, reading
            ``ANTHROPIC_API_KEY`` from the environment.
        model: Claude model id to use. Defaults to the latest (Opus 4.8).
        max_tokens: Output token ceiling for the extraction call.
    """

    def __init__(
        self,
        client: Any | None = None,
        *,
        model: str = DEFAULT_MODEL,
        max_tokens: int = 8000,
    ) -> None:
        self._client = client
        self.model = model
        self.max_tokens = max_tokens

    # -- client management -------------------------------------------------

    @property
    def client(self) -> Any:
        """Return the Anthropic client, constructing a real one if needed.

        Raises:
            MissingAPIKeyError: If no client was injected and ANTHROPIC_API_KEY
                is not set.
        """
        if self._client is None:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                raise MissingAPIKeyError(
                    "ANTHROPIC_API_KEY is not set and no Anthropic client was "
                    "injected. Set the env var or pass client=... to "
                    "TestimonialExtractor()."
                )
            try:
                import anthropic
            except ImportError as exc:  # pragma: no cover - import guard
                raise MissingAPIKeyError(
                    "The 'anthropic' package is required to construct a default "
                    "client. Install it (pip install anthropic) or inject a client."
                ) from exc
            self._client = anthropic.Anthropic()
        return self._client

    # -- public API --------------------------------------------------------

    def extract(
        self, mention_text: str, known_projects: list[str] | None = None
    ) -> list[ExtractedTestimonial]:
        """Extract testimonials from a single mention.

        Args:
            mention_text: The raw scraped post text (``mention.raw_text``).
            known_projects: Names of known Spark projects to match links against.

        Returns:
            A list of :class:`ExtractedTestimonial` (possibly empty). Each is a
            plain dataclass mirroring the DATA_MODEL entities; this layer never
            touches the DB.
        """
        known_projects = known_projects or []

        if not mention_text or not mention_text.strip():
            return []

        user_content = self._build_prompt(mention_text, known_projects)

        response = self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            thinking={"type": "adaptive"},
            system=_SYSTEM_PROMPT,
            tools=[_EXTRACTION_TOOL],
            # Force the structured tool call so we get validated data, not prose.
            tool_choice={"type": "tool", "name": "record_testimonials"},
            messages=[{"role": "user", "content": user_content}],
        )

        tool_input = self._extract_tool_input(response)
        if tool_input is None:
            return []
        return self._parse(tool_input)

    # -- internals ---------------------------------------------------------

    @staticmethod
    def _build_prompt(mention_text: str, known_projects: list[str]) -> str:
        if known_projects:
            projects_block = "\n".join(f"- {name}" for name in known_projects)
        else:
            projects_block = "(no known projects provided)"
        return (
            "Known Spark projects (use these exact names for project_links):\n"
            f"{projects_block}\n\n"
            "Social mention text to analyze (character offsets start at 0):\n"
            "<mention>\n"
            f"{mention_text}\n"
            "</mention>"
        )

    @staticmethod
    def _extract_tool_input(response: Any) -> dict[str, Any] | None:
        """Pull the forced tool call's input dict out of the response.

        Tolerates both the SDK object shape (blocks with ``.type``/``.input``)
        and a plain-dict shape (useful for fakes in tests).
        """
        content = getattr(response, "content", None)
        if content is None and isinstance(response, dict):
            content = response.get("content")
        if not content:
            return None

        for block in content:
            btype = getattr(block, "type", None)
            binput = getattr(block, "input", None)
            bname = getattr(block, "name", None)
            if btype is None and isinstance(block, dict):
                btype = block.get("type")
                binput = block.get("input")
                bname = block.get("name")
            if btype == "tool_use" and bname == "record_testimonials":
                if isinstance(binput, str):
                    try:
                        return json.loads(binput)
                    except json.JSONDecodeError:
                        return None
                if isinstance(binput, dict):
                    return binput
        return None

    def _parse(self, tool_input: dict[str, Any]) -> list[ExtractedTestimonial]:
        results: list[ExtractedTestimonial] = []
        for raw in tool_input.get("testimonials", []) or []:
            if not isinstance(raw, dict):
                continue
            elements = [
                TestimonialElement(
                    element_type=str(el.get("element_type", "")),
                    value_text=str(el.get("value_text", "")),
                    confidence=_as_float(el.get("confidence")),
                    value_json=el.get("value_json")
                    if isinstance(el.get("value_json"), dict)
                    else None,
                    span_start=_as_int_or_none(el.get("span_start")),
                    span_end=_as_int_or_none(el.get("span_end")),
                )
                for el in (raw.get("elements") or [])
                if isinstance(el, dict)
            ]
            links = [
                CandidateProjectLink(
                    project_name=str(link.get("project_name", "")),
                    confidence=_as_float(link.get("confidence")),
                    link_method=LINK_METHOD_LLM,
                )
                for link in (raw.get("project_links") or [])
                if isinstance(link, dict) and link.get("project_name")
            ]
            results.append(
                ExtractedTestimonial(
                    kind=str(raw.get("kind", "mention")),
                    sentiment=str(raw.get("sentiment", "neutral")),
                    confidence=_as_float(raw.get("confidence")),
                    extracted_quote=str(raw.get("extracted_quote", "")),
                    summary_text=str(raw.get("summary_text", "") or ""),
                    model_used=self.model,
                    elements=elements,
                    project_links=links,
                )
            )
        return results


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _as_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
