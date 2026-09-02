export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, removeInterest, countsFor, teamIdFor } from '../../lib/db';
import { rateLimit, rateLimitResponse, getClientIp } from '../../lib/rate-limit';
import { mirror, clearInterest } from '../../lib/mailchimp';

export const POST: APIRoute = async ({ request, locals }) => {
  const ip = getClientIp(request);
  const rl = rateLimit(ip, { name: 'withdraw', limit: 10, windowSec: 60 });
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const bounty_slug = typeof body.bounty_slug === 'string' ? body.bounty_slug.trim() : '';

  if (!email || !bounty_slug) return json({ error: 'Missing required fields' }, 400);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(bounty_slug)) return json({ error: 'Invalid slug format' }, 400);

  try {
    // One row per (person, bounty), so withdrawing is a single delete —
    // the Mailchimp version had to deactivate the intent tag, both working-mode
    // tags, and every team-group tag for the bounty. The person row is kept.
    const { removed, counts, teamId } = await withDb(locals, async (db) => {
      // Read the team id first — after the delete it is unrecoverable, and the
      // team-group tag cannot be cleared without it.
      const tid = await teamIdFor(db, { bountySlug: bounty_slug, email });
      const n = await removeInterest(db, { bountySlug: bounty_slug, email });
      return { removed: n, counts: await countsFor(db, bounty_slug), teamId: tid };
    });

    // Clear the tags too, or comms mail people who pulled out.
    if (removed > 0) {
      mirror(locals, (env) => clearInterest(env, email, bounty_slug, teamId));
    }

    return json({ success: true, removed, counts });
  } catch (err) {
    console.error('Withdraw API error:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Could not withdraw right now' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
