"""Persistence layer — turns scraper/extractor outputs into DB rows.

This is the integration contract the CLI (``scripts/run_scrape.py``) depends on.
It is the ONLY module that bridges the decoupled layers: it accepts the
scrapers' :class:`RawMention` and the extractor's :class:`ExtractedTestimonial`
(as objects exposing ``.as_dict()`` or plain dicts) and writes the ``platform`` /
``author`` / ``mention`` / ``testimonial`` / ``testimonial_element`` /
``mention_project_link`` / ``summary`` rows defined in ``docs/DATA_MODEL.md``.

Design notes:
* Idempotent: mentions dedupe on ``(platform_id, platform_post_id)`` and authors
  on ``(platform_id, platform_user_id)`` -- re-running a scrape updates rather
  than duplicates.
* Each function owns its own session (commit-on-success via ``get_session``), so
  callers don't manage transactions. ``save_mentions`` returns lightweight
  detached :class:`PersistedMention` records (id + raw_text) so the caller can
  drive extraction without holding the session open.
* No secrets are read or written here (credentials never touch the DB).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Sequence, cast

from sqlalchemy import select

from . import models
from .session import get_session


@dataclass
class PersistedMention:
    """A persisted mention, detached from the session.

    Carries just what the extraction step needs (``id`` to attach derived rows,
    ``raw_text`` to feed the extractor) so callers never touch a live ORM object.
    """

    id: int
    raw_text: str


def _as_dict(obj: Any) -> dict[str, Any]:
    """Accept either a dataclass exposing ``as_dict()`` or a plain dict."""
    if isinstance(obj, dict):
        return obj
    as_dict = getattr(obj, "as_dict", None)
    if callable(as_dict):
        return cast("dict[str, Any]", as_dict())
    raise TypeError(f"Expected a dict or object with as_dict(), got {type(obj)!r}")


def _get_or_create_platform(session, name: str) -> models.Platform:
    platform = session.scalar(select(models.Platform).where(models.Platform.name == name))
    if platform is None:
        platform = models.Platform(name=name)
        session.add(platform)
        session.flush()  # assign id
    return platform


def _get_or_create_author(session, platform_id: int, mention) -> int | None:
    """Upsert the author from a RawMention's inline author fields. Returns id or None."""
    user_id = getattr(mention, "author_platform_user_id", None)
    if not user_id:
        return None
    author = session.scalar(
        select(models.Author).where(
            models.Author.platform_id == platform_id,
            models.Author.platform_user_id == user_id,
        )
    )
    if author is None:
        author = models.Author(
            platform_id=platform_id,
            platform_user_id=user_id,
            handle=getattr(mention, "author_handle", None),
            display_name=getattr(mention, "author_display_name", None),
            profile_url=getattr(mention, "author_profile_url", None),
        )
        session.add(author)
        session.flush()
    return author.id


def save_mentions(
    platform_name: str, seed: str, mentions: Iterable[Any]
) -> list[PersistedMention]:
    """Persist a scrape run + its raw mentions; return detached mention records.

    Dedupes mentions by ``(platform_id, platform_post_id)``: an existing mention
    is refreshed (text/payload) rather than duplicated.
    """
    persisted: list[PersistedMention] = []
    with get_session() as session:
        platform = _get_or_create_platform(session, platform_name)
        run = models.ScrapeRun(platform_id=platform.id, seed=seed, status="running")
        session.add(run)
        session.flush()

        count = 0
        for m in mentions:
            author_id = _get_or_create_author(session, platform.id, m)
            existing = session.scalar(
                select(models.Mention).where(
                    models.Mention.platform_id == platform.id,
                    models.Mention.platform_post_id == m.platform_post_id,
                )
            )
            if existing is None:
                row = models.Mention(
                    platform_id=platform.id,
                    scrape_run_id=run.id,
                    author_id=author_id,
                    platform_post_id=m.platform_post_id,
                    url=getattr(m, "url", None),
                    raw_text=getattr(m, "raw_text", None),
                    lang=getattr(m, "lang", None),
                    engagement=getattr(m, "engagement", None) or None,
                    raw_payload=getattr(m, "raw_payload", None) or None,
                    content_hash=getattr(m, "content_hash", None),
                    posted_at=getattr(m, "posted_at", None),
                )
                session.add(row)
                session.flush()
            else:
                # Idempotent refresh of the raw capture.
                existing.raw_text = getattr(m, "raw_text", existing.raw_text)
                existing.raw_payload = getattr(m, "raw_payload", None) or existing.raw_payload
                existing.scrape_run_id = run.id
                row = existing
                session.flush()
            persisted.append(PersistedMention(id=row.id, raw_text=row.raw_text or ""))
            count += 1

        run.status = "success"
        run.stats = {"mentions": count}
    return persisted


def _mention_id(mention: Any) -> int:
    if isinstance(mention, PersistedMention):
        return mention.id
    if isinstance(mention, dict):
        return int(mention["id"])
    mid = getattr(mention, "id", None)
    if mid is None:
        raise ValueError("Cannot persist testimonials: mention has no id.")
    return int(mid)


def save_testimonials(mention: Any, testimonials: Sequence[Any]) -> list[int]:
    """Persist testimonials + elements + project links for one mention.

    ``mention`` is a :class:`PersistedMention` (or anything exposing ``id``).
    ``testimonials`` are extractor outputs (``ExtractedTestimonial`` or dicts).
    Project links are resolved from project *name* to ``project_id`` against the
    ``project`` mirror; unknown names are skipped (logged via the returned count
    gap) so a hallucinated name never creates an orphan link.
    """
    mention_id = _mention_id(mention)
    created_ids: list[int] = []
    with get_session() as session:
        for t in testimonials:
            data = _as_dict(t)
            row = models.Testimonial(
                mention_id=mention_id,
                kind=data.get("kind"),
                sentiment=data.get("sentiment"),
                confidence=data.get("confidence"),
                extracted_quote=data.get("extracted_quote"),
                summary_text=data.get("summary_text") or None,
                model_used=data.get("model_used"),
            )
            session.add(row)
            session.flush()

            for el in data.get("elements", []) or []:
                session.add(
                    models.TestimonialElement(
                        testimonial_id=row.id,
                        element_type=el.get("element_type", ""),
                        value_text=el.get("value_text"),
                        value_json=el.get("value_json"),
                        confidence=el.get("confidence"),
                        span_start=el.get("span_start"),
                        span_end=el.get("span_end"),
                    )
                )

            for link in data.get("project_links", []) or []:
                project_name = link.get("project_name")
                if not project_name:
                    continue
                project = session.scalar(
                    select(models.Project).where(models.Project.name == project_name)
                )
                if project is None:
                    # Unknown/hallucinated project name -> skip rather than orphan.
                    continue
                session.add(
                    models.MentionProjectLink(
                        mention_id=mention_id,
                        project_id=project.id,
                        testimonial_id=row.id,
                        link_method=link.get("link_method", "llm"),
                        confidence=link.get("confidence"),
                    )
                )
            created_ids.append(row.id)
    return created_ids


def save_summary(
    scope: str, summary_text: str, testimonials: Sequence[Any]
) -> int:
    """Persist a generated summary row with traceability to its sources."""
    with get_session() as session:
        row = models.Summary(
            scope=scope,
            summary_text=summary_text,
            source_testimonial_ids=[
                t.get("id") for t in (_as_dict(x) for x in testimonials) if t.get("id")
            ]
            or None,
        )
        session.add(row)
        session.flush()
        return row.id


def list_project_names() -> list[str]:
    """Return known Spark project names from the synced ``project`` mirror."""
    with get_session() as session:
        return list(session.scalars(select(models.Project.name)))
