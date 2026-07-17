// Client-side mirror of lib/db's `imageUrl()`. That module is server-only
// ("server-only" import), so client components can't import from it — this
// keeps the bare-S3-key → servable-URL logic in one shared, client-safe place.
// No "server-only" import here on purpose.
export function keyToUrl(key: string): string {
  if (/^https?:\/\//i.test(key) || key.startsWith("/api/img/")) return key;
  return `/api/img/${key.split("/").map(encodeURIComponent).join("/")}`;
}
