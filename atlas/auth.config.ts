// Edge-safe Auth.js config (no DB / bcrypt) — imported by middleware to gate
// routes. The DB-backed Credentials provider lives in auth.ts (Node runtime).
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  // One sign-in surface for everyone. A BU viewer bounced from a protected page and
  // an admin arriving deliberately land in the same place; the callbackUrl decides
  // where they end up.
  //
  // `error` points here too, deliberately. Without it, a failed sign-in lands on
  // Auth.js's built-in page, which says "Try again" and nothing else — a dead end
  // that cost a round of debugging because nobody could tell a rejected domain from
  // a broken provider config. /login renders the actual reason (see LoginClient).
  pages: { signIn: "/login", error: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      // Both login surfaces stay reachable without a session, or the redirect loops.
      if (pathname === "/login" || pathname === "/admin/login") return true;
      // Everything under /admin requires a session — and NOTHING MORE. This check
      // cannot tell an admin from a signed-in student: it runs at the edge, where
      // auth.config.ts must not import lib/db.ts (server-only + pg), so there is no
      // way to consult the `users` table here.
      //
      // Since sign-in opened to the whole @bu.edu domain, that gap became real
      // rather than theoretical: a student CAN now satisfy this check. The actual
      // admin gate is app/admin/layout.tsx resolving actor() per request, plus
      // requireAdmin/requireSuper on every route. Treat this as UX only — it exists
      // to send a signed-out visitor to /login, not to protect anything.
      if (pathname.startsWith("/admin")) return !!auth?.user;
      return true;
    },
  },
} satisfies NextAuthConfig;
