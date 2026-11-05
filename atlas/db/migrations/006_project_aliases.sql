-- Add projects.aliases: human-readable other names for a project (the spelled-out
-- long form, names it was previously known by). Search matches them; the project
-- still displays under `title`. NOT ids or repo slugs — nothing auto-populates this.
--
-- NOT NULL DEFAULT '{}' backfills every existing row with an empty list in one step
-- (a constant default is metadata-only in PG 11+, no table rewrite).
--
-- ORDERING: apply this BEFORE deploying code that selects `aliases` (lib/db.ts COLS,
-- scripts/issue-bot/answer.mjs). Old code ignores the column, so migrating first is
-- safe; deploying first 500s every project read.
--
-- Apply with: psql "$DATABASE_URL" -f atlas/db/migrations/006_project_aliases.sql
BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

COMMIT;
