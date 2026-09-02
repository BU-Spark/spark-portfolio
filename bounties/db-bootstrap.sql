-- =============================================================================
-- bounties — database bootstrap & credential rotation
--
-- Run this file AS A WHOLE, against the bounties database (Railway: `railway`),
-- as a superuser:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db-bootstrap.sql
--
-- Every section is idempotent, so re-running the file is safe.
--
-- DO NOT run SECTION 2 on its own. It grants on person / bounty_interest,
-- which SECTION 1 creates; run out of order it fails with
-- `ERROR: relation "person" does not exist` and the app ends up with no
-- table privileges. Section order is a dependency, not a suggestion.
--
-- Replace both PUT_A_NEW_..._HERE placeholders first. Generate strong values:
--   openssl rand -base64 24 | tr -d '/+=' | cut -c1-28
--
-- These are deliberately plain quoted literals, not psql `:'var'` variables:
-- psql only interpolates those via -f / stdin, NEVER via -c, and no GUI
-- console interpolates them at all. Either way you get
-- `ERROR: syntax error at or near ":"`. Literals work in every client.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — schema
-- Safe to run any time. Creates nothing if it already exists.
-- =============================================================================

CREATE TABLE IF NOT EXISTS person (
  id          bigserial PRIMARY KEY,
  email       text        NOT NULL UNIQUE,   -- always stored lowercased
  first_name  text        NOT NULL,
  last_name   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bounty_interest (
  id           bigserial   PRIMARY KEY,
  -- the bounty's content-collection slug; deliberately not a FK, because
  -- bounties live in src/content/bounties/*.md and there is no table to point at
  bounty_slug  text        NOT NULL,
  person_id    bigint      NOT NULL REFERENCES person(id) ON DELETE CASCADE,

  -- Categoricals are text + CHECK, not ENUMs, per spine/vocabularies.md.
  -- Widening one is a DROP-and-RECREATE of the constraint, never
  -- add-if-absent: a guard that finds the narrow constraint and skips leaves
  -- the database rejecting a value the application believes is valid, and that
  -- failure is invisible until the first write.
  intent       text        NOT NULL
                 CHECK (intent IN ('interested', 'looking_for_team')),
  working_mode text        NOT NULL DEFAULT 'solo'
                 CHECK (working_mode IN ('solo', 'team')),

  team_id      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- one standing position per person per bounty; re-registering updates it
  UNIQUE (bounty_slug, person_id)
);

CREATE INDEX IF NOT EXISTS bounty_interest_slug_idx
  ON bounty_interest (bounty_slug);

CREATE INDEX IF NOT EXISTS bounty_interest_team_idx
  ON bounty_interest (bounty_slug, team_id)
  WHERE team_id IS NOT NULL;

-- Convenience views, so answering "who signed up for what" is a one-liner
-- instead of a join you have to remember. CREATE OR REPLACE keeps them
-- idempotent. Bounty *titles* live in markdown, not the DB, so these key on
-- slug only.
CREATE OR REPLACE VIEW bounty_roster AS
SELECT bi.bounty_slug,
       p.email, p.first_name, p.last_name,
       bi.intent, bi.working_mode, bi.team_id,
       bi.created_at AS joined_at
FROM bounty_interest bi
JOIN person p ON p.id = bi.person_id;

-- One row per PERSON across all bounties: SELECT * FROM bounty_people;
CREATE OR REPLACE VIEW bounty_people AS
SELECT p.email, p.first_name, p.last_name,
       count(*)                                        AS bounty_count,
       array_agg(bi.bounty_slug ORDER BY bi.bounty_slug) AS bounties,
       min(bi.created_at)                              AS first_joined,
       max(bi.created_at)                              AS last_joined
FROM person p
JOIN bounty_interest bi ON bi.person_id = p.id
GROUP BY p.id, p.email, p.first_name, p.last_name;


-- =============================================================================
-- SECTION 2 — least-privilege application role
--
-- The app must not connect as `postgres`. This role can read and write the two
-- tables and nothing else: no DDL, no other schemas, no superuser.
-- Running this changes nothing about existing connections.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bounties_app') THEN
    CREATE ROLE bounties_app LOGIN;
  END IF;
END
$$;

-- Set (or re-set) the password. This is also how you rotate the APP password
-- later: re-run just this line with a new value.
ALTER ROLE bounties_app WITH PASSWORD 'PUT_A_NEW_APP_PASSWORD_HERE';

-- No CREATE rights anywhere; connect + use the schema only.
GRANT CONNECT ON DATABASE railway TO bounties_app;
GRANT USAGE   ON SCHEMA public    TO bounties_app;
REVOKE CREATE ON SCHEMA public FROM bounties_app;

-- Exactly the two tables, exactly the four verbs.
GRANT SELECT, INSERT, UPDATE, DELETE ON person          TO bounties_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bounty_interest TO bounties_app;

-- bigserial primary keys need the sequences.
GRANT SELECT ON bounty_roster TO bounties_app;
GRANT SELECT ON bounty_people TO bounties_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bounties_app;

-- So a future table added by SECTION 1 doesn't silently 403 the app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bounties_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bounties_app;


-- =============================================================================
-- SECTION 3 — verify before you rely on it
-- Expect: two tables, the CHECK constraints present, and bounties_app holding
-- exactly SELECT/INSERT/UPDATE/DELETE on both tables.
-- =============================================================================

SELECT tablename FROM pg_tables
 WHERE schemaname = 'public' ORDER BY tablename;

SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'bounty_interest'::regclass
   AND contype = 'c'
 ORDER BY conname;

SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS grants
  FROM information_schema.table_privileges
 WHERE grantee = 'bounties_app'
 GROUP BY table_name
 ORDER BY table_name;

-- Should return false. If it returns true, the role is over-privileged.
SELECT rolsuper OR rolcreatedb OR rolcreaterole AS over_privileged
  FROM pg_roles WHERE rolname = 'bounties_app';


-- =============================================================================
-- SECTION 4 — rotate the LEAKED superuser password
--
-- ⚠ RUN THIS LAST, AND READ THIS FIRST.
--
-- The old `postgres` password was pasted into a chat transcript, so it must be
-- considered public. It is superuser on an internet-facing endpoint.
--
-- BUT: Railway stores that password in the service variables (PGPASSWORD,
-- POSTGRES_PASSWORD) and builds its own connection strings from them. Changing
-- it here does NOT update those variables, so after this runs:
--   - Railway's Connect tab / provided DATABASE_URL will be WRONG
--   - anything still using the old password stops working
--
-- So either:
--   (a) you can edit those service variables -> run this, then update them; or
--   (b) you cannot (non-admin) -> get an admin to rotate it from the Railway
--       side instead, and skip this section.
--
-- Either way, SECTION 2 already means the app never uses this account, so the
-- app keeps working through the rotation.
-- =============================================================================

-- ALTER ROLE postgres WITH PASSWORD 'PUT_A_NEW_SUPERUSER_PASSWORD_HERE';

-- Who else can log in? Anything unexpected here is worth asking about.
SELECT rolname, rolsuper, rolcanlogin
  FROM pg_roles
 WHERE rolcanlogin
 ORDER BY rolsuper DESC, rolname;
