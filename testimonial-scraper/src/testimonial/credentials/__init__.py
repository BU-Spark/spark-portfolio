"""Credential resolution layer.

Defines the ``CredentialProvider`` pluggability seam (see
``docs/ARCHITECTURE.md``). The DB only ever stores a *locator* (provider type +
key name); the actual secret is resolved at runtime and never persisted.
"""

from .base import CredentialProvider, Secret
from .env_provider import EnvCredentialProvider

__all__ = ["CredentialProvider", "Secret", "EnvCredentialProvider"]
