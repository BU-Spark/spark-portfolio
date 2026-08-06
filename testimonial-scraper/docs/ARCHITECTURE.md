# Testimonial Scraper — Architecture

## Goal

From a set of social credentials, walk social platforms (LinkedIn first), find
posts/mentions/testimonials about **Spark**, tie them back to Spark projects, store
the atomic testimonial elements, and enable generated summaries later.

## The pluggability seam (Langdon's key constraint)

Two independent plug points, deliberately kept apart:

```
                ┌─────────────────────┐
                │   CredentialProvider │   "where do secrets come from?"
                │   (ABC)              │   env → personal creds now
                └──────────┬───────────┘   vault → BU Spark creds later
                           │ resolves secret at runtime (never stored in DB)
                           ▼
┌──────────────┐   uses   ┌─────────────────────┐   emits   ┌──────────────┐
│ scrape job   │ ───────▶ │   PlatformScraper    │ ────────▶ │  raw mention │
│ (CLI/cron)   │          │   (ABC: LinkedIn,…)  │           │  records     │
└──────────────┘          └─────────────────────┘           └──────┬───────┘
                                                                    │
                          ┌─────────────────────┐                  ▼
                          │  TestimonialExtractor│   LLM (Anthropic)  derives
                          │  (Claude)            │ ◀──────────  testimonials +
                          └─────────────────────┘              elements + project
                                                               links + summaries
```

- **`CredentialProvider`** (`src/testimonial/credentials/`): `resolve(credential_set) -> Secret`.
  Implementations: `EnvCredentialProvider` (reads `LINKEDIN_USER`/`LINKEDIN_PASS` or a
  session cookie from env), later `VaultCredentialProvider`. The DB row only names
  *which* provider + *which* key — never the secret itself.
- **`PlatformScraper`** (`src/testimonial/scrapers/`): `search(seed) -> Iterable[RawMention]`.
  First impl `LinkedInScraper`. New platforms = new subclass, registered in a registry.
- **`TestimonialExtractor`** (`src/testimonial/extraction/`): takes raw mention text,
  uses Claude to extract testimonial(s), atomic elements, sentiment, and candidate
  project links with confidence. Pure function of the mention → re-runnable.

## Stack

- **Python 3.11+**, **SQLAlchemy 2.x** + **Alembic** migrations, **Postgres**
  (matches ProjectShowcase's Railway Postgres; can be a separate DB in the same workspace).
- **Anthropic SDK** (`anthropic`) for extraction/summarization — Claude latest model.
- LinkedIn access: start with an authenticated-session approach (cookie) behind the
  `CredentialProvider`; keep the scraper interface generic so the actual transport
  (official API vs. session) can change without touching the rest.

## Why not store creds in the DB

Storing LinkedIn passwords/session cookies in Postgres would make the showcase-adjacent
DB a high-value secret store and a breach liability. The locator pattern means the DB is
safe to share with the team and Langdon for review; secrets stay in env / secret manager.

**Encrypted-column variant (review pass 1 — Langdon).** If we later want the creds to
live *in* Postgres, that fits the same seam as a third provider: `provider_type =
pgcrypto`, where `secret_locator` names an encrypted column and a single key-encryption
key (KEK) held in env decrypts it — "one secret, the decryption key." This still keeps
plaintext out of the DB. Trade-off vs. the locator default: it consolidates many creds
behind one KEK (nice at BU-Spark scale) but that KEK still lives outside the DB and
becomes the single point of compromise, whereas the locator keeps the DB entirely
secret-free (a breach yields nothing to decrypt). Default remains `env`; adopt pgcrypto
only if cred volume justifies it, and use Postgres `pgcrypto` — never hand-rolled crypto.

**Comments & second-pass project mapping (review pass 1).** Comments on posts are
captured as `mention` rows with a `parent_mention_id` self-reference, so no new scraper
path is needed. Project mapping never blocks collection: the scraper writes raw mentions
only, and `mention_project_link` keeps unresolved references (`candidate_name`) for a
later reconciliation pass. See DATA_MODEL.md.

## Layout

```
Testimonial/
  docs/            DATA_MODEL.md, ARCHITECTURE.md
  src/testimonial/
    db/            models.py (SQLAlchemy), session.py
    credentials/   base.py (CredentialProvider ABC), env_provider.py
    scrapers/      base.py (PlatformScraper ABC), linkedin.py, registry.py
    extraction/    extractor.py (Claude), summarizer.py
  scripts/         run_scrape.py (CLI entrypoint)
  tests/
```

## ⚠️ Compliance note (must resolve before live scraping)

LinkedIn's ToS restricts automated scraping; credential-based automation can get
accounts flagged. Before pointing this at a real/BU Spark account we should confirm the
sanctioned path (official LinkedIn API / partner access, or explicit approval). The
architecture intentionally hides transport behind `PlatformScraper` so we can switch to
an API-based source without rework. Flagging this for Langdon.
