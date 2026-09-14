-- A bounty's prize is won by a TEAM, not by each member.
--
-- payout_cents on bounty_interest stored money per person, so marking a team of
-- four as delivered on a $200 bounty recorded $800. The award is one fact about
-- (bounty, team) and now lives in its own table, where it cannot multiply by
-- headcount.
--
-- Safe to re-run. Additive: no existing row is modified, and the legacy
-- bounty_interest.payout_cents column is left in place for rows written before
-- awards existed.
BEGIN;

CREATE TABLE IF NOT EXISTS bounty_award (
  bounty_slug    text        NOT NULL,
  team_key       text        NOT NULL,
  payout_cents   integer     NOT NULL DEFAULT 0 CHECK (payout_cents >= 0),
  submission_url text,
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bounty_slug, team_key)
);

-- DROP, not CREATE OR REPLACE: replacing a view can only APPEND columns, and
-- team_key / team_payout_cents sit in the middle of the select list.
DROP VIEW IF EXISTS bounty_roster;
CREATE VIEW bounty_roster AS
SELECT bi.bounty_slug,
       p.email, p.first_name, p.last_name,
       bi.intent, bi.working_mode, bi.team_id,
       bi.created_at AS joined_at,
       bi.submitted_at, bi.completed_at,
       coalesce(bi.team_id, 'person:' || bi.person_id::text) AS team_key,
       a.payout_cents AS team_payout_cents,
       bi.payout_cents,
       coalesce(a.submission_url, bi.submission_url) AS submission_url
FROM bounty_interest bi
JOIN person p ON p.id = bi.person_id
LEFT JOIN bounty_award a
       ON a.bounty_slug = bi.bounty_slug
      AND a.team_key = coalesce(bi.team_id, 'person:' || bi.person_id::text);

DROP VIEW IF EXISTS bounty_people;
CREATE VIEW bounty_people AS
SELECT p.email, p.first_name, p.last_name,
       count(*)                                        AS bounty_count,
       array_agg(bi.bounty_slug ORDER BY bi.bounty_slug) AS bounties,
       min(bi.created_at)                              AS first_joined,
       max(bi.created_at)                              AS last_joined,
       count(bi.completed_at)                          AS completed_count
FROM person p
JOIN bounty_interest bi ON bi.person_id = p.id
GROUP BY p.id, p.email, p.first_name, p.last_name;

-- The app role needs to read and write awards like any other table.
GRANT SELECT, INSERT, UPDATE, DELETE ON bounty_award TO bounties_app;
GRANT SELECT ON bounty_roster, bounty_people TO bounties_app;

COMMIT;
