-- Revert 006: drop projects.aliases.
--
-- DESTRUCTIVE: every alias recorded by admins or the issue bot (including old titles
-- kept on rename) is lost. Export first if any exist:
--
--   \copy (SELECT id, aliases FROM projects WHERE aliases <> '{}') TO 'aliases-backup.csv' CSV HEADER
--
-- Revert the code FIRST — lib/db.ts selects this column on every project read, so
-- dropping it under the new code 500s the whole gallery.
BEGIN;

ALTER TABLE projects DROP COLUMN IF EXISTS aliases;

COMMIT;
