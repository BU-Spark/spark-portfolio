// Full-page project detail (replaces the slide-in drawer). Rendered by
// app/projects/[slug]/page.tsx, which loads the project from the database and
// passes it in. Server component; the only client-side bit (the masthead logo
// that hides itself on a missing file) lives in <MastheadLogo>.
import Link from "next/link";
import MastheadLogo from "@/components/MastheadLogo";
import { courseLabel } from "@/lib/data";
import { disciplineColor } from "@/lib/colors";
import {
  primaryDiscipline,
  projectDisciplines,
  projectTerms,
  runsByRecency,
  termRank,
} from "@/lib/project";
import { cleanBlurb } from "@/lib/gdocs";
import type { Project } from "@/lib/types";

const ACCENT = "#0fa392";

function GalleryImage({
  project,
  index,
  primary = false,
}: {
  project: Project;
  index: number;
  primary?: boolean;
}) {
  const color = disciplineColor(primaryDiscipline(project));
  const radius = primary ? 10 : 7;
  const url = project.images && project.images[index];

  if (url) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: primary ? "16 / 9" : "4 / 3",
          borderRadius: radius,
          overflow: "hidden",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${project.title} image ${index + 1}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    );
  }

  // Striped discipline-tinted placeholder (no caption label).
  const angle = 90 + ((index * 37 + project.id.length) % 4) * 30;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: primary ? "16 / 9" : "4 / 3",
        borderRadius: radius,
        overflow: "hidden",
        background: `repeating-linear-gradient(${angle}deg, color-mix(in oklab, ${color} ${18 - index * 2}%, #fff) 0 14px, color-mix(in oklab, ${color} 7%, #fff) 14px 28px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 90% at ${20 + index * 20}% 12%, color-mix(in oklab, ${color} 26%, transparent), transparent 62%)`,
        }}
      />
    </div>
  );
}

// External-link glyph shown beside the client name when the org has a website.
function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// The client card. A plain row normally; a native <details> dropdown when there's
// an "about the client" blurb. The org website (clientUrl) is a link icon by the
// name — never an underline. Both the icon and the blurb only appear when set.
function ClientBlock({ project }: { project: Project }) {
  const initials = project.partner
    .replace(/^(The )/, "")
    .trim()
    .split(/[\s—-]+/)
    .slice(0, 2)
    .map((w) => (w ? w[0] : ""))
    .join("");
  const hasDesc = !!project.clientDesc?.trim();

  const frame: React.CSSProperties = {
    background: `color-mix(in oklab, ${ACCENT} 7%, #fafafa)`,
    border: `1px solid color-mix(in oklab, ${ACCENT} 18%, #eee)`,
    borderRadius: 10,
    marginBottom: 24,
  };
  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 18px",
  };

  const inner = (
    <>
      <div
        style={{
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: 8,
          background: "#fff",
          border: "1px solid #e6e6e6",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--display)",
          fontWeight: 700,
          fontSize: 16,
          color: ACCENT,
        }}
      >
        {initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#8a8a8a",
          }}
        >
          Client
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontFamily: "var(--display)",
            fontWeight: 600,
            fontSize: 17,
            color: "#16191c",
            lineHeight: 1.2,
            marginTop: 2,
          }}
        >
          {project.partner}
          {project.clientUrl && (
            <a
              href={project.clientUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${project.partner} website`}
              title={`Visit ${project.partner}`}
              style={{
                display: "inline-flex",
                color: ACCENT,
                flexShrink: 0,
              }}
            >
              <LinkIcon />
            </a>
          )}
        </div>
      </div>
      <span
        style={{
          marginLeft: "auto",
          flexShrink: 0,
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: ACCENT,
          border: `1px solid color-mix(in oklab, ${ACCENT} 35%, #fff)`,
          borderRadius: 999,
          padding: "4px 11px",
        }}
      >
        {project.clientType}
      </span>
      {hasDesc && (
        <span
          className="client-chev"
          aria-hidden
          style={{ flexShrink: 0, color: "#9aa0a6", display: "inline-flex", transition: "transform .18s" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      )}
    </>
  );

  if (!hasDesc) return <div style={{ ...frame, ...row }}>{inner}</div>;

  return (
    <details className="client-drop" style={frame}>
      <style>{`
        .client-drop > summary { list-style: none; cursor: pointer; }
        .client-drop > summary::-webkit-details-marker { display: none; }
        .client-drop[open] .client-chev { transform: rotate(180deg); }
      `}</style>
      <summary style={row}>{inner}</summary>
      <div
        style={{
          padding: "0 18px 16px 76px",
          fontSize: 14.5,
          lineHeight: 1.6,
          color: "#3a3f44",
          whiteSpace: "pre-line",
        }}
      >
        {project.clientDesc}
      </div>
    </details>
  );
}

export default function ProjectView({ project }: { project: Project }) {
  const color = disciplineColor(primaryDiscipline(project));
  // A public repo link shows only when there's a URL and the code isn't private.
  // Otherwise (private OR no repo URL at all) we show "code available on request".
  const repoUrl = project.repoUrl?.trim();
  const hasRepoLink = !!repoUrl && !project.codePrivate;
  // Dedupe runs on term + course + discipline (case-insensitive, trimmed) so a
  // project that appeared twice under the same course/term shows one row.
  const seen = new Set<string>();
  const runs = runsByRecency(project).filter((r) => {
    const key = [r.term, r.course, r.discipline]
      .map((v) => v.trim().toLowerCase())
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Distinct terms in chronological order (SPARK_TERMS is most-recent-first, so
  // chronological = descending termRank). Used for the multi-semester timeline.
  const timelineTerms = projectTerms(project).sort(
    (a, b) => termRank(b) - termRank(a),
  );

  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>
      <Masthead />

      <div
        className="spark-detail"
        style={{ maxWidth: 760, margin: "0 auto", padding: "28px 40px 80px" }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            letterSpacing: "0.04em",
            color: "#6a6f74",
            textDecoration: "none",
            marginBottom: 22,
          }}
        >
          ← Back to gallery
        </Link>

        {/* Image gallery (no captions) */}
        <div className="spark-detail-hero" style={{ marginBottom: 30 }}>
          <GalleryImage project={project} index={0} primary />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 6,
              marginTop: 6,
            }}
          >
            {[1, 2, 3].map((i) => (
              <GalleryImage key={i} project={project} index={i} />
            ))}
          </div>
        </div>

        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            letterSpacing: "0.1em",
            color: ACCENT,
            textTransform: "uppercase",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{ width: 8, height: 8, borderRadius: "50%", background: color }}
          />
          {projectDisciplines(project).join(" · ")}
        </div>
        <h1
          style={{
            fontFamily: "var(--display)",
            fontSize: 32,
            lineHeight: 1.12,
            margin: "0 0 20px",
            color: "#16191c",
            letterSpacing: "-0.01em",
          }}
        >
          {project.title}
        </h1>

        {/* Prominent client block — only when there's a client to show.
            When there's an "about the client" blurb it becomes a native <details>
            dropdown; the org website (if any) is a link icon beside the name. */}
        {project.partner && <ClientBlock project={project} />}

        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: "#3a3f44",
            margin: "0 0 26px",
            whiteSpace: "pre-line",
          }}
        >
          {cleanBlurb(project.blurb)}
        </p>

        {/* Where it ran — one row per semester/course the project appeared in */}
        <div style={{ paddingTop: 24, borderTop: "1px solid #ececec" }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#8a8a8a",
            }}
          >
            {runs.length > 1 ? "Where it ran" : "Course"}
          </span>

          {/* Multi-semester timeline: only when the project spans >1 distinct
              term. Pill nodes spanning the full section width with a track. */}
          {timelineTerms.length > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginTop: 16,
                marginBottom: 4,
              }}
            >
              {timelineTerms.map((term, i) => (
                <div
                  key={term}
                  style={{ display: "contents" }}
                >
                  {i > 0 && (
                    <div
                      style={{
                        flex: 1,
                        minWidth: 24,
                        height: 2,
                        borderRadius: 2,
                        background: `color-mix(in oklab, ${ACCENT} 28%, #e4e4e4)`,
                        margin: "0 -1px",
                      }}
                    />
                  )}
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 11px",
                      borderRadius: 7,
                      background: `color-mix(in oklab, ${ACCENT} 9%, #fff)`,
                      border: `1.5px solid color-mix(in oklab, ${ACCENT} 26%, #ddd)`,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: ACCENT,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "'IBM Plex Sans', sans-serif",
                        fontSize: 12.5,
                        fontWeight: 550,
                        color: "#16191c",
                        letterSpacing: "0.01em",
                      }}
                    >
                      {term}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 12,
            }}
          >
            {runs.map((r, i) => (
              <div
                key={`${r.term}-${r.course}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "#16191c",
                    minWidth: 92,
                  }}
                >
                  {r.term}
                </span>
                <span style={{ fontSize: 14.5, color: "#3a3f44" }}>
                  {courseLabel(r.course)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: disciplineColor(r.discipline),
                  }}
                >
                  {r.discipline}
                </span>
              </div>
            ))}
          </div>
        </div>

        {project.tech && project.tech.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#8a8a8a",
            }}
          >
            Tech Stack
          </span>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}
          >
            {project.tech.map((tch) => (
              <span
                key={tch}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  color: "#2a2f33",
                  border: "1px solid #dcdcdc",
                  borderRadius: 3,
                  padding: "5px 10px",
                  background: "#fafafa",
                }}
              >
                {tch}
              </span>
            ))}
          </div>
        </div>
        )}

        {project.topics && project.topics.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#8a8a8a",
            }}
          >
            Topics
          </span>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}
          >
            {project.topics.map((t) => (
              <span
                key={t}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  color: "#2a2f33",
                  border: "1px solid #dcdcdc",
                  borderRadius: 3,
                  padding: "5px 10px",
                  background: "#fafafa",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        )}

        {project.datasets && project.datasets.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#8a8a8a",
            }}
          >
            Datasets
          </span>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}
          >
            {project.datasets.map((d, i) => {
              const chip: React.CSSProperties = {
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                color: d.url ? ACCENT : "#2a2f33",
                border: `1px solid color-mix(in oklab, ${ACCENT} ${d.url ? 35 : 15}%, #dcdcdc)`,
                borderRadius: 3,
                padding: "5px 10px",
                background: `color-mix(in oklab, ${ACCENT} ${d.url ? 6 : 3}%, #fafafa)`,
                textDecoration: "none",
              };
              // With a link it's a chip-link; a name-only dataset renders as a plain chip.
              return d.url ? (
                <a key={`${d.label}-${i}`} href={d.url} target="_blank" rel="noopener noreferrer" style={chip}>
                  {d.label}
                </a>
              ) : (
                <span key={`${d.label}-${i}`} style={chip}>
                  {d.label}
                </span>
              );
            })}
          </div>
        </div>
        )}

        {(
          <div
            className="spark-detail-actions"
            style={{ display: "flex", gap: 12, marginTop: 34, flexWrap: "wrap" }}
          >
            {hasRepoLink ? (
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "13px 22px",
                  background: "#16191c",
                  color: "#fff",
                  textDecoration: "none",
                  fontFamily: "var(--display)",
                  fontSize: 14.5,
                  fontWeight: 600,
                  borderRadius: 4,
                }}
              >
                <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                View project →
              </a>
            ) : (
              <a
                href={`mailto:buspark@bu.edu?subject=Code request: ${encodeURIComponent(
                  project.title,
                )}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "13px 22px",
                  background: "#16191c",
                  color: "#fff",
                  textDecoration: "none",
                  fontFamily: "var(--display)",
                  fontSize: 14.5,
                  fontWeight: 600,
                  borderRadius: 4,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Code available on request →
              </a>
            )}
            {project.prodUrl && (
              <a
                href={project.prodUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "13px 22px",
                  background: "#0fa392",
                  color: "#fff",
                  textDecoration: "none",
                  fontFamily: "var(--display)",
                  fontSize: 14.5,
                  fontWeight: 600,
                  borderRadius: 4,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                View live →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Masthead() {
  return (
    <header
      className="spark-gutter"
      style={{ borderBottom: "1px solid #ececec", padding: "0 40px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
          maxWidth: 1340,
          margin: "0 auto",
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            textDecoration: "none",
          }}
        >
          <MastheadLogo
            src="/spark-logo.png"
            alt="BU Spark!"
            style={{ height: 30, width: "auto", display: "block" }}
          />
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{
                fontFamily: "var(--display)",
                fontWeight: 700,
                fontSize: 19,
                color: "#16191c",
                whiteSpace: "nowrap",
              }}
            >
              BU Spark!
            </span>
            <span style={{ width: 1, height: 16, background: "#d4d4d4" }} />
            <span style={{ fontSize: 14, color: "#6a6f74" }}>Project Gallery</span>
          </div>
        </Link>
      </div>
    </header>
  );
}
