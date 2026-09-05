export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, markCompleted, clearCompleted } from '../../../lib/db';
import { rateLimit, rateLimitResponse, getClientIp } from '../../../lib/rate-limit';
import { requireAdmin, ADMIN_COOKIE } from '../../../lib/admin';

/**
 * Declare who delivered a bounty.
 *
 * A redesign, not a port. hackbu.dev's version did fs.writeFileSync into
 * src/content/*.md and src/data/leaderboard.json at request time — impossible
 * on a serverless filesystem (leaderboard.json is still 3 bytes in that repo).
 * Here completion is rows in Postgres, so it works from any deployment, needs
 * no redeploy to publish, and the Hall of Fame reads it live.
 *
 * Per PERSON, not per bounty: a team win marks every member, so
 * bounty_people.completed_count is honest for each of them.
 *
 *   { slug, emails: [...], payoutCents?, submissionUrl? }   declare
 *   { slug, emails: [...], undo: true }                     take it back
 */
const MAX_EMAILS = 20;
const MAX_URL = 2048;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const denied = requireAdmin(request, locals, cookies.get(ADMIN_COOKIE)?.value);
  if (denied) return denied;

  const rl = rateLimit(getClientIp(request), { name: 'declare-winner', limit: 10, windowSec: 60 });
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const emails = Array.isArray(body.emails)
    ? body.emails.filter((e): e is string => typeof e === 'string' && e.trim() !== '')
    : [];
  const undo = body.undo === true;

  if (!slug || emails.length === 0) return json({ error: 'Missing required fields: slug, emails' }, 400);
  if (emails.length > MAX_EMAILS) return json({ error: `Too many emails — max ${MAX_EMAILS}` }, 400);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return json({ error: 'Invalid slug format' }, 400);

  // Money arrives as integer cents, never dollars or floats, so there is no
  // rounding step for a client to get wrong.
  let payoutCents: number | undefined;
  if (body.payoutCents !== undefined && body.payoutCents !== null) {
    if (!Number.isInteger(body.payoutCents) || (body.payoutCents as number) < 0) {
      return json({ error: 'payoutCents must be a non-negative integer' }, 400);
    }
    payoutCents = body.payoutCents as number;
  }

  let submissionUrl: string | undefined;
  if (typeof body.submissionUrl === 'string' && body.submissionUrl.trim()) {
    const u = body.submissionUrl.trim();
    if (u.length > MAX_URL) return json({ error: 'submissionUrl too long' }, 400);
    // https only: this URL is rendered as a public link on the Hall of Fame.
    if (!/^https:\/\/[^\s]+$/i.test(u)) return json({ error: 'submissionUrl must be an https URL' }, 400);
    submissionUrl = u;
  }

  try {
    if (undo) {
      const cleared = await withDb(locals, (db) => clearCompleted(db, { bountySlug: slug, emails }));
      return json({ success: true, cleared });
    }
    const result = await withDb(locals, (db) =>
      markCompleted(db, { bountySlug: slug, emails, payoutCents, submissionUrl })
    );
    // 200 with `unknown` populated: marking 3 of 4 is a real partial success
    // the admin has to see, not an error that hides which one failed.
    return json({ success: true, ...result });
  } catch (err) {
    console.error('Declare winner error:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Could not record that right now' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
