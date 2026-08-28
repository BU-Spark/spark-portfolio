// Admin — add a project to the Spark! gallery (persists via SparkStore + localStorage).
const { useState, useEffect, useMemo } = React;

const ACCENT = "#0fa392";

function Label({ children, required }) {
  return (
    <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a8a8a", marginBottom: 7 }}>
      {children}{required && <span style={{ color: ACCENT }}> *</span>}
    </label>
  );
}

function Field({ label, required, children, hint }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Label required={required}>{label}</Label>
      {children}
      {hint && <div style={{ fontSize: 12, color: "#9a9a9a", marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function TagInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div style={{ border: "1px solid #d8d8d8", borderRadius: 7, padding: 8, background: "#fff", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {value.map((tag) => (
        <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `color-mix(in oklab, ${ACCENT} 12%, #fff)`, color: `color-mix(in oklab, ${ACCENT} 72%, #000)`, borderRadius: 5, padding: "4px 8px", fontSize: 13, fontFamily: "var(--mono)" }}>
          {tag}
          <button onClick={() => onChange(value.filter((x) => x !== tag))} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={value.length ? "" : placeholder}
        style={{ border: "none", outline: "none", flex: 1, minWidth: 120, fontSize: 14, padding: "4px 2px", background: "transparent" }}
      />
    </div>
  );
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

function App() {
  const blank = {
    title: "", blurb: "", discipline: "", program: "",
    partner: "", clientType: "", term: "", course: "",
    tech: [], team: [],
  };
  const [form, setForm] = useState(blank);
  const [draftId, setDraftId] = useState(() => Date.now().toString(36));
  const [toast, setToast] = useState(null);
  const [custom, setCustom] = useState(() => window.SparkStore.getCustom());

  useEffect(() => window.SparkStore.subscribe(() => setCustom(window.SparkStore.getCustom())), []);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setVal = (k) => (e) => set(k)(e.target.value);

  const imageSlotIds = [0, 1, 2, 3].map((i) => `proj-${draftId}-img-${i}`);

  const required = ["title", "blurb", "discipline", "program", "partner", "clientType", "term"];
  const missing = required.filter((k) => !String(form[k]).trim());
  const valid = missing.length === 0;

  const submit = () => {
    if (!valid) {
      setToast({ type: "err", msg: `Please fill: ${missing.join(", ")}` });
      return;
    }
    const id = `${slugify(form.title)}-${draftId}`;
    const project = {
      id,
      title: form.title.trim(),
      blurb: form.blurb.trim(),
      discipline: form.discipline,
      program: form.program,
      clientType: form.clientType,
      partner: form.partner.trim(),
      term: form.term,
      course: form.course.trim() || "—",
      tech: form.tech.length ? form.tech : ["—"],
      team: form.team.length ? form.team : ["TBD"],
      imageSlots: imageSlotIds,
      featured: false,
      custom: true,
    };
    window.SparkStore.addProject(project);
    setToast({ type: "ok", msg: `“${project.title}” added to the gallery.` });
    setForm(blank);
    setDraftId(Date.now().toString(36));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Header */}
      <header style={{ background: "#0e1211", color: "#fff" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 32px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 19, whiteSpace: "nowrap" }}>BU Spark!</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "#8c948f", letterSpacing: "0.04em" }}>/ admin</span>
          </div>
          <a href="Spark Project Gallery.html" style={{ textDecoration: "none", color: "#c2c8c5", fontSize: 13.5, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 7 }}>← Back to gallery</a>
        </div>
      </header>

      {toast && (
        <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", zIndex: 100, background: toast.type === "ok" ? "#0e1211" : "#b3261e", color: "#fff", padding: "13px 20px", borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,0.25)", fontSize: 14, display: "flex", alignItems: "center", gap: 12, animation: "sparkFade 0.25s ease" }}>
          <span>{toast.type === "ok" ? "✓" : "!"}</span>{toast.msg}
          {toast.type === "ok" && <a href="Spark Project Gallery.html" style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>View →</a>}
        </div>
      )}

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 32px 90px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 40, alignItems: "start" }}>
        {/* Form */}
        <main style={{ background: "#fff", borderRadius: 14, border: "1px solid #e6e6e6", padding: "34px 36px" }}>
          <h1 style={{ fontFamily: "var(--display)", fontSize: 26, letterSpacing: "-0.01em", color: "#16191c", margin: "0 0 6px" }}>Add a project</h1>
          <p style={{ fontSize: 14.5, color: "#6a6f74", margin: "0 0 30px", lineHeight: 1.5 }}>New projects appear in the public gallery immediately and are searchable by every facet.</p>

          <Field label="Project title" required>
            <input className="fld" value={form.title} onChange={setVal("title")} placeholder="e.g. Boston 311 Service Equity Dashboard" />
          </Field>

          <Field label="Short description" required hint="One or two sentences shown on the card and detail view.">
            <textarea className="fld" value={form.blurb} onChange={setVal("blurb")} placeholder="What the project does and who it helps…" />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <Field label="Discipline" required>
              <select className="fld" value={form.discipline} onChange={setVal("discipline")}>
                <option value="">Select…</option>
                {window.SPARK_DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Program" required>
              <select className="fld" value={form.program} onChange={setVal("program")}>
                <option value="">Select…</option>
                {window.SPARK_PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
            <Field label="Client / partner" required hint="The organization's name — e.g. City of Boston, The Boston Globe.">
              <input className="fld" value={form.partner} onChange={setVal("partner")} placeholder="Organization name" />
            </Field>
            <Field label="Client type" required>
              <select className="fld" value={form.clientType} onChange={setVal("clientType")}>
                <option value="">Select…</option>
                {window.SPARK_CLIENT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 18 }}>
            <Field label="Term" required>
              <select className="fld" value={form.term} onChange={setVal("term")}>
                <option value="">Select…</option>
                {window.SPARK_TERMS.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
                <option value="Fall 2026">Fall 2026</option>
              </select>
            </Field>
            <Field label="Course">
              <input className="fld" value={form.course} onChange={setVal("course")} placeholder="e.g. DS 549: Spark! Data Science Practicum" />
            </Field>
          </div>

          <Field label="Tech stack" hint="Type and press Enter to add each technology.">
            <TagInput value={form.tech} onChange={set("tech")} placeholder="Python, React, D3.js…" />
          </Field>

          <Field label="Student team" hint="Type a name and press Enter.">
            <TagInput value={form.team} onChange={set("team")} placeholder="Add team member…" />
          </Field>

          <Field label="Project images" hint="Drag an image onto each slot (or click to browse). The first is the cover; up to four show in the detail view.">
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gridTemplateRows: "auto auto", gap: 8 }}>
              {React.createElement("image-slot", { id: imageSlotIds[0], shape: "rounded", radius: "8", placeholder: "Cover image", style: { width: "100%", aspectRatio: "16 / 11", gridRow: "span 2" } })}
              {React.createElement("image-slot", { id: imageSlotIds[1], shape: "rounded", radius: "8", placeholder: "Image 2", style: { width: "100%", aspectRatio: "4 / 3" } })}
              {React.createElement("image-slot", { id: imageSlotIds[2], shape: "rounded", radius: "8", placeholder: "Image 3", style: { width: "100%", aspectRatio: "4 / 3" } })}
              {React.createElement("image-slot", { id: imageSlotIds[3], shape: "rounded", radius: "8", placeholder: "Image 4", style: { width: "100%", aspectRatio: "4 / 3", gridColumn: "2 / 4" } })}
            </div>
          </Field>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 30, paddingTop: 24, borderTop: "1px solid #eee" }}>
            <button onClick={submit} disabled={!valid} style={{ padding: "13px 26px", border: "none", borderRadius: 7, cursor: valid ? "pointer" : "not-allowed", background: valid ? "#16191c" : "#cfcfcf", color: "#fff", fontFamily: "var(--display)", fontSize: 15, fontWeight: 600 }}>
              Add to gallery
            </button>
            <button onClick={() => { setForm(blank); setDraftId(Date.now().toString(36)); }} style={{ padding: "13px 20px", border: "1px solid #d8d8d8", borderRadius: 7, cursor: "pointer", background: "#fff", color: "#55595e", fontSize: 14.5, fontWeight: 500 }}>Clear</button>
            {!valid && <span style={{ fontSize: 12.5, color: "#a0a0a0", fontFamily: "var(--mono)" }}>{missing.length} required field{missing.length === 1 ? "" : "s"} left</span>}
          </div>
        </main>

        {/* Sidebar */}
        <aside style={{ position: "sticky", top: 24, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e6e6e6", padding: "20px 22px" }}>
            <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 15, color: "#16191c", marginBottom: 4 }}>Gallery status</div>
            <div style={{ fontSize: 13, color: "#6a6f74", lineHeight: 1.5 }}>
              <strong style={{ color: "#16191c" }}>{window.SPARK_PROJECTS.length + custom.length}</strong> projects live ·{" "}
              <strong style={{ color: ACCENT }}>{custom.length}</strong> added by you
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e6e6e6", padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 15, color: "#16191c" }}>Your additions</span>
              {custom.length > 0 && <button onClick={() => { if (confirm("Remove all projects you've added?")) window.SparkStore.clearCustom(); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, color: "#b3261e", fontFamily: "var(--mono)" }}>clear all</button>}
            </div>
            {custom.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9a9a9a", lineHeight: 1.5 }}>Nothing yet. Projects you add will be listed here and saved to this browser.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {custom.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderTop: "1px solid #f1f1f1" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#16191c", lineHeight: 1.25 }}>{p.title}</div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "#9a9a9a", marginTop: 3 }}>{p.discipline} · {p.term}</div>
                    </div>
                    <button onClick={() => window.SparkStore.removeCustom(p.id)} title="Remove" style={{ border: "none", background: "none", cursor: "pointer", color: "#b3b3b3", fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: `color-mix(in oklab, ${ACCENT} 8%, #fff)`, borderRadius: 12, border: `1px solid color-mix(in oklab, ${ACCENT} 20%, #eee)`, padding: "18px 20px", fontSize: 12.5, color: "#4a5560", lineHeight: 1.55 }}>
            <strong style={{ color: "#16191c" }}>Prototype note</strong><br />
            Additions are saved to your browser so you can preview the full flow. A production version would write to the shared Spark! database.
          </div>
        </aside>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
