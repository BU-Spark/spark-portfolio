// Shared shell for every /admin page — the "Spark Control" redesign.
// A persistent dark left rail + a light canvas (see AdminShell, which also
// special-cases the full-bleed /admin/login). The subtree is wrapped in
// `.spark-control`, scoping the redesign's tokens + primitives
// (app/admin/spark-control.css) to /admin only — the public gallery keeps
// globals.css :root untouched.
import AdminShell from "@/components/admin/AdminShell";
import "./spark-control.css";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
