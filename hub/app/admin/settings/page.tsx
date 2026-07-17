"use client";
// Admin → Settings ("Spark Control — Taxonomy & display"). Edit the controlled
// vocabularies (Disciplines, Programs, Client Types — used by the sidebar facets
// and the add/edit dropdowns) and choose which facet groups show in the public
// gallery sidebar. Persists to /api/settings (PUT, admin-gated).
import { useCallback, useEffect, useRef, useState } from "react";
import type { GallerySettings, FacetKey } from "@/lib/types";
import PageHeader from "@/components/admin/PageHeader";
import { useToast } from "@/components/admin/useToast";
import { useUnsavedGuard } from "@/components/admin/useUnsavedGuard";
import { useHotkey } from "@/components/admin/useHotkey";

const FACET_LABELS: Record<FacetKey, string> = {
  discipline: "Discipline",
  topic: "Topic",
  program: "Program",
  clientType: "Client Type",
  term: "Term",
};

// Categorical hue map → a stable color dot per vocabulary value (mirrors the
// handoff's `dc()`). Unknown values fall back to a neutral teal-violet.
const HUE: Record<string, number> = {
  UX: 25, SWE: 255, ML: 305, "Data Visualization": 205, "Data Science": 160,
  Innovation: 75, Misc: 260, Government: 45, Nonprofit: 150, Media: 335,
  Education: 200, Healthcare: 25, Startup: 75, Research: 280,
};
function dotColor(v: string) {
  return `oklch(0.62 0.14 ${HUE[v] ?? 260})`;
}

// Stable JSON-ish equality for the settings object (key order is fixed below).
function eq(a: GallerySettings | null, b: GallerySettings | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function SettingsPage() {
  const { toastEl, notify } = useToast();
  const [settings, setSettings] = useState<GallerySettings | null>(null);
  // Snapshot of what's persisted on the server, for dirty tracking.
  const [saved, setSaved] = useState<GallerySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isDirty = !!settings && !!saved && !eq(settings, saved);
  useUnsavedGuard(isDirty);

  const load = useCallback(() => {
    setLoading(true);
    setLoadErr(null);
    fetch("/api/settings")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((s: GallerySettings) => {
        // Normalize so the dirty diff is stable (programs may be undefined).
        const norm: GallerySettings = { ...s, programs: s.programs ?? [] };
        setSettings(norm);
        setSaved(norm);
      })
      .catch((e) =>
        setLoadErr(e instanceof Error ? e.message : "Could not load settings.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!settings || busy || !isDirty) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          if (j?.error) detail = `${j.error} (HTTP ${res.status})`;
        } catch {
          /* non-JSON body */
        }
        notify("err", `Could not save settings — ${detail}.`);
        return;
      }
      const { settings: srv } = await res.json();
      const norm: GallerySettings = { ...srv, programs: srv.programs ?? [] };
      setSettings(norm);
      setSaved(norm);
      notify("ok", "Settings saved — the gallery is updated.");
    } catch (e) {
      notify(
        "err",
        `Could not save settings — ${e instanceof Error ? e.message : "network error"}.`
      );
    } finally {
      setBusy(false);
    }
  }, [settings, busy, isDirty, notify]);

  useHotkey("mod+s", save);

  return (
    <>
      {toastEl}
      <PageHeader eyebrow="Admin" title="Taxonomy & display" />

      <div className="content" style={{ maxWidth: 840 }}>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--ink-2)",
            maxWidth: 680,
            margin: "0 0 24px",
          }}
        >
          Configure the gallery&apos;s controlled vocabulary and which filter
          groups appear publicly. Removing a value only changes dropdowns and the
          sidebar — it doesn&apos;t retag existing projects.
        </p>

        {loading ? (
          <>
            <div className="card sk" style={{ height: 150, marginBottom: 18 }} />
            <div className="card sk" style={{ height: 150, marginBottom: 18 }} />
          </>
        ) : loadErr ? (
          <div
            className="card card-pad"
            style={{ textAlign: "center" }}
          >
            <p style={{ margin: "0 0 14px", color: "var(--ink-3)", fontSize: 14 }}>
              Couldn&apos;t load settings — {loadErr}.
            </p>
            <button className="btn-sm" onClick={load}>
              Retry
            </button>
          </div>
        ) : settings ? (
          <>
            {/* ── Content vocabulary ── */}
            <GroupDivider label="Content vocabulary" />

            <ListEditor
              title="Disciplines"
              hint="Practicum categories shown in project dropdowns and the public discipline filter."
              values={settings.disciplines}
              onChange={(disciplines) => setSettings({ ...settings, disciplines })}
              placeholder="Add…"
              onDuplicate={(v) => notify("err", `“${v}” is already in the list.`)}
            />

            <ListEditor
              title="Programs"
              hint="Spark! program tracks used to tag and filter projects; powers the public program filter."
              values={settings.programs ?? []}
              onChange={(programs) => setSettings({ ...settings, programs })}
              placeholder="Add…"
              onDuplicate={(v) => notify("err", `“${v}” is already in the list.`)}
            />

            <ListEditor
              title="Client types"
              hint="Partner categories used to tag and filter projects by the kind of organization."
              values={settings.clientTypes}
              onChange={(clientTypes) => setSettings({ ...settings, clientTypes })}
              placeholder="Add…"
              onDuplicate={(v) => notify("err", `“${v}” is already in the list.`)}
            />

            <ListEditor
              title="Topics"
              hint="Subject-matter tags (e.g. Criminal Justice, Healthcare) shown in the project editor and the public Topic filter."
              values={settings.topics ?? []}
              onChange={(topics) => setSettings({ ...settings, topics })}
              placeholder="Add a topic…"
              onDuplicate={(v) => notify("err", `“${v}” is already in the list.`)}
            />

            {/* ── Homepage content ── */}
            <GroupDivider label="Homepage content" />
            <div
              className="card card-pad"
              style={{ marginBottom: 18, background: "var(--panel-2)" }}
            >
              <h3 className="sec-title" style={{ margin: "0 0 4px" }}>
                Intro copy
              </h3>
              <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 16px", lineHeight: 1.5 }}>
                The eyebrow, headline, and paragraph at the top of the public gallery.
              </p>
              <div className="field">
                <label className="lab">Eyebrow</label>
                <input
                  className="fld"
                  value={settings.intro?.eyebrow ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      intro: {
                        eyebrow: e.target.value,
                        heading: settings.intro?.heading ?? "",
                        body: settings.intro?.body ?? "",
                      },
                    })
                  }
                  placeholder="Explore our work"
                />
              </div>
              <div className="field">
                <label className="lab">Headline</label>
                <textarea
                  className="fld"
                  value={settings.intro?.heading ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      intro: {
                        eyebrow: settings.intro?.eyebrow ?? "",
                        heading: e.target.value,
                        body: settings.intro?.body ?? "",
                      },
                    })
                  }
                  rows={2}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="lab">Paragraph</label>
                <textarea
                  className="fld"
                  value={settings.intro?.body ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      intro: {
                        eyebrow: settings.intro?.eyebrow ?? "",
                        heading: settings.intro?.heading ?? "",
                        body: e.target.value,
                      },
                    })
                  }
                  rows={3}
                />
              </div>
            </div>

            <div
              className="card card-pad"
              style={{ marginBottom: 18, background: "var(--panel-2)" }}
            >
              <h3 className="sec-title" style={{ margin: "0 0 4px" }}>
                Hero stats
              </h3>
              <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 16px", lineHeight: 1.5 }}>
                Shown under the intro copy. The number is live (project /
                student-experience counts); edit the wording after it.
              </p>
              {(settings.heroStats ?? []).map((s, i) => (
                <div
                  key={s.metric}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: i === (settings.heroStats?.length ?? 0) - 1 ? 0 : 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--ink-3)",
                      minWidth: 70,
                      textTransform: "capitalize",
                    }}
                  >
                    {s.metric}
                  </span>
                  <input
                    type="number"
                    className="fld"
                    style={{ width: 96 }}
                    value={s.value ?? ""}
                    placeholder="auto"
                    title="Leave blank to use the live count"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        heroStats: (settings.heroStats ?? []).map((x, idx) =>
                          idx === i
                            ? {
                                ...x,
                                value:
                                  e.target.value === ""
                                    ? undefined
                                    : Number(e.target.value),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                  <input
                    className="fld"
                    style={{ flex: 1 }}
                    value={s.text}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        heroStats: (settings.heroStats ?? []).map((x, idx) =>
                          idx === i ? { ...x, text: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder={s.metric === "students" ? "student experiences" : "projects since 2019"}
                  />
                  <Switch
                    checked={s.show}
                    onChange={(checked) =>
                      setSettings({
                        ...settings,
                        heroStats: (settings.heroStats ?? []).map((x, idx) =>
                          idx === i ? { ...x, show: checked } : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>

            {/* ── Display control ── */}
            <GroupDivider label="Display control" />

            {/* Sidebar-facet switches */}
            <div
              className="card card-pad"
              style={{ marginBottom: 18, background: "var(--panel-2)" }}
            >
              <h3
                className="sec-title"
                style={{ margin: "0 0 4px" }}
              >
                Sidebar filters
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  margin: "0 0 16px",
                  lineHeight: 1.5,
                }}
              >
                Choose which of the four facet groups appear in the public
                gallery&apos;s filter sidebar.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                {(Object.keys(FACET_LABELS) as FacetKey[]).map((key) => {
                  const on = settings.showFacets[key];
                  return (
                    <label
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        border: "1px solid var(--line)",
                        borderRadius: 11,
                        padding: "13px 15px",
                        background: "var(--panel)",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 500 }}>
                        {FACET_LABELS[key]}
                      </span>
                      <Switch
                        checked={on}
                        onChange={(checked) =>
                          setSettings({
                            ...settings,
                            showFacets: { ...settings.showFacets, [key]: checked },
                          })
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            {/* ── Filter order ── */}
            <div
              className="card card-pad"
              style={{ marginBottom: 18, background: "var(--panel-2)" }}
            >
              <h3 className="sec-title" style={{ margin: "0 0 4px" }}>
                Filter order
              </h3>
              <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 16px", lineHeight: 1.5 }}>
                The order the filter groups appear in the public gallery sidebar.
              </p>
              {(settings.facetOrder ?? []).map((key, i) => {
                const order = settings.facetOrder ?? [];
                const move = (dir: number) => {
                  const j = i + dir;
                  if (j < 0 || j >= order.length) return;
                  const next = [...order];
                  [next[i], next[j]] = [next[j], next[i]];
                  setSettings({ ...settings, facetOrder: next });
                };
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      borderTop: i ? "1px solid var(--line)" : "none",
                    }}
                  >
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", width: 20 }}>
                      {i + 1}
                    </span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
                      {FACET_LABELS[key]}
                    </span>
                    <button className="btn-sm" disabled={i === 0} onClick={() => move(-1)} aria-label="Move up">
                      ↑
                    </button>
                    <button className="btn-sm" disabled={i === order.length - 1} onClick={() => move(1)} aria-label="Move down">
                      ↓
                    </button>
                  </div>
                );
              })}
            </div>

            {/* ── Thumbnail badge ── */}
            <div
              className="card card-pad"
              style={{ marginBottom: 18, background: "var(--panel-2)" }}
            >
              <h3 className="sec-title" style={{ margin: "0 0 4px" }}>
                Thumbnail badge
              </h3>
              <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 16px", lineHeight: 1.5 }}>
                Which field the badge on each project card shows.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {(
                  [
                    ["discipline", "Discipline"],
                    ["course", "Course code"],
                    ["program", "Program"],
                  ] as const
                ).map(([val, lbl]) => {
                  const on = (settings.thumbBadge ?? "discipline") === val;
                  return (
                    <button
                      key={val}
                      className={on ? "tab on" : "tab"}
                      onClick={() => setSettings({ ...settings, thumbBadge: val })}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Save bar ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginTop: 8,
              }}
            >
              <button
                className="btn btn-teal"
                onClick={save}
                disabled={busy || !isDirty}
                title={!isDirty ? "No changes to save" : undefined}
              >
                {busy ? "Saving…" : "Save settings"}
              </button>
              {isDirty && !busy && (
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "var(--amber)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  ● Unsaved changes
                </span>
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

// --- Reusable bits -----------------------------------------------------------

// Mono uppercase section divider with a tinted rule (handoff `.vgrp`).
function GroupDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        margin: "30px 0 18px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--display)",
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "var(--teal-deep)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          height: 1,
          background: "color-mix(in oklab,var(--teal) 22%,#eee)",
        }}
      />
    </div>
  );
}

// Sliding toggle switch (handoff `.switch`/`.sl`). Inlined because the scoped
// design system does not ship the `.switch` primitive; matches its dimensions.
function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span
      style={{
        position: "relative",
        width: 42,
        height: 24,
        flexShrink: 0,
        display: "inline-block",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0, position: "absolute" }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          background: checked ? "var(--teal)" : "#cfd6d1",
          borderRadius: 999,
          transition: "background .15s",
          cursor: "pointer",
        }}
      />
      <span
        style={{
          position: "absolute",
          width: 18,
          height: 18,
          left: 3,
          top: 3,
          background: "#fff",
          borderRadius: "50%",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "transform .15s",
          transform: checked ? "translateX(18px)" : "translateX(0)",
          pointerEvents: "none",
        }}
      />
    </span>
  );
}

// An editable string list rendered as color-dotted vocab chips with in-place
// rename, reorder, and remove, plus a dashed inline "+ Add…" zone. Title shows a
// live count: "Disciplines (12)".
function ListEditor({
  title,
  hint,
  values,
  onChange,
  placeholder,
  onDuplicate,
}: {
  title: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  onDuplicate?: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const addRef = useRef<HTMLInputElement | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      onDuplicate?.(v);
      setDraft("");
      addRef.current?.focus();
      return;
    }
    onChange([...values, v]);
    setDraft("");
    addRef.current?.focus();
  };

  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= values.length) return;
    const next = [...values];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const startEdit = (i: number) => {
    setEditing(i);
    setEditDraft(values[i]);
    // Focus on next paint.
    setTimeout(() => editRef.current?.select(), 0);
  };
  const commitEdit = () => {
    if (editing == null) return;
    const v = editDraft.trim();
    const i = editing;
    if (!v) {
      setEditing(null);
      return;
    }
    if (
      values.some((x, idx) => idx !== i && x.toLowerCase() === v.toLowerCase())
    ) {
      onDuplicate?.(v);
      return; // keep editing so they can fix it
    }
    if (v !== values[i]) {
      const next = [...values];
      next[i] = v;
      onChange(next);
    }
    setEditing(null);
  };

  return (
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <h3 className="sec-title" style={{ margin: "0 0 4px" }}>
        {title}{" "}
        <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>
          ({values.length})
        </span>
      </h3>
      <p
        style={{
          fontSize: 13,
          color: "var(--ink-3)",
          margin: "0 0 16px",
          lineHeight: 1.5,
        }}
      >
        {hint}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {values.length === 0 && (
          <div
            style={{
              border: "1px dashed var(--field)",
              borderRadius: 9,
              padding: 14,
              textAlign: "center",
              fontSize: 13,
              color: "var(--ink-4)",
              width: "100%",
            }}
          >
            None yet — add one below.
          </div>
        )}
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13.5,
              background: "var(--panel)",
              border: "1px solid var(--field)",
              borderRadius: 9,
              padding: "7px 11px",
            }}
          >
            {/* Color dot */}
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                background: dotColor(v),
                flexShrink: 0,
              }}
            />

            {/* Reorder */}
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              title="Move up"
              aria-label={`Move ${v} up`}
              style={reorderBtn(i === 0)}
            >
              ↑
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === values.length - 1}
              title="Move down"
              aria-label={`Move ${v} down`}
              style={reorderBtn(i === values.length - 1)}
            >
              ↓
            </button>

            {/* Label / inline rename */}
            {editing === i ? (
              <input
                ref={editRef}
                value={editDraft}
                autoFocus
                onChange={(e) => setEditDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(null);
                  }
                }}
                style={{
                  border: "1px solid var(--teal)",
                  outline: "none",
                  borderRadius: 5,
                  fontFamily: "var(--body)",
                  fontSize: 13.5,
                  width: Math.max(60, editDraft.length * 8),
                  padding: "1px 4px",
                }}
              />
            ) : (
              <span
                onDoubleClick={() => startEdit(i)}
                title="Double-click to rename"
                style={{ cursor: "text", padding: "0 2px" }}
              >
                {v}
              </span>
            )}

            {/* Rename (pencil) */}
            {editing !== i && (
              <button
                onClick={() => startEdit(i)}
                title={`Rename ${v}`}
                aria-label={`Rename ${v}`}
                style={iconBtn("var(--ink-4)")}
              >
                ✎
              </button>
            )}

            {/* Remove */}
            <button
              onClick={() => remove(i)}
              title={`Remove ${v}`}
              aria-label={`Remove ${v}`}
              style={iconBtn("var(--ink-4)")}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.color =
                  "var(--rose)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.color =
                  "var(--ink-4)")
              }
            >
              ×
            </button>
          </span>
        ))}
        {/* Inline dashed add chip */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px dashed color-mix(in oklab,var(--teal) 45%,#ccc)",
            background: "color-mix(in oklab,var(--teal) 5%,#fff)",
            borderRadius: 9,
            padding: 7,
          }}
        >
          <span style={{ color: "var(--teal-deep)", fontSize: 15 }}>+</span>
          <input
            ref={addRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: "var(--body)",
              fontSize: 13.5,
              width: 130,
              padding: "2px 4px",
            }}
          />
        </span>
      </div>
    </div>
  );
}

function iconBtn(color: string): React.CSSProperties {
  return {
    border: "none",
    background: "none",
    cursor: "pointer",
    color,
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
    transition: "color .12s",
  };
}

function reorderBtn(disabled: boolean): React.CSSProperties {
  return {
    border: "none",
    background: "none",
    cursor: disabled ? "default" : "pointer",
    color: disabled ? "var(--line)" : "var(--ink-4)",
    fontSize: 11,
    lineHeight: 1,
    padding: 0,
  };
}
