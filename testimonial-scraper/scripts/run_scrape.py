"""End-to-end scrape CLI for the Testimonial scraper.

This is the thin command-line entrypoint that wires the pluggable pieces
described in ``docs/ARCHITECTURE.md`` into one run. The intended flow is:

    1. Resolve credentials via a ``CredentialProvider`` (env now, vault later).
       The DB only ever names *which* provider + *which* locator; the secret is
       resolved into an in-memory ``Secret`` at this point and never persisted.
    2. Look up the right ``PlatformScraper`` for ``--platform`` in the scraper
       registry (e.g. the LinkedIn scraper), constructed with the resolved
       credential.
    3. Scrape mentions for ``--seed`` (a search query / profile / hashtag),
       yielding raw ``RawMention`` records.
    4. Persist the scrape run + raw mentions (author / mention / scrape_run
       rows) via the db layer. Raw text is stored verbatim and immutably so
       extraction can be re-run without re-scraping.
    5. For each new mention, run ``TestimonialExtractor`` (Claude) to derive
       testimonials, their atomic elements, and candidate project links
       (mention -> project), and persist those derived rows.
    6. Optionally run the ``Summarizer`` (Claude) to produce aggregate summary
       text (global / per-project / per-author) and persist ``summary`` rows.

Other modules (db/, credentials/env_provider, scrapers/) are being built in
parallel, so the heavy wiring lives inside ``main()`` and is import-guarded:
this file always ``py_compile``s and ``--help`` always works even before those
modules land. When a dependency is missing, the step is reported as skipped
rather than crashing.

Usage:
    python scripts/run_scrape.py --platform linkedin --seed "Spark project"
    python scripts/run_scrape.py --help
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Make the src-layout package importable when run directly
# (`python scripts/run_scrape.py`) without requiring PYTHONPATH or an install.
_SRC = Path(__file__).resolve().parent.parent / "src"
if _SRC.is_dir() and str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_scrape",
        description=(
            "Scrape social mentions of Spark, persist them, extract "
            "testimonials with Claude, and optionally summarize."
        ),
    )
    parser.add_argument(
        "--platform",
        required=True,
        help="Platform to scrape (e.g. 'linkedin'). Resolved via the scraper registry.",
    )
    parser.add_argument(
        "--seed",
        required=True,
        help="Search seed: a query string, profile, or hashtag to scrape.",
    )
    parser.add_argument(
        "--credential-label",
        default=None,
        help=(
            "Label of the credential_set to use (e.g. 'kush-personal'). "
            "Defaults to the platform's default credential."
        ),
    )
    parser.add_argument(
        "--summarize",
        action="store_true",
        help="After extraction, generate an aggregate summary of the testimonials.",
    )
    parser.add_argument(
        "--summary-scope",
        choices=("global", "project", "author"),
        default="global",
        help="Scope for the optional summary (default: global).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scrape and extract but do not persist anything.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    # Heavy imports are kept inside main() so this module compiles and --help
    # works even while db/, credentials/, and scrapers/ are still being built
    # by other agents. Each wiring step degrades gracefully if its dependency
    # is not importable yet.
    try:
        from testimonial.credentials.env_provider import EnvCredentialProvider
        from testimonial.scrapers.registry import get_scraper
    except ImportError as exc:
        print(
            f"[run_scrape] scraper/credential wiring not available yet ({exc}). "
            "This entrypoint documents the intended flow; the db/, credentials/, "
            "and scrapers/ modules are built in parallel.",
            file=sys.stderr,
        )
        return 2

    # 1. Resolve credentials. The provider turns a locator into an in-memory
    #    Secret; nothing secret is ever read from or written to the DB here.
    provider = EnvCredentialProvider()

    # 2. Get the scraper for the requested platform from the registry, wired
    #    with the resolved credential provider.
    scraper = get_scraper(args.platform, credential_provider=provider)

    # 3. Scrape raw mentions for the seed.
    mentions = list(scraper.search(args.seed))
    print(f"[run_scrape] scraped {len(mentions)} mention(s) from {args.platform}")

    # 4. Persist the scrape run + raw mentions (unless --dry-run).
    #    Persistence is owned by the db layer (imported lazily here).
    persisted = mentions
    if not args.dry_run:
        try:
            from testimonial.db import persistence  # type: ignore[attr-defined]

            persisted = persistence.save_mentions(args.platform, args.seed, mentions)
        except ImportError as exc:
            print(
                f"[run_scrape] db persistence not available yet ({exc}); "
                "continuing in-memory.",
                file=sys.stderr,
            )

    # 5. Extract testimonials from each mention with Claude.
    from testimonial.extraction import Summarizer, TestimonialExtractor

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "[run_scrape] ANTHROPIC_API_KEY is not set; cannot run extraction.",
            file=sys.stderr,
        )
        return 3

    known_projects = _load_known_project_names()
    extractor = TestimonialExtractor()

    all_testimonials: list[dict] = []
    for mention in persisted:
        raw_text = _mention_text(mention)
        testimonials = extractor.extract(raw_text, known_projects)
        all_testimonials.extend(t.as_dict() for t in testimonials)
        if not args.dry_run:
            try:
                from testimonial.db import persistence  # type: ignore[attr-defined]

                persistence.save_testimonials(mention, testimonials)
            except ImportError:
                pass  # already warned above

    print(f"[run_scrape] extracted {len(all_testimonials)} testimonial(s)")

    # 6. Optionally summarize.
    if args.summarize and all_testimonials:
        summarizer = Summarizer()
        summary = summarizer.summarize(all_testimonials, scope=args.summary_scope)
        print(f"\n[run_scrape] {args.summary_scope} summary:\n{summary}")
        if not args.dry_run:
            try:
                from testimonial.db import persistence  # type: ignore[attr-defined]

                persistence.save_summary(args.summary_scope, summary, all_testimonials)
            except ImportError:
                pass

    return 0


def _load_known_project_names() -> list[str]:
    """Load known Spark project names for link matching.

    Pulls from the synced ``project`` mirror via the db layer when available;
    returns an empty list otherwise (extraction still runs, just without
    project-link matching).
    """
    try:
        from testimonial.db import persistence  # type: ignore[attr-defined]

        return list(persistence.list_project_names())
    except ImportError:
        return []


def _mention_text(mention: object) -> str:
    """Best-effort pull of the raw text out of a mention object/dict."""
    if isinstance(mention, dict):
        return str(mention.get("raw_text", "") or mention.get("text", ""))
    for attr in ("raw_text", "text"):
        value = getattr(mention, attr, None)
        if value:
            return str(value)
    return ""


if __name__ == "__main__":
    raise SystemExit(main())
