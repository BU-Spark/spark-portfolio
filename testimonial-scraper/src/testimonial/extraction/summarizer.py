"""Claude-backed aggregate summarization over testimonials.

:class:`Summarizer` produces the aggregate ``summary_text`` described by the
``summary`` entity in ``docs/DATA_MODEL.md`` — a single human-readable string
synthesizing a collection of testimonials at one of three scopes:

* ``global``  — across all testimonials.
* ``project`` — testimonials tied to one Spark project.
* ``author``  — testimonials from one author.

Like :mod:`testimonial.extraction.extractor`, this layer is decoupled from the
DB: it accepts plain testimonial dicts (e.g. the output of
``ExtractedTestimonial.as_dict()``) and returns a plain string. The persistence
layer is responsible for writing a ``summary`` row. The Anthropic client is
injectable for testing.
"""

from __future__ import annotations

import json
import os
from typing import Any

from testimonial.extraction.extractor import DEFAULT_MODEL, MissingAPIKeyError

SUMMARY_SCOPES = ("global", "project", "author")

_SYSTEM_PROMPT = (
    "You write concise, faithful aggregate summaries of collections of "
    "testimonials about Spark and Spark projects. Summarize themes, recurring "
    "outcomes, notable metrics, and overall sentiment. Do not fabricate "
    "details that are not present in the testimonials. Return only the summary "
    "prose, with no preamble such as 'Here is the summary'."
)


class Summarizer:
    """Summarizes a list of testimonial dicts into one aggregate string.

    Args:
        client: An Anthropic client (or compatible object exposing
            ``messages.create``). Injected for testing. If ``None``, a real
            :class:`anthropic.Anthropic` client is constructed lazily, reading
            ``ANTHROPIC_API_KEY`` from the environment.
        model: Claude model id. Defaults to the latest (Opus 4.8).
        max_tokens: Output token ceiling for the summary.
    """

    def __init__(
        self,
        client: Any | None = None,
        *,
        model: str = DEFAULT_MODEL,
        max_tokens: int = 2000,
    ) -> None:
        self._client = client
        self.model = model
        self.max_tokens = max_tokens

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
                    "injected. Set the env var or pass client=... to Summarizer()."
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

    def summarize(
        self,
        testimonials: list[dict[str, Any]],
        scope: str = "global",
        *,
        scope_label: str | None = None,
    ) -> str:
        """Produce an aggregate summary over ``testimonials``.

        Args:
            testimonials: Testimonial dicts (e.g. ``ExtractedTestimonial.as_dict()``).
            scope: One of ``"global"``, ``"project"``, ``"author"``.
            scope_label: Optional human label for the scope (e.g. the project or
                author name) to focus the summary.

        Returns:
            The aggregate summary string. Empty string if there is nothing to
            summarize.

        Raises:
            ValueError: If ``scope`` is not a recognized value.
        """
        if scope not in SUMMARY_SCOPES:
            raise ValueError(
                f"scope must be one of {SUMMARY_SCOPES!r}, got {scope!r}"
            )
        if not testimonials:
            return ""

        user_content = self._build_prompt(testimonials, scope, scope_label)

        response = self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            thinking={"type": "adaptive"},
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
        return self._extract_text(response)

    @staticmethod
    def _build_prompt(
        testimonials: list[dict[str, Any]], scope: str, scope_label: str | None
    ) -> str:
        if scope == "global":
            scope_line = "Scope: a GLOBAL summary across all testimonials below."
        elif scope == "project":
            target = scope_label or "the project"
            scope_line = f"Scope: summarize testimonials for PROJECT '{target}'."
        else:  # author
            target = scope_label or "the author"
            scope_line = f"Scope: summarize testimonials from AUTHOR '{target}'."

        payload = json.dumps(testimonials, indent=2, default=str)
        return (
            f"{scope_line}\n\n"
            f"There are {len(testimonials)} testimonial(s). Write a single "
            "cohesive aggregate summary (a few sentences to a short paragraph) "
            "capturing the key themes, outcomes, metrics, and overall sentiment.\n\n"
            "Testimonials (JSON):\n"
            f"{payload}"
        )

    @staticmethod
    def _extract_text(response: Any) -> str:
        """Concatenate the text blocks from a Claude response.

        Tolerates both the SDK object shape and a plain-dict shape (for fakes).
        """
        content = getattr(response, "content", None)
        if content is None and isinstance(response, dict):
            content = response.get("content")
        if not content:
            return ""

        parts: list[str] = []
        for block in content:
            btype = getattr(block, "type", None)
            btext = getattr(block, "text", None)
            if btype is None and isinstance(block, dict):
                btype = block.get("type")
                btext = block.get("text")
            if btype == "text" and btext:
                parts.append(btext)
        return "".join(parts).strip()
