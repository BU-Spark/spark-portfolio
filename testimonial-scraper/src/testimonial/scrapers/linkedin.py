"""LinkedIn scraper — SKELETON ONLY.

.. warning::

   Real LinkedIn scraping is intentionally **not implemented** here. LinkedIn's
   ToS restricts automated scraping and credential-based automation can get
   accounts flagged. See the "Compliance note" in ``docs/ARCHITECTURE.md``:
   before pointing this at a real/BU Spark account we must confirm a sanctioned
   path (official LinkedIn API / partner access, or explicit approval).

The class exists to lock the interface and the credential seam in place so the
actual transport can be dropped in later without touching the rest of the
system.
"""

from __future__ import annotations

from typing import Iterator

from ..credentials.base import CredentialProvider
from .base import PlatformScraper, RawMention
from .registry import register


@register
class LinkedInScraper(PlatformScraper):
    """Skeleton scraper for LinkedIn.

    Args:
        credential_provider: Resolves the session/secret at runtime.
        credential_locator: The ``secret_locator`` to resolve (e.g. the env var
            name ``"LINKEDIN_SESSION_COOKIE"``). NOT the secret itself.
        provider_type: The ``provider_type`` to pass through to the provider
            (defaults to ``"env"``).

    The secret is resolved lazily inside :meth:`search` so merely constructing a
    scraper never touches secret material.
    """

    name = "linkedin"
    # Env var name resolved by the CredentialProvider (NOT the secret). Prefer a
    # session cookie over username/password; see .env.example.
    default_credential_locator = "LINKEDIN_SESSION_COOKIE"

    def __init__(
        self,
        credential_provider: CredentialProvider,
        credential_locator: str,
        provider_type: str = "env",
    ) -> None:
        self.credential_provider = credential_provider
        self.credential_locator = credential_locator
        self.provider_type = provider_type

    def search(self, seed: str) -> Iterator[RawMention]:
        # TODO(compliance): Do NOT implement live LinkedIn scraping until the
        # sanctioned access path is confirmed — see the "Compliance note" in
        # docs/ARCHITECTURE.md (official API / partner access / explicit
        # approval). The credential resolution and RawMention shape below are
        # the intended integration points once that is resolved.
        #
        # Example of the resolve-at-use-point pattern (kept commented so no
        # secret is ever touched by the stub):
        #     secret = self.credential_provider.resolve(
        #         self.provider_type, self.credential_locator
        #     )
        #     session_cookie = secret.reveal()  # use, never log
        raise NotImplementedError(
            "LinkedInScraper.search is not implemented: live LinkedIn scraping "
            "is blocked pending the compliance/ToS resolution described in "
            "docs/ARCHITECTURE.md (official API or explicit approval required)."
        )
