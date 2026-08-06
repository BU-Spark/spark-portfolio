// Shared shell for every /admin page — the "Spark Control" redesign.
// A persistent dark left rail + a light canvas (see AdminShell, which also
// special-cases the full-bleed /admin/login). The subtree is wrapped in
// `.spark-control`, scoping the redesign's tokens + primitives
// (app/admin/spark-control.css) to /admin only — the public gallery keeps
// globals.css :root untouched.
//
// This is also the ONLY server-side auth check the admin pages have. Every page
// under /admin is a client component, so before this the whole surface relied on
// middleware alone — and middleware can only assert "a JWT exists", which stays
// true after an admin's row is deleted. Resolving the actor here covers all of
// them in one place and makes revocation immediate.
import { actor } from "@/lib/actor";
import { ORGS } from "@/lib/authz";
import AdminShell from "@/components/admin/AdminShell";
import { ActorProvider } from "@/components/admin/ActorContext";
import "./spark-control.css";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const a = await actor();
  // A row is not enough — it has to carry actual authority. actor() maps a NULL org
  // to "", which authorizes nothing, so a non-super with no valid team would other-
  // wise render the whole admin UI and get a 403 from every write it attempted.
  // The column is NOT NULL today, making this defence-in-depth rather than a live
  // bug, but the gate should express the rule instead of relying on the schema.
  const authorized = !!a && (a.isSuper || (ORGS as readonly string[]).includes(a.org));
  return (
    <ActorProvider
      actor={a && authorized ? { email: a.email, org: a.org, isSuper: a.isSuper } : null}
    >
      <AdminShell hasActor={authorized}>{children}</AdminShell>
    </ActorProvider>
  );
}
