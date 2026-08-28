// Full Auth.js setup (Node runtime). Sign-in is Google OAuth restricted to the BU
// Google Workspace domain. JWT sessions so middleware can read auth at the edge.
//
// A SESSION IS NOT AUTHORITY. Any @bu.edu account can sign in — that is what makes
// the BU visibility tier possible. What a session buys is exactly one thing: reads
// of `internal` projects alongside `public` ones. Admin power is decided separately
// and per-request by actor() (lib/actor.ts), which looks the email up in `users` on
// every call; a signed-in student has no row, so actor() returns null and both the
// /admin layout gate and every route guard refuse them.
//
// This used to also require an allowlist row HERE, which meant "has a session" and
// "is an admin" were the same fact. They no longer are, so nothing may infer admin
// authority from session presence — see the middleware note in auth.config.ts.
//
// Provider credentials come from AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (the v5
// convention — Google() picks them up automatically).
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { authConfig } from "./auth.config";

// Only Workspace accounts on this domain may sign in. Checked as a plain suffix on
// the email Google returns, which is sound only because the provider is Google and
// the domain is a Workspace domain — a self-asserted email claim would not be.
const ALLOWED_DOMAIN = "bu.edu";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Google({
      // Force the account chooser so signing in as the wrong Google identity is
      // a deliberate choice, not a silent cookie reuse.
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Gatekeeper: a @bu.edu address, and nothing more. Deliberately no allowlist
    // check — see the header. Returning false here is the ONLY way to refuse
    // sign-in, so it must stay narrow enough that a legitimate BU viewer gets in.
    async signIn({ user }) {
      const email = (user.email ?? "").trim().toLowerCase();
      return email.endsWith(`@${ALLOWED_DOMAIN}`);
    },
  },
});
