export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, upsertPerson, setInterest, countsFor } from '../../lib/db';
import { rateLimit, rateLimitResponse, getClientIp } from '../../lib/rate-limit';

/** 8 hex chars, matching the id shape the Mailchimp `team-group:` tags used. */
function newTeamId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const ip = getClientIp(request);
  const rl = rateLimit(ip, { name: 'respond', limit: 10, windowSec: 60 });
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
  const type = str(body.type);
  const working_mode = str(body.working_mode) || 'solo';

  const missing = { first_name: !!first_name, last_name: !!last_name, email: !!email, bounty_slug: !!bounty_slug, type: !!type };
  if (!first_name || !last_name || !email || !bounty_slug || !type) {
    return json({ error: 'Missing required fields', missing }, 400);
  }
  if (!EMAIL.test(email)) return json({ error: 'That email address looks wrong' }, 400);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(bounty_slug)) return json({ error: 'Invalid slug format' }, 400);
  if (type !== 'interested' && type !== 'looking-for-team') {
    return json({ error: 'type must be "interested" or "looking-for-team"' }, 400);
  }
  if (working_mode !== 'solo' && working_mode !== 'team') {
    return json({ error: 'working_mode must be "solo" or "team"' }, 400);
  }

  // "Looking for teammates" implies you don't have a team yet, so it never
  // carries a team id. Only an explicit solo/team choice can create one.
  const intent = type === 'interested' ? 'interested' : 'looking_for_team';
  const teamId = intent === 'interested' && working_mode === 'team' ? newTeamId() : null;

  try {
    const counts = await withDb(locals, async (db) => {
      const personId = await upsertPerson(db, { email, firstName: first_name, lastName: last_name });
      await setInterest(db, {
        bountySlug: bounty_slug,
        personId,
        intent,
        workingMode: intent === 'looking_for_team' ? 'solo' : working_mode,
        teamId,
      });
      return countsFor(db, bounty_slug);
    });

    return json({ success: true, counts, ...(teamId ? { teamId } : {}) });
  } catch (err) {
    console.error('Respond API error:', err instanceof Error ? err.message : String(err));
    // Don't echo the driver's message: it can contain the connection string.
    return json({ error: 'Could not record that right now' }, 500);
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
