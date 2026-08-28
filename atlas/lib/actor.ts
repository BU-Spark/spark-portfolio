// Org-scoped admin permissions — the resolution + enforcement layer.
//
// Counterpart to lib/authz.ts: the pure rules live there (and are unit-tested);
// everything that needs a session or the database lives here (and is verified
// against the real DB on int instead). Keeping the split clean is what lets
// authz.ts be importable under vitest — lib/db.ts starts with
// `import "server-only"`, which throws there.
//
// Route handlers use these guards in place of the copy-pasted
//   const session = await auth(); if (!session) return 401
// that every /api route carried before. Same line count at the call site:
//
//   const g = await requireProject(id);
//   if (!g.ok) return g.res;
//   // …g.actor is the resolved admin
//
// Guards return a Guard object rather than throwing, because App Router handlers
// must return a Response — a thrown error becomes an opaque 500 unless every
// handler is wrapped in a HOF, which would mean rewriting ~30 signatures and
// re-plumbing the `{ params }` argument.
import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { query, getProjectOrgs } from "@/lib/db";
import { type Actor, canEdit } from "@/lib/authz";

export type { Actor };

/**
 * The signed-in admin, re-read from `users` on EVERY request.
 *
 * Deliberately not a JWT claim. Sessions are `strategy: "jwt"` with no `jwt`
 * callback, so putting org/is_super in the token would make them stale: a
 * re-tagged admin would keep old privileges until expiry, with no mechanism to
 * force a sign-out, and the manual `UPDATE users SET is_super = true` would not
 * take effect until the token refreshed. Reading per request also closes a
 * pre-existing hole — until now, removing someone from `users` left their live
 * session fully working.
 *
 * Cost is one lookup on an 8-row table against a unique index, on requests that
 * already run several queries. `cache()` dedupes it within a single request
 * (relevant when the admin layout and a route handler both ask).
 *
 * Returns null for "no session" AND for "row no longer exists" — both mean the
 * caller is not an admin, so callers never need to tell them apart.
 *
 * No retry loop here, unlike isAdminEmail: a throw there breaks sign-in, whereas
 * a throw here fails one API call the client can retry.
 */
export const actor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return null;
  const rows = await query<{
    id: number;
    email: string;
    org: string | null;
    is_super: boolean | null;
  }>(`SELECT id, email, org, is_super FROM users WHERE lower(email) = $1`, [email]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    // Fail closed: a NULL org authorises nothing (canEdit rejects orgs outside ORGS).
    org: r.org ?? "",
    isSuper: r.is_super === true,
  };
});

export type Guard = { ok: true; actor: Actor } | { ok: false; res: Response };

const deny = (status: number, error: string): Guard => ({
  ok: false,
  res: Response.json({ error }, { status }),
});

/** Any signed-in admin, either org. Replaces the old bare session check. */
export async function requireAdmin(): Promise<Guard> {
  const a = await actor();
  return a ? { ok: true, actor: a } : deny(401, "Unauthorized");
}

/** Super admins only: granting admin, the shared vocabulary, moving ownership. */
export async function requireSuper(): Promise<Guard> {
  const a = await actor();
  if (!a) return deny(401, "Unauthorized");
  return a.isSuper ? { ok: true, actor: a } : deny(403, "Super admin only");
}

const ORG_LABEL: Record<string, string> = { spark: "Spark!", cds: "CDS" };
const label = (org: string) => ORG_LABEL[org] ?? org;

/**
 * The actor may write to EVERY one of these projects. One query regardless of
 * count, so it covers the single-project case and the two-sided cases (merge,
 * bulk upload requests) with the same code path.
 *
 * 403 rather than 404 for another team's project, and the message names the
 * owner. Hiding it would only be worth doing to prevent id enumeration, and the
 * admin project list deliberately shows every project with an org badge — so the
 * ids are already visible and a vague error would just be unhelpful.
 */
export async function requireProjects(ids: string[]): Promise<Guard> {
  const a = await actor();
  if (!a) return deny(401, "Unauthorized");
  if (!ids.length) return deny(400, "No project ids supplied");
  if (a.isSuper) return { ok: true, actor: a };

  const orgs = await getProjectOrgs(ids);
  const missing = ids.filter((id) => !orgs.has(id));
  if (missing.length) return deny(404, `Project not found: ${missing.join(", ")}`);

  const foreign = ids.filter((id) => !canEdit(a, orgs.get(id) as string));
  if (foreign.length) {
    const owners = [...new Set(foreign.map((id) => label(orgs.get(id) as string)))];
    return deny(
      403,
      `Owned by ${owners.join(" / ")} — ask one of their admins to make this change.`
    );
  }
  return { ok: true, actor: a };
}

export const requireProject = (id: string) => requireProjects([id]);
