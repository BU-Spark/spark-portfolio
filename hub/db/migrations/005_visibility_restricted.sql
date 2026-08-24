-- Widen projects_visibility_chk to admit a fourth state: 'restricted'.
--
-- WHY, AND WHY IT MUST LAND BEFORE THE BU LOGIN TIER
--
-- Today 'internal' means "ready, staff only". The BU-tier work redefines it as
-- "any signed-in @bu.edu user can see this" — which silently exposes all 140
-- currently-internal projects to the whole university the moment login opens.
--
-- Some of that work is client-confidential and must never be BU-wide. There is no
-- column today that can say so, so this adds one state and the ladder becomes:
--
--   hidden      draft, not finished           — admin only
--   restricted  finished, deliberately closed — admin only
--   internal    cleared for the BU community  — any signed-in @bu.edu user
--   public      opted in                      — everyone
--
-- Ordering is least → most visible, matching VISIBILITIES in lib/data.ts.
--
-- This file is ONLY the widening. The 140-row move from 'internal' to 'restricted'
-- is a separate, deliberate step, run after the code that understands the new value
-- is deployed — otherwise prod holds a value its running code cannot label.
--
-- Apply with: psql "$DATABASE_URL" -f hub/db/migrations/005_visibility_restricted.sql
BEGIN;

-- DROP then ADD, not a pg_constraint guard. Same reasoning as 004: the constraint
-- already exists with the narrower list, so a guard would find it, skip, and leave
-- the database rejecting a value the application now believes is valid. Widening an
-- enum CHECK is always a replace. Re-runnable either way.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_visibility_chk;
ALTER TABLE projects
  ADD CONSTRAINT projects_visibility_chk
  CHECK (visibility IN ('hidden', 'restricted', 'internal', 'public'));

-- Default stays 'hidden' (set in 003). A new project is a draft; nothing is born
-- restricted, because restricted asserts a deliberate decision about a finished thing.

COMMIT;
