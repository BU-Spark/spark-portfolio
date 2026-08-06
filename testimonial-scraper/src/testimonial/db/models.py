"""SQLAlchemy 2.x declarative models for the Testimonial scraper.

These mirror the ER diagram in docs/DATA_MODEL.md. Design principles enforced here:

* Raw vs. derived separation: ``Mention`` is the immutable raw capture;
  ``Testimonial`` / ``TestimonialElement`` are regenerable derived artifacts.
* No raw secrets in the DB: ``CredentialSet`` stores only ``provider_type`` +
  ``secret_locator`` (see the explicit comment on that model).
* Confidence + link_method on anything inferred.
* Idempotent scraping via unique constraints on platform identifiers + content_hash.

All timestamps are timezone-aware (``DateTime(timezone=True)``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


class Base(DeclarativeBase):
    """Declarative base. ``Base.metadata`` is the autogenerate target for Alembic."""


# Reusable timezone-aware timestamp type.
TZDateTime = DateTime(timezone=True)


class Platform(Base):
    """A supported social network (LinkedIn first). Seed table."""

    __tablename__ = "platform"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False
    )  # linkedin|x|instagram|...
    base_url: Mapped[Optional[str]] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        TZDateTime, server_default=func.now(), nullable=False
    )

    credential_sets: Mapped[list["CredentialSet"]] = relationship(
        back_populates="platform", cascade="all, delete-orphan"
    )
    authors: Mapped[list["Author"]] = relationship(back_populates="platform")
    mentions: Mapped[list["Mention"]] = relationship(back_populates="platform")
    scrape_runs: Mapped[list["ScrapeRun"]] = relationship(back_populates="platform")


class CredentialSet(Base):
    """The pluggability seam for credentials.

    SECURITY / CRITICAL: This table NEVER stores a raw secret (no password, token,
    or session cookie). It stores only:
        * ``provider_type``  -- which CredentialProvider implementation to use
          (env|vault|manual_session), and
        * ``secret_locator`` -- *where* that provider should fetch the secret
          (e.g. an env var NAME like "LINKEDIN_SESSION_COOKIE" or a vault path).
    The actual secret is resolved at runtime by the CredentialProvider and lives in
    env / a secret manager. This keeps the DB safe to share. Do NOT add a secret
    column here.
    """

    __tablename__ = "credential_set"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform_id: Mapped[int] = mapped_column(
        ForeignKey("platform.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(
        String(128), nullable=False
    )  # e.g. 'kush-personal', 'bu-spark'
    provider_type: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # env|vault|manual_session
    secret_locator: Mapped[str] = mapped_column(
        String(512), nullable=False
    )  # env var name / vault path -- NOT the secret itself
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )  # active|expired|revoked
    created_at: Mapped[datetime] = mapped_column(
        TZDateTime, server_default=func.now(), nullable=False
    )
    rotated_at: Mapped[Optional[datetime]] = mapped_column(TZDateTime)

    platform: Mapped["Platform"] = relationship(back_populates="credential_sets")
    scrape_runs: Mapped[list["ScrapeRun"]] = relationship(
        back_populates="credential_set"
    )


class ScrapeRun(Base):
    """Audit + idempotency anchor for a single scrape execution."""

    __tablename__ = "scrape_run"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform_id: Mapped[int] = mapped_column(
        ForeignKey("platform.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    credential_set_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("credential_set.id", ondelete="SET NULL"), index=True
    )
    seed: Mapped[Optional[str]] = mapped_column(
        String(1024)
    )  # search query / profile / hashtag
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="running", server_default="running"
    )  # running|success|partial|failed
    stats: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB
    )  # counts, rate-limit info
    error: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(
        TZDateTime, server_default=func.now(), nullable=False
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(TZDateTime)

    platform: Mapped["Platform"] = relationship(back_populates="scrape_runs")
    credential_set: Mapped[Optional["CredentialSet"]] = relationship(
        back_populates="scrape_runs"
    )
    mentions: Mapped[list["Mention"]] = relationship(back_populates="scrape_run")


class Author(Base):
    """A platform user who posted a mention. Deduped per platform by user id."""

    __tablename__ = "author"
    __table_args__ = (
        UniqueConstraint(
            "platform_id", "platform_user_id", name="uq_author_platform_user"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform_id: Mapped[int] = mapped_column(
        ForeignKey("platform.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform_user_id: Mapped[str] = mapped_column(
        String(255), nullable=False
    )  # unique per platform (see table arg)
    handle: Mapped[Optional[str]] = mapped_column(String(255))
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    headline: Mapped[Optional[str]] = mapped_column(Text)
    profile_url: Mapped[Optional[str]] = mapped_column(String(1024))
    is_spark_affiliated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        TZDateTime, server_default=func.now(), nullable=False
    )

    platform: Mapped["Platform"] = relationship(back_populates="authors")
    mentions: Mapped[list["Mention"]] = relationship(back_populates="author")


class Mention(Base):
    """Raw scraped post (immutable, re-processable). Deduped per platform by post id."""

    __tablename__ = "mention"
    __table_args__ = (
        UniqueConstraint(
            "platform_id", "platform_post_id", name="uq_mention_platform_post"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform_id: Mapped[int] = mapped_column(
        ForeignKey("platform.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scrape_run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("scrape_run.id", ondelete="SET NULL"), index=True
    )
    author_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("author.id", ondelete="SET NULL"), index=True
    )
    platform_post_id: Mapped[str] = mapped_column(
        String(255), nullable=False
    )  # unique per platform (see table arg)
    url: Mapped[Optional[str]] = mapped_column(String(1024))
    raw_text: Mapped[Optional[str]] = mapped_column(Text)
    lang: Mapped[Optional[str]] = mapped_column(String(16))
    engagement: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB
    )  # likes|comments|shares
    raw_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB
    )  # full scraped object
    content_hash: Mapped[Optional[str]] = mapped_column(
        String(64), index=True
    )  # dedup
    posted_at: Mapped[Optional[datetime]] = mapped_column(TZDateTime)
    scraped_at: Mapped[datetime] = mapped_column(
        TZDateTime, server_default=func.now(), nullable=False
    )

    platform: Mapped["Platform"] = relationship(back_populates="mentions")
    scrape_run: Mapped[Optional["ScrapeRun"]] = relationship(back_populates="mentions")
    author: Mapped[Optional["Author"]] = relationship(back_populates="mentions")
    testimonials: Mapped[list["Testimonial"]] = relationship(
        back_populates="mention", cascade="all, delete-orphan"
    )
    project_links: Mapped[list["MentionProjectLink"]] = relationship(
        back_populates="mention", cascade="all, delete-orphan"
    )


class Project(Base):
    """Synced mirror of a ProjectShowcase project (via external_id)."""

    __tablename__ = "project"
    __table_args__ = (
        UniqueConstraint("external_id", name="uq_project_external_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[Optional[str]] = mapped_column(
        String(255)
    )  # ProjectShowcase project id
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    slug: Mapped[Optional[str]] = mapped_column(String(512))
    semester: Mapped[Optional[str]] = mapped_column(String(64))
    description: Mapped[Optional[str]] = mapped_column(Text)
    synced_at: Mapped[Optional[datetime]] = mapped_column(TZDateTime)

    mention_links: Mapped[list["MentionProjectLink"]] = relationship(
        back_populates="project"
    )


class MentionProjectLink(Base):
    """M:N tie between a mention (optionally a testimonial) and a project.

    Carries link_method + confidence so humans can review/override inferred links.
    """

    __tablename__ = "mention_project_link"
    __table_args__ = (
        UniqueConstraint(
            "mention_id",
            "project_id",
            "testimonial_id",
            name="uq_mention_project_testimonial",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mention_id: Mapped[int] = mapped_column(
        ForeignKey("mention.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[int] = mapped_column(
        ForeignKey("project.id", ondelete="CASCADE"), nullable=False, index=True
    )
    testimonial_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("testimonial.id", ondelete="CASCADE"), index=True
    )  # nullable -- link can be at testimonial granularity
    link_method: Mapped[str] = mapped_column(
        String(16), nullable=False
    )  # auto|llm|manual
    confidence: Mapped[Optional[float]] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        TZDateTime, server_default=func.now(), nullable=False
    )

    mention: Mapped["Mention"] = relationship(back_populates="project_links")
    project: Mapped["Project"] = relationship(back_populates="mention_links")
    testimonial: Mapped[Optional["Testimonial"]] = relationship(
        back_populates="project_links"
    )


class Testimonial(Base):
    """Derived artifact extracted from a mention (regenerable)."""

    __tablename__ = "testimonial"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mention_id: Mapped[int] = mapped_column(
        ForeignKey("mention.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[Optional[str]] = mapped_column(
        String(32)
    )  # testimonial|praise|case_study|mention
    sentiment: Mapped[Optional[str]] = mapped_column(
        String(16)
    )  # positive|neutral|negative
    confidence: Mapped[Optional[float]] = mapped_column(Float)
    extracted_quote: Mapped[Optional[str]] = mapped_column(Text)
    summary_text: Mapped[Optional[str]] = mapped_column(
        Text
    )  # short per-testimonial summary
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )  # pending|approved|rejected
    model_used: Mapped[Optional[str]] = mapped_column(String(128))
    extracted_at: Mapped[datetime] = mapped_column(
        TZDateTime, server_default=func.now(), nullable=False
    )

    mention: Mapped["Mention"] = relationship(back_populates="testimonials")
    elements: Mapped[list["TestimonialElement"]] = relationship(
        back_populates="testimonial", cascade="all, delete-orphan"
    )
    project_links: Mapped[list["MentionProjectLink"]] = relationship(
        back_populates="testimonial"
    )


class TestimonialElement(Base):
    """An atomic component decomposed from a testimonial."""

    __tablename__ = "testimonial_element"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    testimonial_id: Mapped[int] = mapped_column(
        ForeignKey("testimonial.id", ondelete="CASCADE"), nullable=False, index=True
    )
    element_type: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # quote|outcome|metric|project_ref|attribution|sentiment
    value_text: Mapped[Optional[str]] = mapped_column(Text)
    value_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB)
    confidence: Mapped[Optional[float]] = mapped_column(Float)
    span_start: Mapped[Optional[int]] = mapped_column(
        Integer
    )  # char offset into mention.raw_text (nullable)
    span_end: Mapped[Optional[int]] = mapped_column(Integer)

    testimonial: Mapped["Testimonial"] = relationship(back_populates="elements")


class Summary(Base):
    """A generated summary scoped globally, per-project, or per-author."""

    __tablename__ = "summary"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[str] = mapped_column(
        String(16), nullable=False
    )  # global|project|author
    # Polymorphic reference: holds project_id when scope='project' or author_id
    # when scope='author'; NULL for scope='global'. Intentionally NOT a hard FK
    # because the referenced table depends on `scope`.
    scope_ref_id: Mapped[Optional[int]] = mapped_column(Integer, index=True)
    summary_text: Mapped[Optional[str]] = mapped_column(Text)
    model_used: Mapped[Optional[str]] = mapped_column(String(128))
    source_testimonial_ids: Mapped[Optional[Any]] = mapped_column(
        JSONB
    )  # traceability: testimonial ids the summary was built from
    generated_at: Mapped[datetime] = mapped_column(
        TZDateTime, server_default=func.now(), nullable=False
    )


# Silence unused-import warnings for types referenced only in annotations.
_ = BigInteger
