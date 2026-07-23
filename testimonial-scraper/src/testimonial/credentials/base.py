"""Credential provider abstraction.

This is one of the two pluggability seams described in ``docs/ARCHITECTURE.md``:
secrets come from *somewhere* (env now, a vault later), and the rest of the
system only ever sees a resolved :class:`Secret` handed to it at runtime.

Security contract (do not violate):

* Secrets MUST NEVER be persisted to the database. The DB stores only a
  *locator* (``provider_type`` + ``secret_locator``) per ``docs/DATA_MODEL.md``
  (the ``credential_set`` entity), never the secret material itself.
* Secrets MUST NEVER be logged. :class:`Secret` redacts its value in both
  ``repr`` and ``str`` so it is safe to drop into log lines / tracebacks.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Secret:
    """A resolved secret held in memory only.

    Wraps the raw secret material (password, session cookie, API token, ...)
    together with enough provenance to debug *where* it came from without ever
    exposing the value. Access the material explicitly via
    :meth:`reveal` — this makes the "I am about to use a secret" moment grep-able
    and keeps casual ``str``/``repr`` paths redacted.

    Never store an instance of this class in the database or write it to a log.
    """

    # The raw secret material. Kept private-ish by convention; use reveal().
    _value: str = field(repr=False)
    # Where this secret came from, for debugging (NOT the secret).
    provider_type: str = ""
    secret_locator: str = ""

    def reveal(self) -> str:
        """Return the raw secret material.

        Call this only at the point of use (e.g. setting an auth header).
        The return value must not be logged or persisted.
        """
        return self._value

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return (
            f"Secret(provider_type={self.provider_type!r}, "
            f"secret_locator={self.secret_locator!r}, value=<redacted>)"
        )

    def __str__(self) -> str:  # pragma: no cover - trivial
        return "<redacted secret>"


class CredentialProvider(abc.ABC):
    """Resolves a secret locator into in-memory :class:`Secret` material.

    Implementations select *where* secrets live:

    * :class:`~testimonial.credentials.env_provider.EnvCredentialProvider`
      reads an environment variable (used now, for personal creds).
    * A future ``VaultCredentialProvider`` would read a secret manager path
      (for BU Spark creds), with no change to callers.

    The ``credential_set`` DB row names *which* provider and *which* locator;
    this class turns that into a usable secret at runtime and nothing more.
    """

    @abc.abstractmethod
    def resolve(self, provider_type: str, secret_locator: str) -> Secret:
        """Resolve ``secret_locator`` into a :class:`Secret`.

        Args:
            provider_type: The provider discriminator from the credential_set
                row (e.g. ``"env"``, ``"vault"``, ``"manual_session"``). An
                implementation may validate that it can serve this type.
            secret_locator: Where to fetch the secret (e.g. an env var name or
                a vault path). NEVER the secret itself.

        Returns:
            A :class:`Secret` holding the resolved material in memory.

        Raises:
            KeyError / ValueError: If the secret cannot be resolved. The error
                message must reference the *locator*, never the value.
        """
        raise NotImplementedError
