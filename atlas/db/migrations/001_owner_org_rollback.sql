-- Rollback for 001_owner_org.sql.
--
--   psql "$DATABASE_URL" -f atlas/db/migrations/001_owner_org_rollback.sql
--
-- TWO PRECONDITIONS, both easy to get wrong:
--
-- 1. REVERT THE CODE FIRST. The new columns are inert to old code (COLS in
--    lib/db.ts never selects owner_org), but the reverse is not true: new code
--    against this rolled-back schema fails every project read. Also revert the
--    two paired ON CONFLICT changes — `ON CONFLICT (org, name_key)` and
--    `ON CONFLICT (lower(email))` both fail once the indexes below are gone.
--
-- 2. THIS ROLLBACK EXPIRES. It is lossless only until a super admin starts
--    reassigning genuine CDS projects. After that, DROP COLUMN owner_org
--    destroys hand-entered ownership that exists nowhere else — at that point
--    "rollback" means revert the code and LEAVE the columns in place.

BEGIN;

ALTER TABLE projects     DROP CONSTRAINT IF EXISTS projects_owner_org_chk;
ALTER TABLE users        DROP CONSTRAINT IF EXISTS users_org_chk;
ALTER TABLE import_inbox DROP CONSTRAINT IF EXISTS import_inbox_org_chk;

DROP INDEX IF EXISTS users_email_lower_key;

-- Restoring the single-column inbox key FAILS if two orgs already hold the same
-- name_key (exactly what the (org, name_key) key made possible). If this errors,
-- delete the non-spark inbox rows first:
--   DELETE FROM import_inbox WHERE org <> 'spark';
DROP INDEX IF EXISTS idx_import_inbox_org_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_inbox_name_key ON import_inbox (name_key);

ALTER TABLE projects     DROP COLUMN IF EXISTS owner_org;
ALTER TABLE users        DROP COLUMN IF EXISTS org;
ALTER TABLE users        DROP COLUMN IF EXISTS is_super;
ALTER TABLE import_inbox DROP COLUMN IF EXISTS org;

COMMIT;
