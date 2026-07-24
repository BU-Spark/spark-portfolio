"use client";
// Decides the admin frame based on route. Everything sits under `.spark-control`
// (so the redesign tokens apply), but /admin/login renders full-bleed with no
// rail/canvas grid — it has its own dark teal-glow backdrop. Every other route
// gets the persistent rail + scrolling canvas.
import { usePathname } from "next/navigation";
import AdminRail from "@/components/admin/AdminRail";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  if (pathname === "/admin/login") {
    return <div className="spark-control">{children}</div>;
  }
  return (
    <div className="app spark-control">
      <AdminRail />
      <main className="canvas">{children}</main>
    </div>
  );
}
