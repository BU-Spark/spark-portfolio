-- Revert 005: narrow projects_visibility_chk back to three states.
--
-- ORDERING HAZARD — read before running.
--
-- This FAILS if any row is 'restricted', because Postgres validates a new CHECK
-- against existing data. That is deliberate. 'restricted' is the only record that
-- somebody decided a project must NOT be shown to the BU community, and the obvious
-- automatic fallback is the dangerous one: mapping restricted → internal would, the
-- moment the BU tier is live, publish exactly the projects that were withheld.
--
-- So decide first, explicitly. The SAFE direction is toward less visibility:
--
--   UPDATE projects SET visibility = 'hidden' WHERE visibility = 'restricted';
--
-- That over-hides (a finished project reappears as a draft) but cannot leak. Run it
-- yourself, then this file.
--
-- Reverting the code is part of this rollback, not optional: lib/data.ts
-- VISIBILITIES, the legacy-published CASE in updateProject, and the create form all
-- know about 'restricted', and writing it against the narrow CHECK raises a
-- constraint violation.
BEGIN;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_visibility_chk;
ALTER TABLE projects
  ADD CONSTRAINT projects_visibility_chk
  CHECK (visibility IN ('hidden', 'internal', 'public'));

COMMIT;
