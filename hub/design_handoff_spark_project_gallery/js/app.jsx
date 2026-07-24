// Root — Editorial gallery (locked in) + tweaks + shared detail overlay + Admin link.
const { useState: useAppState, useEffect: useAppEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#0fa392",
  "fontPair": "Grotesk",
  "density": "compact",
  "showPhotos": true,
  "layout": "grid"
}/*EDITMODE-END*/;

const FONT_PAIRS = {
  "Grotesk": { display: "'Space Grotesk', sans-serif", body: "'IBM Plex Sans', sans-serif" },
  "Editorial": { display: "'Spectral', Georgia, serif", body: "'IBM Plex Sans', sans-serif" },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [active, setActive] = useAppState(null);
  const [projects, setProjects] = useAppState(() => window.SparkStore.getProjects());

  useAppEffect(() => {
    const refresh = () => setProjects(window.SparkStore.getProjects());
    const unsub = window.SparkStore.subscribe(refresh);
    window.addEventListener("focus", refresh);
    return () => { unsub(); window.removeEventListener("focus", refresh); };
  }, []);

  const fonts = FONT_PAIRS[t.fontPair] || FONT_PAIRS.Grotesk;
  const rootStyle = {
    "--accent": t.accent,
    "--display": fonts.display,
    "--body": fonts.body,
    "--mono": "'IBM Plex Mono', monospace",
    fontFamily: fonts.body,
    minHeight: "100vh",
  };

  return (
    <div style={rootStyle}>
      <DirectionA projects={projects} t={t} onOpen={setActive} />

      {active && <ProjectDetail project={active} onClose={() => setActive(null)} accent={t.accent} />}

      {/* Floating Admin button */}
      <a href="Spark Admin.html" title="Admin — add a project" style={{
        position: "fixed", bottom: 24, right: 24, zIndex: 500,
        display: "inline-flex", alignItems: "center", gap: 9, textDecoration: "none",
        background: "#0e1211", color: "#fff", padding: "12px 20px 12px 17px",
        borderRadius: 999, boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
        fontFamily: "var(--body)", fontSize: 14, fontWeight: 600,
      }}>
        <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%", background: t.accent, color: "#08110f", fontSize: 17, lineHeight: 1 }}>+</span>
        Add a project
      </a>

      <TweaksPanel>
        <TweakSection label="Brand accent" />
        <TweakColor label="Teal" value={t.accent} options={["#0fa392", "#12b9a4", "#0a7d70", "#168fb0"]} onChange={(v) => setTweak("accent", v)} />
        <TweakSection label="Typography" />
        <TweakRadio label="Font pairing" value={t.fontPair} options={["Grotesk", "Editorial"]} onChange={(v) => setTweak("fontPair", v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Default view" value={t.layout} options={["grid", "list"]} onChange={(v) => setTweak("layout", v)} />
        <TweakRadio label="Card density" value={t.density} options={["compact", "regular", "comfy"]} onChange={(v) => setTweak("density", v)} />
        <TweakToggle label="Show project images" value={t.showPhotos} onChange={(v) => setTweak("showPhotos", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
