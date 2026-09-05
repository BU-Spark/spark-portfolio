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

function resolveConnectionString(locals?: unknown): string {
  const runtimeEnv = (locals as RuntimeLocals | undefined)?.runtime?.env;

  const hyperdrive = runtimeEnv?.HYPERDRIVE?.connectionString;
  if (hyperdrive) return hyperdrive;

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
  return direct;
}

/**
 * Run `fn` with a connected client, always closing it.
 * Pass the API route's `locals` so the Hyperdrive binding can be found.
 */
export async function withDb<T>(locals: unknown, fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = resolveConnectionString(locals);
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  const client = new Client({
    connectionString,
    // Railway's public Postgres endpoint requires TLS; a local socket doesn't.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
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
