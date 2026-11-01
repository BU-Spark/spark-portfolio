// Admin allowlist management.
//   GET  → list allowed admins (any admin: useful for "who do I ask about this?")
//   POST → add a @bu.edu email to the allowlist { email, org } — any admin; a
//          scoped admin may only add into their own org (canAddAdmin)
// There are no passwords: listed people sign in with Google (auth.ts gates on this
// list + the bu.edu domain).
import { requireAdmin } from "@/lib/actor";
import { addAdminEmail, listUsers } from "@/lib/db";
import { ORGS, canAddAdmin } from "@/lib/authz";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  return Response.json({ users: await listUsers() });
}

export async function POST(req: Request) {
  // Any admin may add; canAddAdmin below scopes a non-super to their own org.
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let body: { email?: string; org?: string; isSuper?: unknown; is_super?: unknown };
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
  //
  // A scoped admin's team is fixed: an omitted org means theirs, and a supplied
  // org that differs is rejected by canAddAdmin below (not silently rewritten).
  const org = (body.org || (g.actor.isSuper ? "" : g.actor.org)).trim();
  if (!ORGS.includes(org as never)) {
    return Response.json(
      { error: `Pick a team: ${ORGS.join(" or ")}.` },
      { status: 400 }
    );
  }

  // The super flag is read only so a request asking for it is refused loudly;
  // addAdminEmail has no is_super parameter, so it could never be written anyway.
  const wantsSuper = !!body.isSuper || !!body.is_super;
  if (!canAddAdmin(g.actor, { org, isSuper: wantsSuper })) {
    return Response.json(
      {
        error: wantsSuper
          ? "Super admin is granted in the database only."
          : "You can only add admins to your own team.",
      },
      { status: 403 }
    );
  }

  const inserted = await addAdminEmail(email, email.split("@")[0], org);
  return Response.json({ ok: true, inserted });
}
