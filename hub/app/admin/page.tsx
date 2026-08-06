"use client";
// Admin dashboard — the landing page for /admin. The hero is a six-segment
// circular "process wheel" (recreated from the Claude Design handoff) with the
// BU Spark! logo at its center; each wedge + numbered callout links to an admin
// section and shows a live count where we have one. Below the wheel, a compact
// "Needs attention" list surfaces projects missing info. /admin/* is gated, so
// the project list is safe to fetch client-side. Shared shell (topbar + nav +
// bg) comes from app/admin/layout.tsx.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { primaryDiscipline, latestTerm, missingInfo } from "@/lib/project";
import { useActor, canEditHere } from "@/components/admin/ActorContext";
import type { Project } from "@/lib/types";
import DashboardWheel, { type WheelSegment } from "@/components/admin/DashboardWheel";

const ACCENT = "#0fa392";
const PROJECTS_CACHE_KEY = "spark:admin:projects:v1";

// Every admin destination — rendered as a flat, always-visible grid on the
// dashboard so nothing (e.g. "Manage admins") is buried only inside a dropdown.
// `superOnly` entries are filtered out for scoped admins, matching AdminRail:
// /admin/settings and /admin/users are requireSuper at the API, so leaving them
// linked here would hand a CDS or Spark admin a pair of guaranteed dead ends.
const ALL_SECTIONS: { label: string; href: string; desc: string; superOnly?: boolean }[] = [
  { label: "Projects", href: "/admin/projects", desc: "Browse & edit the catalog" },
  { label: "People", href: "/admin/people", desc: "Directory & per-semester roles" },
  { label: "Approvals", href: "/admin/approvals", desc: "Everything waiting on you" },
  { label: "Inbox", href: "/admin/inbox", desc: "Triage imported rows" },
  { label: "Media", href: "/admin/uploads", desc: "Review image uploads" },
  { label: "Bulk uploads", href: "/admin/bulk-uploads", desc: "Outreach upload links" },
  { label: "Import CSV", href: "/admin/import", desc: "Bulk data import" },
  { label: "Settings", href: "/admin/settings", desc: "Taxonomy & facets", superOnly: true },
  { label: "Manage admins", href: "/admin/users", desc: "Add or remove admins", superOnly: true },
];

export default function AdminDashboardPage() {
  const actor = useActor();
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [focusedRow, setFocusedRow] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(false);
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setTotal(data.total ?? 0);
      setProjects(data.projects ?? []);
      try {
        sessionStorage.setItem(
          PROJECTS_CACHE_KEY,
          JSON.stringify({ total: data.total, projects: data.projects ?? [] })
        );
      } catch {}
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  const refreshCounts = useCallback(async () => {
    await Promise.allSettled([
      fetch("/api/inbox")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.count != null) setInboxCount(d.count);
        })
        .catch(() => {}),
      fetch("/api/upload-requests?status=submitted")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPendingUploads(d?.requests?.length ?? 0))
        .catch(() => {}),
      fetch("/api/people")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPeopleCount(d?.people?.length ?? 0))
        .catch(() => {}),
    ]);
  }, []);

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(PROJECTS_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        setTotal(data.total ?? 0);
        setProjects(data.projects ?? []);
        setLoading(false);
      }
    } catch {}
    refresh();
    refreshCounts();
  }, [refresh, refreshCounts]);

  // --- stats derived client-side from the admin project list ----------------
  // Own-team only, unlike /admin/projects. This is a WORK QUEUE: a to-do list full
  // of items you're not allowed to fix is worse than no list. Cross-team visibility
  // belongs on the projects page, where the point is noticing mis-filed records.
  const needsInfo = projects.filter(
    (p) => missingInfo(p).length > 0 && canEditHere(actor, p.ownerOrg ?? "spark")
  );
  const attention = needsInfo.slice(0, 5);

  // ── the six wheel segments (colors + wedge lengths from the handoff spec) ──
  const segments: WheelSegment[] = [
    {
      key: "projects", title: "Projects", href: "/admin/projects",
      count: total, descriptor: "Total projects", solidR: 124,
      from: "oklch(0.72 0.13 165)", to: "oklch(0.52 0.13 165)",
      icon: (<>
        <rect x={-9} y={-9} width={7.5} height={7.5} rx={1} />
        <rect x={1.5} y={-9} width={7.5} height={7.5} rx={1} />
        <rect x={-9} y={1.5} width={7.5} height={7.5} rx={1} />
        <rect x={1.5} y={1.5} width={7.5} height={7.5} rx={1} />
      </>),
    },
    {
      key: "people", title: "People", href: "/admin/people",
      count: peopleCount, descriptor: "In directory", solidR: 141,
      from: "oklch(0.70 0.13 255)", to: "oklch(0.50 0.14 255)",
      icon: (<>
        <circle cx={0} cy={-5} r={3.2} />
        <path d="M-6 7 a6 6 0 0 1 12 0" />
        <circle cx={-9} cy={-2} r={2.4} />
        <circle cx={9} cy={-2} r={2.4} />
        <path d="M-13 8 a4.5 4.5 0 0 1 4 -4" />
        <path d="M13 8 a4.5 4.5 0 0 0 -4 -4" />
      </>),
    },
    {
      key: "inbox", title: "Inbox", href: "/admin/inbox",
      count: inboxCount, descriptor: "Pending triage", solidR: 130,
      from: "oklch(0.73 0.12 205)", to: "oklch(0.53 0.13 205)",
      icon: (<>
        <path d="M-10 -7 H10 V7 H-10 Z" />
        <path d="M-10 1 H-4 L-2 4 H2 L4 1 H10" />
      </>),
    },
    {
      key: "uploads", title: "Uploads", href: "/admin/uploads",
      count: pendingUploads, descriptor: "Awaiting review", solidR: 143,
      from: "oklch(0.68 0.15 305)", to: "oklch(0.48 0.16 305)",
      icon: (<>
        <rect x={-10} y={-8} width={20} height={16} rx={2} />
        <circle cx={-4} cy={-2} r={2.2} />
        <path d="M-10 6 L-3 -1 L10 8" />
      </>),
    },
    {
      key: "bulk", title: "Bulk uploads", href: "/admin/bulk-uploads",
      count: null, descriptor: "Outreach links", solidR: 130,
      from: "oklch(0.70 0.15 25)", to: "oklch(0.52 0.16 25)",
      icon: (<>
        <path d="M-2 2 a4.5 4.5 0 0 0 6.4 0 l3 -3 a4.5 4.5 0 0 0 -6.4 -6.4 l-1.6 1.6" />
        <path d="M2 -2 a4.5 4.5 0 0 0 -6.4 0 l-3 3 a4.5 4.5 0 0 0 6.4 6.4 l1.6 -1.6" />
      </>),
    },
    {
      key: "settings", title: "Settings", href: "/admin/settings",
      count: null, descriptor: "Taxonomy & facets", solidR: 140,
      from: "oklch(0.78 0.14 75)", to: "oklch(0.60 0.15 75)",
      icon: (<>
        <circle cx={0} cy={0} r={4} />
        <path d="M0 -10 V-6 M0 6 V10 M-10 0 H-6 M6 0 H10 M-7 -7 L-4.2 -4.2 M7 7 L4.2 4.2 M-7 7 L-4.2 4.2 M7 -7 L4.2 -4.2" />
      </>),
    },
  ].filter((s) => s.key !== "settings" || actor?.isSuper);

  return (
    <div className="wrap">
      {/* ── Title row ── */}
      <div className="titlerow">
        <div>
          <div className="page-eyebrow">Overview</div>
          <h1 className="page">Dashboard</h1>
          <p className="subcopy">
            An overview of the Spark! project gallery. Pick a section from the
            wheel — everything you publish here is saved to the shared live
            database and visible to every visitor immediately.
          </p>
        </div>
        <Link href="/admin/new" className="btn btn-dark" style={{ textDecoration: "none", flexShrink: 0 }}>
          <span className="plus">+</span> Add a project
        </Link>
      </div>

      {loadError && (
        <div
          className="card"
          style={{
            marginBottom: 22, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
            flexWrap: "wrap", borderColor: "var(--amber-line)", background: "var(--amber-bg)",
          }}
        >
          <div style={{ flex: 1, minWidth: 200, color: "var(--amber-ink)", fontSize: 13.5 }}>
            Couldn&apos;t load catalog stats — counts may be stale.
          </div>
          <button type="button" onClick={() => { refresh(); refreshCounts(); }} className="btn btn-dark" style={{ flexShrink: 0 }}>
            Retry
          </button>
        </div>
      )}

      {/* ── All sections (every admin page is reachable from here) ── */}
      <section className="card" style={{ overflow: "hidden", marginBottom: 8 }}>
        <div style={{ padding: "16px 22px 13px", borderBottom: "1px solid var(--rowsep)", fontFamily: "var(--display)", fontWeight: 700, fontSize: 16 }}>
          All sections
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1, background: "var(--rowsep)" }}>
          {ALL_SECTIONS.filter((s) => !s.superOnly || actor?.isSuper).map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="spark-row"
              style={{ display: "block", padding: "14px 20px", background: "#fff", textDecoration: "none" }}
            >
              <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 14.5, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                {s.label}
                <span style={{ color: ACCENT, fontFamily: "var(--mono)", fontSize: 11.5 }}>→</span>
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", marginTop: 5 }}>{s.desc}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Wheel hero — no card; breaks out of the 1080px column and scales up 1.5×.
          Negative margins crop the wheel's large transparent top/bottom dead space. ── */}
      <div style={{ width: "min(1540px, 94vw)", marginLeft: "50%", transform: "translateX(-50%)", marginTop: "clamp(-90px, -5vw, -20px)", marginBottom: "clamp(-80px, -4.5vw, -16px)", pointerEvents: "none" }}>
        <DashboardWheel segments={segments} loading={loading} />
      </div>

      {/* ── Needs attention ── */}
      <section className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 22px 13px", borderBottom: "1px solid var(--rowsep)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 10 }}>
            Needs attention
            {!loading && needsInfo.length > 0 && <span className="countpill">{needsInfo.length}</span>}
          </div>
          <Link href="/admin/projects?tab=needsInfo" style={{ fontFamily: "var(--mono)", fontSize: 12, color: ACCENT, textDecoration: "none" }}>
            Manage all →
          </Link>
        </div>

        {loading ? (
          [58, 64, 50, 70, 54].map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 22px", borderBottom: "1px solid var(--rowsep)" }}>
              <div className="sk" style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="sk" style={{ height: 13, width: `${w}%` }} />
                <div className="sk" style={{ height: 10, width: `${w - 18}%`, marginTop: 8 }} />
              </div>
              <div className="sk" style={{ height: 11, width: 34 }} />
            </div>
          ))
        ) : attention.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 30px 44px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px", display: "grid", placeItems: "center", background: `color-mix(in oklab, ${ACCENT} 14%, #fff)`, color: ACCENT, border: `1px solid color-mix(in oklab, ${ACCENT} 28%, #fff)` }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h3 style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 18, margin: "0 0 8px" }}>Everything&apos;s in order</h3>
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--sec)", maxWidth: 360, margin: "0 auto" }}>
              Every project has its description, tech stack, repo, and images. Nothing to fix right now.
            </p>
          </div>
        ) : (
          attention.map((p) => {
            const missing = missingInfo(p);
            const arrowVisible = hoveredRow === p.id || focusedRow === p.id;
            return (
              <Link
                key={p.id}
                href={`/admin/edit/${p.id}`}
                onMouseEnter={() => setHoveredRow(p.id)}
                onMouseLeave={() => setHoveredRow((cur) => (cur === p.id ? null : cur))}
                onFocus={() => setFocusedRow(p.id)}
                onBlur={() => setFocusedRow((cur) => (cur === p.id ? null : cur))}
                className="spark-row"
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", borderBottom: "1px solid var(--rowsep)", cursor: "pointer", textDecoration: "none", transition: "background .12s" }}
              >
                <span title={`Missing: ${missing.join(", ")}`} style={{ width: 9, height: 9, borderRadius: "50%", background: "#fbbf24", flexShrink: 0, boxShadow: "0 0 0 3px var(--amber-bg2)", display: "inline-block" }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", gap: 9 }}>
                    {p.title}
                    {p.published === false && <span className="badge badge-draft">Draft</span>}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", marginTop: 5 }}>
                    {primaryDiscipline(p)} · {latestTerm(p)} · <span style={{ color: "var(--amber-ink)" }}>missing {missing.join(", ").toLowerCase()}</span>
                  </div>
                </div>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: ACCENT, flexShrink: 0, opacity: arrowVisible ? 1 : 0, transform: arrowVisible ? "translateX(0)" : "translateX(-4px)", transition: "all .15s" }}>
                  Edit →
                </span>
              </Link>
            );
          })
        )}
      </section>
    </div>
  );
}
