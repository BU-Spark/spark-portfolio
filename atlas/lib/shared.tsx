"use client";
// Shared brand system, helpers, and filtering logic for the Spark! gallery.
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  primaryDiscipline,
  primaryCourseCode,
  primaryRun,
  projectDisciplines,
  projectProgramLabels,
  projectTerms,
  termRank,
} from "./project";
import { courseLabel } from "./data";
import type { Project, FacetCounts } from "./types";
import type { InitialFilters } from "./filters";

// --- Discipline color coding -------------------------------------------------
// Definitions live in the pure lib/colors module (so server components can call
// disciplineColor); imported for internal use here and re-exported so existing
// "@/lib/shared" importers (e.g. Gallery) keep working unchanged.
import { DISCIPLINE_COLORS, disciplineColor, DISCIPLINE_ABBR } from "./colors";
export { DISCIPLINE_COLORS, disciplineColor, DISCIPLINE_ABBR };

// --- Thumbnail ---------------------------------------------------------------
// Renders the real cover image when present; otherwise a striped placeholder
// tinted per discipline (the prototype's design-time stand-in, kept as the
// empty/loading fallback per the handoff).
export function Thumb({
  project,
  ratio = "4 / 3",
  rounded = 0,
  label = true,
  badgeField = "discipline",
}: {
  project: Project;
  ratio?: string;
  rounded?: number;
  label?: boolean;
  badgeField?: "discipline" | "course" | "program";
}) {
  const pd = primaryDiscipline(project);
  const color = disciplineColor(pd);
  // The badge color always encodes discipline; its LABEL is field-configurable:
  //   discipline (default) → abbr (UX, SWE, DATAVIZ)
  //   course               → course code (XC473, DS539)
  //   program              → friendly program name (fell back to discipline abbr)
  const disciplineAbbr = DISCIPLINE_ABBR[pd] || pd;
  const badgeLabel =
    badgeField === "course"
      ? primaryCourseCode(project) || disciplineAbbr
      : badgeField === "program"
        ? courseLabel(primaryRun(project)?.course || "") || disciplineAbbr
        : disciplineAbbr;
  // Up to 3 topic pills at the bottom-left; the rest collapse into a "+N".
  const topics = project.topics ?? [];
  const shownTopics = topics.slice(0, 3);
  const extraTopics = topics.length - shownTopics.length;
  const cover = project.images && project.images[0];

  // Same overlay on both the image and placeholder branches.
  const topicPills = label && shownTopics.length > 0 && (
    <div
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        zIndex: 1,
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        maxWidth: "calc(100% - 16px)",
      }}
    >
      {shownTopics.map((t) => (
        <span
          key={t}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            letterSpacing: "0.04em",
            color: "#1a1a1a",
            background: "rgba(255,255,255,0.82)",
            padding: "2px 6px",
            borderRadius: 999,
          }}
        >
          {t}
        </span>
      ))}
      {extraTopics > 0 && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            letterSpacing: "0.04em",
            color: "#1a1a1a",
            background: "rgba(255,255,255,0.82)",
            padding: "2px 6px",
            borderRadius: 999,
          }}
        >
          +{extraTopics}
        </span>
      )}
    </div>
  );

  if (cover) {
    return (
      <div
        style={{
          position: "relative",
          aspectRatio: ratio,
          width: "100%",
          borderRadius: rounded,
          overflow: "hidden",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cover}
          alt={project.title}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
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
            {badgeLabel}
          </span>
        )}
        {topicPills}
      </div>
    );
  }

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
          {badgeLabel}
        </span>
      )}
      {topicPills}
    </div>
  );
}

// --- Filter state shape (for shareable URLs) ---------------------------------
// Seeded identically on the server (from searchParams) and the client so SSR
// and hydration agree. `view` lives in Gallery but travels in the URL too.
// Re-export so existing `import { type InitialFilters } from "@/lib/shared"`
// keeps working. The pure parser lives in lib/filters.ts (a non-client module)
// because the server gallery page calls it.
export type { InitialFilters };

// --- Filtering hook ----------------------------------------------------------
export function useFilters(
  projects: Project[],
  initial: InitialFilters = {},
  // The view is owned by the caller but participates in the shareable URL.
  view?: "grid" | "list"
) {
  const [query, setQuery] = useState(initial.query ?? "");
  const [disciplines, setDisciplines] = useState<Set<string>>(
    () => new Set(initial.disciplines ?? [])
  );
  const [programs, setPrograms] = useState<Set<string>>(
    () => new Set(initial.programs ?? [])
  );
  const [clientTypes, setClientTypes] = useState<Set<string>>(
    () => new Set(initial.clientTypes ?? [])
  );
  const [terms, setTerms] = useState<Set<string>>(
    () => new Set(initial.terms ?? [])
  );
  const [topics, setTopics] = useState<Set<string>>(
    () => new Set(initial.topics ?? [])
  );
  const [sort, setSort] = useState<"term" | "az">(initial.sort ?? "term");

  const toggle = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
      (value: string) => {
        setter((prev) => {
          const next = new Set(prev);
          if (next.has(value)) next.delete(value);
          else next.add(value);
          return next;
        });
      },
    []
  );

  const clearAll = useCallback(() => {
    setQuery("");
    setDisciplines(new Set());
    setPrograms(new Set());
    setClientTypes(new Set());
    setTerms(new Set());
    setTopics(new Set());
  }, []);

  // A project matches a facet if ANY of its runs qualifies (so a project that
  // moved UX→SWE shows under both). clientType is project-level.
  const latestRank = (p: Project) => {
    const ts = projectTerms(p).map(termRank);
    return ts.length ? Math.min(...ts) : Number.MAX_SAFE_INTEGER;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = projects.filter((p) => {
      const pd = projectDisciplines(p);
      const pp = projectProgramLabels(p);
      const pt = projectTerms(p);
      if (disciplines.size && !pd.some((d) => disciplines.has(d))) return false;
      if (programs.size && !pp.some((x) => programs.has(x))) return false;
      if (clientTypes.size && !clientTypes.has(p.clientType)) return false;
      if (terms.size && !pt.some((t) => terms.has(t))) return false;
      if (topics.size && !(p.topics ?? []).some((t) => topics.has(t))) return false;
      if (q) {
        const hay = [
          p.title,
          p.blurb,
          p.partner,
          p.clientType,
          ...(p.tech || []),
          ...p.runs.flatMap((r) => [r.course, r.discipline, r.term]),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort === "az") {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else {
      list = [...list].sort(
        (a, b) => latestRank(a) - latestRank(b) || a.title.localeCompare(b.title)
      );
    }
    return list;
  }, [projects, query, disciplines, programs, clientTypes, terms, topics, sort]);

  // Counts over the full dataset. A project contributes once per unique facet
  // value across its runs (not re-narrowed by other active filters).
  const counts = useMemo<FacetCounts>(() => {
    const c: FacetCounts = {
      discipline: {},
      topic: {},
      program: {},
      clientType: {},
      term: {},
    };
    const bump = (m: Record<string, number>, k: string) => {
      if (k) m[k] = (m[k] || 0) + 1;
    };
    projects.forEach((p) => {
      projectDisciplines(p).forEach((d) => bump(c.discipline, d));
      projectProgramLabels(p).forEach((x) => bump(c.program, x));
      projectTerms(p).forEach((t) => bump(c.term, t));
      (p.topics ?? []).forEach((t) => bump(c.topic, t));
      bump(c.clientType, p.clientType);
    });
    return c;
  }, [projects]);

  const activeCount =
    (query ? 1 : 0) +
    disciplines.size +
    programs.size +
    clientTypes.size +
    terms.size +
    topics.size;

  // --- Shareable filter URL --------------------------------------------------
  // Mirror filter/sort/view state into the query string with replaceState (no
  // navigation, no useSearchParams — avoids the Suspense boundary requirement).
  // Skip the very first run so we don't clobber/normalize the server-provided
  // URL before the user has interacted (and to keep hydration clean).
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    const q = query.trim();
    if (q) params.set("q", q);
    if (disciplines.size) params.set("discipline", [...disciplines].join(","));
    if (programs.size) params.set("program", [...programs].join(","));
    if (clientTypes.size)
      params.set("clientType", [...clientTypes].join(","));
    if (terms.size) params.set("term", [...terms].join(","));
    if (topics.size) params.set("topic", [...topics].join(","));
    if (sort !== "term") params.set("sort", sort);
    if (view && view !== "grid") params.set("view", view);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(window.history.state, "", url);
  }, [query, disciplines, programs, clientTypes, terms, topics, sort, view]);

  return {
    query,
    setQuery,
    disciplines,
    programs,
    clientTypes,
    terms,
    topics,
    toggleDiscipline: toggle(setDisciplines),
    toggleProgram: toggle(setPrograms),
    toggleClientType: toggle(setClientTypes),
    toggleTerm: toggle(setTerms),
    toggleTopic: toggle(setTopics),
    sort,
    setSort,
    clearAll,
    filtered,
    counts,
    activeCount,
  };
}
