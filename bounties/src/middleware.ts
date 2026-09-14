/**
 * Serves `hackbu.buspark.io/` with the HackBU track page.
 *
 * WHY THIS IS NOT A `next('/tracks/hackbu')` REWRITE, and why index.astro had
 * to stop being prerendered for any of it to run:
 *
 * The adapter only reaches middleware when `app.match(request)` finds an SSR
 * route. Under `output: 'hybrid'` a prerendered path has no SSR route, so the
 * generated worker takes an earlier branch — `env.ASSETS.fetch(...)` — and
 * returns the static file without ever entering the Astro app. While `/` was
 * prerendered, middleware could not see a request to it at all, and a rewrite
 * here would have been dead code that looked correct.
 *
 * `/tracks/hackbu` is still prerendered, so it is fetched from the asset
 * binding rather than rewritten to: a rewrite would ask the SSR app for a route
 * it does not have.
 *
 * The response is rebuilt rather than returned as-is because an asset response
 * is immutable; setting Vary on it directly throws.
 */
import { defineMiddleware } from 'astro:middleware';
import { trackForHost, shouldServeTrackRoot } from './lib/hostname';

export const onRequest = defineMiddleware(async (context, next) => {
  const host = context.request.headers.get('host');
  const { pathname, origin } = context.url;

  if (!shouldServeTrackRoot(host, pathname)) return next();

  const assets = (context.locals as { runtime?: { env?: { ASSETS?: { fetch: typeof fetch } } } })
    .runtime?.env?.ASSETS;
  // No binding means `astro dev`, where there is no asset server to ask. Fall
  // through to the board rather than 500 — the mapping is a production concern
  // and local dev reaches the same page at /tracks/<id>.
  if (!assets) return next();

  const track = trackForHost(host);
  const asset = await assets.fetch(`${origin}/tracks/${track}/`);
  // A miss means the track page was not built. Serving the board is wrong but
  // reachable; a 404 on the front door is neither.
  if (asset.status === 404) return next();

  const headers = new Headers(asset.headers);
  // The same URL now yields different bodies per hostname. Without this a cache
  // in front of the Worker could serve the board to hackbu visitors.
  headers.append('Vary', 'Host');
  return new Response(asset.body, { status: asset.status, headers });
});
