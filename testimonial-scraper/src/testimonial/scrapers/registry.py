"""Registry mapping platform name -> :class:`PlatformScraper` subclass.

Lets a scrape job look up the right scraper class by the ``platform.name`` value
(from ``docs/DATA_MODEL.md``) without importing each module directly. New
platforms register themselves on import.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Type

from .base import PlatformScraper

if TYPE_CHECKING:
    from ..credentials.base import CredentialProvider

_REGISTRY: dict[str, Type[PlatformScraper]] = {}


def register(scraper_cls: Type[PlatformScraper]) -> Type[PlatformScraper]:
    """Register a :class:`PlatformScraper` subclass under its ``name``.

    Usable as a decorator. Raises ``ValueError`` on a missing ``name`` or a
    duplicate registration (so two scrapers can't silently shadow each other).
    """
    name = getattr(scraper_cls, "name", "")
    if not name:
        raise ValueError(
            f"{scraper_cls.__name__} must set a non-empty class attribute "
            "`name` before it can be registered."
        )
    existing = _REGISTRY.get(name)
    if existing is not None and existing is not scraper_cls:
        raise ValueError(
            f"A scraper is already registered for platform {name!r}: "
            f"{existing.__name__}."
        )
    _REGISTRY[name] = scraper_cls
    return scraper_cls


def get(name: str) -> Type[PlatformScraper]:
    """Return the registered scraper class for ``name``.

    Raises ``KeyError`` if no scraper is registered for that platform.
    """
    try:
        return _REGISTRY[name]
    except KeyError:
        known = ", ".join(sorted(_REGISTRY)) or "(none)"
        raise KeyError(
            f"No scraper registered for platform {name!r}. Known: {known}."
        ) from None


def get_scraper(
    name: str,
    credential_provider: "CredentialProvider",
    *,
    secret_locator: str | None = None,
    provider_type: str = "env",
) -> PlatformScraper:
    """Look up a scraper class by ``name`` and instantiate it, wired with creds.

    Convenience over :func:`get` for the common case (used by the CLI): resolves
    the class, then constructs it with the credential provider and the secret
    *locator* (env var name / vault path -- never the secret itself). If
    ``secret_locator`` is omitted, the scraper's ``default_credential_locator``
    class attribute is used.

    Raises:
        KeyError: if no scraper is registered for ``name``.
        ValueError: if no locator is given and the scraper declares no default.
    """
    cls = get(name)
    locator = secret_locator or getattr(cls, "default_credential_locator", "")
    if not locator:
        raise ValueError(
            f"No secret_locator supplied and {cls.__name__} declares no "
            "`default_credential_locator`. Pass secret_locator=... (the env var "
            "name / vault path, not the secret)."
        )
    # Subclasses share this (provider, locator, provider_type) constructor
    # contract (see docs/ARCHITECTURE.md); it isn't expressed on the ABC, so we
    # construct via Any to keep the contract documented rather than type-enforced.
    scraper_cls: Any = cls
    return scraper_cls(
        credential_provider=credential_provider,
        credential_locator=locator,
        provider_type=provider_type,
    )


def available() -> list[str]:
    """Return the sorted list of registered platform names."""
    return sorted(_REGISTRY)
