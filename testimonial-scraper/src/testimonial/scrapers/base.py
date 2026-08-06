"""Platform scraper abstraction and the raw mention it emits.

This is the second pluggability seam from ``docs/ARCHITECTURE.md``: each social
network gets a :class:`PlatformScraper` subclass that turns a search *seed* into
an iterator of :class:`RawMention` records. New platforms = new subclass,
registered in ``registry.py``.

:class:`RawMention` mirrors the *raw* fields of the ``mention`` entity in
``docs/DATA_MODEL.md``. It deliberately holds only verbatim scraped data — no
derived/extracted artifacts (those belong to the extraction layer, which this
module must not depend on).
"""

from __future__ import annotations

import abc
import hashlib
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterator, Optional


def compute_content_hash(text: str) -> str:
    """Compute a stable dedup hash for mention text.

    Normalizes the text (Unicode NFC, collapse internal whitespace, strip, and
    casefold) before hashing so trivial formatting differences between re-runs
    hash identically. Returns a hex sha256 digest, used as ``content_hash`` for
    idempotent scraping per ``docs/DATA_MODEL.md``.
    """
    normalized = unicodedata.normalize("NFC", text or "")
    normalized = " ".join(normalized.split()).casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


@dataclass
class RawMention:
    """A single verbatim scraped post/mention.

    Maps to the raw columns of the ``mention`` entity (plus inline author info,
    which the persistence layer is responsible for splitting into the ``author``
    table). Carries no derived/extracted fields.
    """

    # Platform-native post identifier; unique per platform. Used with
    # content_hash for dedup on re-scrape.
    platform_post_id: str
    url: str
    raw_text: str

    # When the post was authored on-platform (may be None if unknown).
    posted_at: Optional[datetime] = None
    # BCP-47-ish language code, e.g. "en". None if undetected.
    lang: Optional[str] = None

    # Engagement counters, e.g. {"likes": 3, "comments": 1, "shares": 0}.
    engagement: dict[str, Any] = field(default_factory=dict)
    # Full scraped object, kept verbatim so re-extraction never needs a re-scrape.
    raw_payload: dict[str, Any] = field(default_factory=dict)

    # Inline author info (denormalized; split into `author` on persist).
    author_platform_user_id: Optional[str] = None
    author_handle: Optional[str] = None
    author_display_name: Optional[str] = None
    author_profile_url: Optional[str] = None

    # Dedup hash of raw_text. Auto-computed if not supplied.
    content_hash: Optional[str] = None

    def __post_init__(self) -> None:
        if self.content_hash is None:
            self.content_hash = compute_content_hash(self.raw_text)


class PlatformScraper(abc.ABC):
    """Turns a search seed into an iterator of :class:`RawMention`.

    Subclasses set the class attribute ``name`` (the platform key, matching the
    ``platform.name`` column, e.g. ``"linkedin"``) and implement
    :meth:`search`. The transport (official API vs. authenticated session) is an
    implementation detail hidden behind this interface — see the compliance note
    in ``docs/ARCHITECTURE.md``.
    """

    #: Platform key, e.g. "linkedin". Overridden by subclasses.
    name: str = ""

    #: Default ``secret_locator`` (env var name / vault path) used by
    #: ``registry.get_scraper`` when no explicit locator is supplied. NOT a
    #: secret -- just where the CredentialProvider should look. Overridden by
    #: subclasses.
    default_credential_locator: str = ""

    @abc.abstractmethod
    def search(self, seed: str) -> Iterator[RawMention]:
        """Yield raw mentions matching ``seed``.

        Args:
            seed: A search query, profile, or hashtag (the ``scrape_run.seed``).

        Yields:
            :class:`RawMention` records, one per scraped post.
        """
        raise NotImplementedError
