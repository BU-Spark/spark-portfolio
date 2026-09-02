import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Cloudflare to match the rest of the program: atlas ships to Workers via
// OpenNext + Wrangler, and buspark.io is already on Cloudflare DNS.
//
// `hybrid` keeps every page static and server-renders only what must be:
// src/pages/api/* (Mailchimp + Eventbrite) and src/pages/events.astro.
export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  vite: {
    ssr: {
      // Leave node: imports as bare specifiers instead of trying to bundle
      // them — Workers provides them at runtime via the `nodejs_compat` flag
      // set in wrangler.jsonc. Without this, the build fails on
      // `node:crypto` (the Mailchimp MD5 subscriber hash).
      external: ['node:crypto'],
    },
  },
});
