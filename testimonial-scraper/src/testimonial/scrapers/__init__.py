"""Platform scraper layer.

Defines the ``PlatformScraper`` seam and the ``RawMention`` record it emits (see
``docs/ARCHITECTURE.md``). Importing this package also registers the built-in
scrapers (currently :class:`LinkedInScraper`) in the registry.
"""

from .base import PlatformScraper, RawMention, compute_content_hash
from . import registry
# Import for side effect: registers LinkedInScraper in the registry.
from .linkedin import LinkedInScraper

__all__ = [
    "PlatformScraper",
    "RawMention",
    "compute_content_hash",
    "registry",
    "LinkedInScraper",
]
