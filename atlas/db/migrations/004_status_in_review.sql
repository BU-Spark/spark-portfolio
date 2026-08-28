-- Widen projects_status_chk to admit a fourth pipeline status: 'in_review'.
--
-- WHY A FOURTH STATUS AND NOT A REUSE
--
-- /api/pd-complete runs the automated checks when a PM submits the end-of-semester
-- completion form. Pass sets 'complete'. Failure previously set 'active', because the
-- spec's suggestion of 'pending' was wrong: 'pending' means "scoped, not yet worked
-- on", so reusing it would make work nobody has started indistinguishable from work
-- whose PM believes it is finished.
--
-- 'active' was the least-wrong option available, but it loses the signal a supervisor
-- actually needs — that a completion claim was made and rejected. 'in_review' records
-- exactly that: submitted, bounced, fixes outstanding.
--
-- This is additive and non-breaking. No existing row changes value, so old code that
-- only knows three statuses keeps working; it just cannot produce or filter the new
-- one. Deploy order therefore does not matter for reads. It DOES matter for writes:
-- run this BEFORE deploying code that can write 'in_review', or the CHECK rejects it.
--
-- Apply with: psql "$DATABASE_URL" -f atlas/db/migrations/004_status_in_review.sql
BEGIN;

-- DROP then ADD rather than a guarded ADD: the constraint already exists from 002 with
-- the narrower list, so an IF NOT EXISTS guard would find it and silently do nothing —
-- leaving the database rejecting a value the application now considers valid. That
-- failure mode is invisible until the first webhook rejection 500s.
--
-- Re-runnable: DROP ... IF EXISTS tolerates a missing constraint, and the ADD then
-- restores the full four-value list either way.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_chk;
ALTER TABLE projects
  ADD CONSTRAINT projects_status_chk
  CHECK (status IN ('pending', 'active', 'in_review', 'complete'));

-- The column default stays 'pending' (set in 002). A new project is scoped before it
-- is worked on; nothing should be born in review.

-- No backfill. Nothing currently in the table is a bounced submission — pd_completions
-- is the record of submissions and every existing row predates this status — so an
-- UPDATE here would be inventing history.

COMMIT;
