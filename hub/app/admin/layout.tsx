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
import AdminShell from "@/components/admin/AdminShell";
import { ActorProvider } from "@/components/admin/ActorContext";
import "./spark-control.css";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const a = await actor();
  return (
    <ActorProvider
      actor={a ? { email: a.email, org: a.org, isSuper: a.isSuper } : null}
    >
      <AdminShell hasActor={!!a}>{children}</AdminShell>
    </ActorProvider>
  );
}
