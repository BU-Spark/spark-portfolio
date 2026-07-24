"use client";
// Bulk magic-upload-link generation — Spark Control "pipeline" redesign.
// Projects still missing screenshots; generate a magic-upload link for each
// (emails auto-send when a sender domain is configured, otherwise copy the link
// to the PM). PMs come from the project's team roles; emails from the People
// directory. Visual refresh only — every behavior, field, and API call below is
// preserved from the prior implementation. Admin-only route.
//   GET  /api/upload-requests/bulk  → { candidates, emailConfigured }
//   POST /api/upload-requests/bulk  → { results, created, emailed }
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import { useToast } from "@/components/admin/useToast";
import CopyButton from "@/components/admin/CopyButton";

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

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconMail() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BulkUploadsPage() {
  const { toastEl, notify } = useToast();
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
  const linkFor = useCallback((c: Candidate) => gen[c.id]?.url ?? c.openUrl ?? null, [gen]);

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

  const pending = useMemo(() => visible.filter((c) => !linkFor(c)), [visible, linkFor]);
  const linked = useMemo(() => visible.filter((c) => linkFor(c)), [visible, linkFor]);

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
    () => linked.map((c) => `${c.title}\t${linkFor(c)}`).join("\n"),
    [linked, linkFor]
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
    <>
      {toastEl}

      <PageHeader eyebrow="Pipeline" title="Bulk uploads">
        <button
          className="btn btn-teal"
          style={{ fontSize: 13.5, padding: "11px 20px" }}
          onClick={() => generate(pending.map((c) => c.id))}
          disabled={busy || pending.length === 0}
        >
          {busy
            ? "Generating…"
            : `Generate links for ${pending.length} project${pending.length === 1 ? "" : "s"}`}
        </button>
      </PageHeader>

      <div className="content" style={{ maxWidth: 980 }}>
        {/* Intro */}
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--ink-2)",
            maxWidth: 720,
            margin: "0 0 16px",
          }}
        >
          Projects still missing screenshots. Generate a magic-upload link for each — emails
          send automatically when a sender domain is configured; otherwise copy each link to the
          PM. PMs come from the project&rsquo;s team roles; emails from the{" "}
          <Link href="/admin/people" className="tlink" style={{ display: "inline" }}>
            People directory
          </Link>
          .
        </p>

        {/* Load error */}
        {loadError && (
          <div
            className="banner"
            style={{
              background: "var(--rose-bg)",
              border: "1px solid var(--rose-line)",
              borderLeft: "4px solid var(--rose)",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--rose)" }}>
              Couldn&rsquo;t load candidates: {loadError}{" "}
              <button
                onClick={refresh}
                style={{
                  background: "none",
                  border: "none",
                  textDecoration: "underline",
                  color: "inherit",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 13,
                }}
              >
                Retry
              </button>
            </span>
          </div>
        )}

        {/* Auto-email warning banner */}
        {!emailConfigured && !loadError && (
          <div className="banner amber">
            <div>
              <div className="bt">Auto-email is off</div>
              <div className="bs">
                No Resend domain. Links generate fine — copy each to the PM. Set{" "}
                <code
                  style={{
                    fontFamily: "var(--mono)",
                    background: "rgba(0,0,0,.05)",
                    padding: "1px 5px",
                    borderRadius: 3,
                  }}
                >
                  RESEND_API_KEY
                </code>{" "}
                +{" "}
                <code
                  style={{
                    fontFamily: "var(--mono)",
                    background: "rgba(0,0,0,.05)",
                    padding: "1px 5px",
                    borderRadius: 3,
                  }}
                >
                  EMAIL_FROM
                </code>{" "}
                to auto-send.
              </div>
            </div>
          </div>
        )}

        {/* Action bar: copy-all, CSV, optional semester filter, count */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <CopyButton
            value={allLinksText}
            title={linked.length ? "Copy every generated link (title + URL)" : "No links yet"}
          />
          <button
            className="btn-sm"
            onClick={downloadCsv}
            disabled={linked.length === 0}
            title="Download title, PM name, PM email, upload URL"
            style={{ opacity: linked.length === 0 ? 0.5 : 1, cursor: linked.length === 0 ? "not-allowed" : "pointer" }}
          >
            Download CSV
          </button>

          {semesters.length > 1 && (
            <select
              className="fld"
              value={semFilter}
              onChange={(e) => setSemFilter(e.target.value)}
              aria-label="Filter by semester"
              style={{ maxWidth: 200, width: "auto", padding: "8px 11px", fontSize: 13 }}
            >
              <option value="">All semesters</option>
              {semesters.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          <span style={{ fontSize: 13, color: "var(--ink-4)", marginLeft: "auto" }}>
            {visible.length} project{visible.length === 1 ? "" : "s"} need screenshots
            {linked.length ? ` · ${linked.length} link${linked.length === 1 ? "" : "s"} ready` : ""}
          </span>
        </div>

        {/* Candidate list */}
        <div className="card" style={{ overflow: "hidden" }}>
          {loading ? (
            [0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.3fr 1fr auto",
                  gap: 16,
                  padding: "15px 22px",
                  borderTop: i === 0 ? "none" : "1px solid var(--line-2)",
                  alignItems: "center",
                }}
              >
                <div>
                  <div className="sk" style={{ height: 14, width: "60%" }} />
                  <div className="sk" style={{ height: 10, width: "40%", marginTop: 8 }} />
                </div>
                <div className="sk" style={{ height: 12, width: 70 }} />
                <div className="sk" style={{ height: 28, width: 90, borderRadius: 9 }} />
              </div>
            ))
          ) : loadError ? (
            <div className="empty">Couldn&rsquo;t load candidates.</div>
          ) : visible.length === 0 ? (
            <div className="empty">
              {candidates.length === 0
                ? "Every project has at least one screenshot."
                : "No projects match this semester."}
            </div>
          ) : (
            visible.map((c, i) => {
              const url = linkFor(c);
              const g = gen[c.id];
              const isLinked = !!url;
              const failed = g && !g.url && g.status !== "skipped-existing";
              return (
                <div
                  key={c.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.3fr 1fr auto",
                    gap: 16,
                    alignItems: "center",
                    padding: "13px 22px",
                    borderTop: i === 0 ? "none" : "1px solid var(--line-2)",
                    background: isLinked ? "var(--bg2)" : undefined,
                  }}
                >
                  {/* Project title + PM line + view link */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 14.5 }}>
                      {c.title}
                      {c.semester ? (
                        <span
                          style={{
                            marginLeft: 8,
                            fontFamily: "var(--mono)",
                            fontSize: 11,
                            color: "var(--ink-4)",
                            fontWeight: 400,
                          }}
                        >
                          {c.semester}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)", marginTop: 3 }}>
                      {c.pm ? `PM: ${c.pm}` : "no PM on file"}
                      {c.pm && (c.pmEmail ? ` · ${c.pmEmail}` : " · no email")}
                      {" · "}
                      <Link
                        href={`/admin/projects/${encodeURIComponent(c.id)}`}
                        className="tlink"
                        style={{ display: "inline", fontSize: 11 }}
                      >
                        View project →
                      </Link>
                    </div>
                  </div>

                  {/* Status indicator (leading icon) */}
                  {failed ? (
                    <div style={{ fontSize: 12, color: "var(--rose)" }}>{g?.note || "failed"}</div>
                  ) : g?.emailed ? (
                    <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 7, color: "var(--teal-deep)" }}>
                      <IconMail /> emailed
                    </div>
                  ) : g?.note ? (
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{g.note}</div>
                  ) : c.openUrl ? (
                    <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 7, color: "var(--ink-3)" }}>
                      <IconLink /> has open link
                    </div>
                  ) : (
                    <div />
                  )}

                  {/* Per-row actions */}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
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
                        style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "not-allowed" : "pointer" }}
                      >
                        generate{c.pmEmail ? " (+ email)" : ""}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
