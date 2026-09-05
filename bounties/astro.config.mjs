import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { builtinModules } from 'node:module';

// Cloudflare to match the rest of the program: atlas ships to Workers via
// OpenNext + Wrangler, and buspark.io is already on Cloudflare DNS.
//
// `hybrid` keeps every page static and server-renders only what must be:
// src/pages/api/* (Postgres + Eventbrite) and src/pages/events.astro.

// `pg` — and its dependencies — import Node builtins as BARE specifiers
// (`events`, `net`, `tls`, `stream`…). Rollup refuses to bundle those and the
// error names one module at a time, so chasing them individually never ends.
// Workers provides all of them under the `nodejs_compat` flag set in
// wrangler.jsonc, but only under the `node:` prefix — so rewrite bare -> node:
// and mark the prefixed forms external, leaving them for the runtime.
const bare = builtinModules.filter((m) => !m.startsWith('_'));
const nodePrefixAliases = bare.map((m) => ({
  find: new RegExp(`^${m}$`),
  replacement: `node:${m}`,
}));

export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  vite: {
    resolve: { alias: nodePrefixAliases },
    ssr: { external: bare.map((m) => `node:${m}`) },
  },
});
