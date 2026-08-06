"use client";
// Decides the admin frame based on route. Everything sits under `.spark-control`
// (so the redesign tokens apply), but /admin/login renders full-bleed with no
// rail/canvas grid — it has its own dark teal-glow backdrop. Every other route
// gets the persistent rail + scrolling canvas.
//
// `hasActor` comes from the server layout. When it's false on a non-login route the
// person holds a session cookie but has no row in `users` — either they were just
// removed, or the row was deleted while they were signed in. Middleware can't catch
// that (it only sees the JWT), so we show it here instead of rendering an admin UI
// whose every API call would 401.
import { usePathname } from "next/navigation";
import AdminRail from "@/components/admin/AdminRail";

export default function AdminShell({
  children,
  hasActor = true,
}: {
  children: React.ReactNode;
  hasActor?: boolean;
}) {
  const pathname = usePathname() || "";
  if (pathname === "/admin/login") {
    return <div className="spark-control">{children}</div>;
  }
  if (!hasActor) {
    return (
      <div className="spark-control" style={{ padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 24, marginBottom: 10 }}>
          Your admin access has been removed
        </h1>
        <p style={{ color: "var(--sec)", fontSize: 14.5, lineHeight: 1.6 }}>
          You&rsquo;re still signed in, but this account is no longer on the admin list.
          <br />
          Ask a super admin to re-add you, or{" "}
          <a href="/api/auth/signout" style={{ color: "var(--teal-deep)" }}>
            sign out
          </a>
          .
        </p>
      </div>
    );
  }
  return (
    <div className="app spark-control">
      <AdminRail />
      <main className="canvas">{children}</main>
    </div>
  );
}
