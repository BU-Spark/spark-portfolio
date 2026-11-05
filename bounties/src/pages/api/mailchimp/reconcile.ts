export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb } from '../../../lib/db';
import {
  resolveMailchimpEnv,
  syncInterest,
  clearInterest,
  listMembers,
  parseTags,
  parseAfter,
  keysetResult,
  pruneClearCap,
  clearOrphans,
  RECONCILE_ROWS_PER_CALL,
} from '../../../lib/mailchimp';
import { rateLimit, getClientIp } from '../../../lib/rate-limit';
import { requireAdmin, ADMIN_COOKIE } from '../../../lib/admin';

/**
 * Make Mailchimp match Postgres.
 *
 * The per-request mirror in /api/respond is fire-and-forget, so it can lose a
 * write (Mailchimp 5xx, isolate torn down before waitUntil settles). Postgres
 * is still correct when that happens; Mailchimp is stale. This is the repair.
 *
 * Safe to run repeatedly — every operation is an upsert or a tag set.
 *
 * By default it only ADDS/CORRECTS tags. `?prune=1` also deactivates tags for
 * people Mailchimp thinks are on a bounty but Postgres does not, which is the
 * only destructive direction and therefore opt-in.
 *
 * DO NOT USE ?prune=1 WHILE hackbu.dev IS STILL ACCEPTING SIGNUPS.
 *
 * hackbu.dev writes tags into the SAME audience (3baefe8534) directly from its
 * own /api/respond, /api/withdraw and /api/team-join, using the same tag
 * vocabulary. Those signups have no Postgres row here, so prune reads them as
 * orphans and deactivates them -- silently removing real people from the list
 * comms mails. Two writers, one audience, and only one of them is mirrored
 * from this database.
 *
 * Prune becomes safe once hackbu.dev is retired and this app is the only
 * writer. Until then the non-prune path is still useful and still correct: it
 * only adds and corrects, so it cannot delete a hackbu.dev signup.
 *
 * PAGED. Workers Free allows 50 subrequests per request and every row costs
 * two, so one call syncs RECONCILE_ROWS_PER_CALL rows with bounty_interest.id
 * greater than `?after=` (default 0) and returns `next_after` (the last id
 * synced, null when done) and `remaining`. Call again with after=next_after
 * until it is null. A keyset cursor, not an offset, so a withdrawal between
 * calls cannot shift a row past the window.
 *
 * `?prune=1` is a separate pass (no sync). It lists the audience, then clears
 * as many orphans as the remaining budget allows (SUBREQUEST_BUDGET minus list
 * pages). Repeat while prune_remaining > 0; prune_failed / prune_skipped name
 * the members whose clear failed and the orphans skipped because of it.
 *
 *   curl -X POST "https://bounties.buspark.io/api/mailchimp/reconcile?after=0" \
 *        -H "Authorization: Bearer $ADMIN_KEY"
 */
export const POST: APIRoute = async ({ request, url, locals, cookies }) => {
  const denied = requireAdmin(request, locals, cookies.get(ADMIN_COOKIE)?.value);
  if (denied) return denied;

  const rl = rateLimit(getClientIp(request), { name: 'reconcile', limit: 30, windowSec: 300 });
  if (!rl.allowed) return json({ error: 'Rate limited' }, 429);

  const mc = resolveMailchimpEnv(locals);
  if (!mc) return json({ error: 'Mailchimp is not configured' }, 503);

  const prune = url.searchParams.get('prune') === '1';
  const after = parseAfter(url.searchParams.get('after'));
  if (after === null) return json({ error: '`after` must be a non-negative integer' }, 400);

  try {
    if (prune) return json(await runPrune(locals, mc));

    // Postgres is the truth: read one keyset page, then make Mailchimp agree.
    const rows = await withDb(locals, async (db) => {
      const { rows } = await db.query<{
        id: string;
        email: string;
        first_name: string;
        last_name: string;
        bounty_slug: string;
        intent: 'interested' | 'looking_for_team';
        working_mode: 'solo' | 'team';
        team_id: string | null;
        matching: string;
      }>(
        // count(*) OVER () is evaluated before LIMIT: every row past `after`.
        `SELECT bi.id::text AS id, p.email, p.first_name, p.last_name,
                bi.bounty_slug, bi.intent, bi.working_mode, bi.team_id,
                count(*) OVER () AS matching
           FROM bounty_interest bi
           JOIN person p ON p.id = bi.person_id
          WHERE bi.id > $1
          ORDER BY bi.id
          LIMIT $2`,
        [after, RECONCILE_ROWS_PER_CALL]
      );
      return rows;
    });

    let synced = 0;
    const failures: string[] = [];
    for (const r of rows) {
      try {
        await syncInterest(
          mc,
          { email: r.email, firstName: r.first_name, lastName: r.last_name },
          {
            bountySlug: r.bounty_slug,
            intent: r.intent,
            workingMode: r.working_mode,
            teamId: r.team_id,
          }
        );
        synced++;
      } catch (err) {
        // Keep going: one bad address must not strand the rest.
        failures.push(`${r.bounty_slug}/${r.email}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const { nextAfter, remaining } = keysetResult(
      rows.map((r) => r.id),
      rows.length ? Number(rows[0].matching) : 0
    );
    return json({
      success: failures.length === 0,
      after,
      synced,
      next_after: nextAfter,
      remaining,
      prune_enabled: false,
      failures,
    });
  } catch (err) {
    console.error('Reconcile failed:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Reconcile failed' }, 500);
  }
};

/**
 * Tags Mailchimp has that Postgres does not back. Someone who withdrew while
 * the mirror was failing would otherwise still receive mail.
 */
async function runPrune(locals: unknown, mc: NonNullable<ReturnType<typeof resolveMailchimpEnv>>) {
  // Prune compares against ALL of Postgres. One DB query, no Mailchimp fetches.
  const truthRows = await withDb(locals, async (db) => {
    const { rows } = await db.query<{ email: string; bounty_slug: string }>(
      `SELECT p.email, bi.bounty_slug
         FROM bounty_interest bi
         JOIN person p ON p.id = bi.person_id`
    );
    return rows;
  });

  // \u0000 as the separator, written as an escape: it cannot occur in a
  // slug or an email, so the composite key cannot collide. A literal NUL
  // byte here would make this file binary to grep and `file`.
  const KEY = (slug: string, email: string) => `${slug}\u0000${email.toLowerCase()}`;
  const truth = new Set(truthRows.map((r) => KEY(r.bounty_slug, r.email)));

  const { members, pages } = await listMembers(mc);
  const orphans: { email: string; slug: string; teamId: string | null }[] = [];
  for (const m of members) {
    for (const parsed of parseTags(m.tags).rows) {
      if (truth.has(KEY(parsed.bountySlug, m.email))) continue;
      orphans.push({ email: m.email, slug: parsed.bountySlug, teamId: parsed.teamId });
    }
  }

  // Always from the front: a cleared orphan drops out of the next listing.
  const cap = pruneClearCap(pages);
  const r = await clearOrphans(orphans, cap, (o) => clearInterest(mc, o.email, o.slug, o.teamId));
  const failures = r.failed.map((f) => `prune ${f.orphan.slug}/${f.orphan.email}: ${f.error}`);
  return {
    success: failures.length === 0,
    prune_enabled: true,
    list_pages: pages,
    clear_cap: cap,
    pruned: r.cleared,
    prune_remaining: r.remaining,
    prune_failed: r.failed.map((f) => `${f.orphan.slug}/${f.orphan.email}`),
    prune_skipped: r.skipped.map((o) => `${o.slug}/${o.email}`),
    failures,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
