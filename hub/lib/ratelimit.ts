// Optional rate limiting for the public (token-gated, unauthenticated) upload
// endpoints. Ships DORMANT: with no Upstash env set, checkRateLimit() always
// allows — so behavior is unchanged until you create an Upstash Redis DB and add
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (mirrors the Resend pattern).
// Serverless-safe because the counter lives in Upstash, not per-lambda memory.
import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let cached: Ratelimit | null | undefined;

function getLimiter(): Ratelimit | null {
  if (cached !== undefined) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cached = null; // not configured → dormant
    return null;
  }
  cached = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(20, "60 s"), // 20 requests / minute / key
    prefix: "spark-upload",
    analytics: false,
  });
  return cached;
}

/**
 * Returns true if the request is allowed. No-op (always allows) when Upstash
 * isn't configured, and fails OPEN on limiter errors so a Redis blip never
 * blocks a legitimate uploader.
 */
export async function checkRateLimit(key: string): Promise<boolean> {
  const limiter = getLimiter();
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit(key);
    return success;
  } catch {
    return true;
  }
}
