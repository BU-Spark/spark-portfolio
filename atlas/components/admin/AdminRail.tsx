"use client";
// Spark Control — persistent dark left rail (replaces the old topbar AdminNav).
// Grouped icon+label nav (Catalog / Pipeline / Admin), brand mark, inbox count
// badge, and a footer with the signed-in admin + sign-out. Active item derived
// from usePathname(). Collapses to an icon rail under 1080px (see spark-control.css).
// The signed-in admin comes from ActorContext (resolved server-side in the admin
// layout), which replaces the old fetch("/api/auth/session") — that call couldn't
// tell us the team anyway, since the session carries only name/email/image.
import { useEffect, useState } from "react";
import { useActor, orgLabel } from "@/components/admin/ActorContext";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

type IconName =
  | "command" | "projects" | "people" | "inbox" | "media" | "bulk" | "import" | "admins"
  | "settings" | "approvals";

// Minimal stroke icons (24×24 viewBox; CSS sizes them to 17px).
function Icon({ name }: { name: IconName }) {
  const p = (d: string) => <path d={d} />;
  const common = {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "command":
      return <svg {...common}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>;
    case "projects":
      return <svg {...common}>{p("M4 5h16M4 12h16M4 19h10")}</svg>;
    case "people":
      return <svg {...common}><circle cx="9" cy="8" r="3.2" />{p("M3.5 19a5.5 5.5 0 0 1 11 0")}<circle cx="17" cy="9" r="2.4" />{p("M16 14.2a4.5 4.5 0 0 1 4.5 4.8")}</svg>;
    case "inbox":
      return <svg {...common}>{p("M4 4h16v16H4z")}{p("M4 14h4l2 3h4l2-3h4")}</svg>;
    case "media":
      return <svg {...common}><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="10" r="1.8" />{p("M4 17l5-5 4 4 3-3 4 4")}</svg>;
    case "bulk":
      return <svg {...common}>{p("M9 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L10.5 6")}{p("M15 11a4 4 0 0 0-5.7 0L6.7 13.6a4 4 0 0 0 5.7 5.7L13.5 18")}</svg>;
    case "import":
      return <svg {...common}>{p("M12 3v12")}{p("M8 11l4 4 4-4")}{p("M4 19h16")}</svg>;
    case "admins":
      return <svg {...common}><circle cx="12" cy="8" r="3.4" />{p("M5.5 20a6.5 6.5 0 0 1 13 0")}</svg>;
    case "approvals":
      return <svg {...common}>{p("M20 6L9 17l-5-5")}</svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3.2" />{p("M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1l2.1-2.1M17 7l2.1-2.1")}</svg>;
  }
}

interface NavItem { href: string; label: string; icon: IconName; exact?: boolean; badge?: number }

export default function AdminRail() {
  const pathname = usePathname() || "";
  const [inboxCount, setInboxCount] = useState(0);
  const [approvalCount, setApprovalCount] = useState(0);
  const [suggestionCount, setSuggestionCount] = useState(0);
  const actor = useActor();

  useEffect(() => {
    const ac = new AbortController();
    // Both counts are already org-scoped server-side, so the badges only ever show
    // rows this admin can actually act on.
    fetch("/api/inbox", { signal: ac.signal }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.count != null) setInboxCount(d.count);
    }).catch(() => {});
    fetch("/api/approvals", { signal: ac.signal }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (Array.isArray(d?.items)) setApprovalCount(d.items.length);
    }).catch(() => {});
    // Community suggestions. A review queue nobody is prompted to visit is a queue
    // that silently fills up, which is exactly what happened to this feature between
    // shipping the API and shipping this badge.
    fetch("/api/suggestions?status=pending", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (Array.isArray(d?.suggestions)) setSuggestionCount(d.suggestions.length);
      }).catch(() => {});
    return () => ac.abort();
  }, []);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  const groups: { title: string; items: NavItem[] }[] = [
    { title: "Catalog", items: [
      { href: "/admin", label: "Command center", icon: "command", exact: true },
      { href: "/admin/projects", label: "Projects", icon: "projects" },
      { href: "/admin/people", label: "People", icon: "people" },
    ]},
    { title: "Pipeline", items: [
      { href: "/admin/approvals", label: "Approvals", icon: "approvals", badge: approvalCount },
      { href: "/admin/inbox", label: "Import inbox", icon: "inbox", badge: inboxCount },
      { href: "/admin/import", label: "Import CSV", icon: "import" },
      { href: "/admin/suggestions", label: "Suggestions", icon: "approvals", badge: suggestionCount },
      { href: "/admin/uploads", label: "Uploads", icon: "media" },
      { href: "/admin/bulk-uploads", label: "Bulk uploads", icon: "bulk" },
    ]},
    // Hidden rather than disabled for non-supers: both pages are super-only at the
    // API, so they'd be dead ends. "Import CSV" stays visible for everyone — it's
    // org-scoped now, not super-only.
    ...(actor?.isSuper
      ? [{ title: "Admin", items: [
          { href: "/admin/users", label: "Admins", icon: "admins" as IconName },
          { href: "/admin/settings", label: "Settings", icon: "settings" as IconName },
        ]}]
      : []),
  ];

  const initials = (actor?.email || "?")
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";

  return (
    <aside className="rail">
      <Link href="/admin" className="rail-brand" style={{ textDecoration: "none" }}>
        <span className="rail-logo"><Image src="/spark-logo.png" alt="" width={36} height={36} /></span>
        <span>
          <span className="wm">Spark<i>!</i></span>
          <span className="sub">Control</span>
        </span>
      </Link>

      <nav className="rail-nav">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="rail-grp">{g.title}</div>
            {g.items.map((it) => (
              <Link key={it.href} href={it.href} className={`rail-link${isActive(it.href, it.exact) ? " on" : ""}`}>
                <Icon name={it.icon} />
                <span>{it.label}</span>
                {it.badge != null && it.badge > 0 && <span className="rail-badge">{it.badge}</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="rail-foot">
        <span className="rail-ava">{initials}</span>
        <span className="who">
          {/* Team is shown permanently: what you can edit now depends on it, so
              "which hat am I wearing" must never be a guess. */}
          <span className="nm">
            {actor?.isSuper ? "Super admin" : orgLabel(actor?.org)}
          </span>
          <span className="em">{actor?.email || ""}</span>
        </span>
        <button className="out" title="Sign out" aria-label="Sign out" onClick={() => signOut({ callbackUrl: "/" })}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
