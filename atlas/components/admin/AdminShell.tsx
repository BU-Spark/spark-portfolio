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
    // Wording deliberately covers BOTH ways to land here, because this component
    // cannot tell them apart — it only receives a boolean.
    //
    //   (a) an admin whose `users` row was deleted mid-session, and
    //   (b) since sign-in opened to the whole @bu.edu domain, ANY BU account that
    //       simply navigated to /admin.
    //
    // (b) is now by far the common case and it used to be impossible, so the old
    // copy — "your admin access has been removed" — told students they had lost
    // something they never had. The route out is the gallery, not a support ticket.
    return (
      <div className="spark-control" style={{ padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 24, marginBottom: 10 }}>
          This area is for Spark! staff
        </h1>
        <p style={{ color: "var(--sec)", fontSize: 14.5, lineHeight: 1.6 }}>
          You&rsquo;re signed in, but this account isn&rsquo;t on the admin list.
          <br />
          <a href="/" style={{ color: "var(--teal-deep)" }}>
            Back to the gallery
          </a>
          {" · "}
          <a href="/api/auth/signout" style={{ color: "var(--teal-deep)" }}>
            Sign out
          </a>
          <br />
          <span style={{ fontSize: 13 }}>
            If you should have admin access, ask a super admin to add you.
          </span>
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
