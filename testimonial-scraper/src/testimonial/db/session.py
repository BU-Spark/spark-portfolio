"""Engine + Session factory.

Reads ``DATABASE_URL`` from the environment (or a local ``.env``) via
pydantic-settings, builds a singleton Engine + sessionmaker, and exposes a
``get_session()`` context manager that commits on success and rolls back on error.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


class Settings(BaseSettings):
    """Application settings sourced from env vars / a local .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # postgresql+psycopg://user:pass@host:5432/testimonial
    database_url: str = "postgresql+psycopg://user:pass@localhost:5432/testimonial"
    sql_echo: bool = False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Return a cached SQLAlchemy Engine built from settings."""
    settings = get_settings()
    return create_engine(
        settings.database_url,
        echo=settings.sql_echo,
        pool_pre_ping=True,
        future=True,
    )


@lru_cache(maxsize=1)
def get_sessionmaker() -> sessionmaker[Session]:
    """Return a cached sessionmaker bound to the engine."""
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )


@contextmanager
def get_session() -> Iterator[Session]:
    """Yield a Session, committing on success and rolling back on error.

    Usage::

        with get_session() as session:
            session.add(obj)
    """
    session = get_sessionmaker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
