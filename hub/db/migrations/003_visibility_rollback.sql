-- Rollback for 003_visibility.sql.
--
-- This one is unusually safe, because 003 was expand-contract: `published` was never
-- dropped and the application dual-writes it, so the boolean is still correct at any
-- point. Reverting the code alone is therefore a complete rollback — old code reads
-- `published`, which is accurate, and simply ignores `visibility`.
--
-- Run the statements below only if you also want the column gone.
--
-- WHAT IS LOST: the distinction between 'internal' and 'public'. Both collapse to
-- published = true, so every deliberate opt-in decision is erased and cannot be
-- reconstructed — the boolean cannot tell "ready" from "live". If real opt-ins exist,
-- prefer reverting the code and leaving the column in place.
BEGIN;

-- Re-sync the boolean first, so it reflects any visibility changes made since 003.
-- Note this is where the information loss happens: internal and public both become
-- true, because that is all a boolean can say.
UPDATE projects SET published = (visibility <> 'hidden');

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_visibility_chk;
ALTER TABLE projects DROP COLUMN IF EXISTS visibility;

COMMIT;
