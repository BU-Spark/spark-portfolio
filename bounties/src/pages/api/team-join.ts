export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, upsertPerson, setInterest, teamExists, countsFor } from '../../lib/db';
import { rateLimit, rateLimitResponse, getClientIp } from '../../lib/rate-limit';
import { mirror, syncInterest } from '../../lib/mailchimp';

/**
 * Join an existing team on a bounty, by team id.
 *
 * Ported from hackbu.dev. That version had to page through up to 1000
 * Mailchimp members looking for anyone carrying the `team-group:<slug>:<id>`
 * tag just to answer "does this team exist?", then deactivate every other
 * team-group tag the joiner held. Here both are one indexed query and one
 * column, because a person can hold exactly one team per bounty by
 * construction.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_ID = /^[a-f0-9]{8}$/i;

export const POST: APIRoute = async ({ request, locals }) => {
  const rl = rateLimit(getClientIp(request), { name: 'team-join', limit: 10, windowSec: 60 });
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const first_name = str(body.first_name);
  const last_name = str(body.last_name);
  const email = str(body.email);
  const bounty_slug = str(body.bounty_slug);
  const team_id = str(body.team_id);

  if (!first_name || !last_name || !email || !bounty_slug || !team_id) {
    return json({ error: 'Missing required fields' }, 400);
  }
  if (!EMAIL.test(email)) return json({ error: 'That email address looks wrong' }, 400);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(bounty_slug)) return json({ error: 'Invalid slug format' }, 400);
  // Matches the id shape newTeamId() produces in respond.ts.
  if (!TEAM_ID.test(team_id)) return json({ error: 'Invalid team code' }, 400);

  try {
    const result = await withDb(locals, async (db) => {
      if (!(await teamExists(db, { bountySlug: bounty_slug, teamId: team_id }))) {
        return null;
      }
      const personId = await upsertPerson(db, {
        email,
        firstName: first_name,
        lastName: last_name,
      });
      await setInterest(db, {
        bountySlug: bounty_slug,
        personId,
        intent: 'interested',
        workingMode: 'team',
        teamId: team_id,
      });
      return countsFor(db, bounty_slug);
    });

    if (result === null) {
      // 404, not 400: the request was well-formed, the team just isn't there.
      return json({ error: 'No team with that code on this bounty' }, 404);
    }

    mirror(locals, (env) =>
      syncInterest(
        env,
        { email, firstName: first_name, lastName: last_name },
        {
          bountySlug: bounty_slug,
          intent: 'interested',
          workingMode: 'team',
          teamId: team_id,
        }
      )
    );

    return json({ success: true, counts: result, teamId: team_id });
  } catch (err) {
    console.error('Team join error:', err instanceof Error ? err.message : String(err));
    // Never echo the driver message: it can contain the connection string.
    return json({ error: 'Could not join that team right now' }, 500);
  }
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
