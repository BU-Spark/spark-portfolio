// Where sign-in lands when no specific destination was requested.
//
// The role decision has to happen HERE rather than in /login, because /login is a
// client component and the answer needs a database lookup: "is this person an
// admin" is a `users` row, deliberately not a JWT claim (see lib/actor.ts on why
// putting it in the token would make revocation take until expiry).
//
// So the flow is: /login → Google → /after-login → resolve actor() → redirect.
// One door, and the door decides.
//
// If Auth.js supplied a callbackUrl (someone was bounced off a protected page),
// /login honours that instead and this route is never reached — being sent back to
// the page you asked for beats being sent somewhere role-appropriate.
import { redirect } from "next/navigation";
import { actor } from "@/lib/actor";
import { ORGS } from "@/lib/authz";

// A session lookup per visit, and the destination depends on it — nothing here is
// cacheable.
export const dynamic = "force-dynamic";

export default async function AfterLogin() {
  const a = await actor();
  // Mirrors the gate in app/admin/layout.tsx exactly. A row alone is not authority:
  // actor() maps a NULL org to "", which authorises nothing, so an admin with no
  // valid team would otherwise be routed into an admin UI that 403s on every write.
  const isAdmin = !!a && (a.isSuper || (ORGS as readonly string[]).includes(a.org));
  redirect(isAdmin ? "/admin" : "/");
}
