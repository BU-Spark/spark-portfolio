-- Rollback for 002_project_status.sql.
--
-- PRECONDITION: revert the CODE FIRST, then run this. New schema + old code is
-- inert (old COLS never selects `status`, and addProject omits it so the default
-- applies). Old schema + new code is hard down: `column "status" does not exist`
-- on every project read, public gallery included.
--
-- THIS ROLLBACK EXPIRES. It is lossless only while every row still holds its
-- seeded value. Once anyone sets a project to pending/active by hand, dropping the
-- column destroys pipeline state that exists nowhere else — no term or publish flag
-- can reconstruct "scoped but not started". After that point, rollback means
-- "revert the code and leave the column in place", which is safe.
BEGIN;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_chk;
ALTER TABLE projects DROP COLUMN IF EXISTS status;

COMMIT;
