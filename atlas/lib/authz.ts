// Org-scoped admin permissions — the pure decision layer.
//
// This module imports NOTHING. Not `server-only`, not @/lib/db, not next-auth.
// That constraint is deliberate and load-bearing: it's what makes the rules
// unit-testable without a database, a session, or Next internals (lib/db.ts
// starts with `import "server-only"`, which throws under vitest). Anything that
// needs to *resolve* the current actor lives in lib/actor.ts instead.
//
// The model, in two sentences: every admin belongs to exactly one org and may
// only edit projects owned by that org; a small number of explicitly-flagged
// super admins may edit anything and are the only ones who can move a project
// between orgs. `is_super` is granted by SQL alone — no API accepts the field —
// so an admin created by a path that forgets to tag them is a scoped Spark
// admin, never a super admin.

/** The two teams sharing the gallery database. */
export const ORGS = ["spark", "cds"] as const;

export type Org = (typeof ORGS)[number];

/** The signed-in admin, as resolved by lib/actor.ts. */
export interface Actor {
  id: number;
  email: string;
  /** Typed as `string`, not `Org` — the value comes from the DB and a bad row
   *  must fail closed rather than be trusted by the type system. */
  org: string;
  isSuper: boolean;
}

function isKnownOrg(org: string): boolean {
  return (ORGS as readonly string[]).includes(org);
}

/**
 * May this actor write to a project owned by `ownerOrg`?
 *
 * NOTE the `isKnownOrg` guard: without it an actor carrying `org: ""` would
 * authorise a row whose `owner_org` is also `""`, because `"" === ""`. The DB
 * CHECK makes such a row unreachable today, but the guard is what keeps this
 * fail-closed if that ever stops being true.
 *
 * `owner_org` is authority and is entirely separate from `surfaces`, which is
 * visibility. A project tagged for both galleries is still owned by exactly one
 * team — see the dual-surface case in authz.test.ts.
 */
export function canEdit(actor: Actor, ownerOrg: string): boolean {
  if (actor.isSuper) return true;
  return isKnownOrg(actor.org) && actor.org === ownerOrg;
}

/**
 * May this actor merge these two projects? Both sides must be writable, so a
 * cross-org merge is automatically super-only with no extra rule. Order must
 * not matter — a one-sided check is the natural bug here.
 */
export function canMerge(actor: Actor, survivorOrg: string, absorbedOrg: string): boolean {
  return canEdit(actor, survivorOrg) && canEdit(actor, absorbedOrg);
}

/** Moving a project between teams is super-only. */
export function canSetOwnerOrg(actor: Actor): boolean {
  return actor.isSuper;
}

/** Granting/revoking admin is super-only. */
export function canManageUsers(actor: Actor): boolean {
  return actor.isSuper;
}

/** Editing the global gallery vocabulary (shared by both orgs) is super-only. */
export function canEditVocab(actor: Actor): boolean {
  return actor.isSuper;
}
