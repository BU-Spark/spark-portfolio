/**
 * One-time migration: Mailchimp tags -> Postgres.
 *
 *   # report only, writes nothing (default)
 *   node --experimental-strip-types scripts/backfill-from-mailchimp.ts
 *
 *   # actually write
 *   node --experimental-strip-types scripts/backfill-from-mailchimp.ts --apply
 *
 * Why this exists: some signups only ever existed as Mailchimp tags. Making
 * Postgres the source of truth without moving them first would silently drop
 * real people — a bounty roster would read 0 while comms still had 8 names.
 *
 * Reads Mailchimp strictly READ-ONLY. It never writes a tag, so re-running it
 * is safe and it cannot corrupt the audience. The Postgres side is an upsert
 * (ON CONFLICT DO UPDATE), so re-running converges rather than duplicating.
 *
 * Env (from bounties/.dev.vars or the shell):
 *   MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID, DATABASE_URL
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { listMembers, parseTags, resolveMailchimpEnv } from '../src/lib/mailchimp.ts';

const APPLY = process.argv.includes('--apply');

// .dev.vars is the project's gitignored secret file; load it so this script
// needs no separate configuration.
try {
  for (const line of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .dev.vars — rely on the shell environment */
}

const mc = resolveMailchimpEnv();
if (!mc) throw new Error('Missing MAILCHIMP_API_KEY / MAILCHIMP_AUDIENCE_ID');
// Only --apply needs Postgres; a dry run is pure Mailchimp reads, so it can
// be run before the database is even reachable.
const dbUrl = process.env.DATABASE_URL;
if (APPLY && !dbUrl) throw new Error('Missing DATABASE_URL (required for --apply)');

console.log(`Mode: ${APPLY ? 'APPLY (writes to Postgres)' : 'DRY RUN (no writes)'}\n`);

const members = await listMembers(mc);
console.log(`Mailchimp members: ${members.length}`);

const byStatus = new Map<string, number>();
for (const m of members) byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);
console.log(`  by status: ${[...byStatus].map(([s, n]) => `${s}=${n}`).join(', ')}`);

interface Planned {
  email: string;
  firstName: string;
  lastName: string;
  bountySlug: string;
  intent: string;
  workingMode: string;
  teamId: string | null;
}

const planned: Planned[] = [];
const noName: string[] = [];
const unattributable: string[] = [];
let withoutBountyTags = 0;

for (const m of members) {
  const { rows, unattributable: bad } = parseTags(m.tags);
  for (const t of bad) unattributable.push(`${m.email}: ${t}`);
  if (rows.length === 0) {
    withoutBountyTags++;
    continue;
  }
  if (!m.firstName.trim() || !m.lastName.trim()) noName.push(m.email);
  for (const r of rows) {
    planned.push({
      email: m.email.toLowerCase(),
      firstName: m.firstName.trim(),
      lastName: m.lastName.trim(),
      ...r,
    });
  }
}

const people = new Set(planned.map((p) => p.email));
const perBounty = new Map<string, number>();
for (const p of planned) perBounty.set(p.bountySlug, (perBounty.get(p.bountySlug) ?? 0) + 1);

console.log(`\nTo migrate: ${planned.length} interest rows across ${people.size} people`);
for (const [slug, n] of [...perBounty].sort()) console.log(`  ${slug}: ${n}`);
console.log(`\nMembers with no bounty tags (left alone): ${withoutBountyTags}`);
if (noName.length) {
  // person.first_name / last_name are NOT NULL; empty strings are allowed but
  // useless in a mail merge, so they are called out rather than hidden.
  console.log(`Missing FNAME/LNAME (will be stored empty): ${noName.length}`);
  for (const e of noName) console.log(`  ${e}`);
}
if (unattributable.length) {
  console.log(`\nTags that name no bounty (SKIPPED, not guessed at):`);
  for (const u of unattributable) console.log(`  ${u}`);
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to migrate.');
  process.exit(0);
}

const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl!);
const db = new Client({
  connectionString: dbUrl!,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});
await db.connect();

let inserted = 0;
try {
  // All or nothing: a partial migration is worse than none, because the
  // difference is invisible afterwards.
  await db.query('BEGIN');
  for (const p of planned) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO person (email, first_name, last_name)
            VALUES (lower($1), $2, $3)
       ON CONFLICT (email) DO UPDATE
              SET first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), person.first_name),
                  last_name  = COALESCE(NULLIF(EXCLUDED.last_name,  ''), person.last_name),
                  updated_at = now()
         RETURNING id`,
      [p.email, p.firstName, p.lastName]
    );
    await db.query(
      `INSERT INTO bounty_interest (bounty_slug, person_id, intent, working_mode, team_id)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bounty_slug, person_id) DO UPDATE
              SET intent = EXCLUDED.intent,
                  working_mode = EXCLUDED.working_mode,
                  team_id = COALESCE(EXCLUDED.team_id, bounty_interest.team_id),
                  updated_at = now()`,
      [p.bountySlug, rows[0].id, p.intent, p.workingMode, p.teamId]
    );
    inserted++;
  }
  await db.query('COMMIT');
} catch (err) {
  await db.query('ROLLBACK');
  throw err;
}

console.log(`\nWrote ${inserted} rows. Verifying against Postgres:`);
const { rows: verify } = await db.query<{ bounty_slug: string; n: string }>(
  `SELECT bounty_slug, count(*) AS n FROM bounty_interest GROUP BY 1 ORDER BY 1`
);
let ok = true;
for (const v of verify) {
  const expected = perBounty.get(v.bounty_slug);
  const match = expected === Number(v.n);
  if (!match) ok = false;
  console.log(`  ${v.bounty_slug}: ${v.n} in Postgres, ${expected ?? 0} from Mailchimp ` +
    (match ? 'ok' : 'MISMATCH'));
}
await db.end();
console.log(ok ? '\nCounts match.' : '\nCOUNTS DO NOT MATCH — investigate before going live.');
process.exit(ok ? 0 : 1);
