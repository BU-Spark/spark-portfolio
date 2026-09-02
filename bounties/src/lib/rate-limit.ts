/**
 * Simple in-memory rate limiter.
 * Works per-process; on serverless each cold start resets.
 * Good enough to prevent abuse bursts.
 */

interface Entry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, Entry>>();

interface RateLimitOptions {
  /** Unique name for this limiter (e.g. 'respond', 'login') */
  name: string;
  /** Max requests per window */
  limit: number;
  /** Window size in seconds */
  windowSec: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  headers: Record<string, string>;
}

export function rateLimit(ip: string, opts: RateLimitOptions): RateLimitResult {
  if (!stores.has(opts.name)) stores.set(opts.name, new Map());
  const store = stores.get(opts.name)!;

  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + opts.windowSec * 1000 });
    return {
      allowed: true,
      limit: opts.limit,
      remaining: opts.limit - 1,
      headers: {
        'X-RateLimit-Limit': String(opts.limit),
        'X-RateLimit-Remaining': String(opts.limit - 1),
      },
    };
  }

  if (entry.count >= opts.limit) {
    const headers = {
      'X-RateLimit-Limit': String(opts.limit),
      'X-RateLimit-Remaining': '0',
    };
    return { allowed: false, limit: opts.limit, remaining: 0, headers };
  }

  entry.count++;
  const remaining = Math.max(0, opts.limit - entry.count);
  const headers = {
    'X-RateLimit-Limit': String(opts.limit),
    'X-RateLimit-Remaining': String(remaining),
  };

  return { allowed: true, limit: opts.limit, remaining, headers };
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', ...result.headers },
  });
}

/** Extract client IP from request (works with proxies) */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

// Periodically clean expired entries (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const store of stores.values()) {
    for (const [ip, entry] of store) {
      if (now > entry.resetAt) store.delete(ip);
    }
  }
}, 5 * 60 * 1000);
