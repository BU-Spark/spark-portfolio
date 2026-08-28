"use client";
// Review queue for community suggestions (the BU-tier "add information" flow).
//
// The design problem this page has to solve: `applicableFields` silently SKIPS any
// field the project already has content for, so a naive queue would show six
// proposals, the reviewer would click accept, and two would land. Every row here
// therefore states, per field, whether it will be written or skipped — and offers an
// explicit overwrite tick for the skipped ones.
//
// contributorsNote and note are shown separately and labelled as never-applied,
// because they are the only fields a human has to act on manually.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import { useToast } from "@/components/admin/useToast";

const APPLIABLE = ["blurb", "repoUrl", "prodUrl", "tech", "topics", "clientDesc"] as const;
const NOTE_ONLY = ["contributorsNote", "note"] as const;

const FIELD_LABEL: Record<string, string> = {
  blurb: "Description",
  repoUrl: "Code repository",
  prodUrl: "Live demo",
  tech: "Tech stack",
  topics: "Topics",
  clientDesc: "Client description",
  contributorsNote: "Who worked on this",
  note: "Note from submitter",
};

interface Suggestion {
  id: number;
  projectId: string;
  projectTitle?: string;
  ownerOrg?: string;
  submittedBy: string;
  payload: Record<string, unknown>;
  createdAt: string;
  current?: Record<string, unknown>;
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && v.length === 0);

const show = (v: unknown) =>
  Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : v == null ? "—" : String(v);

function SuggestionsInner() {
  const { notify, toastEl } = useToast();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  // Per-suggestion set of fields the reviewer has ticked to overwrite.
  const [overwrite, setOverwrite] = useState<Record<number, string[]>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/suggestions?status=pending");
    if (res.ok) {
      const d = await res.json();
      setItems(d.suggestions ?? []);
    } else {
      notify("err", "Couldn't load the queue.");
    }
    setLoading(false);
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: number, verdict: "accepted" | "rejected") {
    setBusy(id);
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        verdict,
        note: notes[id] || undefined,
        overwrite: overwrite[id] ?? [],
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      notify("err", d.error || "That didn't work.");
      // A 409 means someone else got there first — reload so the row disappears
      // rather than sitting there inviting another click.
      if (res.status === 409) void load();
      return;
    }
    const applied: string[] = d.applied ?? [];
    notify(
      "ok",
      verdict === "rejected"
        ? "Rejected."
        : applied.length
          ? `Accepted — wrote ${applied.map((f) => FIELD_LABEL[f] ?? f).join(", ")}.`
          : "Accepted. Nothing to write (fields already filled, or note-only).",
    );
    setItems((p) => p.filter((x) => x.id !== id));
  }

  const toggleOverwrite = (id: number, field: string) =>
    setOverwrite((p) => {
      const cur = p[id] ?? [];
      return { ...p, [id]: cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field] };
    });

  return (
    <>
      <PageHeader eyebrow="Community" title="Suggestions" />
      <div className="content">
        {toastEl}
        {loading ? (
          <p style={{ color: "var(--ink-4)" }}>Loading…</p>
        ) : !items.length ? (
          <div className="card" style={{ padding: 22 }}>
            <strong>Nothing waiting.</strong>
            <p style={{ margin: "6px 0 0", color: "var(--ink-4)", fontSize: 14 }}>
              Suggestions from signed-in BU accounts show up here for review. Nothing is
              written to a project until you accept it.
            </p>
          </div>
        ) : (
          items.map((s) => {
            const ow = overwrite[s.id] ?? [];
            return (
              <div key={s.id} className="card" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <Link href={`/admin/edit/${s.projectId}`} style={{ fontWeight: 700, fontSize: 16 }}>
                    {s.projectTitle || s.projectId}
                  </Link>
                  <span style={{ fontSize: 12.5, color: "var(--ink-4)" }}>
                    {s.submittedBy} · {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <table style={{ width: "100%", marginTop: 14, borderCollapse: "collapse", fontSize: 13.5 }}>
                  <tbody>
                    {APPLIABLE.filter((f) => s.payload[f] !== undefined).map((f) => {
                      const blank = isEmpty(s.current?.[f]);
                      const willWrite = blank || ow.includes(f);
                      return (
                        <tr key={f} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: "8px 10px 8px 0", width: 150, color: "var(--ink-4)" }}>
                            {FIELD_LABEL[f]}
                          </td>
                          <td style={{ padding: "8px 10px 8px 0" }}>
                            <div>{show(s.payload[f])}</div>
                            {!blank && (
                              <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 3 }}>
                                currently: {show(s.current?.[f])}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "8px 0", width: 190, textAlign: "right" }}>
                            {blank ? (
                              <span style={{ color: "#15803d", fontSize: 12.5 }}>will write</span>
                            ) : (
                              <label style={{ fontSize: 12.5, cursor: "pointer", color: willWrite ? "#b45309" : "var(--ink-4)" }}>
                                <input
                                  type="checkbox"
                                  checked={ow.includes(f)}
                                  onChange={() => toggleOverwrite(s.id, f)}
                                  style={{ marginRight: 6 }}
                                />
                                {willWrite ? "will REPLACE" : "skipped — replace?"}
                              </label>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {NOTE_ONLY.filter((f) => s.payload[f] !== undefined).map((f) => (
                      <tr key={f} style={{ borderTop: "1px solid var(--line)", background: "#f8f8f7" }}>
                        <td style={{ padding: "8px 10px 8px 0", width: 150, color: "var(--ink-4)" }}>
                          {FIELD_LABEL[f]}
                        </td>
                        <td style={{ padding: "8px 10px 8px 0", whiteSpace: "pre-wrap" }}>
                          {show(s.payload[f])}
                        </td>
                        <td style={{ padding: "8px 0", width: 190, textAlign: "right", fontSize: 12.5, color: "var(--ink-4)" }}>
                          never auto-applied
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="fld"
                    placeholder="Note (optional) — recorded either way"
                    value={notes[s.id] ?? ""}
                    onChange={(e) => setNotes((p) => ({ ...p, [s.id]: e.target.value }))}
                    style={{ flex: 1, minWidth: 200 }}
                  />
                  <button
                    className="btn primary"
                    disabled={busy === s.id}
                    onClick={() => review(s.id, "accepted")}
                  >
                    {busy === s.id ? "…" : "Accept"}
                  </button>
                  <button
                    className="btn"
                    disabled={busy === s.id}
                    onClick={() => review(s.id, "rejected")}
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

export default function SuggestionsPage() {
  return (
    <Suspense fallback={null}>
      <SuggestionsInner />
    </Suspense>
  );
}
