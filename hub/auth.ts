// Full Auth.js setup (Node runtime). Admin sign-in is Google OAuth, gated to BU
// Google Workspace accounts that an admin has added to the allowlist (the users
// table). Google proves the person owns the @bu.edu address; the allowlist
// decides who's actually let in. JWT sessions so middleware reads auth at edge.
//
// Provider credentials come from AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (the v5
// convention — Google() picks them up automatically).
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { authConfig } from "./auth.config";
import { isAdminEmail } from "@/lib/db";

// Only Workspace accounts on this domain may sign in (in addition to the
// per-email allowlist). Keeps a random gmail that an admin mistyped out.
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
    // Gatekeeper: must be a @bu.edu address AND on the admin allowlist.
    async signIn({ user }) {
      const email = (user.email ?? "").trim().toLowerCase();
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) return false;
      return await isAdminEmail(email);
    },
  },
});
