export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb } from '../../../lib/db';
import {
  resolveMailchimpEnv,
  syncInterest,
  clearInterest,
  listMembers,
  parseTags,
  reconcileSlice,
  PRUNE_CLEARS_PER_CALL,
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
 * two, so one call syncs RECONCILE_ROWS_PER_CALL rows from `?offset=` and
 * returns `next_offset` (null when done) and `remaining`; call again with
 * next_offset until it is null. `?prune=1` is a separate pass (no sync) that
 * clears at most PRUNE_CLEARS_PER_CALL orphans; repeat while prune_remaining > 0.
 *
 *   curl -X POST "https://bounties.buspark.io/api/mailchimp/reconcile?offset=0" \
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

  try {
    // Postgres is the truth: read it in full, then make Mailchimp agree.
    const rows = await withDb(locals, async (db) => {
      const { rows } = await db.query<{
        email: string;
        first_name: string;
        last_name: string;
        bounty_slug: string;
        intent: 'interested' | 'looking_for_team';
        working_mode: 'solo' | 'team';
        team_id: string | null;
      }>(
        `SELECT p.email, p.first_name, p.last_name,
                bi.bounty_slug, bi.intent, bi.working_mode, bi.team_id
           FROM bounty_interest bi
           JOIN person p ON p.id = bi.person_id
          ORDER BY bi.id`
      );
      return rows;
    });

    let synced = 0;
    const failures: string[] = [];
    // Prune is its own pass, so its fetches never share a budget with sync.
    const page = prune
      ? { batch: [], nextOffset: null, remaining: 0 }
      : reconcileSlice(rows, Number(url.searchParams.get('offset') ?? 0));
    for (const r of page.batch) {
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

    let pruned = 0;
    let pruneRemaining = 0;
    if (prune) {
      // Tags Mailchimp has that Postgres does not back. Someone who withdrew
      // while the mirror was failing would otherwise still receive mail.
      // \u0000 as the separator, written as an escape: it cannot occur in a
      // slug or an email, so the composite key cannot collide. A literal NUL
      // byte here would make this file binary to grep and `file`.
      const KEY = (slug: string, email: string) => `${slug}\u0000${email.toLowerCase()}`;
      const truth = new Set(rows.map((r) => KEY(r.bounty_slug, r.email)));
      const orphans: { email: string; slug: string; teamId: string | null }[] = [];
      for (const m of await listMembers(mc)) {
        for (const parsed of parseTags(m.tags).rows) {
          if (truth.has(KEY(parsed.bountySlug, m.email))) continue;
          orphans.push({ email: m.email, slug: parsed.bountySlug, teamId: parsed.teamId });
        }
      }
      // Always from the front: a cleared orphan drops out of the next listing.
      const { batch, remaining } = reconcileSlice(orphans, 0, PRUNE_CLEARS_PER_CALL);
      pruneRemaining = remaining;
      for (const o of batch) {
        try {
          await clearInterest(mc, o.email, o.slug, o.teamId);
          pruned++;
        } catch (err) {
          failures.push(`prune ${o.slug}/${o.email}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    return json({
      success: failures.length === 0,
      rows: rows.length,
      synced,
      next_offset: page.nextOffset,
      remaining: page.remaining,
      pruned,
      prune_remaining: pruneRemaining,
      prune_enabled: prune,
      failures,
    });
  } catch (err) {
    console.error('Reconcile failed:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Reconcile failed' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
