/**
 * Admin authentication for the routes that can change other people's data.
 *
 * Accepts either form, because two callers need different ones:
 *   - `Authorization: Bearer <ADMIN_KEY>` for curl and scripts
 *   - the `spark-admin` cookie for the dashboard, once it exists
 *
 * Compared with a constant-time digest rather than `===`. The comparison is
 * cheap and the key guards destructive operations (team reassignment, tag
 * pruning), so leaking its prefix through timing is not a trade worth making.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const ADMIN_COOKIE = 'spark-admin';

export function resolveAdminKey(locals: unknown): string | undefined {
  const runtime = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env;
  return (
    runtime?.ADMIN_KEY ??
    (import.meta as { env?: Record<string, string | undefined> }).env?.ADMIN_KEY ??
    (typeof process !== 'undefined' ? process.env?.ADMIN_KEY : undefined)
  );
}

/**
 * Returns null when the caller is an admin, or the 401/503 Response to send.
 *
 * A MISSING key is a 503, not a 401: an unconfigured server is an operator
 * error, and reporting it as "unauthorized" sends people hunting for a bad
 * password instead of an unset secret.
 */
export function requireAdmin(request: Request, locals: unknown, cookieValue?: string): Response | null {
  const adminKey = resolveAdminKey(locals);
  if (!adminKey) {
    return json({ error: 'ADMIN_KEY is not configured on this deployment' }, 503);
  }

  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const provided = bearer || cookieValue || '';
  if (!provided || !timingSafeEqual(provided, adminKey)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
