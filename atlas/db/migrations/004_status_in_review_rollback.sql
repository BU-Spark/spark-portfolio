-- Revert 004: narrow projects_status_chk back to the original three statuses.
--
-- ORDERING HAZARD, read before running.
--
-- This FAILS if any row is already 'in_review' — the new CHECK is validated against
-- existing data. That is deliberate: silently rewriting those rows would destroy the
-- only record that a completion was submitted and rejected.
--
-- So decide what those rows should become first. 'active' is the honest fallback (the
-- work is outstanding), and it is what the code did before 004 existed:
--
--   UPDATE projects SET status = 'active' WHERE status = 'in_review';
--
-- Run that yourself, deliberately, then this file. It is not included here because a
-- rollback script that quietly mutates data is how you lose information you needed.
--
-- Reverting the code (lib/data.ts PROJECT_STATUSES, PROJECT_STATUS_LABELS,
-- PROJECT_STATUS_SHORT, and the pd-complete route's rejection branch) is part of this
-- rollback, not optional: code that writes 'in_review' against the narrow CHECK gets a
-- constraint violation on every rejected submission.
BEGIN;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_chk;
ALTER TABLE projects
  ADD CONSTRAINT projects_status_chk
  CHECK (status IN ('pending', 'active', 'complete'));

COMMIT;
