// Shared brand system, helpers, and filtering logic for the Spark! Project Gallery.
// Exposed on window so each direction component can use it.
const { useState, useMemo, useCallback } = React;

// --- Discipline color coding -------------------------------------------------
// Harmonious set: fixed lightness/chroma in oklch, hue varied per discipline.
const DISCIPLINE_COLORS = {
  "UX": "oklch(0.64 0.15 25)",
  "SWE": "oklch(0.62 0.14 255)",
  "ML": "oklch(0.60 0.16 305)",
  "Data Visualization": "oklch(0.66 0.13 205)",
  "Data Science": "oklch(0.64 0.13 160)",
  "Innovation": "oklch(0.70 0.14 75)",
  "Misc": "oklch(0.62 0.03 260)",
};
function disciplineColor(d) {
  return DISCIPLINE_COLORS[d] || "oklch(0.6 0.03 260)";
}
// Short tag used on thumbnails
const DISCIPLINE_ABBR = {
  "UX": "UX",
  "SWE": "SWE",
  "ML": "ML",
  "Data Visualization": "DATAVIZ",
  "Data Science": "DATA SCI",
  "Innovation": "INNOV",
  "Misc": "MISC",
};

// --- Striped placeholder thumbnail (tinted per discipline) -------------------
function Thumb({ project, ratio = "4 / 3", rounded = 0, label = true }) {
  const color = disciplineColor(project.discipline);
  const seed = project.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const angle = 90 + (seed % 4) * 30;
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: ratio,
        width: "100%",
        borderRadius: rounded,
        overflow: "hidden",
        background: `repeating-linear-gradient(${angle}deg, color-mix(in oklab, ${color} 16%, #fff) 0 14px, color-mix(in oklab, ${color} 7%, #fff) 14px 28px)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 90% at 80% 10%, color-mix(in oklab, ${color} 30%, transparent), transparent 60%)`,
        }}
      />
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: `color-mix(in oklab, ${color} 70%, #1a1a1a)`,
          background: "rgba(255,255,255,0.7)",
          padding: "4px 9px",
          borderRadius: 2,
          zIndex: 1,
        }}
      >
        project image
      </span>
      {label && (
        <span
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 1,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.1em",
            color: "#fff",
            background: color,
            padding: "3px 8px",
            borderRadius: 2,
          }}
        >
          {DISCIPLINE_ABBR[project.discipline] || project.discipline}
        </span>
      )}
    </div>
  );
}

// --- Filtering hook ----------------------------------------------------------
function useFilters(projects) {
  const [query, setQuery] = useState("");
  const [disciplines, setDisciplines] = useState(() => new Set());
  const [programs, setPrograms] = useState(() => new Set());
  const [clientTypes, setClientTypes] = useState(() => new Set());
  const [terms, setTerms] = useState(() => new Set());
  const [sort, setSort] = useState("term"); // term | az

  const toggle = useCallback((setter) => (value) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setQuery("");
    setDisciplines(new Set());
    setPrograms(new Set());
    setClientTypes(new Set());
    setTerms(new Set());
  }, []);

  const termOrder = window.SPARK_TERMS;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = projects.filter((p) => {
      if (disciplines.size && !disciplines.has(p.discipline)) return false;
      if (programs.size && !programs.has(p.program)) return false;
      if (clientTypes.size && !clientTypes.has(p.clientType)) return false;
      if (terms.size && !terms.has(p.term)) return false;
      if (q) {
        const hay = [
          p.title, p.blurb, p.partner, p.course,
          p.discipline, p.program, p.clientType,
          ...(p.tech || []), ...(p.team || []),
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort === "az") {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else {
      list = [...list].sort(
        (a, b) => termOrder.indexOf(a.term) - termOrder.indexOf(b.term) || a.title.localeCompare(b.title)
      );
    }
    return list;
  }, [projects, query, disciplines, programs, clientTypes, terms, sort, termOrder]);

  // counts for facet values given OTHER active filters (kept simple: count over all projects)
  const counts = useMemo(() => {
    const c = { discipline: {}, program: {}, clientType: {}, term: {} };
    projects.forEach((p) => {
      c.discipline[p.discipline] = (c.discipline[p.discipline] || 0) + 1;
      c.program[p.program] = (c.program[p.program] || 0) + 1;
      c.clientType[p.clientType] = (c.clientType[p.clientType] || 0) + 1;
      c.term[p.term] = (c.term[p.term] || 0) + 1;
    });
    return c;
  }, [projects]);

  const activeCount =
    (query ? 1 : 0) + disciplines.size + programs.size + clientTypes.size + terms.size;

  return {
    query, setQuery,
    disciplines, programs, clientTypes, terms,
    toggleDiscipline: toggle(setDisciplines),
    toggleProgram: toggle(setPrograms),
    toggleClientType: toggle(setClientTypes),
    toggleTerm: toggle(setTerms),
    sort, setSort,
    clearAll, filtered, counts, activeCount,
  };
}

window.SparkShared = {
  DISCIPLINE_COLORS,
  disciplineColor,
  DISCIPLINE_ABBR,
  Thumb,
  useFilters,
};
