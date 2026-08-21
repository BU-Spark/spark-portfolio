-- Pipeline status for projects: where the work is, as opposed to who may edit it
-- (owner_org) or who can see it (published/surfaces).
--
-- THREE INDEPENDENT AXES. Do not derive any one from another:
--   owner_org  — AUTHORITY  — which team may edit          (spark | cds)
--   published  — VISIBILITY — whether the public sees it   (boolean today)
--   status     — PIPELINE   — where the work actually is   (pending|active|complete)
--
-- The distinction that motivates this: a project can be `complete` but unpublished
-- (finished, still missing a screenshot), or `published` while `active` (live work
-- shown deliberately). Collapsing pipeline state into the publish toggle is exactly
-- what made the old model unable to answer "what is in flight right now".
--
--   pending   scoped, not yet worked on (pre-active)
--   active    currently being worked on
--   complete  work finished
--
-- Apply with: psql "$DATABASE_URL" -f hub/db/migrations/002_project_status.sql
BEGIN;

-- Two defaults, deliberately, and the ORDER is the point.
--
-- ADD COLUMN ... DEFAULT 'complete' stamps every EXISTING row with 'complete'
-- without a table rewrite (PG11+ non-volatile default). That is the correct value
-- for the current 170: every project's latest run is Spring 2026 or earlier and it
-- is now August 2026, so nothing in the table is still in flight. There is no
-- Fall 2026 run in the database at all (verified), so no row is wrongly retired.
--
-- Then SET DEFAULT 'pending' changes only what FUTURE inserts get, leaving the
-- backfilled rows untouched. A new project is scoped before it is worked on, so
-- 'pending' is the honest default going forward. This is why there is no UPDATE
-- statement here: the two defaults do the work of a backfill for free.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete';
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'pending';

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS; guard on pg_constraint so re-runs
-- are clean (this file is expected to be run more than once — nonprod, then prod).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_status_chk') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_status_chk CHECK (status IN ('pending', 'active', 'complete'));
  END IF;
END $$;

-- No index on status: 170 rows and 3 distinct values, and getProjectsForList()
-- still has no WHERE/LIMIT — the planner seq-scans regardless. Same reasoning as
-- owner_org in 001.
-- ponytail: add idx_projects_status when the table passes ~50k rows or the admin
-- list gets real server-side filtering.

COMMIT;
