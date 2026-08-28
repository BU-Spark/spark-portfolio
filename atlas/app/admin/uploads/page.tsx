"use client";
// Admin uploads hub — two tabs in one page (Spark Control redesign):
//   "Review uploads"  – the PM-submitted screenshot review queue (approve / reject)
//   "Bulk outreach"   – generate magic-upload links for projects missing screenshots
// Layout (app/admin/layout.tsx) renders the .spark-control shell + dark rail; this
// page renders only its content: <PageHeader> + a `.content` body. Active tab
// persists in ?tab=. VISUAL refresh only — every behavior/field/API call preserved.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keyToUrl } from "@/lib/imageClient";
import PageHeader from "@/components/admin/PageHeader";
import { useToast } from "@/components/admin/useToast";
import ConfirmModal from "@/components/admin/ConfirmModal";
import CopyButton from "@/components/admin/CopyButton";
import Lightbox from "@/components/admin/Lightbox";
import FilterBar from "@/components/admin/FilterBar";

const CAP = 4;

type Notify = (type: "ok" | "err", msg: string) => void;

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadTab = "review" | "bulk";

interface QueueItem {
  token: string;
  projectId: string;
  projectTitle?: string;
  recipient: string | null;
  images: string[];        // newly uploaded (pending) keys
  projectImages: string[]; // keys already on the project
  submittedAt: string | null;
}

type Candidate = {
  id: string;
  title: string;
  pm: string | null;
  pmEmail: string | null;
  openUrl: string | null;
  semester: string | null;
};

type GenResult = {
  id: string;
  url?: string;
  emailed: boolean;
  status: string;
  note?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Date + time, with a friendly relative age suffix.
function formatSubmitted(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const abs = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  let rel: string;
  if (mins < 1) rel = "just now";
  else if (mins < 60) rel = `${mins}m ago`;
  else if (mins < 1440) rel = `${Math.round(mins / 60)}h ago`;
  else rel = `${Math.round(mins / 1440)}d ago`;
  return `${abs} · ${rel}`;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconMail() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function IconZoom() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UploadsPage() {
  return (
    <Suspense fallback={null}>
      <UploadsPageInner />
    </Suspense>
  );
}

function UploadsPageInner() {
  const { toastEl, notify } = useToast();
  const router = useRouter();
  const sp = useSearchParams();

  const tab: UploadTab = sp.get("tab") === "bulk" ? "bulk" : "review";
  const setTab = (t: UploadTab) => {
    const params = new URLSearchParams(sp.toString());
    if (t === "review") params.delete("tab");
    else params.set("tab", t);
    const qs = params.toString();
    router.replace(qs ? `/admin/uploads?${qs}` : "/admin/uploads", { scroll: false });
  };

  const [reviewCount, setReviewCount] = useState<number | null>(null);

  return (
    <>
      {toastEl}

      <PageHeader eyebrow="Pipeline" title="Uploads">
        {reviewCount != null && reviewCount > 0 && (
          <span className="badge b-teal" style={{ fontSize: 11 }}>
            {reviewCount} pending
          </span>
        )}
      </PageHeader>

      <div className="content" style={{ maxWidth: 920 }}>
        <p className="subcopy" style={{ marginTop: 0, marginBottom: 22 }}>
          Review screenshots submitted by project teams, or generate outreach links for
          projects that still need them.
        </p>

        {/* ── Tabs (segmented) ── */}
        <div className="tabs" style={{ marginBottom: 24 }}>
          {([
            { key: "review" as UploadTab, label: "Review uploads", count: reviewCount },
            { key: "bulk" as UploadTab, label: "Bulk outreach", count: null },
          ]).map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              className={`tab${tab === key ? " on" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
              {key === "review" && count != null && count > 0 && (
                <span className="c"> {count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab panels ── (both mounted so the review count stays fresh) */}
        <div style={{ display: tab === "review" ? "block" : "none" }}>
          <ReviewPanel notify={notify} onCount={setReviewCount} />
        </div>
        <div style={{ display: tab === "bulk" ? "block" : "none" }}>
          <BulkPanel notify={notify} />
        </div>
      </div>

      {/* Shake keyframe — feedback animation for over-cap selection. Guarded under
          prefers-reduced-motion so it stays still when the user opts out. */}
      <style>{`
        @keyframes _shake {
          0%,100% { transform: translateX(0); }
          25%      { transform: translateX(-4px); }
          75%      { transform: translateX(4px); }
        }
        .spark-control ._shake { animation: _shake 0.32s ease; }
        @media (prefers-reduced-motion: reduce) {
          .spark-control ._shake { animation: none; }
        }
      `}</style>
    </>
  );
}

// ── Review panel ──────────────────────────────────────────────────────────────

function ReviewPanel({
  notify,
  onCount,
}: {
  notify: Notify;
  onCount: (n: number | null) => void;
}) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [shaking, setShaking] = useState<Record<string, string | null>>({});
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  // Reject flow: which card has its note box open + the draft note.
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // Approve-all confirm.
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/upload-requests?status=submitted");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const { requests } = (await res.json()) as { requests: QueueItem[] };
      setItems(requests);
      onCount(requests.length);
      const init: Record<string, Set<string>> = {};
      for (const r of requests) {
        const union = [...(r.projectImages ?? []), ...(r.images ?? [])];
        init[r.token] = new Set(union.slice(0, CAP));
      }
      setSelected(init);
    } catch (e) {
      setItems(null);
      setLoadError(e instanceof Error ? e.message : "Could not load the review queue.");
      onCount(null);
    }
  }, [onCount]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (token: string, key: string) =>
    setSelected((prev) => {
      const next = new Set(prev[token] ?? []);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < CAP) {
        next.add(key);
      } else {
        setShaking((s) => ({ ...s, [token]: key }));
        setTimeout(() => setShaking((s) => ({ ...s, [token]: null })), 320);
        notify("err", `Deselect one image first — max ${CAP}.`);
      }
      return { ...prev, [token]: next };
    });

  // Select all (capped) / deselect all for one card's images.
  const selectAll = (r: QueueItem) => {
    const union = [...(r.projectImages ?? []), ...(r.images ?? [])];
    if (union.length > CAP) notify("err", `Selected the first ${CAP} — that's the max.`);
    setSelected((prev) => ({ ...prev, [r.token]: new Set(union.slice(0, CAP)) }));
  };
  const deselectAll = (token: string) =>
    setSelected((prev) => ({ ...prev, [token]: new Set<string>() }));

  // Approve one token with the given image set. Returns true on success.
  const approveOne = async (token: string, images: string[]): Promise<boolean> => {
    const res = await fetch(`/api/upload-requests/${token}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "" }));
      throw new Error(error || "Could not approve.");
    }
    return true;
  };

  const approve = async (token: string) => {
    setBusy(token);
    try {
      await approveOne(token, [...(selected[token] ?? [])]);
      notify("ok", "Approved — screenshots are live.");
      await load();
    } catch (e) {
      notify("err", e instanceof Error ? e.message : "Could not approve.");
    } finally {
      setBusy(null);
    }
  };

  // Approve every pending card that has a non-empty selection, using each card's
  // current selection. Surfaces partial failures.
  const approveAll = async () => {
    if (!items) return;
    const targets = items.filter((r) => (selected[r.token]?.size ?? 0) > 0);
    if (!targets.length) {
      notify("err", "No cards have a selected image to approve.");
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of targets) {
      try {
        await approveOne(r.token, [...(selected[r.token] ?? [])]);
        ok++;
      } catch (e) {
        failed.push(`${r.projectTitle ?? r.projectId}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setBulkBusy(false);
    if (failed.length) {
      notify("err", `Approved ${ok}; ${failed.length} failed — ${failed[0]}`);
    } else {
      notify("ok", `Approved ${ok} upload${ok === 1 ? "" : "s"}.`);
    }
    await load();
  };

  const submitReject = async (token: string) => {
    const note = rejectNote;
    setBusy(token);
    try {
      const res = await fetch(`/api/upload-requests/${token}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || "Could not reject.");
      }
      notify("ok", "Sent back — the link is open again for re-upload.");
      setRejecting(null);
      setRejectNote("");
      await load();
    } catch (e) {
      notify("err", e instanceof Error ? e.message : "Could not reject.");
    } finally {
      setBusy(null);
    }
  };

  const openReject = (token: string) => {
    setRejecting(token);
    setRejectNote("");
  };

  // ── Error / loading / empty states ──
  if (loadError) {
    return (
      <div>
        <div className="banner amber" style={{ marginBottom: 18 }}>
          <div>
            <div className="bt">Couldn&rsquo;t load the review queue</div>
            <div className="bs">{loadError}</div>
          </div>
        </div>
        <button className="btn-sm" onClick={load} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <IconRefresh /> Retry
        </button>
      </div>
    );
  }

  if (items === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {[0, 1].map((i) => (
          <div key={i} className="card card-pad">
            <div className="sk" style={{ height: 18, width: "40%" }} />
            <div className="sk" style={{ height: 11, width: "55%", marginTop: 10 }} />
            <div className="sk" style={{ height: 140, width: "100%", marginTop: 16, borderRadius: 12 }} />
          </div>
        ))}
      </div>
    );
  }

  const pendingApproveCount = items.filter((r) => (selected[r.token]?.size ?? 0) > 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Toolbar: count + helper copy + refresh / approve-all */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {items.length > 0 && (
          <span className="badge b-teal" style={{ fontSize: 11 }}>{items.length} pending</span>
        )}
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
          Choose the final set (up to {CAP}) and approve to publish, or send back with a note.
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn-sm"
          onClick={load}
          title="Refresh the review queue"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <IconRefresh /> Refresh
        </button>
        {items.length > 0 && (
          <button
            className="btn-sm teal"
            onClick={() => setConfirmAll(true)}
            disabled={bulkBusy || pendingApproveCount === 0}
            style={{ opacity: bulkBusy || pendingApproveCount === 0 ? 0.5 : 1, cursor: bulkBusy || pendingApproveCount === 0 ? "not-allowed" : "pointer" }}
            title="Approve every card using its current selection"
          >
            {bulkBusy ? "Approving…" : `Approve all (${pendingApproveCount})`}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card empty">Nothing awaiting review right now.</div>
      ) : (
        items.map((r) => {
          const sel = selected[r.token] ?? new Set<string>();
          const newOnes = r.images ?? [];
          const existing = (r.projectImages ?? []).filter((k) => !newOnes.includes(k));
          const atCap = sel.size >= CAP;
          const isEmpty = sel.size === 0;
          const isBusy = busy === r.token;
          const total = newOnes.length + existing.length;
          const title = r.projectTitle ?? r.projectId;

          return (
            <div key={r.token} className="card card-pad">
              {/* Card header — title + N/CAP selected counter */}
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <h2 className="sec-title" style={{ margin: 0 }}>
                  {title}
                </h2>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: atCap ? "var(--amber)" : "var(--ink-4)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {sel.size}/{CAP} selected
                </span>
              </div>

              {/* Submitter / date / view link */}
              <p
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--ink-4)",
                  margin: "8px 0 16px",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span>
                  From {r.recipient || "an unspecified sender"}
                  {r.submittedAt ? ` · submitted ${formatSubmitted(r.submittedAt)}` : ""}
                </span>
                <Link
                  href={`/admin/projects/${encodeURIComponent(r.projectId)}`}
                  className="tlink"
                >
                  View project →
                </Link>
              </p>

              {/* Per-card select-all / deselect-all */}
              {total > 0 && (
                <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                  <button type="button" className="tlink" onClick={() => selectAll(r)}>
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => deselectAll(r.token)}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600 }}
                  >
                    Deselect all
                  </button>
                </div>
              )}

              {/* New screenshots group */}
              <ImageGroup
                label="New screenshots"
                projectTitle={title}
                keys={newOnes}
                sel={sel}
                shakingKey={shaking[r.token] ?? null}
                variant="new"
                onToggle={(k) => toggle(r.token, k)}
                onZoom={(src, alt) => setLightbox({ src, alt })}
              />

              {/* Existing project images group */}
              {existing.length > 0 && (
                <ImageGroup
                  label="Already on the project"
                  projectTitle={title}
                  keys={existing}
                  sel={sel}
                  shakingKey={shaking[r.token] ?? null}
                  variant="existing"
                  onToggle={(k) => toggle(r.token, k)}
                  onZoom={(src, alt) => setLightbox({ src, alt })}
                />
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
                <button
                  className="btn btn-teal"
                  onClick={() => approve(r.token)}
                  disabled={isBusy || isEmpty || bulkBusy}
                  style={{
                    fontSize: 14,
                    padding: "10px 20px",
                    opacity: isBusy || isEmpty ? 0.5 : 1,
                    cursor: isBusy || isEmpty ? "not-allowed" : "pointer",
                    boxShadow: isBusy || isEmpty ? "none" : undefined,
                  }}
                >
                  {isBusy ? "Working…" : "Approve & publish"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => openReject(r.token)}
                  disabled={isBusy || bulkBusy}
                  style={{
                    fontSize: 13.5,
                    padding: "10px 18px",
                    color: "var(--rose)",
                    cursor: isBusy ? "not-allowed" : "pointer",
                    opacity: isBusy ? 0.5 : 1,
                  }}
                >
                  Send back
                </button>
                {isEmpty && rejecting !== r.token && (
                  <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
                    Select at least one image to approve
                  </span>
                )}
              </div>

              {/* Inline reject note box */}
              {rejecting === r.token && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    background: "var(--panel-2)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r)",
                  }}
                >
                  <label className="eyebrow" htmlFor={`rn-${r.token}`} style={{ display: "block", marginBottom: 8 }}>
                    Note for the uploader (optional)
                  </label>
                  <textarea
                    id={`rn-${r.token}`}
                    className="fld"
                    autoFocus
                    rows={3}
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Why it's being sent back — leave blank to just re-open the link."
                    style={{ width: "100%", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <button
                      className="btn-sm teal"
                      onClick={() => submitReject(r.token)}
                      disabled={isBusy}
                      style={{ opacity: isBusy ? 0.5 : 1 }}
                    >
                      {isBusy ? "Sending…" : "Send back"}
                    </button>
                    <button
                      className="btn-sm"
                      onClick={() => {
                        setRejecting(null);
                        setRejectNote("");
                      }}
                      disabled={isBusy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {lightbox && (
        <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}

      <ConfirmModal
        open={confirmAll}
        title="Approve all pending uploads?"
        body={`This will publish the current selection for ${pendingApproveCount} card${pendingApproveCount === 1 ? "" : "s"}. Cards with nothing selected are skipped.`}
        confirmLabel="Approve all"
        onConfirm={() => {
          setConfirmAll(false);
          approveAll();
        }}
        onCancel={() => setConfirmAll(false)}
      />
    </div>
  );
}

// ── Bulk outreach panel ───────────────────────────────────────────────────────

function BulkPanel({ notify }: { notify: Notify }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState<Record<string, GenResult>>({});
  const [semFilter, setSemFilter] = useState<string>("");

  const refresh = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/upload-requests/bulk");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const d = await res.json();
      setCandidates(d.candidates ?? []);
      setEmailConfigured(!!d.emailConfigured);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load outreach candidates.");
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A project has a live link if it already had one (openUrl) or we just made one.
  const linkFor = (c: Candidate) => gen[c.id]?.url ?? c.openUrl ?? null;

  // Semesters present, for the optional filter.
  const semesters = useMemo(() => {
    const s = new Set<string>();
    for (const c of candidates) if (c.semester) s.add(c.semester);
    return [...s].sort();
  }, [candidates]);

  const visible = useMemo(
    () => (semFilter ? candidates.filter((c) => c.semester === semFilter) : candidates),
    [candidates, semFilter]
  );

  const pending = useMemo(
    () => visible.filter((c) => !linkFor(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, gen]
  );

  // Rows that currently have a usable link, for bulk outreach.
  const linked = useMemo(
    () => visible.filter((c) => linkFor(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, gen]
  );

  const generate = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/upload-requests/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: ids }),
      });
      if (!res.ok) throw new Error(`Generation failed (${res.status})`);
      const d = await res.json();
      const next: Record<string, GenResult> = { ...gen };
      const failures: string[] = [];
      for (const r of d.results as GenResult[]) {
        next[r.id] = r;
        if (!r.url && r.status !== "skipped-existing") {
          failures.push(`${r.id}${r.note ? `: ${r.note}` : ""}`);
        }
      }
      setGen(next);
      if (failures.length) {
        notify("err", `${failures.length} link${failures.length === 1 ? "" : "s"} failed — ${failures[0]}`);
      } else {
        notify(
          "ok",
          `Created ${d.created} link${d.created === 1 ? "" : "s"}${d.emailed ? `, emailed ${d.emailed}` : ""}.`
        );
      }
    } catch (e) {
      notify("err", e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  // Bulk outreach: title + URL, one per line.
  const allLinksText = useMemo(
    () =>
      linked
        .map((c) => `${c.title}\t${linkFor(c)}`)
        .join("\n"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linked, gen]
  );

  const downloadCsv = () => {
    if (!linked.length) {
      notify("err", "No generated links to export yet.");
      return;
    }
    const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Project", "PM name", "PM email", "Upload URL"].join(","),
      ...linked.map((c) => [esc(c.title), esc(c.pm), esc(c.pmEmail), esc(linkFor(c))].join(",")),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `upload-outreach${semFilter ? `-${semFilter.replace(/\s+/g, "-")}` : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <p className="subcopy" style={{ marginTop: 0, marginBottom: 18 }}>
        Projects still missing screenshots. Generate a magic-upload link for each — emails
        send automatically when a sender domain is configured; otherwise copy each link to the PM.
        PMs come from the project&rsquo;s team roles; emails from the{" "}
        <Link href="/admin/people">People directory</Link>.
      </p>

      {/* ── Load error ── */}
      {loadError && (
        <div className="banner amber">
          <div>
            <div className="bt">Couldn&rsquo;t load candidates</div>
            <div className="bs">
              {loadError}{" "}
              <button
                onClick={refresh}
                style={{ background: "none", border: "none", textDecoration: "underline", color: "inherit", cursor: "pointer", padding: 0, fontSize: 13 }}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Auto-email warning banner ── */}
      {!emailConfigured && !loadError && (
        <div className="banner amber">
          <div>
            <div className="bt">Auto-email is off</div>
            <div className="bs">
              No Resend domain. Links generate fine — copy each to the PM. Set{" "}
              <code style={{ fontFamily: "var(--mono)" }}>RESEND_API_KEY</code> +{" "}
              <code style={{ fontFamily: "var(--mono)" }}>EMAIL_FROM</code> to auto-send.
            </div>
          </div>
        </div>
      )}

      {/* ── Optional semester filter ── */}
      {semesters.length > 1 && (
        <FilterBar activeCount={semFilter ? 1 : 0}>
          <label className="eyebrow" htmlFor="sem-filter" style={{ marginRight: 8 }}>
            Semester
          </label>
          <select
            id="sem-filter"
            className="fld"
            value={semFilter}
            onChange={(e) => setSemFilter(e.target.value)}
            style={{ maxWidth: 220 }}
          >
            <option value="">All semesters</option>
            {semesters.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterBar>
      )}

      {/* ── Action bar: generate + bulk outreach ── */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <button
          className="btn btn-teal"
          style={{ fontSize: 14, padding: "11px 20px", opacity: busy || pending.length === 0 ? 0.5 : 1, cursor: busy || pending.length === 0 ? "not-allowed" : "pointer", boxShadow: busy || pending.length === 0 ? "none" : undefined }}
          onClick={() => generate(pending.map((c) => c.id))}
          disabled={busy || pending.length === 0}
        >
          {busy
            ? "Generating…"
            : `Generate links for ${pending.length} project${pending.length === 1 ? "" : "s"}`}
        </button>
        <CopyButton
          value={allLinksText}
          title={linked.length ? "Copy every generated link (title + URL)" : "No links yet"}
        />
        <button
          className="btn-sm"
          onClick={downloadCsv}
          disabled={linked.length === 0}
          style={{ opacity: linked.length === 0 ? 0.5 : 1, cursor: linked.length === 0 ? "not-allowed" : "pointer" }}
          title="Download title, PM name, PM email, upload URL"
        >
          Download CSV
        </button>
        <span style={{ fontSize: 13, color: "var(--ink-4)" }}>
          {visible.length} project{visible.length === 1 ? "" : "s"} need screenshots
          {linked.length ? ` · ${linked.length} link${linked.length === 1 ? "" : "s"} ready` : ""}
        </span>
      </div>

      {/* ── Candidate list ── */}
      <div className="card listcard">
        {loading ? (
          <>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="lrow" style={{ cursor: "default" }}>
                <div style={{ flex: 1 }}>
                  <div className="sk" style={{ height: 14, width: "60%" }} />
                  <div className="sk" style={{ height: 10, width: "40%", marginTop: 8 }} />
                </div>
                <div className="sk" style={{ height: 12, width: 70 }} />
                <div className="sk" style={{ height: 28, width: 90, borderRadius: 8 }} />
              </div>
            ))}
          </>
        ) : loadError ? (
          <div className="empty">Couldn&rsquo;t load candidates.</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {candidates.length === 0
              ? "Every project has at least one screenshot."
              : "No projects match this semester."}
          </div>
        ) : (
          visible.map((c) => {
            const url = linkFor(c);
            const g = gen[c.id];
            const isLinked = !!url;
            const failed = g && !g.url && g.status !== "skipped-existing";
            return (
              <div
                key={c.id}
                className="lrow"
                style={{ cursor: "default", background: isLinked ? "var(--panel-2)" : undefined }}
              >
                {/* Project title + PM line + view link */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ttl">
                    {c.title}
                    {c.semester ? <span className="chip">{c.semester}</span> : null}
                  </div>
                  <div className="meta">
                    {c.pm ? `PM: ${c.pm}` : "no PM on file"}
                    {c.pm && (c.pmEmail ? ` · ${c.pmEmail}` : " · no email")}
                    {" · "}
                    <Link
                      href={`/admin/projects/${encodeURIComponent(c.id)}`}
                      style={{ color: "var(--teal-deep)" }}
                    >
                      View project →
                    </Link>
                  </div>
                </div>

                {/* Status indicator */}
                {failed ? (
                  <span className="badge b-amber" style={{ color: "var(--rose)", background: "var(--rose-bg)", borderColor: "var(--rose-line)" }}>
                    {g?.note || "failed"}
                  </span>
                ) : g?.emailed ? (
                  <span className="badge b-grn" style={{ gap: 5 }}>
                    <IconMail /> emailed
                  </span>
                ) : g?.note ? (
                  <span className="badge b-draft">{g.note}</span>
                ) : c.openUrl ? (
                  <span className="badge b-teal" style={{ gap: 5 }}>
                    <IconLink /> has open link
                  </span>
                ) : (
                  <span style={{ width: 1 }} />
                )}

                {/* Per-row actions */}
                <div className="rowact">
                  {url ? (
                    <>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="tlink">
                        open
                      </a>
                      <CopyButton value={url} title="Copy upload link" />
                    </>
                  ) : (
                    <button
                      className="btn-sm teal"
                      onClick={() => generate([c.id])}
                      disabled={busy}
                      style={{ opacity: busy ? 0.5 : 1, cursor: busy ? "not-allowed" : "pointer" }}
                    >
                      generate
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Image group sub-component (review panel) ──────────────────────────────────

function ImageGroup({
  label,
  projectTitle,
  keys,
  sel,
  shakingKey,
  variant,
  onToggle,
  onZoom,
}: {
  label: string;
  projectTitle: string;
  keys: string[];
  sel: Set<string>;
  shakingKey: string | null;
  variant: "new" | "existing";
  onToggle: (key: string) => void;
  onZoom: (src: string, alt: string) => void;
}) {
  if (!keys.length) return null;

  const isExisting = variant === "existing";

  return (
    <div
      style={
        isExisting
          ? { marginBottom: 16, background: "var(--bg2)", borderRadius: 12, padding: 12 }
          : { marginBottom: 16 }
      }
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        {keys.map((key, i) => {
          const on = sel.has(key);
          const isShaking = shakingKey === key;
          const src = keyToUrl(key);
          const alt = `${projectTitle} — screenshot ${i + 1}`;
          return (
            <Thumb
              key={key}
              src={src}
              alt={alt}
              on={on}
              isExisting={isExisting}
              isShaking={isShaking}
              onToggle={() => onToggle(key)}
              onZoom={() => onZoom(src, alt)}
            />
          );
        })}
      </div>
    </div>
  );
}

// One selectable thumbnail with a zoom affordance + image-failed fallback.
function Thumb({
  src,
  alt,
  on,
  isExisting,
  isShaking,
  onToggle,
  onZoom,
}: {
  src: string;
  alt: string;
  on: boolean;
  isExisting: boolean;
  isShaking: boolean;
  onToggle: () => void;
  onZoom: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={isShaking ? "_shake" : undefined}
      style={{
        position: "relative",
        aspectRatio: "4 / 3",
        borderRadius: 11,
        overflow: "hidden",
        padding: 0,
        cursor: "pointer",
        background: "repeating-linear-gradient(125deg,#dfe6e2 0 12px,#eef2ef 12px 24px)",
        border: on
          ? `2.5px solid var(--teal)`
          : isExisting
          ? "2.5px dashed #cfd6d1"
          : "2.5px solid transparent",
        opacity: on ? 1 : 0.62,
        transition: "opacity 0.12s, border-color 0.12s",
      }}
    >
      {failed ? (
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: "100%",
            height: "100%",
            background: "var(--rose-bg)",
            color: "var(--rose)",
            fontSize: 11,
            fontFamily: "var(--mono)",
            textAlign: "center",
            padding: 6,
          }}
        >
          image failed to load
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}

      {/* Zoom affordance — opens the lightbox without toggling selection */}
      {!failed && (
        <span
          role="button"
          tabIndex={-1}
          title="View full size"
          aria-label="View full size"
          onClick={(e) => {
            e.stopPropagation();
            onZoom();
          }}
          style={{
            position: "absolute",
            bottom: 6,
            left: 6,
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "rgba(0,0,0,0.5)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            cursor: "zoom-in",
          }}
        >
          <IconZoom />
        </span>
      )}

      {/* Selection badge */}
      <span
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: on ? "var(--teal)" : "rgba(0,0,0,0.35)",
          color: "#fff",
          fontSize: on ? 13 : 15,
          display: "grid",
          placeItems: "center",
          lineHeight: 1,
        }}
      >
        {on ? "✓" : "+"}
      </span>
    </button>
  );
}
