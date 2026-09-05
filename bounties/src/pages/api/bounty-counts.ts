export const prerender = false;

import type { APIRoute } from 'astro';
import { withDb, allCounts, countsFor, type Counts } from '../../lib/db';

/**
 * `?slug=x` -> { interested, lookingForTeam } for that bounty.
 * No slug     -> { [slug]: { interested, lookingForTeam } } for every bounty.
 *
 * Both are single GROUP BY queries. The Mailchimp version pulled up to 1000
 * members and filtered their tag arrays in JS on every request.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const slug = url.searchParams.get('slug');
  if (slug && !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    return json({ error: 'Invalid slug format' }, 400);
  }

  try {
    // widen explicitly: the ternary's two branches give withDb's generic two
    // candidate types and it would otherwise infer only the first
    const result = await withDb<Counts | Record<string, Counts>>(locals, (db) =>
      slug ? countsFor(db, slug) : allCounts(db)
    );
    return json(result);
  } catch (err) {
    console.error('Bounty counts API error:', err instanceof Error ? err.message : String(err));
    // Counts are decorative — fail soft so a DB blip doesn't break the page.
    // But flag it: without `degraded`, an unreachable database is
    // indistinguishable from an empty one, which hid a dead deploy once.
    return json(slug ? { interested: 0, lookingForTeam: 0, degraded: true } : { degraded: true });
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
