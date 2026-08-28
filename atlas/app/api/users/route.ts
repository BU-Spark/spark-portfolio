// Admin allowlist management.
//   GET  → list allowed admins (any admin: useful for "who do I ask about this?")
//   POST → add a @bu.edu email to the allowlist { email, org }  — SUPER ADMIN ONLY
// There are no passwords: listed people sign in with Google (auth.ts gates on this
// list + the bu.edu domain).
import { requireAdmin, requireSuper } from "@/lib/actor";
import { addAdminEmail, listUsers } from "@/lib/db";
import { ORGS } from "@/lib/authz";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  return Response.json({ users: await listUsers() });
}

export async function POST(req: Request) {
  // Granting admin is cross-org by nature, so it's super-only.
  const g = await requireSuper();
  if (!g.ok) return g.res;

  let body: { email?: string; org?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  // Admins sign in with Google Workspace, so only @bu.edu can ever authenticate.
  if (!email.endsWith("@bu.edu")) {
    return Response.json(
      { error: "Only @bu.edu addresses can be admins." },
      { status: 400 }
    );
  }

  // Org is required and validated — there is no "unscoped admin". Note what is
  // deliberately absent: `is_super`. Even a super admin cannot mint another super
  // admin through this API; that is done with SQL only. Because of that, a
  // mistake here (wrong org, missing field) can only ever produce a *scoped*
  // admin, never one with cross-org authority.
  const org = (body.org || "").trim();
  if (!ORGS.includes(org as never)) {
    return Response.json(
      { error: `Pick a team: ${ORGS.join(" or ")}.` },
      { status: 400 }
    );
  }

  const inserted = await addAdminEmail(email, email.split("@")[0], org);
  return Response.json({ ok: true, inserted });
}
