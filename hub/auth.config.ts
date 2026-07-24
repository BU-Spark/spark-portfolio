// Edge-safe Auth.js config (no DB / bcrypt) — imported by middleware to gate
// routes. The DB-backed Credentials provider lives in auth.ts (Node runtime).
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  pages: { signIn: "/admin/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      // The login page itself is always reachable.
      if (pathname === "/admin/login") return true;
      // Everything else under /admin requires a session.
      if (pathname.startsWith("/admin")) return !!auth?.user;
      return true;
    },
  },
} satisfies NextAuthConfig;
