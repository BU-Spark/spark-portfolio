"""Environment-variable credential provider.

Resolves a ``secret_locator`` as the *name* of an environment variable, e.g.
``LINKEDIN_SESSION_COOKIE`` or ``LINKEDIN_PASS``. This is the default provider
for development / personal credentials per ``docs/ARCHITECTURE.md``.

The secret value lives only in the process environment and the returned
in-memory :class:`Secret`; it is never written to the database or logged.
"""

from __future__ import annotations

import os

from .base import CredentialProvider, Secret


class EnvCredentialProvider(CredentialProvider):
    """Reads secrets from environment variables.

    ``secret_locator`` is interpreted as the environment variable name to read.
    Intended ``provider_type`` is ``"env"``, but any value is accepted so the
    same instance can serve session-style locators that still live in env.
    """

    PROVIDER_TYPE = "env"

    def resolve(self, provider_type: str, secret_locator: str) -> Secret:
        if not secret_locator:
            raise ValueError(
                "EnvCredentialProvider requires a non-empty secret_locator "
                "(the environment variable name to read)."
            )

        value = os.environ.get(secret_locator)
        if value is None:
            # Reference the locator only — never anything secret.
            raise KeyError(
                f"Environment variable {secret_locator!r} is not set; cannot "
                f"resolve credential for provider_type={provider_type!r}. "
                "Set it in the environment / a secret manager before scraping."
            )

        return Secret(
            _value=value,
            provider_type=provider_type,
            secret_locator=secret_locator,
        )
