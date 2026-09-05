export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, assignTeam, rosterFor } from '../../../lib/db';
import { rateLimit, rateLimitResponse, getClientIp } from '../../../lib/rate-limit';
import { requireAdmin, ADMIN_COOKIE } from '../../../lib/admin';
import { mirror, syncInterest } from '../../../lib/mailchimp';

/**
 * Put a set of people onto one team for a bounty — the admin fix-up for
 * "these four are actually working together".
 *
 * `existingTeamId` joins them to a team that already exists; omit it and a new
 * team id is minted. Ported from hackbu.dev, where validating an existing team
 * meant paging the whole Mailchimp audience.
 */
const TEAM_ID = /^[a-f0-9]{8}$/i;
const MAX_EMAILS = 50;

/** 8 hex chars, matching respond.ts and the legacy `team-group:` tag ids. */
function newTeamId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const denied = requireAdmin(request, locals, cookies.get(ADMIN_COOKIE)?.value);
  if (denied) return denied;

  const rl = rateLimit(getClientIp(request), { name: 'merge-team', limit: 10, windowSec: 60 });
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: { slug?: unknown; emails?: unknown; existingTeamId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const emails = Array.isArray(body.emails) ? body.emails.filter((e) => typeof e === 'string') : null;
  const existingTeamId =
    typeof body.existingTeamId === 'string' ? body.existingTeamId.trim() : '';

  if (!slug || !emails || emails.length < 1) {
    return json({ error: 'Missing required fields: slug, emails' }, 400);
  }
  // Bounded so one call cannot turn into hundreds of Mailchimp writes.
  if (emails.length > MAX_EMAILS) {
    return json({ error: `Too many emails — max ${MAX_EMAILS} per request` }, 400);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return json({ error: 'Invalid slug format' }, 400);
  if (existingTeamId && !TEAM_ID.test(existingTeamId)) {
    return json({ error: 'Invalid existingTeamId format' }, 400);
  }

  const teamId = existingTeamId || newTeamId();

  try {
    const { placed, unknown, roster } = await withDb(locals, async (db) => {
      const res = await assignTeam(db, { bountySlug: slug, emails, teamId });
      // Re-read so the Mailchimp mirror uses committed state rather than what
      // this request believed it wrote.
      return { ...res, roster: await rosterFor(db, slug) };
    });

    for (const r of roster.filter((x) => placed.includes(x.email.toLowerCase()))) {
      mirror(locals, (env) =>
        syncInterest(
          env,
          { email: r.email, firstName: r.first_name, lastName: r.last_name },
          { bountySlug: slug, intent: 'interested', workingMode: 'team', teamId }
        )
      );
    }

    // 200 with `unknown` populated, not an error: placing 3 of 4 people is a
    // real partial success and the admin needs to see which one failed.
    return json({ success: true, teamId, placed, unknown });
  } catch (err) {
    console.error('Merge team error:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Could not update that team right now' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
