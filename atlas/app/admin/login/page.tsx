// RETIRED. /login is the single sign-in surface for everyone.
//
// This route survives only so old bookmarks, the Google OAuth console's redirect
// history, and any link sitting in a Slack thread keep working. It renders nothing
// and never has a form.
//
// Why it went: sign-in used to be admin-only, so an admin-branded door made sense.
// Once any @bu.edu account could sign in, two doors meant two different accounts of
// what signing in gets you — and this one's "approved admins only" framing was the
// wrong one for most arrivals. Where you LAND is now decided after sign-in by
// /after-login, from the actor, rather than by which URL you happened to start at.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // Preserve ?error= so a rejected sign-in still explains itself on the new page.
  // callbackUrl is deliberately NOT forwarded: anyone arriving here asked for the
  // admin door, and /after-login routes them by role — which is the correct
  // destination whether or not they turn out to be an admin.
  const error = typeof sp.error === "string" ? sp.error : null;
  redirect(error ? `/login?error=${encodeURIComponent(error)}` : "/login");
}
