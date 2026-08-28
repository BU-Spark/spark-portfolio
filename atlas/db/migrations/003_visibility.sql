-- Widen visibility from a boolean to three states, and switch the gallery to an
-- OPT-IN model.
--
--   hidden    draft — not finished, nobody outside the admin area sees it
--   internal  ready, but NOT opted in to the public gallery. Staff can view it via
--             the admin detail page, which already mirrors the public layout.
--   public    opted in — live on the gallery
--
-- WHY OPT-IN. `published = true` on 140 rows never meant "someone chose to show
-- this"; it meant "the data looked complete enough". Launching those as `public`
-- would publish 140 projects nobody opted in, and every one of them currently has
-- zero images. So published=true maps to `internal`, not `public`: it preserves the
-- existing ready/draft distinction exactly, while leaving the public gallery to be
-- filled deliberately, one project at a time.
--
-- Consequence, stated plainly because it looks like a bug otherwise: after this
-- migration the PUBLIC GALLERY IS EMPTY until someone opts projects in. That is the
-- intended launch posture. To instead go live with everything that was previously
-- published, run the one statement at the bottom of this file.
--
-- Apply with: psql "$DATABASE_URL" -f atlas/db/migrations/003_visibility.sql
BEGIN;

-- Default 'hidden' is fail-closed: a row created by any path that forgets to set
-- visibility is invisible rather than accidentally public.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'hidden';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_visibility_chk') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_visibility_chk
      CHECK (visibility IN ('hidden', 'internal', 'public'));
  END IF;
END $$;

-- Backfill from the boolean. Guarded on 'hidden' so a re-run cannot stomp
-- visibilities that have since been set by hand — this file is expected to run more
-- than once (nonprod, then prod), and by the second run real opt-ins may exist.
UPDATE projects
   SET visibility = CASE WHEN published THEN 'internal' ELSE 'hidden' END
 WHERE visibility = 'hidden';

-- `published` is deliberately KEPT, not dropped. This is an expand-contract
-- migration: new schema + old code must stay safe, because the Worker deploy and the
-- migration are not atomic. The application dual-writes both columns for now
-- (published = visibility <> 'hidden'), so a code rollback still finds a correct
-- boolean. A later migration drops it once nothing reads it.
--
-- Do NOT start reading `published` again in new code. lib/db.ts derives
-- Project.published from visibility so the admin UI's draft/not-draft concept keeps
-- working off a single source of truth.

-- No index: 170 rows, 3 values, and the public list query has no LIMIT.
-- ponytail: add idx_projects_visibility when the table passes ~50k rows.

COMMIT;

-- ---------------------------------------------------------------------------
-- OPTIONAL — launch with everything that was previously published, instead of an
-- empty gallery. Run by hand only if that is the deliberate choice; it publishes
-- 140 projects that currently have no images.
--
--   UPDATE projects SET visibility = 'public' WHERE visibility = 'internal';
--
-- The reverse (back to the opt-in posture) is:
--
--   UPDATE projects SET visibility = 'internal' WHERE visibility = 'public';
-- ---------------------------------------------------------------------------
