"use client";
// Admin: merge two project records that are really the same project (e.g. recorded
// separately across two semesters). Pick which record survives (keeps its URL/slug)
// and, for any project-level field that conflicts, which value to keep. Everything
// per-semester — runs/roles/PD, contributors, role timeline — combines automatically.
import { useMemo, useState } from "react";
import type { Project } from "@/lib/types";

const ACCENT = "#0fa392";

type Side = "A" | "B";
type TextField =
  | "title" | "blurb" | "partner" | "clientType"
  | "repoUrl" | "prodUrl" | "driveUrl" | "techNote";

const TEXT_FIELDS: [TextField, string][] = [
  ["title", "Title"],
  ["blurb", "Blurb"],
  ["partner", "Client / partner"],
  ["clientType", "Client type"],
  ["repoUrl", "Repo URL"],
  ["prodUrl", "Live / demo URL"],
  ["driveUrl", "Drive folder"],
  ["techNote", "Tech note (internal)"],
];

const txt = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "");
const sameTermCourse = (r: { term: string; course: string }) =>
  `${(r.term || "").trim().toLowerCase()}|${(r.course || "").trim().toLowerCase()}`;

export default function MergeProjectsModal({
  a,
  b,
  onClose,
  onMerged,
}: {
  a: Project;
  b: Project;
  onClose: () => void;
  onMerged: (survivorId: string) => void;
}) {
  // Default survivor: the published one, else the one with more semesters, else A.
  const initialSurvivor: Side = useMemo(() => {
    if (!!a.published !== !!b.published) return a.published ? "A" : "B";
    if ((a.runs?.length ?? 0) !== (b.runs?.length ?? 0))
      return (a.runs?.length ?? 0) >= (b.runs?.length ?? 0) ? "A" : "B";
    return "A";
  }, [a, b]);

  const [survivor, setSurvivor] = useState<Side>(initialSurvivor);
  // Per-field overrides; absent → defaults to survivor's side (or the populated side).
  const [overrides, setOverrides] = useState<Partial<Record<TextField | "published" | "featured", Side>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const other: Side = survivor === "A" ? "B" : "A";
  const proj = (s: Side) => (s === "A" ? a : b);

  // Which side's value to keep for a text field: explicit override, else survivor if
  // it has a value, else the other (populated) side.
  const pickText = (f: TextField): Side =>
    overrides[f] ?? (txt(proj(survivor)[f] as string | null) ? survivor : txt(proj(other)[f] as string | null) ? other : survivor);
  const pickBool = (f: "published" | "featured"): Side => overrides[f] ?? survivor;

  // A text field needs a picker only when BOTH sides are populated and differ.
  const textConflicts = TEXT_FIELDS.filter(([f]) => {
    const va = txt(a[f] as string | null);
    const vb = txt(b[f] as string | null);
    return va && vb && va !== vb;
  });
  const boolConflicts = (["published", "featured"] as const).filter((f) => !!a[f] !== !!b[f]);

  // Auto-combine preview.
  const semesters = useMemo(() => {
    const seen = new Set<string>();
    for (const r of [...(a.runs ?? []), ...(b.runs ?? [])]) seen.add(sameTermCourse(r));
    return seen.size;
  }, [a, b]);
  const techCount = useMemo(() => {
    const s = new Set<string>();
    for (const t of [...(a.tech ?? []), ...(b.tech ?? [])]) if (t.trim()) s.add(t.trim().toLowerCase());
    return s.size;
  }, [a, b]);
  const imageCount = Math.min(
    4,
    new Set([...((a.images as string[]) ?? []), ...((b.images as string[]) ?? [])].filter(Boolean)).size
  );
  const contribApprox = (a.contributorCount ?? 0) + (b.contributorCount ?? 0);

  const flip = (next: Side) => {
    setSurvivor(next);
    setOverrides({}); // re-default all picks to the new survivor
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    const survivorProj = proj(survivor);
    const valText = (f: TextField) => (proj(pickText(f))[f] as string | null) ?? null;
    // undefined (not "") for these so an unexpectedly-empty pick falls back to the
    // populated side in mergeProjects rather than wiping the field.
    const resolution = {
      title: valText("title") ?? undefined,
      blurb: valText("blurb") ?? undefined,
      blurbFromAbsorbed: pickText("blurb") === other,
      partner: valText("partner") ?? undefined,
      clientType: valText("clientType") ?? undefined,
      repoUrl: valText("repoUrl"),
      prodUrl: valText("prodUrl"),
      driveUrl: valText("driveUrl"),
      techNote: valText("techNote"),
      published: !!proj(pickBool("published")).published,
      featured: !!proj(pickBool("featured")).featured,
    };
    try {
      const res = await fetch("/api/projects/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          survivorId: survivorProj.id,
          absorbedId: proj(other).id,
          resolution,
        }),
      });
      if (!res.ok) {
        const { error: e } = await res.json().catch(() => ({ error: "" }));
        setError(e || "Merge failed.");
        setBusy(false);
        return;
      }
      onMerged(survivorProj.id);
    } catch {
      setError("Network error — merge not performed.");
      setBusy(false);
    }
  };

  const SurvivorCard = ({ side }: { side: Side }) => {
    const p = proj(side);
    const on = survivor === side;
    return (
      <button
        type="button"
        onClick={() => flip(side)}
        style={{
          flex: 1,
          textAlign: "left",
          border: `1.5px solid ${on ? ACCENT : "var(--field)"}`,
          background: on ? "color-mix(in oklab, #0fa392 8%, #fff)" : "#fff",
          borderRadius: 9,
          padding: "12px 14px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${on ? ACCENT : "#bbb"}`, background: on ? ACCENT : "#fff", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
            {txt(p.title) || "(untitled)"}
          </span>
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", paddingLeft: 22 }}>
          {p.id} · {(p.runs?.length ?? 0)} sem · {p.published ? "published" : "draft"}
        </div>
      </button>
    );
  };

  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div
        className="modal__panel"
        style={{ maxWidth: 620, textAlign: "left" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontFamily: "var(--display)", fontSize: 18, margin: "0 0 6px", color: "var(--ink)" }}>
          Merge two projects
        </h3>
        <p style={{ fontSize: 13, color: "var(--sec)", margin: "0 0 18px", lineHeight: 1.5 }}>
          Combines both records into one. The non-surviving record is{" "}
          <b>deleted</b> — its name is kept as an alias so PD syncs still match.
        </p>

        {/* Survivor choice */}
        <div className="lab" style={{ marginBottom: 8 }}>Keep this record (its URL survives)</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <SurvivorCard side="A" />
          <SurvivorCard side="B" />
        </div>

        {/* Conflict pickers */}
        {(textConflicts.length > 0 || boolConflicts.length > 0) && (
          <>
            <div className="lab" style={{ marginBottom: 8 }}>Resolve conflicting fields</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              {textConflicts.map(([f, label]) => (
                <div key={f}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--sec)", marginBottom: 5 }}>{label}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {(["A", "B"] as Side[]).map((side) => {
                      const val = txt(proj(side)[f] as string | null);
                      const on = pickText(f) === side;
                      return (
                        <button
                          key={side}
                          type="button"
                          onClick={() => setOverrides((o) => ({ ...o, [f]: side }))}
                          title={val}
                          style={{
                            textAlign: "left",
                            border: `1.5px solid ${on ? ACCENT : "var(--field)"}`,
                            background: on ? "color-mix(in oklab, #0fa392 7%, #fff)" : "#fff",
                            borderRadius: 7,
                            padding: "8px 10px",
                            cursor: "pointer",
                            fontSize: 12.5,
                            color: "var(--ink)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: f === "blurb" || f === "techNote" ? "normal" : "nowrap",
                            maxHeight: f === "blurb" || f === "techNote" ? 70 : undefined,
                            lineHeight: 1.4,
                          }}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {boolConflicts.map((f) => (
                <div key={f}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--sec)", marginBottom: 5 }}>
                    {f === "published" ? "Published" : "Featured"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {(["A", "B"] as Side[]).map((side) => {
                      const on = pickBool(f) === side;
                      return (
                        <button
                          key={side}
                          type="button"
                          onClick={() => setOverrides((o) => ({ ...o, [f]: side }))}
                          style={{
                            border: `1.5px solid ${on ? ACCENT : "var(--field)"}`,
                            background: on ? "color-mix(in oklab, #0fa392 7%, #fff)" : "#fff",
                            borderRadius: 7, padding: "8px 10px", cursor: "pointer",
                            fontSize: 12.5, color: "var(--ink)",
                          }}
                        >
                          {proj(side).title?.slice(0, 18) || side}: {proj(side)[f] ? "yes" : "no"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Auto-combine preview */}
        <div
          style={{
            background: "#f6faf9", border: "1px solid #e3efed", borderRadius: 8,
            padding: "11px 13px", marginBottom: 18, fontSize: 12.5, color: "var(--sec)", lineHeight: 1.6,
          }}
        >
          <b style={{ color: "var(--ink)" }}>Combined automatically:</b> {semesters} semester
          {semesters !== 1 ? "s" : ""} (each keeps its own team &amp; PD) · up to {contribApprox} contributor
          {contribApprox !== 1 ? "s" : ""} · {techCount} tech tag{techCount !== 1 ? "s" : ""} · {imageCount} image
          {imageCount !== 1 ? "s" : ""}.
        </div>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={submit}
            disabled={busy}
            style={{ background: ACCENT, color: "#fff", borderColor: "transparent", cursor: busy ? "not-allowed" : "pointer" }}
          >
            {busy ? "Merging…" : "Merge projects"}
          </button>
        </div>
      </div>
    </div>
  );
}
