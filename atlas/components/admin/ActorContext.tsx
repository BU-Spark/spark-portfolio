"use client";
// Makes the signed-in admin's team + super flag available to the admin UI without
// every component fetching /api/auth/session for itself (which couldn't tell them
// the org anyway — the session carries only name/email/image).
//
// The value is resolved ONCE, server-side, in app/admin/layout.tsx and passed
// down. Everything here is presentation: what to hide, what to disable, what to
// badge. It is never a security boundary — the route guards in lib/actor.ts are,
// and they re-read the DB on every request.
// Safe to import from a client component: lib/authz.ts imports nothing at all.
import { ORGS } from "@/lib/authz";
import { createContext, useContext } from "react";

export interface ClientActor {
  email: string;
  org: string;
  isSuper: boolean;
}

const ActorContext = createContext<ClientActor | null>(null);

export function ActorProvider({
  actor,
  children,
}: {
  actor: ClientActor | null;
  children: React.ReactNode;
}) {
  return <ActorContext.Provider value={actor}>{children}</ActorContext.Provider>;
}

/** null when signed out (or the admin row was removed). */
export function useActor(): ClientActor | null {
  return useContext(ActorContext);
}

const LABELS: Record<string, string> = { spark: "Spark!", cds: "CDS" };

/** Human label for a team key — "Spark!" / "CDS", falling back to the raw key. */
export function orgLabel(org: string | undefined | null): string {
  if (!org) return "—";
  return LABELS[org] ?? org;
}

/**
 * Mirror of canEdit() in lib/authz.ts, for UI affordances only. Kept as a thin
 * wrapper so components read as intent and there is one place to change if the
 * rule moves. Never rely on this for enforcement — a client can skip it entirely.
 */
export function canEditHere(actor: ClientActor | null, ownerOrg: string | undefined): boolean {
  if (!actor) return false;
  if (actor.isSuper) return true;
  // The known-org guard mirrors canEdit(). Without it an actor whose org is junk
  // ("sparkk", "") would get enabled controls for a project whose owner_org is the
  // same junk, then a 403 on save — the affordance would promise what the server
  // refuses. Cosmetic either way, but "mirror of canEdit" has to actually be true.
  return (ORGS as readonly string[]).includes(actor.org) && actor.org === ownerOrg;
}
