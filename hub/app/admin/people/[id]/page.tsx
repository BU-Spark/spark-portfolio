"use client";
// Person profile — /admin/people/[id]. The Spark Control "Role journey" centerpiece:
// a SparkFlow streamgraph of the person's roles over time (click a ribbon to zoom
// into its per-semester projects), plus a hero with live "now" role chips, a stat
// strip, the project list, and a contact side panel. Admin-only (gated route).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import SparkFlow from "@/components/admin/SparkFlow";
import PageHeader from "@/components/admin/PageHeader";
import { useToast } from "@/components/admin/useToast";
import { activeAt, color, type RoleStint, type DetailMap } from "@/components/admin/sparkFlowMath";

interface Profile {
  id: string; name: string; email: string | null; aliases: string[]; notes: string | null;
  roles: RoleStint[]; detail: DetailMap;
  projects: { id: string; title: string; term: string; role: string }[];
  stats: { rolesHeld: number; termsActive: number; projects: number; sinceTerm: string | null };
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";
}

export default function PersonProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toastEl, notify } = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const now = new Date();

  // Edit + merge state (editing relocated here from the directory).
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [aliases, setAliases] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);
  const [mergeTarget, setMergeTarget] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/people/${id}`)
      .then((r) => { if (r.status === 404) { setNotFound(true); return null; } return r.ok ? r.json() : null; })
      .then((d) => {
        if (d?.profile) {
          setP(d.profile);
          setEmail(d.profile.email ?? "");
          setAliases((d.profile.aliases ?? []).join(", "));
          setNotes(d.profile.notes ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Other people for the merge picker.
  useEffect(() => {
    fetch("/api/people").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.people) setOthers(d.people.filter((x: { id: string }) => String(x.id) !== String(id)).map((x: { id: string; name: string }) => ({ id: String(x.id), name: x.name })));
    }).catch(() => {});
  }, [id]);

  const active = p ? activeAt(p.roles, now) : [];

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/people", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: Number(id), email: email.trim() || null, notes: notes.trim() || null,
          aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) { notify("err", "Couldn't save."); return; }
      notify("ok", "Saved.");
      setEditing(false);
      setP((cur) => cur ? { ...cur, email: email.trim() || null, notes: notes.trim() || null, aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean) } : cur);
    } catch { notify("err", "Couldn't save."); }
    finally { setSaving(false); }
  };

  const doMerge = async () => {
    if (!mergeTarget) return;
    const target = others.find((o) => o.id === mergeTarget);
    if (!confirm(`Merge "${p?.name}" into "${target?.name}"? Its name variants become aliases of ${target?.name}, and "${p?.name}" is removed.`)) return;
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "merge", sourceId: Number(id), targetId: Number(mergeTarget) }),
    });
    if (!res.ok) { notify("err", "Merge failed."); return; }
    router.push(`/admin/people/${mergeTarget}`);
  };

  const doDelete = async () => {
    if (!confirm(`Delete "${p?.name}" from the directory? This removes the person record (project role data is unaffected).`)) return;
    const res = await fetch("/api/people", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(id) }),
    });
    if (!res.ok) { notify("err", "Delete failed."); return; }
    router.push("/admin/people");
  };

  return (
    <>
      {toastEl}
      <PageHeader eyebrow="People / Profile" title={p?.name ?? (notFound ? "Not found" : "…")} />
      <div className="content">
        <Link href="/admin/people" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
          ← All people
        </Link>

        {notFound ? (
          <div className="card card-pad">This person could not be found.</div>
        ) : loading || !p ? (
          <div className="card card-pad"><div className="sk" style={{ height: 84, borderRadius: 14 }} /></div>
        ) : (
          <>
            {/* Hero */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 22, padding: "26px 28px" }}>
                <div style={{ width: 84, height: 84, borderRadius: 22, flexShrink: 0, background: "linear-gradient(150deg,var(--teal),var(--teal-deep))", color: "#042a25", display: "grid", placeItems: "center", fontFamily: "var(--display)", fontWeight: 700, fontSize: 32, boxShadow: "var(--sh-teal)" }}>
                  {initialsOf(p.name)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--display)", fontSize: 27, fontWeight: 700, letterSpacing: "-.02em" }}>{p.name}</div>
                  <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center" }}>
                    {p.email && <span>✉ {p.email}</span>}
                    {p.stats.sinceTerm && <span>◷ Spark! since {p.stats.sinceTerm}</span>}
                  </div>
                  {active.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
                      {active.map((role) => (
                        <span key={role} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 500, borderRadius: 999, padding: "5px 12px 5px 9px", border: `1px solid ${color(role, "solid")}33`, color: color(role, "deep"), background: color(role, "tint") }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color(role, "solid") }} />
                          {role} · now
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 9, alignItems: "flex-end" }}>
                  <button className="btn btn-teal" onClick={() => setEditing((e) => !e)}>{editing ? "Done editing" : "Edit person"}</button>
                  {p.email && <a className="tlink" href={`mailto:${p.email}`}>✉ {p.email}</a>}
                </div>
              </div>
              {/* Stat strip */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "var(--line)", borderTop: "1px solid var(--line)" }}>
                {[
                  { n: p.stats.rolesHeld, l: "Roles held" },
                  { n: p.stats.termsActive, l: "Terms active" },
                  { n: p.stats.projects, l: "Projects" },
                  { n: active.length, l: "Active now" },
                ].map((s) => (
                  <div key={s.l} style={{ background: "var(--panel)", padding: "16px 22px" }}>
                    <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 22 }}>{s.n}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink-4)", marginTop: 4 }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Two-column layout */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, marginTop: 20, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
                {/* Journey */}
                <div className="card card-pad">
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, marginBottom: 6 }}>
                    <div>
                      <div className="eyebrow">Role journey</div>
                      <div className="sec-title" style={{ marginTop: 5 }}>How {p.name.split(" ")[0]}&apos;s involvement has flowed</div>
                    </div>
                    <span className="badge b-teal">streamgraph</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
                    Each ribbon is a role; the river swells where roles overlap. <b style={{ color: "var(--ink-2)" }}>Click any ribbon</b> to zoom in — it splits into its projects, semester by semester.
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <SparkFlow roles={p.roles} detail={p.detail} now={now} height={300} />
                  </div>
                </div>

                {/* Projects */}
                <div className="card card-pad">
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Projects</div>
                  <div className="sec-title" style={{ marginBottom: 8 }}>Involved in {p.projects.length} project{p.projects.length === 1 ? "" : "s"}</div>
                  {p.projects.length === 0 ? (
                    <div style={{ color: "var(--ink-4)", fontSize: 13.5, padding: "10px 0" }}>No project roles recorded.</div>
                  ) : p.projects.map((proj) => (
                    <Link key={proj.id} href={`/admin/edit/${proj.id}`} style={{ display: "flex", gap: 13, alignItems: "center", padding: "13px 0", borderTop: "1px solid var(--line-2)" }}>
                      <div style={{ width: 52, height: 40, borderRadius: 8, flexShrink: 0, background: "repeating-linear-gradient(125deg,#e7ece9 0 10px,#f2f5f2 10px 20px)" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 14.5 }}>{proj.title}</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)", marginTop: 3 }}>{proj.term}</div>
                      </div>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, borderRadius: 6, padding: "3px 8px", color: color(proj.role, "deep"), background: color(proj.role, "tint") }}>{proj.role}</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Side panel */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div className="card card-pad">
                  <div className="eyebrow" style={{ marginBottom: 14 }}>Contact &amp; details</div>
                  {editing ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div><label className="lab">Email</label><input className="fld" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@bu.edu" /></div>
                      <div><label className="lab">Aliases (comma-separated)</label><input className="fld" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="maya, m. patel" /></div>
                      <div><label className="lab">Internal note</label><textarea className="fld" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Admin-only note" /></div>
                      <button className="btn btn-teal" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <Row k="Email" v={p.email ? <a href={`mailto:${p.email}`} style={{ color: "var(--teal-deep)" }}>{p.email}</a> : <span style={{ color: "var(--amber)" }}>none on file</span>} />
                      <Row k="Aliases" v={p.aliases.length ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{p.aliases.map((a) => <span key={a} className="chip">{a}</span>)}</div>
                      ) : <span style={{ color: "var(--ink-4)" }}>—</span>} />
                    </div>
                  )}
                </div>

                {!editing && p.notes && (
                  <div className="card card-pad">
                    <div className="eyebrow" style={{ marginBottom: 10 }}>Internal note</div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)", background: "var(--amber-bg)", border: "1px solid var(--amber-line)", borderRadius: 10, padding: "12px 14px" }}>{p.notes}</div>
                  </div>
                )}

                {editing && (
                  <div className="card card-pad">
                    <div className="eyebrow" style={{ marginBottom: 12 }}>Merge &amp; remove</div>
                    <label className="lab">Merge this person into…</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select className="fld" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={{ flex: 1 }}>
                        <option value="">— choose a person —</option>
                        {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      <button className="btn-sm" onClick={doMerge} disabled={!mergeTarget}>Merge</button>
                    </div>
                    <p className="hint">Name variants become aliases of the survivor; this record is removed.</p>
                    <button className="btn-sm" onClick={doDelete} style={{ marginTop: 12, color: "var(--rose)", borderColor: "var(--rose-line)" }}>Delete person</button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-4)" }}>{k}</span>
      <span style={{ fontSize: 14, color: "var(--ink)" }}>{v}</span>
    </div>
  );
}
