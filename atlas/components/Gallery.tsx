"use client";
// The Spark! gallery — masthead, intro, sidebar filters, grid + list views.
// Shipped defaults are baked in (the design-time tweaks panel is not part of
// the product): accent #0fa392, compact density, grid default, images on.
import { useState } from "react";
import Link from "next/link";
import {
  SPARK_TERMS,
  courseLabel,
  formatCourseCodes,
  DEFAULT_GALLERY_SETTINGS,
} from "@/lib/data";
import {
  Thumb,
  disciplineColor,
  useFilters,
  type InitialFilters,
} from "@/lib/shared";
import {
  primaryDiscipline,
  projectDisciplines,
  projectPrograms,
  projectProgramLabels,
  projectTerms,
  latestTerm,
  termRank,
  courseCode,
} from "@/lib/project";
import { cleanBlurb } from "@/lib/gdocs";
import AuthStrip from "@/components/AuthStrip";
import type { Project, FacetCounts, FacetKey, GallerySettings } from "@/lib/types";

const ACCENT = "#0fa392";
// Baked-in "compact" density.
const GAP = 18;
const MIN_CARD = 230;
const CARD_PADDING = "14px 15px 16px";

// BU Spark! logo. Drop the file at public/spark-logo.png and it appears in both
// slots; until then the <img> hides itself via onError so nothing breaks.
const LOGO_SRC = "/spark-logo.png";
function SparkLogo({
  height,
  style,
  className,
}: {
  height: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt="BU Spark!"
      className={className}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
      style={{ height, width: "auto", display: "block", ...style }}
    />
  );
}

function FacetGroup({
  title,
  values,
  selected,
  onToggle,
  counts,
  labelFor,
}: {
  title: string;
  values: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  counts: Record<string, number>;
  // Optional display transform; the raw value stays the filter key + count key.
  labelFor?: (v: string) => string;
}) {
  return (
    <div style={{ marginBottom: 26 }}>
      <style>{`
        .facet-option:focus-within .facet-box {
          outline: 2px solid ${ACCENT};
          outline-offset: 2px;
        }
      `}</style>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#9a9a9a",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {values.map((v) => {
          const on = selected.has(v);
          return (
            <label
              key={v}
              className="facet-option"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                fontSize: 14,
                color: on ? "#16191c" : "#55595e",
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(v)}
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
              />
              <span
                aria-hidden
                className="facet-box"
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: 3,
                  flexShrink: 0,
                  border: on ? `1px solid ${ACCENT}` : "1px solid #cdcdcd",
                  background: on ? ACCENT : "#fff",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {on && (
                  <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>
                    ✓
                  </span>
                )}
              </span>
              <span style={{ flex: 1 }}>{labelFor ? labelFor(v) : v}</span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  color: "#b4b4b4",
                }}
              >
                {counts[v] || 0}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Project-state pill, for signed-in BU viewers.
 *
 * Two INDEPENDENT axes, deliberately not merged into one "state" — see the three-axes
 * rule in atlas/CLAUDE.md. A project can legitimately show both pills:
 *
 *   yellow  status === "in_review"      — a completion was submitted and bounced
 *   pink    visibility === "restricted" — finished, deliberately closed
 *   grey    visibility === "internal"   — visible to BU, not opted in to the gallery
 *   none    public and not in review    — nothing to say
 *
 * `restricted` and `hidden` never reach a viewer's payload, so the pink pill only
 * ever renders in an admin context. It is here so the vocabulary is defined in one
 * place rather than re-derived on the admin side.
 */
function StatePills({ project }: { project: Project }) {
  const pills: { label: string; color: string }[] = [];
  if (project.visibility === "restricted") pills.push({ label: "restricted", color: "#be185d" });
  else if (project.visibility === "internal") pills.push({ label: "not public", color: "#6b7280" });
  if (project.status === "in_review") pills.push({ label: "in review", color: "#b45309" });
  if (!pills.length) return null;
  return (
    <>
      {pills.map((p) => (
        <span
          key={p.label}
          title={
            p.label === "in review"
              ? "A completion form was submitted and the automated checks flagged something."
              : p.label === "restricted"
                ? "Finished, but deliberately not shared beyond the Spark! team."
                : "Visible to signed-in BU accounts. Not on the public gallery."
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontWeight: 600,
            color: p.color,
            background: `${p.color}14`,
            border: `1px solid ${p.color}44`,
            borderRadius: 999,
            padding: "1px 7px",
            lineHeight: 1.4,
            whiteSpace: "nowrap",
          }}
        >
          {p.label}
        </span>
      ))}
    </>
  );
}

function FeaturedBadge({ style }: { style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--mono)",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontWeight: 600,
        color: "#08110f",
        background: ACCENT,
        borderRadius: 999,
        padding: "2px 8px",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      ★ Featured
    </span>
  );
}

function TechTags({ tech, max = 3 }: { tech: string[]; max?: number }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {tech.slice(0, max).map((x) => (
        <span
          key={x}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "#6a6f74",
            background: "#f1f2f1",
            borderRadius: 3,
            padding: "2px 6px",
          }}
        >
          {x}
        </span>
      ))}
    </div>
  );
}

export default function Gallery({
  projects,
  initialFilters = {},
  settings = DEFAULT_GALLERY_SETTINGS,
  terms,
  studentExperiences = 0,
  viewerEmail = null,
}: {
  projects: Project[];
  initialFilters?: InitialFilters;
  settings?: GallerySettings;
  terms?: string[];
  studentExperiences?: number;
  /** Signed-in BU viewer's email, or null. Resolved server-side; see AuthStrip. */
  viewerEmail?: string | null;
}) {
  // Admin-configured vocab + which facets to show (falls back to defaults).
  const disciplines = settings.disciplines;
  const clientTypes = settings.clientTypes;
  const showFacets = settings.showFacets;
  const topics = settings.topics ?? DEFAULT_GALLERY_SETTINGS.topics ?? [];
  const facetOrder = settings.facetOrder ?? DEFAULT_GALLERY_SETTINGS.facetOrder ?? [];
  const thumbBadge = settings.thumbBadge ?? "discipline";
  const intro = settings.intro ?? DEFAULT_GALLERY_SETTINGS.intro!;
  const heroStats = (settings.heroStats ?? DEFAULT_GALLERY_SETTINGS.heroStats!).filter(
    (s) => s.show,
  );
  const statCount = (metric: "projects" | "students") =>
    metric === "students" ? studentExperiences : projects.length;
  // Seed view from the same initialFilters as the filter state so SSR and the
  // first client render agree (no hydration mismatch).
  const [view, setView] = useState<"grid" | "list">(
    initialFilters.view === "list" ? "list" : "grid",
  );
  // Mobile-only collapse of the filter sidebar (always visible on desktop via
  // CSS). Starts closed on both server + client → no hydration mismatch.
  const [showFilters, setShowFilters] = useState(false);
  const f = useFilters(projects, initialFilters, view);
  const counts: FacetCounts = f.counts;
  // Program facet is grouped by friendly program NAME (one row per program, not
  // per course code — several codes map to one name). The label shows the codes,
  // e.g. "Spark! UX Practicum (DS 488/688)".
  const programOptions = Array.from(
    new Set(projects.flatMap((p) => projectProgramLabels(p))),
  ).sort();
  const codesByLabel = new Map<string, string[]>();
  projects.forEach((p) =>
    p.runs.forEach((r) => {
      const label = courseLabel(r.course);
      const code = courseCode(r.course);
      const arr = codesByLabel.get(label) ?? [];
      if (code && !arr.includes(code)) arr.push(code);
      codesByLabel.set(label, arr);
    }),
  );
  const programLabelFor = (label: string) => {
    const codes = formatCourseCodes(codesByLabel.get(label) ?? []);
    return codes ? `${label} (${codes})` : label;
  };

  // Facet groups keyed by FacetKey; rendered in admin-configured facetOrder.
  const facetNodes: Record<FacetKey, React.ReactNode> = {
    discipline: (
      <FacetGroup
        title="Discipline"
        values={disciplines}
        selected={f.disciplines}
        onToggle={f.toggleDiscipline}
        counts={counts.discipline}
      />
    ),
    topic: (
      <FacetGroup
        title="Topic"
        values={topics}
        selected={f.topics}
        onToggle={f.toggleTopic}
        counts={counts.topic}
      />
    ),
    program: (
      <FacetGroup
        title="Program"
        values={programOptions}
        selected={f.programs}
        onToggle={f.toggleProgram}
        counts={counts.program}
        labelFor={programLabelFor}
      />
    ),
    clientType: (
      <FacetGroup
        title="Client Type"
        values={clientTypes}
        selected={f.clientTypes}
        onToggle={f.toggleClientType}
        counts={counts.clientType}
      />
    ),
    term: (
      <FacetGroup
        title="Term"
        values={terms?.length ? terms : SPARK_TERMS}
        selected={f.terms}
        onToggle={f.toggleTerm}
        counts={counts.term}
      />
    ),
  };

  return (
    <div style={{ background: "#fff", minHeight: "100%" }}>
      {/* Mobile filter bottom-sheet scrim (phone only via CSS). Tapping it
          closes the sheet. Never rendered on desktop (the chip + toggle that
          set showFilters are hidden there). */}
      {showFilters && (
        <div
          className="spark-scrim"
          onClick={() => setShowFilters(false)}
          aria-hidden
        />
      )}
      {/* Masthead — brand only. This page is built to live as a standalone
          showcase now and embed under buspark.io later (where it inherits the
          site nav), so it intentionally carries no navigation of its own. */}
      <header
        className="spark-gutter"
        style={{
          borderTop: `3px solid ${ACCENT}`,
          borderBottom: "1px solid #ececec",
          padding: "0 40px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 62,
            maxWidth: 1340,
            margin: "0 auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <SparkLogo height={30} />
            <span
              style={{
                fontFamily: "var(--display)",
                fontWeight: 700,
                fontSize: 19,
                color: "#16191c",
                whiteSpace: "nowrap",
                letterSpacing: "-0.01em",
              }}
            >
              BU Spark!
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#9a9a9a",
                whiteSpace: "nowrap",
              }}
            >
              Project Gallery
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <AuthStrip email={viewerEmail} />
        </div>
      </header>

      {/* Intro band */}
      <div
        className="spark-intro spark-gutter"
        style={{
          padding: "44px 40px 30px",
          maxWidth: 1340,
          margin: "0 auto",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              letterSpacing: "0.12em",
              color: ACCENT,
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            {intro.eyebrow}
          </div>
          <h1
            style={{
              fontFamily: "var(--display)",
              fontSize: "clamp(30px, 4vw, 46px)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: "#16191c",
              margin: 0,
              maxWidth: 720,
            }}
          >
            {intro.heading}
          </h1>
          <p
            style={{
              fontSize: 16.5,
              lineHeight: 1.6,
              color: "#55595e",
              maxWidth: 620,
              marginTop: 18,
            }}
          >
            {intro.body}
          </p>
        </div>
        {/* Right side of the intro band: the logo on top, hero stats stacked
            beneath it (right-aligned on desktop). The stats live OUTSIDE the
            .spark-intro-logo link so they survive the phone rule that hides the
            logo — see the scoped styles below for the mobile stack. */}
        <div className="spark-intro-right">
          <style>{`
            .spark-intro-right {
              flex-shrink: 0;
              max-width: 38%;
              display: flex;
              flex-direction: column;
              align-items: flex-end;
              gap: 20px;
            }
            /* Container owns the width; keep the tablet %-clamp from compounding
               on the link (globals.css shrinks .spark-intro-logo on tablet). */
            .spark-intro-right .spark-intro-logo { max-width: 100% !important; }
            .spark-intro-stats {
              display: flex;
              flex-direction: column;
              align-items: flex-end;
              text-align: right;
              gap: 6px;
            }
            @media (max-width: 900px) { .spark-intro-right { max-width: 22%; } }
            @media (max-width: 600px) {
              .spark-intro-right { max-width: none; align-items: flex-start; }
              .spark-intro-stats { align-items: flex-start; text-align: left; }
            }
          `}</style>
          {/* Discreet admin entry point: the intro logo links to /admin. */}
          <Link
            href="/admin"
            aria-label="Admin"
            className="spark-intro-logo"
            style={{ width: "100%", display: "flex" }}
          >
            <SparkLogo
              height={120}
              style={{ width: "100%", objectFit: "contain" }}
            />
          </Link>
          {heroStats.length > 0 && (
            <div className="spark-intro-stats">
              {heroStats.map((s, i) => (
                <div key={i} style={{ lineHeight: 1.15 }}>
                  <span
                    style={{
                      fontFamily: "var(--display)",
                      fontWeight: 700,
                      fontSize: "clamp(24px, 2.6vw, 34px)",
                      color: ACCENT,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {(s.value ?? statCount(s.metric)).toLocaleString()}
                  </span>{" "}
                  <span
                    style={{
                      fontFamily: "var(--display)",
                      fontWeight: 600,
                      fontSize: "clamp(13px, 1.5vw, 17px)",
                      color: "#9a9a9a",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {s.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Body: sidebar + results */}
      <div
        className="spark-body spark-gutter"
        style={{
          maxWidth: 1340,
          margin: "0 auto",
          padding: "10px 40px 110px",
        }}
      >
        <aside className="spark-sidebar">
          <button
            type="button"
            className="spark-filters-toggle"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            <span>Filters{f.activeCount > 0 ? ` (${f.activeCount})` : ""}</span>
            <span aria-hidden>▾</span>
          </button>
          <div className={`spark-filters-body${showFilters ? " open" : ""}`}>
            {/* Bottom-sheet chrome (phone only via .spark-sheet-only). */}
            <div className="spark-sheet-only">
              <span className="spark-sheet-grab" />
              <div className="spark-sheet-titlerow">
                <span className="t">Filters</span>
                <span style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  {f.activeCount > 0 && (
                    <button
                      type="button"
                      className="spark-sheet-act"
                      onClick={f.clearAll}
                    >
                      Clear ({f.activeCount})
                    </button>
                  )}
                  <button
                    type="button"
                    className="spark-sheet-act"
                    onClick={() => setShowFilters(false)}
                  >
                    Done
                  </button>
                </span>
              </div>
            </div>
            <div
              className="spark-filters-head"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--display)",
                  fontWeight: 700,
                  fontSize: 16,
                  color: "#16191c",
                }}
              >
                Filters
              </span>
              {f.activeCount > 0 && (
                <button
                  onClick={f.clearAll}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12.5,
                    color: ACCENT,
                    fontFamily: "var(--mono)",
                  }}
                >
                  Clear ({f.activeCount})
                </button>
              )}
            </div>
            {facetOrder.map((key) =>
              showFacets[key] ? (
                <div key={key}>{facetNodes[key]}</div>
              ) : null,
            )}
            {/* Bottom-sheet apply button (phone only via .spark-sheet-only). */}
            <button
              type="button"
              className="spark-sheet-apply spark-sheet-only"
              onClick={() => setShowFilters(false)}
            >
              Show {f.filtered.length}{" "}
              {f.filtered.length === 1 ? "project" : "projects"}
            </button>
          </div>
        </aside>

        <main>
          {/* Search + view/sort controls */}
          <div
            className="spark-controls"
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              marginBottom: 24,
              flexWrap: "wrap",
            }}
          >
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <span
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#aaa",
                  fontSize: 15,
                }}
              >
                ⌕
              </span>
              <input
                value={f.query}
                onChange={(e) => f.setQuery(e.target.value)}
                aria-label="Search projects"
                placeholder="Search projects, partners, tech…"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "12px 14px 12px 38px",
                  border: "1px solid #dcdcdc",
                  borderRadius: 6,
                  fontSize: 14.5,
                  fontFamily: "var(--body)",
                  outline: "none",
                  background: "#fff",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = ACCENT)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#dcdcdc")}
              />
            </div>
            <select
              className="spark-sortsel"
              value={f.sort}
              onChange={(e) => f.setSort(e.target.value as "term" | "az")}
              aria-label="Sort projects"
              style={{
                padding: "12px 14px",
                border: "1px solid #dcdcdc",
                borderRadius: 6,
                fontSize: 14,
                fontFamily: "var(--body)",
                color: "#3a3f44",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              <option value="term">Newest first</option>
              <option value="az">A–Z</option>
            </select>
            <div
              className="spark-viewtoggle"
              style={{
                display: "flex",
                border: "1px solid #dcdcdc",
                borderRadius: 6,
                overflow: "hidden",
              }}
              title="View"
            >
              {(
                [
                  ["grid", "▦"],
                  ["list", "≣"],
                ] as const
              ).map(([v, icon]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-label={v + " view"}
                  style={{
                    width: 42,
                    height: 44,
                    border: "none",
                    borderLeft: v === "list" ? "1px solid #ececec" : "none",
                    cursor: "pointer",
                    background: view === v ? "#16191c" : "#fff",
                    color: view === v ? "#fff" : "#9a9a9a",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 16,
                  }}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile quick-filter chip rail (Editorial Feed; phone only via CSS).
              Drives the SAME state as the desktop sidebar — the Filters chip
              opens the bottom sheet, the rest are one-tap discipline/sort toggles. */}
          <div className="spark-chiprail">
            <button
              type="button"
              className="spark-chip spark-chip-filter"
              onClick={() => setShowFilters(true)}
            >
              ⚙ Filters{f.activeCount > 0 ? ` (${f.activeCount})` : ""}
            </button>
            <button
              type="button"
              className="spark-chip"
              onClick={() => f.setSort(f.sort === "term" ? "az" : "term")}
            >
              {f.sort === "term" ? "Newest" : "A–Z"}
            </button>
            {disciplines.map((d) => (
              <button
                key={d}
                type="button"
                className={`spark-chip${f.disciplines.has(d) ? " on" : ""}`}
                onClick={() => f.toggleDiscipline(d)}
              >
                {d}
              </button>
            ))}
          </div>

          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "#9a9a9a",
              marginBottom: 18,
            }}
          >
            {f.filtered.length}{" "}
            {f.filtered.length === 1 ? "project" : "projects"}
          </div>

          {f.filtered.length === 0 ? (
            <div
              style={{
                padding: "80px 0",
                textAlign: "center",
                color: "#9a9a9a",
                fontSize: 15,
              }}
            >
              No projects match your filters.{" "}
              <button
                onClick={f.clearAll}
                style={{
                  color: ACCENT,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 15,
                }}
              >
                Reset
              </button>
            </div>
          ) : view === "list" ? (
            /* ---- LIST VIEW ---- */
            <div
              style={{
                border: "1px solid #ececec",
                borderRadius: 8,
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(260px,2.2fr) 1.1fr 1.3fr 0.8fr",
                  gap: 16,
                  padding: "11px 20px",
                  background: "#f7f7f6",
                  borderBottom: "1px solid #ececec",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#a0a0a0",
                }}
              >
                <span>Project</span>
                <span>Discipline</span>
                <span>Client</span>
                <span>Term</span>
              </div>
              {f.filtered.map((p, i) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="spark-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "minmax(260px,2.2fr) 1.1fr 1.3fr 0.8fr",
                    gap: 16,
                    padding: "15px 20px",
                    alignItems: "center",
                    cursor: "pointer",
                    textDecoration: "none",
                    color: "inherit",
                    borderBottom:
                      i === f.filtered.length - 1
                        ? "none"
                        : "1px solid #f2f2f2",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 13,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 54,
                        height: 40,
                        flexShrink: 0,
                        borderRadius: 5,
                        overflow: "hidden",
                      }}
                    >
                      <Thumb
                        project={p}
                        ratio="54 / 40"
                        label={false}
                        badgeField={thumbBadge}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--display)",
                            fontWeight: 600,
                            fontSize: 15,
                            color: "#16191c",
                            lineHeight: 1.25,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {p.title}
                        </span>
                        {p.featured && (
                          <FeaturedBadge style={{ flexShrink: 0 }} />
                        )}
                        <StatePills project={p} />
                      </div>
                      <div style={{ marginTop: 5 }}>
                        <TechTags tech={p.tech} max={3} />
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 13,
                      color: "#3a3f44",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: disciplineColor(primaryDiscipline(p)),
                        flexShrink: 0,
                      }}
                    />
                    {projectDisciplines(p).join(" / ")}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#16191c",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.partner}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        color: "#a4a4a4",
                        marginTop: 3,
                      }}
                    >
                      {[
                        p.clientType,
                        projectPrograms(p).map((c) => courseLabel(c)).join(" / "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: "#6a6f74",
                    }}
                  >
                    {projectTerms(p)
                      .sort((a, b) => termRank(a) - termRank(b))
                      .join(" · ")}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            /* ---- GRID VIEW (default) ---- */
            <div
              className="spark-grid"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_CARD}px, 1fr))`,
                gap: GAP,
              }}
            >
              {f.filtered.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="spark-card-a"
                  style={{
                    cursor: "pointer",
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid #ececec",
                    background: "#fff",
                    display: "flex",
                    flexDirection: "column",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <Thumb project={p} ratio="4 / 3" badgeField={thumbBadge} />
                    {p.featured && (
                      <FeaturedBadge
                        style={{
                          position: "absolute",
                          top: 10,
                          right: 10,
                          zIndex: 1,
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      padding: CARD_PADDING,
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 9,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: disciplineColor(primaryDiscipline(p)),
                        }}
                      />
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "#9a9a9a",
                        }}
                      >
                        {projectDisciplines(p).join(" / ")} · {latestTerm(p)}
                      </span>
                      <StatePills project={p} />
                    </div>
                    <h3
                      style={{
                        fontFamily: "var(--display)",
                        fontSize: 17.5,
                        lineHeight: 1.2,
                        letterSpacing: "-0.01em",
                        color: "#16191c",
                        margin: "0 0 8px",
                      }}
                    >
                      {p.title}
                    </h3>
                    <p
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        color: "#6a6f74",
                        margin: 0,
                        flex: 1,
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {cleanBlurb(p.blurb)}
                    </p>
                    <div
                      style={{
                        marginTop: 14,
                        paddingTop: 13,
                        borderTop: "1px solid #f0f0f0",
                      }}
                    >
                      {/* Client/partner gets the full width — the course code now
                          lives on the thumbnail badge and the discipline·term on
                          the meta line, so the program label here was redundant. */}
                      <span
                        style={{
                          fontSize: 12.5,
                          color: "#3a3f44",
                          fontWeight: 500,
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.partner}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
