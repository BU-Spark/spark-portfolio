/**
 * Resolve a post-sign-in destination from an untrusted `callbackUrl`.
 *
 * Same-origin only — otherwise /login becomes an open redirect wearing BU's domain,
 * and Auth.js forwards whatever it is handed.
 *
 * Must accept ABSOLUTE urls, not just paths: Auth.js's middleware redirect writes
 * the full origin (`https://host/admin`), so a relative-only check silently sent
 * every bounced admin to the homepage instead of back to /admin. Pure and
 * origin-injected so it can be unit-tested without a browser.
 */
export function safeCallback(
  raw: string | null | undefined,
  origin: string,
  /** Where to go when there is no usable callbackUrl. */
  fallback = "/"
): string {
  if (!raw) return fallback;
  // Protocol-relative ("//evil.com") inherits the page protocol and would parse as
  // plausible; reject before parsing.
  if (raw.startsWith("//")) return fallback;
  if (raw.startsWith("/")) return raw;
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return fallback;
    return `${u.pathname}${u.search}` || fallback;
  } catch {
    return fallback;
  }
}
