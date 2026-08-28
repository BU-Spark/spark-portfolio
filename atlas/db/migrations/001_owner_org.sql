-- 001_owner_org.sql — org-scoped admin permissions (CDS / Spark).
--
-- Adds the authority axis, kept deliberately separate from projects.surfaces:
--   surfaces  = visibility (which public gallery shows the project)
--   owner_org = authority  (which team's admins may edit it)
-- A project can be surfaces={cds,spark} (both galleries) while owner_org='cds'.
--
-- Idempotent and re-runnable: every statement is IF NOT EXISTS / IS DISTINCT
-- FROM guarded, so applying twice is a no-op. Rollback lives in
-- 001_owner_org_rollback.sql.
--
--   psql "$DATABASE_URL" -f atlas/db/migrations/001_owner_org.sql
--
-- Apply to nonprod first, then prod. DB BEFORE CODE — old code never selects
-- owner_org (see COLS in lib/db.ts), so the new columns are inert to it; new
-- code against the old schema fails every project read.

BEGIN;

-- Authority. Default 'spark' is the fail-closed choice: anything created by a
-- path that forgets to set it becomes an ordinary Spark-owned project, never
-- something unowned.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_org text NOT NULL DEFAULT 'spark';

-- Admin scope. is_super is granted ONLY by SQL — no API accepts the field — so
-- forgetting to tag a new admin yields a scoped Spark admin, not a super admin.
ALTER TABLE users ADD COLUMN IF NOT EXISTS org      text    NOT NULL DEFAULT 'spark';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super boolean NOT NULL DEFAULT false;

-- Inbox rows have no project_id to inherit an org from, and once the admin CSV
-- import is org-attributed there are genuinely two possible origins. Deriving
-- the org at triage time instead would let a CDS admin turn a Spark-sourced row
-- into a CDS-owned project — the same identity laundering, one step later.
ALTER TABLE import_inbox ADD COLUMN IF NOT EXISTS org text NOT NULL DEFAULT 'spark';

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS (still true in 18), so guard on
-- pg_constraint to keep this file re-runnable.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_owner_org_chk') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_owner_org_chk CHECK (owner_org IN ('spark','cds'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_org_chk') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_org_chk CHECK (org IN ('spark','cds'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_inbox_org_chk') THEN
    ALTER TABLE import_inbox
      ADD CONSTRAINT import_inbox_org_chk CHECK (org IN ('spark','cds'));
  END IF;
END $$;

-- Backfill. ADD COLUMN ... NOT NULL DEFAULT already wrote 'spark' into every
-- existing row (PG11+ non-volatile default, no table rewrite), so these are
-- no-op safety nets that make the file correct against a partially-migrated DB.
--
-- Ownership is deliberately NOT derived from surfaces. The 23 cds-tagged rows are
-- all news/media partners (WBUR, WGBH, ProPublica, Granite State News, Boston 25,
-- The Intercept, NBC, MarketWatch, Commonwealth Beacon, New Bedford Light) and do
-- not reliably indicate CDS ownership. A super admin reassigns the genuine CDS
-- projects by hand after this lands. DO NOT "fix" this by deriving from surfaces.
UPDATE projects     SET owner_org = 'spark' WHERE owner_org IS DISTINCT FROM 'spark';
UPDATE users        SET org       = 'spark' WHERE org       IS DISTINCT FROM 'spark';
UPDATE import_inbox SET org       = 'spark' WHERE org       IS DISTINCT FROM 'spark';

-- users_email_key is UNIQUE(email) and case-SENSITIVE, but every lookup in the
-- app is lower(email). A@bu.edu and a@bu.edu could coexist as two rows with
-- different org/is_super — privilege confusion now that org carries authority.
--
-- NOTE: users_email_key is deliberately KEPT. addAdminEmail uses
-- `ON CONFLICT (email)`, which resolves against that exact index; dropping it
-- breaks the insert. The paired code change re-targets it to
-- `ON CONFLICT (lower(email))`, which this expression index satisfies.
-- Fail fast, with the offending addresses named, if the collision this index is
-- meant to prevent already exists. Otherwise CREATE UNIQUE INDEX raises a bare
-- unique-violation and aborts the whole transaction with nothing actionable in the
-- message. A clean nonprod run is no proof here: the duplicate would have to exist
-- on the target database, so prod can fail where nonprod passed.
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(lower(email), ', ') INTO dupes
    FROM users GROUP BY lower(email) HAVING count(*) > 1;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Case-duplicate user emails must be merged first: %', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- import_inbox dedupes on name_key alone. Once CSV imports carry an org, a CDS
-- row sharing a name_key with a Spark row would UPSERT onto the Spark row and
-- corrupt it. Re-key to (org, name_key).
--
-- PAIRED CODE CHANGE REQUIRED IN THE SAME DEPLOY: upsertInboxRow must become
-- `ON CONFLICT (org, name_key)`. Left as-is it fails outright with "no unique or
-- exclusion constraint matching the ON CONFLICT specification" — every PD sync 500s.
DROP INDEX IF EXISTS idx_import_inbox_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_inbox_org_name_key
  ON import_inbox (org, name_key);

-- No index on projects.owner_org: 170 rows, 2 distinct values, and
-- getProjectsForList() has no WHERE/LIMIT at all — the planner seq-scans either
-- way.
-- ponytail: add idx_projects_owner_org when the table passes ~50k rows or the
-- admin list gets real pagination.

COMMIT;

-- ---------------------------------------------------------------------------
-- SUPER ADMIN SEED — run by hand, per environment. NOT part of this migration.
--
-- is_super is grantable by SQL only (no API accepts the field), so after applying
-- this file each environment needs at least one super admin or ownership
-- reassignment, vocabulary edits, cross-org merges and POST /api/users become
-- unreachable by ANY account.
--
-- Deliberately left as a comment rather than executed: this file is run against
-- prod, nonprod and any future clone, and a migration that hard-codes email
-- addresses would silently mint super admins on every one of them — including
-- throwaway databases restored from a prod dump. Who holds the role is an
-- environment decision, not a schema one.
--
-- Applied to prod on 2026-08-06 for these two accounts:
--
--   UPDATE users SET is_super = true
--    WHERE lower(email) IN ('kzingade@bu.edu', 'langd0n@bu.edu');
--
--   -- Verify: expect exactly the rows you intended, and a non-zero count.
--   SELECT id, email, org, is_super FROM users ORDER BY id;
-- ---------------------------------------------------------------------------
