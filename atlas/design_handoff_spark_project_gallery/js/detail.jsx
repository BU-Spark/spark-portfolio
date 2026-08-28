// Shared project detail overlay — slides in from the right, used by all directions.
const { useEffect: useDetailEffect } = React;

const GALLERY_CAPTIONS = ["Overview", "Interface", "Process", "Outcome"];

function GalleryImage({ project, index, primary }) {
  const { disciplineColor } = window.SparkShared;
  const color = disciplineColor(project.discipline);
  const caption = GALLERY_CAPTIONS[index] || `Image ${index + 1}`;
  const slotId = project.imageSlots && project.imageSlots[index];
  const radius = primary ? 10 : 7;

  if (slotId) {
    return React.createElement("image-slot", {
      id: slotId,
      shape: "rounded",
      radius: String(radius),
      placeholder: caption,
      style: { width: "100%", aspectRatio: primary ? "16 / 9" : "4 / 3", display: "block" },
    });
  }
  const angle = 90 + ((index * 37 + project.id.length) % 4) * 30;
  return (
    <div style={{
      position: "relative", width: "100%", aspectRatio: primary ? "16 / 9" : "4 / 3",
      borderRadius: radius, overflow: "hidden",
      background: `repeating-linear-gradient(${angle}deg, color-mix(in oklab, ${color} ${18 - index * 2}%, #fff) 0 14px, color-mix(in oklab, ${color} 7%, #fff) 14px 28px)`,
      display: "flex", alignItems: "flex-end",
    }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 90% at ${20 + index * 20}% 12%, color-mix(in oklab, ${color} 26%, transparent), transparent 62%)` }} />
      <span style={{ position: "relative", margin: primary ? 14 : 9, fontFamily: "var(--mono)", fontSize: primary ? 11 : 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: `color-mix(in oklab, ${color} 70%, #1a1a1a)`, background: "rgba(255,255,255,0.78)", padding: primary ? "4px 9px" : "3px 6px", borderRadius: 2 }}>{caption}</span>
    </div>
  );
}

function ProjectDetail({ project, onClose, accent }) {
  useDetailEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!project) return null;
  const { disciplineColor } = window.SparkShared;
  const color = disciplineColor(project.discipline);

  const Meta = ({ label, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a8a8a" }}>{label}</span>
      <span style={{ fontSize: 15, color: "#1a1a1a", lineHeight: 1.4 }}>{children}</span>
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,18,20,0.55)", backdropFilter: "blur(3px)",
        display: "flex", justifyContent: "flex-end",
        animation: "sparkFade 0.2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(580px, 95vw)", height: "100%", background: "#fff",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column",
          animation: "sparkSlide 0.28s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 16, right: 16, zIndex: 5, width: 38, height: 38,
            borderRadius: "50%", border: "none", cursor: "pointer",
            background: "rgba(255,255,255,0.95)", color: "#1a1a1a",
            fontSize: 20, lineHeight: 1, display: "grid", placeItems: "center",
            boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
          }}
        >×</button>

        <div style={{ overflowY: "auto" }}>
          {/* Gallery */}
          <div style={{ padding: "0 0 4px" }}>
            <GalleryImage project={project} index={0} primary />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, padding: "6px 6px 0" }}>
              {[1, 2, 3].map((i) => <GalleryImage key={i} project={project} index={i} />)}
            </div>
          </div>

          <div style={{ padding: "26px 32px 48px" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, letterSpacing: "0.1em", color: accent, textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
              {project.discipline} · {project.program} · {project.term}
            </div>
            <h2 style={{ fontFamily: "var(--display)", fontSize: 28, lineHeight: 1.12, margin: "0 0 18px", color: "#16191c", letterSpacing: "-0.01em" }}>
              {project.title}
            </h2>

            {/* Prominent client block */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", background: `color-mix(in oklab, ${accent} 7%, #fafafa)`, border: `1px solid color-mix(in oklab, ${accent} 18%, #eee)`, borderRadius: 10, marginBottom: 22 }}>
              <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, background: "#fff", border: "1px solid #e6e6e6", display: "grid", placeItems: "center", fontFamily: "var(--display)", fontWeight: 700, fontSize: 16, color: accent }}>
                {project.partner.replace(/^(The )/, "").trim().split(/[\s—-]+/).slice(0, 2).map((w) => w[0]).join("")}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a8a8a" }}>Client</div>
                <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 17, color: "#16191c", lineHeight: 1.2, marginTop: 2 }}>{project.partner}</div>
              </div>
              <span style={{ marginLeft: "auto", flexShrink: 0, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: accent, border: `1px solid color-mix(in oklab, ${accent} 35%, #fff)`, borderRadius: 999, padding: "4px 11px" }}>{project.clientType}</span>
            </div>

            <p style={{ fontSize: 16, lineHeight: 1.6, color: "#3a3f44", margin: "0 0 26px" }}>
              {project.blurb}
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "22px 24px", paddingTop: 24, borderTop: "1px solid #ececec" }}>
              <Meta label="Course">{project.course}</Meta>
              <Meta label="Term">{project.term}</Meta>
              <Meta label="Program">{project.program}</Meta>
              <Meta label="Discipline">{project.discipline}</Meta>
            </div>

            <div style={{ marginTop: 26 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a8a8a" }}>Tech Stack</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {project.tech.map((tch) => (
                  <span key={tch} style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "#2a2f33", border: "1px solid #dcdcdc", borderRadius: 3, padding: "5px 10px", background: "#fafafa" }}>{tch}</span>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 26 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a8a8a" }}>Student Team</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
                {project.team.map((tm) => (
                  <span key={tm} style={{ fontSize: 14, color: "#1a1a1a", display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: `color-mix(in oklab, ${color} 22%, #fff)`, color: `color-mix(in oklab, ${color} 75%, #000)`, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, fontFamily: "var(--mono)" }}>
                      {tm.trim().split(" ").map((n) => n[0]).slice(0, 2).join("")}
                    </span>
                    {tm.trim()}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 34 }}>
              <button style={{ flex: 1, padding: "13px 18px", border: "none", cursor: "pointer", background: "#16191c", color: "#fff", fontFamily: "var(--display)", fontSize: 14.5, fontWeight: 600, borderRadius: 4 }}>View project →</button>
              <button style={{ padding: "13px 18px", cursor: "pointer", borderRadius: 4, background: "#fff", color: "#16191c", border: "1px solid #d4d4d4", fontFamily: "var(--display)", fontSize: 14.5, fontWeight: 600 }}>Contact team</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ProjectDetail = ProjectDetail;
