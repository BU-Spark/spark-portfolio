// Editorial — the locked-in Spark! gallery. White showcase, sidebar filters, grid + list views.
function DirectionA({ projects, t, onOpen }) {
  const { Thumb, disciplineColor } = window.SparkShared;
  const f = window.SparkShared.useFilters(projects);
  const accent = t.accent;
  const [view, setView] = React.useState(t.layout || "grid");
  React.useEffect(() => { if (t.layout) setView(t.layout); }, [t.layout]);
  const gap = t.density === "compact" ? 18 : t.density === "comfy" ? 34 : 26;
  const minCard = t.density === "compact" ? 230 : t.density === "comfy" ? 320 : 270;

  const FacetGroup = ({ title, values, selected, onToggle, counts }) => (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "#9a9a9a", marginBottom: 12 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {values.map((v) => {
          const on = selected.has(v);
          return (
            <label key={v} onClick={() => onToggle(v)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: on ? "#16191c" : "#55595e" }}>
              <span style={{
                width: 17, height: 17, borderRadius: 3, flexShrink: 0,
                border: on ? `1px solid ${accent}` : "1px solid #cdcdcd",
                background: on ? accent : "#fff",
                display: "grid", placeItems: "center",
              }}>
                {on && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>}
              </span>
              <span style={{ flex: 1 }}>{v}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "#b4b4b4" }}>{counts[v] || 0}</span>
            </label>
          );
        })}
      </div>
    </div>
  );

  const TechTags = ({ tech, max = 3 }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {tech.slice(0, max).map((x) => <span key={x} style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "#6a6f74", background: "#f1f2f1", borderRadius: 3, padding: "2px 6px" }}>{x}</span>)}
    </div>
  );

  return (
    <div style={{ background: "#fff", minHeight: "100%" }}>
      {/* Masthead */}
      <header style={{ borderBottom: "1px solid #ececec", padding: "0 40px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, maxWidth: 1340, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 19, color: "#16191c", whiteSpace: "nowrap" }}>BU Spark!</span>
            <span style={{ width: 1, height: 16, background: "#d4d4d4" }} />
            <span style={{ fontSize: 14, color: "#6a6f74" }}>Project Gallery</span>
          </div>
          <nav style={{ display: "flex", gap: 26, fontSize: 13.5, color: "#55595e" }}>
            <span>About</span><span>Programs</span><span style={{ color: accent, fontWeight: 600 }}>Projects</span><span>Partner with us</span>
          </nav>
        </div>
      </header>

      {/* Intro band */}
      <div style={{ padding: "44px 40px 30px", maxWidth: 1340, margin: "0 auto" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.12em", color: accent, textTransform: "uppercase", marginBottom: 14 }}>Explore our work</div>
        <h1 style={{ fontFamily: "var(--display)", fontSize: "clamp(30px, 4vw, 46px)", lineHeight: 1.05, letterSpacing: "-0.02em", color: "#16191c", margin: 0, maxWidth: 720 }}>
          Student-built projects, with real partners and real impact.
        </h1>
        <p style={{ fontSize: 16.5, lineHeight: 1.6, color: "#55595e", maxWidth: 620, marginTop: 18 }}>
          Browse work from our practicums, hackathons, and co-labs — searchable by discipline, program, partner, and the technologies behind each build.
        </p>
      </div>

      {/* Body: sidebar + results */}
      <div style={{ display: "grid", gridTemplateColumns: "248px 1fr", gap: 44, maxWidth: 1340, margin: "0 auto", padding: "10px 40px 110px", alignItems: "start" }}>
        <aside style={{ position: "sticky", top: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 16, color: "#16191c" }}>Filters</span>
            {f.activeCount > 0 && (
              <button onClick={f.clearAll} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12.5, color: accent, fontFamily: "var(--mono)" }}>Clear ({f.activeCount})</button>
            )}
          </div>
          <FacetGroup title="Discipline" values={window.SPARK_DISCIPLINES} selected={f.disciplines} onToggle={f.toggleDiscipline} counts={f.counts.discipline} />
          <FacetGroup title="Program" values={window.SPARK_PROGRAMS} selected={f.programs} onToggle={f.toggleProgram} counts={f.counts.program} />
          <FacetGroup title="Client Type" values={window.SPARK_CLIENT_TYPES} selected={f.clientTypes} onToggle={f.toggleClientType} counts={f.counts.clientType} />
          <FacetGroup title="Term" values={window.SPARK_TERMS} selected={f.terms} onToggle={f.toggleTerm} counts={f.counts.term} />
        </aside>

        <main>
          {/* Search + view/sort controls */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 15 }}>⌕</span>
              <input
                value={f.query}
                onChange={(e) => f.setQuery(e.target.value)}
                placeholder="Search projects, partners, tech…"
                style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px 12px 38px", border: "1px solid #dcdcdc", borderRadius: 6, fontSize: 14.5, fontFamily: "var(--body)", outline: "none", background: "#fff" }}
                onFocus={(e) => (e.target.style.borderColor = accent)}
                onBlur={(e) => (e.target.style.borderColor = "#dcdcdc")}
              />
            </div>
            <select value={f.sort} onChange={(e) => f.setSort(e.target.value)} style={{ padding: "12px 14px", border: "1px solid #dcdcdc", borderRadius: 6, fontSize: 14, fontFamily: "var(--body)", color: "#3a3f44", background: "#fff", cursor: "pointer" }}>
              <option value="term">Newest first</option>
              <option value="az">A–Z</option>
            </select>
            <div style={{ display: "flex", border: "1px solid #dcdcdc", borderRadius: 6, overflow: "hidden" }} title="View">
              {[["grid", "▦"], ["list", "≣"]].map(([v, icon]) => (
                <button key={v} onClick={() => setView(v)} aria-label={v + " view"} style={{ width: 42, height: 44, border: "none", borderLeft: v === "list" ? "1px solid #ececec" : "none", cursor: "pointer", background: view === v ? "#16191c" : "#fff", color: view === v ? "#fff" : "#9a9a9a", display: "grid", placeItems: "center", fontSize: 16 }}>{icon}</button>
              ))}
            </div>
          </div>

          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "#9a9a9a", marginBottom: 18 }}>
            {f.filtered.length} {f.filtered.length === 1 ? "project" : "projects"}
          </div>

          {f.filtered.length === 0 ? (
            <div style={{ padding: "80px 0", textAlign: "center", color: "#9a9a9a", fontSize: 15 }}>No projects match your filters. <button onClick={f.clearAll} style={{ color: accent, background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>Reset</button></div>
          ) : view === "list" ? (
            /* ---- LIST VIEW ---- */
            <div style={{ border: "1px solid #ececec", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,2.2fr) 1.1fr 1.3fr 0.8fr", gap: 16, padding: "11px 20px", background: "#f7f7f6", borderBottom: "1px solid #ececec", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a0a0a0" }}>
                <span>Project</span><span>Discipline</span><span>Client</span><span>Term</span>
              </div>
              {f.filtered.map((p, i) => (
                <div key={p.id} onClick={() => onOpen(p)} className="spark-row" style={{ display: "grid", gridTemplateColumns: "minmax(260px,2.2fr) 1.1fr 1.3fr 0.8fr", gap: 16, padding: "15px 20px", alignItems: "center", cursor: "pointer", borderBottom: i === f.filtered.length - 1 ? "none" : "1px solid #f2f2f2" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
                    {t.showPhotos && <div style={{ width: 54, height: 40, flexShrink: 0, borderRadius: 5, overflow: "hidden" }}><Thumb project={p} ratio="54 / 40" label={false} /></div>}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 15, color: "#16191c", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                      <div style={{ marginTop: 5 }}><TechTags tech={p.tech} max={3} /></div>
                    </div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "#3a3f44" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: disciplineColor(p.discipline), flexShrink: 0 }} />{p.discipline}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#16191c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.partner}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#a4a4a4", marginTop: 3 }}>{p.clientType} · {p.program}</div>
                  </div>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "#6a6f74" }}>{p.term}</span>
                </div>
              ))}
            </div>
          ) : (
            /* ---- GRID VIEW (default) ---- */
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}px, 1fr))`, gap }}>
              {f.filtered.map((p) => (
                <article key={p.id} onClick={() => onOpen(p)} className="spark-card-a" style={{ cursor: "pointer", borderRadius: 8, overflow: "hidden", border: "1px solid #ececec", background: "#fff", display: "flex", flexDirection: "column" }}>
                  {t.showPhotos && <Thumb project={p} ratio="4 / 3" />}
                  <div style={{ padding: t.density === "compact" ? "14px 15px 16px" : "17px 18px 19px", display: "flex", flexDirection: "column", flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: disciplineColor(p.discipline) }} />
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9a9a9a" }}>{p.discipline} · {p.term}</span>
                    </div>
                    <h3 style={{ fontFamily: "var(--display)", fontSize: 17.5, lineHeight: 1.2, letterSpacing: "-0.01em", color: "#16191c", margin: "0 0 8px" }}>{p.title}</h3>
                    <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#6a6f74", margin: 0, flex: 1, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.blurb}</p>
                    <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12.5, color: "#3a3f44", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.partner}</span>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.06em", color: accent, textTransform: "uppercase", flexShrink: 0, marginLeft: 8 }}>{p.program}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
window.DirectionA = DirectionA;
