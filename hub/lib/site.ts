// The gallery's public origin, used for canonical URLs, OG image URLs, the
// sitemap and robots.txt.
//
// This is deliberately ONE constant. It was previously hardcoded as
// "https://sparkshowcase.vercel.app" in four separate files, which survived the
// move to Cloudflare Workers and would have shipped at launch: robots.txt pointed
// crawlers at a sitemap on the old host, that sitemap listed every project under
// the old host, and every canonical/OG tag agreed with it. Google would have
// indexed the Vercel domain and treated the real host as the duplicate.
//
// The production origin is atlas.buspark.io. It was briefly written here as
// hub.buspark.io, which never had a DNS record at all — so between that commit and
// this one, robots.txt, the sitemap and every canonical tag pointed crawlers at a
// hostname that did not resolve. Verified against Cloudflare's own nameservers:
// atlas.buspark.io answers, hub.buspark.io returns NOERROR with zero records.
//
// NEXT_PUBLIC_BASE_URL overrides it (same variable the upload magic-links already
// use), so a preview deployment can advertise itself correctly. The default is the
// real production origin rather than a placeholder — an unset variable should
// degrade to "correct in prod", not to a domain nobody owns.
export const SITE_URL = (process.env.NEXT_PUBLIC_BASE_URL || "https://atlas.buspark.io").replace(
  /\/$/,
  ""
);

/** Absolute-ise an app-relative path (e.g. imageUrl()'s "/api/img/…") for OG/JSON-LD. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
