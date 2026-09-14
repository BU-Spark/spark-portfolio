/**
 * Postgres access for the bounty board (Railway, same provider as atlas).
 *
 * Follows the pattern atlas/lib/db.ts arrived at, including its hard-won rule:
 * under Hyperdrive, do NOT retain a pg Pool in the Worker isolate — stale
 * client sockets cause intermittent 1101s. Hyperdrive owns the origin-side
 * pool, so a fresh Client per request is correct here, and since this app only
 * ever runs on Workers in production there is no Pool path at all.
 *
 * Connection string resolution, in order:
 *   1. the HYPERDRIVE binding (production on Cloudflare)
 *   2. DATABASE_URL (local dev; put it in .dev.vars, which is gitignored)
 */
import { Client } from 'pg';

type HyperdriveBinding = { connectionString?: string };
type RuntimeLocals = {
  runtime?: { env?: { HYPERDRIVE?: HyperdriveBinding; DATABASE_URL?: string } };
};

/**
 * Where a connection string came from. This matters because it decides TLS:
 * see `clientOptions`. Returning it beats re-deriving it from the URL, which is
 * what caused the bug that comment describes.
 */
export type Resolved = { url: string; viaHyperdrive: boolean };

function resolveConnectionString(locals?: unknown): Resolved {
  const runtimeEnv = (locals as RuntimeLocals | undefined)?.runtime?.env;

  const hyperdrive = runtimeEnv?.HYPERDRIVE?.connectionString;
  if (hyperdrive) return { url: hyperdrive, viaHyperdrive: true };

  const direct =
    // `wrangler secret put DATABASE_URL` and .dev.vars BOTH land here, not in
    // import.meta.env. Omitting this was silent in every local test that used
    // a shell variable, and would have 500'd every API route in production
    // with the secret correctly set.
    runtimeEnv?.DATABASE_URL ??
    (import.meta as { env?: Record<string, string | undefined> }).env?.DATABASE_URL ??
    (typeof process !== 'undefined' ? process.env?.DATABASE_URL : undefined);
  if (!direct) {
    throw new Error(
      'No HYPERDRIVE binding and DATABASE_URL is not set. For local dev put ' +
        'DATABASE_URL in bounties/.dev.vars — and use Railway\'s PUBLIC proxy ' +
        'host, not *.railway.internal, which only resolves inside Railway.'
    );
  }
  return { url: direct, viaHyperdrive: false };
}

/**
 * Connection options for `pg`, and specifically whether to ask for TLS.
 *
 * THREE cases, and the middle one is the one that bites:
 *
 *   1. Hyperdrive binding  -> NO TLS. The binding hands back a connection
 *      string for a socket local to the Worker; Hyperdrive makes its own TLS
 *      connection to Railway. Asking for TLS here gets "The server does not
 *      support SSL connections" and takes every DB-backed page down with it.
 *   2. Direct to Railway   -> TLS, unverified chain. The TCP proxy presents a
 *      self-signed certificate: traffic is encrypted, the chain is not checked.
 *   3. Direct to localhost -> no TLS.
 *
 * This used to key on whether the host looked local (`/localhost|127\.0\.0\.1/`),
 * which silently put case 1 into case 2 — a Hyperdrive host is neither local
 * nor Railway. The origin of the string is the fact that matters, so it is
 * passed in rather than guessed at.
 */
export function clientOptions({ url, viaHyperdrive }: Resolved): {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
} {
  if (viaHyperdrive) return { connectionString: url };
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  if (isLocal) return { connectionString: url };
  return { connectionString: stripSslMode(url), ssl: { rejectUnauthorized: false } };
}

/**
 * Remove `sslmode` from a connection string so the explicit `ssl` option below
 * is what decides TLS behaviour.
 *
 * Not cosmetic. pg >= 8.16 treats `sslmode=require` as `verify-full`, unlike
 * libpq, where it means "encrypt, do not verify". Railway's TCP proxy serves a
 * self-signed certificate, so a URL carrying `sslmode=require` fails with
 * "self-signed certificate in certificate chain" — while `psql` on the very
 * same URL succeeds, because psql uses real libpq. Anyone setting this secret
 * by hand is likely to append `sslmode=require`, so strip it rather than
 * depend on them not doing so.
 */
export function stripSslMode(url: string): string {
  // Cheap reject before paying for URL parsing.
  if (!/[?&](sslmode|uselibpqcompat)=/i.test(url)) return url;
  try {
    const u = new URL(url);
    // Case-insensitively: searchParams.delete() matches the key exactly, so a
    // hand-typed `SSLMode=` would otherwise survive. Snapshot the keys first,
    // since deleting while iterating skips entries.
    for (const key of [...u.searchParams.keys()]) {
      if (/^(sslmode|uselibpqcompat)$/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    // An unparseable string is the caller's problem; pg will report it better.
    return url;
  }
}

/**
 * Run `fn` with a connected client, always closing it.
 * Pass the API route's `locals` so the Hyperdrive binding can be found.
 */
export async function withDb<T>(locals: unknown, fn: (db: Client) => Promise<T>): Promise<T> {
  const client = new Client(clientOptions(resolveConnectionString(locals)));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Upsert a person by email and return their id. Emails are stored lowercased. */
export async function upsertPerson(
  db: Client,
  { email, firstName, lastName }: { email: string; firstName: string; lastName: string }
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO person (email, first_name, last_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           last_name  = EXCLUDED.last_name,
           updated_at = now()
     RETURNING id`,
    [email.trim().toLowerCase(), firstName.trim(), lastName.trim()]
  );
  return Number(rows[0].id);
}

/**
 * Record (or update) someone's standing position on one bounty.
 * The UNIQUE (bounty_slug, person_id) constraint makes re-registering an update
 * rather than a duplicate — which is what the old tag model simulated by
 * deactivating conflicting tags.
 */
export async function setInterest(
  db: Client,
  params: {
    bountySlug: string;
    personId: number;
    intent: 'interested' | 'looking_for_team';
    workingMode: 'solo' | 'team';
    teamId: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO bounty_interest (bounty_slug, person_id, intent, working_mode, team_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (bounty_slug, person_id) DO UPDATE
       SET intent       = EXCLUDED.intent,
           working_mode = EXCLUDED.working_mode,
           team_id      = EXCLUDED.team_id,
           updated_at   = now()`,
    [params.bountySlug, params.personId, params.intent, params.workingMode, params.teamId]
  );
}

/** Remove someone's position on a bounty. The person row is kept. */
export async function removeInterest(
  db: Client,
  { bountySlug, email }: { bountySlug: string; email: string }
): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM bounty_interest bi
       USING person p
      WHERE bi.person_id = p.id
        AND bi.bounty_slug = $1
        AND p.email = $2`,
    [bountySlug, email.trim().toLowerCase()]
  );
  return rowCount ?? 0;
}

export interface Counts {
  interested: number;
  lookingForTeam: number;
}

/**
 * Counts for every bounty in one query.
 * The Mailchimp version fetched up to 1000 members and filtered in JS on every
 * request; this is a GROUP BY over an indexed column.
 */
export async function allCounts(db: Client): Promise<Record<string, Counts>> {
  const { rows } = await db.query<{ bounty_slug: string; intent: string; n: string }>(
    `SELECT bounty_slug, intent, count(*)::text AS n
       FROM bounty_interest
      GROUP BY bounty_slug, intent`
  );
  const out: Record<string, Counts> = {};
  for (const r of rows) {
    out[r.bounty_slug] ??= { interested: 0, lookingForTeam: 0 };
    if (r.intent === 'interested') out[r.bounty_slug].interested = Number(r.n);
    else out[r.bounty_slug].lookingForTeam = Number(r.n);
  }
  return out;
}

/** Counts for a single bounty. */
export async function countsFor(db: Client, bountySlug: string): Promise<Counts> {
  const { rows } = await db.query<{ intent: string; n: string }>(
    `SELECT intent, count(*)::text AS n
       FROM bounty_interest
      WHERE bounty_slug = $1
      GROUP BY intent`,
    [bountySlug]
  );
  const counts: Counts = { interested: 0, lookingForTeam: 0 };
  for (const r of rows) {
    if (r.intent === 'interested') counts.interested = Number(r.n);
    else counts.lookingForTeam = Number(r.n);
  }
  return counts;
}

export interface RosterRow {
  email: string;
  first_name: string;
  last_name: string;
  intent: string;
  working_mode: string;
}

/**
 * Everyone signed up for one bounty. Reads the bounty_roster view (see
 * db-bootstrap.sql) so the join lives in one place.
 */
export async function rosterFor(db: Client, bountySlug: string): Promise<RosterRow[]> {
  const { rows } = await db.query<RosterRow>(
    `SELECT email, first_name, last_name, intent, working_mode
       FROM bounty_roster
      WHERE bounty_slug = $1
      ORDER BY last_name, first_name`,
    [bountySlug]
  );
  return rows;
}

/** Slugs that actually have signups, for the "did you mean" reply. */
export async function slugsWithSignups(db: Client): Promise<{ slug: string; n: number }[]> {
  const { rows } = await db.query<{ slug: string; n: string }>(
    `SELECT bounty_slug AS slug, count(*) AS n
       FROM bounty_interest GROUP BY 1 ORDER BY 1`
  );
  return rows.map((r) => ({ slug: r.slug, n: Number(r.n) }));
}

/**
 * The team id on a person's row for one bounty, if any.
 *
 * Read BEFORE deleting on withdrawal: the `team-group:<slug>:<id>` Mailchimp
 * tag can only be cleared if we still know the id, and after the delete it is
 * gone. Returns null when there is no row or no team.
 */
export async function teamIdFor(
  db: Client,
  opts: { bountySlug: string; email: string }
): Promise<string | null> {
  const { rows } = await db.query<{ team_id: string | null }>(
    `SELECT bi.team_id
       FROM bounty_interest bi
       JOIN person p ON p.id = bi.person_id
      WHERE bi.bounty_slug = $1 AND p.email = lower($2)`,
    [opts.bountySlug, opts.email]
  );
  return rows[0]?.team_id ?? null;
}

/** Does anyone hold this team id on this bounty? Validates a join request. */
export async function teamExists(
  db: Client,
  opts: { bountySlug: string; teamId: string }
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM bounty_interest WHERE bounty_slug = $1 AND team_id = $2 LIMIT 1`,
    [opts.bountySlug, opts.teamId]
  );
  return rows.length > 0;
}

/**
 * Put people on a team, creating their interest row if they had none.
 *
 * The Mailchimp version had to deactivate every OTHER `team-group:<slug>:*`
 * tag by hand, because tags are independent booleans and nothing stopped a
 * member belonging to two teams at once. Here team_id is a single column
 * under UNIQUE (bounty_slug, person_id), so one team per person per bounty is
 * structural — there is nothing to clean up.
 *
 * Returns the emails that were actually placed; an unknown email is reported
 * rather than silently skipped, since the caller is an admin fixing rosters.
 */
export async function assignTeam(
  db: Client,
  opts: { bountySlug: string; emails: string[]; teamId: string }
): Promise<{ placed: string[]; unknown: string[] }> {
  const placed: string[] = [];
  const unknown: string[] = [];

  for (const raw of opts.emails) {
    const email = raw.trim().toLowerCase();
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM person WHERE email = $1`,
      [email]
    );
    if (rows.length === 0) {
      unknown.push(email);
      continue;
    }
    await db.query(
      `INSERT INTO bounty_interest (bounty_slug, person_id, intent, working_mode, team_id)
            VALUES ($1, $2, 'interested', 'team', $3)
       ON CONFLICT (bounty_slug, person_id) DO UPDATE
              SET working_mode = 'team',
                  team_id = EXCLUDED.team_id,
                  updated_at = now()`,
      [opts.bountySlug, rows[0].id, opts.teamId]
    );
    placed.push(email);
  }
  return { placed, unknown };
}

/**
 * Take someone off their team for one bounty, keeping their interest.
 *
 * Working mode drops back to solo: being on no team IS working solo, and
 * leaving working_mode='team' with a null team_id would be a state the UI
 * cannot render honestly.
 */
export async function clearTeam(
  db: Client,
  opts: { bountySlug: string; email: string }
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE bounty_interest bi
        SET team_id = NULL, working_mode = 'solo', updated_at = now()
       FROM person p
      WHERE p.id = bi.person_id
        AND bi.bounty_slug = $1
        AND p.email = lower($2)`,
    [opts.bountySlug, opts.email]
  );
  return rowCount ?? 0;
}

/** One row per (bounty, person) with delivery state — the dashboard's feed. */
export interface RosterFull extends RosterRow {
  bounty_slug: string;
  team_id: string | null;
  joined_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  /** team_id, or 'person:<id>' for a solo winner — what an award is keyed by. */
  team_key: string;
  /** The TEAM's award. Repeated across members by the view; never SUM it. */
  team_payout_cents: number | null;
  /** Pre-award rows only. New writes leave this null — see markCompleted. */
  payout_cents: number | null;
  submission_url: string | null;
}

export async function fullRoster(db: Client): Promise<RosterFull[]> {
  const { rows } = await db.query<RosterFull>(
    `SELECT * FROM bounty_roster ORDER BY bounty_slug, last_name, first_name`
  );
  return rows;
}

/**
 * Declare people as having delivered a bounty.
 *
 * Sets completed_at (and submitted_at if it was never recorded) in the SAME
 * statement as payout_cents, so the `paid implies completed` CHECK is
 * satisfied atomically. payoutCents / submissionUrl of undefined leave the
 * existing value alone rather than clearing it.
 */
/**
 * Mark people as having delivered, and record the team's award ONCE.
 *
 * `payoutCents` is the bounty's prize — one number for the whole team. It used
 * to be written to every member's row, so a team of four on a $200 bounty
 * recorded $800. Members now carry delivery state only; the money lives in
 * bounty_award, keyed by (bounty, team), where it cannot multiply by headcount.
 *
 * Marking people on two different teams in one call awards each team the full
 * prize — that is a deliberate, visible act (two team headers, two amounts),
 * not the silent arithmetic the old shape produced.
 */
export async function markCompleted(
  db: Client,
  opts: { bountySlug: string; emails: string[]; payoutCents?: number; submissionUrl?: string }
): Promise<{ marked: string[]; unknown: string[]; teams: string[] }> {
  const marked: string[] = [];
  const unknown: string[] = [];
  const teamKeys = new Set<string>();

  for (const raw of opts.emails) {
    const email = raw.trim().toLowerCase();
    const { rows } = await db.query<{ email: string; team_key: string }>(
      `UPDATE bounty_interest bi
          SET completed_at = COALESCE(bi.completed_at, now()),
              submitted_at = COALESCE(bi.submitted_at, now()),
              updated_at   = now()
         FROM person p
        WHERE p.id = bi.person_id AND bi.bounty_slug = $1 AND p.email = $2
    RETURNING p.email,
              COALESCE(bi.team_id, 'person:' || bi.person_id::text) AS team_key`,
      [opts.bountySlug, email]
    );
    if (rows.length) {
      marked.push(email);
      teamKeys.add(rows[0].team_key);
    } else {
      unknown.push(email);
    }
  }

  // Award per team. Nothing to award if no row matched — writing an award for a
  // team with no delivered members would be money attached to nobody.
  for (const teamKey of teamKeys) {
    await db.query(
      `INSERT INTO bounty_award (bounty_slug, team_key, payout_cents, submission_url)
            VALUES ($1, $2, COALESCE($3, 0), $4)
       ON CONFLICT (bounty_slug, team_key) DO UPDATE
            SET payout_cents   = COALESCE($3, bounty_award.payout_cents),
                submission_url = COALESCE($4, bounty_award.submission_url)`,
      [opts.bountySlug, teamKey, opts.payoutCents ?? null, opts.submissionUrl ?? null]
    );
  }
  return { marked, unknown, teams: [...teamKeys] };
}

/** Undo a declaration. Clears payout too — the CHECK forbids paid-but-not-done. */
export async function clearCompleted(
  db: Client,
  opts: { bountySlug: string; emails: string[] }
): Promise<number> {
  const emails = opts.emails.map((e) => e.trim().toLowerCase());
  const { rowCount } = await db.query(
    `UPDATE bounty_interest bi
        SET completed_at = NULL, payout_cents = NULL, submission_url = NULL, updated_at = now()
       FROM person p
      WHERE p.id = bi.person_id AND bi.bounty_slug = $1
        AND p.email = ANY($2::text[])`,
    [opts.bountySlug, emails]
  );
  // Drop the award only once NOBODY on that team is still marked delivered.
  // Undoing one member of four must not delete the team's award.
  await db.query(
    `DELETE FROM bounty_award a
      WHERE a.bounty_slug = $1
        AND NOT EXISTS (
              SELECT 1 FROM bounty_interest bi
               WHERE bi.bounty_slug = a.bounty_slug
                 AND COALESCE(bi.team_id, 'person:' || bi.person_id::text) = a.team_key
                 AND bi.completed_at IS NOT NULL)`,
    [opts.bountySlug]
  );
  return rowCount ?? 0;
}

export interface HallOfFameRow {
  bounty_slug: string;
  /** "Ada Lovelace, Grace Hopper" — every person marked complete on the bounty */
  names: string;
  submission_url: string | null;
  completed_at: string;
  payout_cents: number;
}

/** One row per completed bounty, for the public Hall of Fame. */
export async function hallOfFame(db: Client): Promise<HallOfFameRow[]> {
  const { rows } = await db.query<HallOfFameRow>(
    // Payout is summed from bounty_award, NOT from the roster: the roster repeats
    // a team's award across its members, so summing there multiplies the prize by
    // headcount. Awards are joined as a scalar subquery for that reason.
    `SELECT r.bounty_slug,
            string_agg(r.first_name || ' ' || r.last_name, ', ' ORDER BY r.last_name, r.first_name) AS names,
            max(r.submission_url)     AS submission_url,
            max(r.completed_at)::text AS completed_at,
            coalesce((SELECT sum(a.payout_cents) FROM bounty_award a
                       WHERE a.bounty_slug = r.bounty_slug), 0)::int AS payout_cents
       FROM bounty_roster r
      WHERE r.completed_at IS NOT NULL
      GROUP BY r.bounty_slug
      ORDER BY max(r.completed_at) DESC`
  );
  return rows;
}
