"use client";
// Admin-only import inbox. Every tracker row the PD-sync importer couldn't match
// to a catalog project lands here (see /api/import) so nothing is ever silently
// dropped — this screen IS the data-integrity guarantee. For each row the admin:
//   • Create  → seed a new unpublished project (then edit/publish it normally)
//   • Merge   → fold into an existing project + write a durable alias (the
//               tracker name auto-matches on the next sync, no code change)
//   • Dismiss → junk (header/contact cells)
//   • Undo    → restore a dismissed row back to pending
// Also shows saved DB aliases (admin-created via merge) with the ability to delete
// them, and an alias list with one-click remove.
// Rows carry team-role names (admin-only PII) — never shown publicly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InboxRow } from "@/lib/db";
import type { Project } from "@/lib/types";
import PageHeader from "@/components/admin/PageHeader";
import { useActor, orgLabel } from "@/components/admin/ActorContext";
import ConfirmModal from "@/components/admin/ConfirmModal";
import { useToast } from "@/components/admin/useToast";
import CopyButton from "@/components/admin/CopyButton";

const ALIAS_OPEN_KEY = "inbox.aliasPanelOpen";
const BLURB_CLIP = 180;

type ViewTab = "pending" | "dismissed";

interface AliasEntry {
  nameKey: string;
  projectId: string;
  createdAt: string;
}

export default function ImportInboxPage() {
  const actor = useActor();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [dismissedRows, setDismissedRows] = useState<InboxRow[]>([]);
  const [aliases, setAliases] = useState<AliasEntry[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  // Global busy guard: any single-row mutation in flight disables every row's actions.
  const [busy, setBusy] = useState<string | null>(null);
  const [busyAlias, setBusyAlias] = useState<string | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [viewTab, setViewTab] = useState<ViewTab>("pending");
  const [aliasOpen, setAliasOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedBlurbs, setExpandedBlurbs] = useState<Set<string>>(new Set());
  const router = useRouter();
  const { toastEl, notify } = useToast();

  // Any mutation (single-row, alias, or batch) blocks all other actions.
  const anyBusy = busy !== null || busyAlias !== null || batchBusy;

  // ── Persist alias panel open/collapsed state in localStorage ──
  useEffect(() => {
    try {
      setAliasOpen(localStorage.getItem(ALIAS_OPEN_KEY) === "1");
    } catch {}
  }, []);
  const toggleAlias = () =>
    setAliasOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(ALIAS_OPEN_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });

  const refresh = useCallback(async () => {
    const [rPending, rDismissed, rp] = await Promise.all([
      fetch("/api/inbox"),
      fetch("/api/inbox?status=dismissed"),
      fetch("/api/projects"),
    ]);
    if (rPending.ok) {
      const d = await rPending.json();
      setRows(d.rows ?? []);
      setAliases(d.aliases ?? []);
    }
    if (rDismissed.ok) {
      const d = await rDismissed.json();
      setDismissedRows(d.rows ?? []);
    }
    if (rp.ok) {
      const list: Project[] = (await rp.json()).projects ?? [];
      setProjects(
        list
          .map((p) => ({ id: p.id, title: p.title }))
          .sort((a, b) => a.title.localeCompare(b.title))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleBlurb = (id: string) =>
    setExpandedBlurbs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Search/filter (client-side) over the active tab's rows ──
  const matchesQuery = useCallback(
    (r: InboxRow) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [r.rawName, r.partner, r.course, r.term]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    },
    [query]
  );

  const pendingCount = rows.length;
  const dismissedCount = dismissedRows.length;
  const baseRows = viewTab === "pending" ? rows : dismissedRows;
  const activeRows = useMemo(
    () => baseRows.filter(matchesQuery),
    [baseRows, matchesQuery]
  );
  // Rows in the current tab that are selectable + currently visible (post-filter).
  const visibleIds = useMemo(() => activeRows.map((r) => r.id), [activeRows]);

  const batchCreate = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBatchBusy(true);
    const results = await Promise.all(
      ids.map((id) =>
        fetch("/api/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", id }),
        })
          .then((r) => ({ id, ok: r.ok }))
          .catch(() => ({ id, ok: false }))
      )
    );
    setBatchBusy(false);
    setSelectedIds(new Set());
    const failed = results.filter((r) => !r.ok).length;
    notify(
      failed ? "err" : "ok",
      failed
        ? `Created ${results.length - failed}/${results.length} drafts; ${failed} failed.`
        : `Created ${results.length} draft${results.length === 1 ? "" : "s"}.`
    );
    await refresh();
  };

  const doBatchDismiss = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setConfirmDismiss(false);
    setBatchBusy(true);
    // Track per-request success so we can surface partial failures instead of
    // swallowing them with .catch(()=>null) + an always-success toast.
    const results = await Promise.all(
      ids.map((id) =>
        fetch("/api/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dismiss", id }),
        })
          .then((r) => ({ id, ok: r.ok }))
          .catch(() => ({ id, ok: false }))
      )
    );
    setBatchBusy(false);
    setSelectedIds(new Set());
    const failed = results.filter((r) => !r.ok).length;
    notify(
      failed ? "err" : "ok",
      failed
        ? `Dismissed ${results.length - failed}/${results.length} rows; ${failed} failed.`
        : `Dismissed ${results.length} row${results.length === 1 ? "" : "s"}.`
    );
    await refresh();
  };

  const batchRestore = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBatchBusy(true);
    const results = await Promise.all(
      ids.map((id) =>
        fetch("/api/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore", id }),
        })
          .then((r) => ({ id, ok: r.ok }))
          .catch(() => ({ id, ok: false }))
      )
    );
    setBatchBusy(false);
    setSelectedIds(new Set());
    const failed = results.filter((r) => !r.ok).length;
    notify(
      failed ? "err" : "ok",
      failed
        ? `Restored ${results.length - failed}/${results.length} rows; ${failed} failed.`
        : `Restored ${results.length} row${results.length === 1 ? "" : "s"}.`
    );
    await refresh();
  };

  const act = async (id: string, action: string, projectId?: string) => {
    setBusy(id);
    const res = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, projectId }),
    });
    setBusy(null);
    if (res.ok) {
      const d = await res.json();
      // Creating a draft from a row → jump straight into editing the new draft
      // (it's bare and needs filling/publishing). Other actions just refresh.
      if (action === "create" && d.projectId) {
        notify("ok", `Created draft ${d.projectId} — opening…`);
        router.push(`/admin/edit/${d.projectId}`);
        return;
      }
      notify(
        "ok",
        action === "merge"
          ? `Merged into ${d.projectId}; alias saved.`
          : action === "restore"
            ? "Restored to pending."
            : "Dismissed."
      );
      await refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      notify("err", d.error || "Action failed.");
    }
  };

  const removeAliasAct = async (nameKey: string) => {
    setBusyAlias(nameKey);
    const res = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove-alias", nameKey }),
    });
    setBusyAlias(null);
    if (res.ok) {
      notify("ok", `Alias "${nameKey}" removed.`);
      await refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      notify("err", d.error || "Remove failed.");
    }
  };

  // Select-all checkbox: checked when every visible row is selected,
  // indeterminate when only some are.
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected =
    visibleIds.some((id) => selectedIds.has(id)) && !allVisibleSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected, viewTab, visibleIds.length]);

  const toggleSelectAll = (checked: boolean) =>
    setSelectedIds(checked ? new Set(visibleIds) : new Set());

  // Teal pill tag (PD✓ / blurb✓) — matches the handoff `.tagpill`.
  const tagPillStyle: React.CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: 10,
    fontWeight: 600,
    color: "var(--teal-deep)",
    background: "color-mix(in oklab,var(--teal) 10%,#fff)",
    border: "1px solid color-mix(in oklab,var(--teal) 24%,#fff)",
    borderRadius: 5,
    padding: "1px 6px",
  };

  return (
    <>
      {toastEl}

      <ConfirmModal
        open={confirmDismiss}
        title={`Dismiss ${selectedIds.size} row${selectedIds.size === 1 ? "" : "s"}?`}
        body="Dismissed rows move to the Dismissed tab. You can restore them from there."
        confirmLabel="Dismiss"
        danger
        onConfirm={doBatchDismiss}
        onCancel={() => setConfirmDismiss(false)}
      />

      <PageHeader eyebrow="Pipeline" title="Import inbox">
        <div className="search" style={{ width: 300 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4-4" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, partner, course…"
          />
        </div>
      </PageHeader>

      <div className="content">
        <p className="subcopy" style={{ marginBottom: 22 }}>
          Tracker rows the PD-sync importer couldn&apos;t match. <b>Create</b> a new
          project, <b>Merge</b> into an existing one (writes a durable alias that
          auto-matches next sync), or <b>Dismiss</b> as junk. When this list is empty,
          every tracker row is accounted for.
        </p>

        {/* ── View tabs: Pending / Dismissed ── */}
        <div className="tabs" style={{ marginBottom: 18 }}>
          {(["pending", "dismissed"] as ViewTab[]).map((tab) => (
            <button
              key={tab}
              className={`tab${viewTab === tab ? " on" : ""}`}
              onClick={() => {
                setViewTab(tab);
                setSelectedIds(new Set());
              }}
              style={{ textTransform: "capitalize" }}
            >
              {tab}{" "}
              <span className="c">
                {loading ? "…" : tab === "pending" ? pendingCount : dismissedCount}
              </span>
            </button>
          ))}
          {query.trim() && !loading && (
            <span
              style={{
                marginLeft: 6,
                alignSelf: "center",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--ink-4)",
              }}
            >
              {activeRows.length} of {baseRows.length} match
            </span>
          )}
        </div>

        {/* ── Batch action bar (when rows selected) ── */}
        {selectedIds.size > 0 && (
          <div
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 16px",
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--ink-3)",
                flexShrink: 0,
              }}
            >
              {selectedIds.size} selected
            </span>

            {viewTab === "pending" ? (
              <>
                <button
                  className="btn-sm teal"
                  onClick={batchCreate}
                  disabled={anyBusy}
                  style={{ cursor: anyBusy ? "not-allowed" : "pointer" }}
                >
                  {batchBusy
                    ? "Working…"
                    : `Create ${selectedIds.size} as draft${selectedIds.size === 1 ? "" : "s"}`}
                </button>
                <button
                  onClick={() => setConfirmDismiss(true)}
                  disabled={anyBusy}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    color: "var(--rose)",
                    background: "none",
                    border: "none",
                    cursor: anyBusy ? "not-allowed" : "pointer",
                    padding: "6px 9px",
                    borderRadius: 7,
                  }}
                >
                  Dismiss {selectedIds.size}
                </button>
              </>
            ) : (
              <button
                className="btn-sm"
                onClick={batchRestore}
                disabled={anyBusy}
                style={{
                  cursor: anyBusy ? "not-allowed" : "pointer",
                  color: "var(--teal-deep)",
                  borderColor: "var(--teal)",
                }}
              >
                {batchBusy ? "Working…" : `Restore ${selectedIds.size}`}
              </button>
            )}

            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={anyBusy}
              style={{
                marginLeft: "auto",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-4)",
                background: "none",
                border: "none",
                cursor: anyBusy ? "not-allowed" : "pointer",
                padding: "4px 6px",
              }}
            >
              Clear
            </button>
          </div>
        )}

        {/* ── Row list ── */}
        <div className="card listcard">
          {/* Select-all header (both tabs) */}
          {!loading && activeRows.length > 0 && (
            <div
              style={{
                padding: "11px 22px",
                borderBottom: "1px solid var(--line-2)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(e) => toggleSelectAll(e.target.checked)}
                disabled={anyBusy}
                style={{ cursor: anyBusy ? "not-allowed" : "pointer" }}
              />
              <span
                style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-4)" }}
              >
                Select all{query.trim() ? " (filtered)" : ""}
              </span>
            </div>
          )}
          {loading ? (
            <div className="empty">Loading…</div>
          ) : activeRows.length === 0 ? (
            query.trim() ? (
              <div className="empty">No rows match “{query.trim()}”.</div>
            ) : viewTab === "pending" ? (
              /* Celebratory empty state */
              <div style={{ textAlign: "center", padding: "56px 30px 60px" }}>
                <div style={{ fontSize: 40 }}>🎉</div>
                <h3
                  style={{
                    fontFamily: "var(--display)",
                    fontSize: 20,
                    margin: "14px 0 8px",
                    color: "var(--ink)",
                  }}
                >
                  Inbox empty
                </h3>
                <p
                  style={{
                    fontSize: 13.5,
                    color: "var(--ink-3)",
                    maxWidth: 380,
                    margin: "0 auto",
                    lineHeight: 1.5,
                  }}
                >
                  Every tracker row matched a project. Nothing to triage right now.
                </p>
              </div>
            ) : (
              /* Dismissed: styled empty-state card (mirrors Pending) */
              <div style={{ textAlign: "center", padding: "56px 30px 60px" }}>
                <div style={{ fontSize: 40 }}>🗂️</div>
                <h3
                  style={{
                    fontFamily: "var(--display)",
                    fontSize: 20,
                    margin: "14px 0 8px",
                    color: "var(--ink)",
                  }}
                >
                  No dismissed rows
                </h3>
                <p
                  style={{
                    fontSize: 13.5,
                    color: "var(--ink-3)",
                    maxWidth: 380,
                    margin: "0 auto",
                    lineHeight: 1.5,
                  }}
                >
                  Rows you dismiss from Pending will collect here and can be restored.
                </p>
              </div>
            )
          ) : (
            activeRows.map((r) => {
              const metaParts = [r.partner, r.course, r.term].filter(Boolean);
              const blurbExpanded = expandedBlurbs.has(r.id);
              const longBlurb = !!r.blurb && r.blurb.length > BLURB_CLIP;
              const hot = r.seenCount >= 3;
              return (
                <div
                  key={r.id}
                  style={{
                    padding: "17px 22px",
                    borderTop: "1px solid var(--line-2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 11,
                    background: hot ? "#fffbe9" : undefined,
                  }}
                >
                  {/* ── Row header: checkbox + name + meta ── */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      disabled={anyBusy}
                      style={{
                        cursor: anyBusy ? "not-allowed" : "pointer",
                        flexShrink: 0,
                        alignSelf: "center",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--display)",
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      {r.rawName}
                      {/* Only meaningful for supers — a scoped admin's list is
                          already filtered to one team server-side, so the badge
                          would be the same on every row. */}
                      {actor?.isSuper && (
                        <span
                          title={`From the ${orgLabel(r.org)} tracker`}
                          style={{
                            marginLeft: 8,
                            fontFamily: "var(--mono)",
                            fontSize: 10,
                            color: "var(--ink-3)",
                            border: "1px solid var(--line)",
                            borderRadius: 5,
                            padding: "1px 6px",
                          }}
                        >
                          {orgLabel(r.org)}
                        </span>
                      )}
                    </span>
                    {/* Meta row: partner · course · term · seen N× */}
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--ink-4)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {metaParts.map((part, i) => (
                        <span key={i}>
                          {i > 0 && (
                            <span style={{ color: "#cfd6d1", marginRight: 8 }}>·</span>
                          )}
                          {part}
                        </span>
                      ))}
                      {metaParts.length === 0 && <span>—</span>}
                      {r.seenCount > 1 && (
                        <>
                          <span style={{ color: "#cfd6d1" }}>·</span>
                          <span
                            title="How many distinct PD-syncs have surfaced this same unmatched row. A high count means the tracker keeps re-sending it — triage it soon."
                            style={
                              hot
                                ? {
                                    color: "var(--amber)",
                                    fontWeight: 600,
                                    cursor: "help",
                                    borderBottom: "1px dotted var(--amber)",
                                  }
                                : {
                                    cursor: "help",
                                    borderBottom: "1px dotted #cfd6d1",
                                  }
                            }
                          >
                            seen {r.seenCount}×
                          </span>
                        </>
                      )}
                      {r.pdUrl && <span style={tagPillStyle}>PD✓</span>}
                      {r.blurb && <span style={tagPillStyle}>blurb✓</span>}
                    </span>
                  </div>

                  {/* ── Blurb preview with show more/less ── */}
                  {r.blurb && (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                        lineHeight: 1.45,
                      }}
                    >
                      {blurbExpanded || !longBlurb
                        ? r.blurb
                        : `${r.blurb.slice(0, BLURB_CLIP)}…`}
                      {longBlurb && (
                        <button
                          onClick={() => toggleBlurb(r.id)}
                          style={{
                            marginLeft: 6,
                            fontFamily: "var(--mono)",
                            fontSize: 11.5,
                            color: "var(--teal-deep)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          {blurbExpanded ? "show less" : "show more"}
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── Actions ── */}
                  {viewTab === "dismissed" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        className="btn-sm"
                        onClick={() => act(r.id, "restore")}
                        disabled={anyBusy}
                        style={{
                          cursor: anyBusy ? "not-allowed" : "pointer",
                          color: "var(--teal-deep)",
                          borderColor: "var(--teal)",
                        }}
                      >
                        Undo
                      </button>
                    </div>
                  ) : (
                    /* Pending: Create / merge-combobox + Merge / Dismiss */
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        className="btn-sm teal"
                        onClick={() => act(r.id, "create")}
                        disabled={anyBusy}
                        style={{ cursor: anyBusy ? "not-allowed" : "pointer" }}
                      >
                        Create project
                      </button>

                      <span style={{ fontSize: 12, color: "var(--ink-4)" }}>or</span>

                      {/* Typeahead combobox: type a title, the datalist filters. The
                          underlying value persists as the project id once a full
                          "Title (id)" option is matched. */}
                      <input
                        list={`projlist-${r.id}`}
                        className="fld"
                        placeholder="merge into existing…"
                        value={target[r.id] ?? ""}
                        onChange={(e) =>
                          setTarget((m) => ({ ...m, [r.id]: e.target.value }))
                        }
                        disabled={anyBusy}
                        style={{
                          maxWidth: 300,
                          fontSize: 12.5,
                          padding: "7px 10px",
                          width: "auto",
                        }}
                      />
                      <datalist id={`projlist-${r.id}`}>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title} ({p.id})
                          </option>
                        ))}
                      </datalist>

                      <button
                        className="btn-sm"
                        onClick={() => act(r.id, "merge", target[r.id])}
                        disabled={anyBusy || !target[r.id]}
                        style={{
                          cursor: anyBusy || !target[r.id] ? "not-allowed" : "pointer",
                          opacity: !target[r.id] ? 0.55 : 1,
                        }}
                      >
                        Merge
                      </button>

                      <button
                        onClick={() => act(r.id, "dismiss")}
                        disabled={anyBusy}
                        style={{
                          marginLeft: "auto",
                          fontFamily: "var(--mono)",
                          fontSize: 11.5,
                          color: "var(--rose)",
                          background: "none",
                          border: "none",
                          cursor: anyBusy ? "not-allowed" : "pointer",
                          padding: "6px 9px",
                          borderRadius: 7,
                          transition: "background .12s",
                        }}
                        onMouseEnter={(e) =>
                          ((e.currentTarget as HTMLButtonElement).style.background =
                            "var(--rose-bg)")
                        }
                        onMouseLeave={(e) =>
                          ((e.currentTarget as HTMLButtonElement).style.background =
                            "none")
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── Saved aliases panel ── */}
        <div style={{ marginTop: 34 }}>
          <button
            className="aliastog"
            onClick={toggleAlias}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 13,
              color: "var(--ink-3)",
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: 0,
            }}
          >
            <span style={{ fontSize: 11, lineHeight: 1 }}>{aliasOpen ? "▾" : "▸"}</span>
            Saved aliases ({aliases.length})
            <span style={{ color: "var(--ink-4)" }}>
              — tracker names auto-matched on next sync
            </span>
          </button>

          {aliasOpen && (
            <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
              <div
                style={{
                  padding: "11px 18px 0",
                  fontSize: 12,
                  color: "var(--ink-4)",
                  lineHeight: 1.5,
                }}
              >
                Tracker-name → project-ID mappings saved via Merge. Removing one makes
                that name reappear in the inbox on the next sync.
              </div>
              {aliases.length === 0 ? (
                <div style={{ padding: "14px 18px", fontSize: 13.5, color: "var(--ink-4)" }}>
                  No saved aliases yet.
                </div>
              ) : (
                aliases.map((a) => (
                  <div
                    key={a.nameKey}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "11px 18px",
                      borderTop: "1px solid var(--line-2)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 12.5,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ color: "var(--ink-3)" }}>{a.nameKey}</span>
                      <CopyButton value={a.nameKey} title="Copy name key" />
                      <span style={{ color: "var(--ink-4)" }}>→</span>
                      <Link
                        href={`/admin/edit/${a.projectId}`}
                        style={{ color: "var(--ink)", fontWeight: 600 }}
                      >
                        {a.projectId}
                      </Link>
                      <CopyButton value={a.projectId} title="Copy project ID" />
                    </span>
                    <button
                      className="tlink"
                      onClick={() => removeAliasAct(a.nameKey)}
                      disabled={busyAlias === a.nameKey || anyBusy}
                      style={{
                        color: "var(--rose)",
                        cursor:
                          busyAlias === a.nameKey || anyBusy ? "not-allowed" : "pointer",
                        flexShrink: 0,
                      }}
                    >
                      remove
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
