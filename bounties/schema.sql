-- bounties — Postgres schema
--
-- Replaces the Mailchimp tag conventions that hackbu.dev still uses
-- (`interested:<slug>`, `team:<slug>`, `solo:<slug>`, `has-team:<slug>`,
-- `team-group:<slug>:<id>`). Those tags encoded mutually exclusive facts as
-- independent booleans, so the write path had to explicitly deactivate the
-- conflicting tag every time. Columns make the contradiction unrepresentable.
--
-- Categoricals are `text` + a CHECK constraint rather than Postgres ENUMs,
-- per spine/vocabularies.md § "Storage note". Widening one is therefore a
-- DROP-and-RECREATE of the constraint, never an add-if-absent: a pg_constraint
-- guard that finds the narrow constraint and skips leaves the database
-- rejecting a value the application believes is valid, and that failure is
-- invisible until the first write.

CREATE TABLE IF NOT EXISTS person (
  id          bigserial PRIMARY KEY,
  -- always stored lowercased; the application lowercases before writing
  email       text        NOT NULL UNIQUE,
  first_name  text        NOT NULL,
  last_name   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bounty_interest (
  id           bigserial   PRIMARY KEY,
  -- the bounty's content-collection slug. Deliberately NOT a foreign key:
  -- bounties live in src/content/bounties/*.md, so there is no table to
  -- reference. If bounty content moves into Postgres, add the FK then.
  bounty_slug  text        NOT NULL,
  person_id    bigint      NOT NULL REFERENCES person(id) ON DELETE CASCADE,

  -- Disjoint intents, matching the two CTAs on a bounty page. The old tag
  -- model made these separate counters and had "I'm interested" deactivate
  -- `team:<slug>`; one column enforces that instead of remembering to.
  intent       text        NOT NULL
                 CHECK (intent IN ('interested', 'looking_for_team')),

  working_mode text        NOT NULL DEFAULT 'solo'
                 CHECK (working_mode IN ('solo', 'team')),

  -- Shared opaque id grouping teammates on one bounty. No separate team table
  -- until a team has attributes of its own.
  team_id      text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- one standing position per person per bounty; re-registering updates it
  UNIQUE (bounty_slug, person_id)
);

-- The board asks for counts per slug on every page load.
CREATE INDEX IF NOT EXISTS bounty_interest_slug_idx
  ON bounty_interest (bounty_slug);

-- Team rosters are read per bounty.
CREATE INDEX IF NOT EXISTS bounty_interest_team_idx
  ON bounty_interest (bounty_slug, team_id)
  WHERE team_id IS NOT NULL;
