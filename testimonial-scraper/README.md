# Spark Testimonial Scraper

Walks social platforms (LinkedIn first) from a set of credentials, finds
posts/mentions/testimonials about **BU Spark**, ties them back to Spark projects,
stores the atomic testimonial elements, and enables generated summaries later.

> **Status:** scaffolding / design review. See `docs/DATA_MODEL.md` (ER diagram for
> Langdon's review) and `docs/ARCHITECTURE.md` (pluggable design).

## Why it's built this way

- **Pluggable credentials** — secrets are resolved at runtime by a `CredentialProvider`
  and are **never stored in the database** (the DB stores only a *locator*). Start with
  your personal credentials via env; swap in BU Spark credentials later by adding a row,
  no code change.
- **Pluggable platforms** — each network is a `PlatformScraper` subclass behind a common
  interface, so LinkedIn-via-session today can become LinkedIn-via-official-API later.
- **Raw vs. derived** — raw scraped posts (`mention`) are immutable and re-processable;
  testimonials, elements, project-links and summaries are *derived* and regenerable.

## Quickstart (once implemented)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in DB url + LinkedIn creds + ANTHROPIC_API_KEY
alembic upgrade head        # create schema
python scripts/run_scrape.py --platform linkedin --seed "BU Spark"
```

## ⚠️ Compliance

LinkedIn's Terms of Service restrict automated scraping. Confirm the sanctioned access
path (official API / partner access / explicit approval) before pointing this at a real
or BU Spark account. See the compliance note in `docs/ARCHITECTURE.md`.

## Layout

```
docs/            DATA_MODEL.md, ARCHITECTURE.md
src/testimonial/
  db/            SQLAlchemy models + session
  credentials/   CredentialProvider ABC + env provider
  scrapers/      PlatformScraper ABC + LinkedIn + registry
  extraction/    Claude-based extractor + summarizer
scripts/         run_scrape.py CLI
tests/
```
