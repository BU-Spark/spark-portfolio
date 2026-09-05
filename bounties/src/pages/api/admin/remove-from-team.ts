export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, clearTeam, rosterFor } from '../../../lib/db';
import { rateLimit, rateLimitResponse, getClientIp } from '../../../lib/rate-limit';
import { requireAdmin, ADMIN_COOKIE } from '../../../lib/admin';
import { mirror, syncInterest } from '../../../lib/mailchimp';

/**
 * Take one person off their team for a bounty. Their interest is kept — this
 * is "they're not with that group after all", not a withdrawal.
 *
 * Working mode drops to solo, because being on no team IS working solo.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const denied = requireAdmin(request, locals, cookies.get(ADMIN_COOKIE)?.value);
  if (denied) return denied;

  const rl = rateLimit(getClientIp(request), {
    name: 'remove-from-team',
    limit: 10,
    windowSec: 60,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: { slug?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';

  if (!slug || !email) return json({ error: 'Missing required fields: slug, email' }, 400);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return json({ error: 'Invalid slug format' }, 400);

  try {
    const { removed, person } = await withDb(locals, async (db) => {
      const n = await clearTeam(db, { bountySlug: slug, email });
      const roster = await rosterFor(db, slug);
      return {
        removed: n,
        person: roster.find((r) => r.email.toLowerCase() === email.toLowerCase()) ?? null,
      };
    });

    if (removed === 0) {
      return json({ error: 'That person has no interest row on this bounty' }, 404);
    }

    // Mirror the new solo state so the has-team / team-group tags come off.
    if (person) {
      mirror(locals, (env) =>
        syncInterest(
          env,
          { email: person.email, firstName: person.first_name, lastName: person.last_name },
          { bountySlug: slug, intent: 'interested', workingMode: 'solo', teamId: null }
        )
      );
    }

    return json({ success: true, removed });
  } catch (err) {
    console.error('Remove from team error:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Could not update that right now' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
