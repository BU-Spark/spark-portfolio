"use client";
// Escalation queue — one page for everything waiting on a person, oldest first.
//
// Consolidates what was previously spread across /admin/inbox (tracker rows),
// /admin/uploads (screenshot approvals) and the drafts tab of /admin/projects. Each
// row still ACTS on its own page; this is the "what needs me today" view, so it
// links out rather than duplicating the triage UI.
//
// Ordering is oldest-first everywhere and never by kind, because the whole point is
// to surface the thing that's been ignored longest — a 60-day-old draft outranks a
// screenshot set that arrived this morning.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import { useActor, orgLabel } from "@/components/admin/ActorContext";
import type { ApprovalKind } from "@/lib/db";

interface ApprovalItem {
  kind: ApprovalKind;
  ref: string;
  title: string;
  detail: string;
  org: string;
  waitingSince: string;
}

// Presentation per source. `href` is where the work actually gets done.
const KINDS: Record<
  ApprovalKind,
  { label: string; href: (ref: string) => string; cta: string }
> = {
  screenshots: {
    label: "Screenshots to review",
    href: () => "/admin/uploads",
    cta: "Review",
  },
  nudge: {
    label: "Waiting on a PM",
    href: () => "/admin/bulk-uploads",
    cta: "Chase",
  },
  inbox: {
    label: "Tracker rows to triage",
    href: () => "/admin/inbox",
    cta: "Triage",
  },
  draft: {
    label: "Drafts not yet published",
    href: (ref) => `/admin/edit/${encodeURIComponent(ref)}`,
    cta: "Open",
  },
};

// Whole days waited. Floor, not round: "1 day" should not appear after 13 hours.
function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function ageLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export default function ApprovalsPage() {
  const actor = useActor();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [backlog, setBacklog] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [kindFilter, setKindFilter] = useState<ApprovalKind | "all">("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const d = await res.json();
      setItems(d.items ?? []);
      setBacklog(d.backlog ?? {});
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.kind] = (c[it.kind] ?? 0) + 1;
    return c;
  }, [items]);

  // A draft with nothing blocking it is one click from done, so it's worth calling
  // out separately from the drafts that need someone to go find a description.
  const readyToPublish = useMemo(
    () => items.filter((i) => i.kind === "draft" && i.detail.startsWith("Ready")).length,
    [items]
  );

  const visible = useMemo(
    () => (kindFilter === "all" ? items : items.filter((i) => i.kind === kindFilter)),
    [items, kindFilter]
  );

  const oldest = items.length ? daysSince(items[0].waitingSince) : 0;

  return (
    <>
      <PageHeader eyebrow="Pipeline" title="Approvals" />

      <div className="content" style={{ maxWidth: 920 }}>
        <p className="subcopy" style={{ marginBottom: 18 }}>
          {actor?.isSuper
            ? "Everything waiting on a person, across all teams, oldest first."
            : `Everything waiting on the ${orgLabel(actor?.org)} team, oldest first.`}
        </p>

      {/* ── Summary strip ── */}
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        {loading ? (
          <div className="sk" style={{ height: 14, width: "45%" }} />
        ) : items.length === 0 ? (
          <div style={{ fontSize: 14.5, color: "var(--sec)" }}>
            Nothing is waiting on anyone right now.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", alignItems: "baseline" }}>
            <strong style={{ fontFamily: "var(--display)", fontSize: 18 }}>
              {items.length} item{items.length === 1 ? "" : "s"} waiting
            </strong>
            {readyToPublish > 0 && (
              <span className="badge b-grn">{readyToPublish} ready to publish now</span>
            )}
            <span className="meta">oldest has waited {ageLabel(oldest)}</span>
          </div>
        )}
      </div>

      {/* ── Kind filter ── */}
      {!loading && items.length > 0 && (
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button
            className={`tab${kindFilter === "all" ? " on" : ""}`}
            onClick={() => setKindFilter("all")}
          >
            All ({items.length})
          </button>
          {(Object.keys(KINDS) as ApprovalKind[])
            .filter((k) => (counts[k] ?? 0) > 0)
            .map((k) => (
              <button
                key={k}
                className={`tab${kindFilter === k ? " on" : ""}`}
                onClick={() => setKindFilter(k)}
              >
                {KINDS[k].label} ({counts[k]})
              </button>
            ))}
        </div>
      )}

      {/* ── The queue ── */}
      <div className="card listcard">
        {loading ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="lrow" style={{ cursor: "default" }}>
              <div style={{ flex: 1 }}>
                <div className="sk" style={{ height: 14, width: "55%" }} />
                <div className="sk" style={{ height: 10, width: "35%", marginTop: 8 }} />
              </div>
              <div className="sk" style={{ height: 12, width: 60 }} />
            </div>
          ))
        ) : loadError ? (
          <div className="empty">
            Couldn&rsquo;t load the queue.{" "}
            <button className="tlink" onClick={() => { setLoadError(false); setLoading(true); load(); }}>
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {items.length === 0
              ? "Nothing waiting — no approvals, no triage, no unpublished drafts."
              : "Nothing in this category."}
          </div>
        ) : (
          visible.map((it) => {
            const k = KINDS[it.kind];
            const days = daysSince(it.waitingSince);
            const ready = it.kind === "draft" && it.detail.startsWith("Ready");
            return (
              <div key={`${it.kind}:${it.ref}`} className="lrow" style={{ cursor: "default" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ttl">
                    {it.title}
                    {/* Team chip only for supers — for everyone else every row is
                        their own team, so the chip would be noise on every line. */}
                    {actor?.isSuper && <span className="chip">{orgLabel(it.org)}</span>}
                  </div>
                  <div className="meta">
                    {k.label} · {it.detail}
                  </div>
                </div>

                {ready && <span className="badge b-grn">ready</span>}

                {/* Age is the whole point of the page, so it gets its own column and
                    goes amber past a fortnight rather than being buried in meta. */}
                <span
                  className={`badge ${days >= 14 ? "b-amber" : "b-draft"}`}
                  title={`Waiting since ${new Date(it.waitingSince).toLocaleDateString()}`}
                >
                  {ageLabel(days)}
                </span>

                <Link href={k.href(it.ref)} className="btn btn-sm" style={{ textDecoration: "none" }}>
                  {k.cta}
                </Link>
              </div>
            );
          })
        )}
      </div>

      {/* ── Standing backlog ──
          Deliberately below the queue and visually quieter. These are conditions,
          not queued work: nothing is "waiting" on a missing tech stack, and today
          100% of the catalog has no images — so promoting these would bury the rows
          somebody can actually clear. */}
      <h2 className="sec-title" style={{ marginTop: 22 }}>
        Data gaps
      </h2>
      <p className="subcopy" style={{ marginTop: 0 }}>
        Standing counts, not a queue. Use the gap filters on{" "}
        <Link href="/admin/projects" style={{ color: "var(--teal-deep)" }}>
          Projects
        </Link>{" "}
        to work through them.
      </p>
      <div className="card card-pad">
        {loading ? (
          <div className="sk" style={{ height: 14, width: "60%" }} />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px" }}>
            {Object.entries(backlog)
              .sort((a, b) => b[1] - a[1])
              .map(([label, n]) => (
                <Link
                  key={label}
                  href={`/admin/projects?gap=${encodeURIComponent(label)}`}
                  className="kv"
                  style={{ textDecoration: "none", display: "flex", gap: 7, alignItems: "baseline" }}
                >
                  <span className="v" style={{ fontFamily: "var(--display)", fontWeight: 700 }}>
                    {n}
                  </span>
                  <span className="k">no {label.toLowerCase()}</span>
                </Link>
              ))}
          </div>
        )}
        </div>
      </div>
    </>
  );
}
