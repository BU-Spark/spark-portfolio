// Admin — READ-ONLY full project detail. Mirrors the public project page's
// visual style (gallery, client block, runs, tech, links) but ALSO surfaces
// every admin-only field (team roles, student contributors, contact / PD doc /
// tech note, per-run students + team id) inside a gated "Admin only" zone.
// Reached by clicking a row in the manage list. The /admin/* path is
// middleware-auth-gated, so this server component renders admin-only data
// without any extra auth. NOT a "use client" page. Spark Control redesign:
// the dark rail + canvas come from the admin layout; this page renders a
// PageHeader + a `.content` body, no in-page topbar.
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/admin/PageHeader";
import { getProjectAdmin, listContributors } from "@/lib/db";
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
import { parseTechStack } from "@/lib/tech";
import type { Contributor, Run } from "@/lib/types";

// Team roles are per-semester now — keyed on Run, rendered for each run below.
const TEAM_ROLES: [keyof Run, string][] = [
  ["sparkProgramLead", "Program Lead"],
  ["pm", "PM"],
  ["tpm", "TPM"],
  ["seniorAdvisor", "Senior Advisor"],
  ["techAdvisor", "Tech Advisor"],
  ["eir", "EIR"],
];

const muted = (v?: string | null) => (v && v.trim() ? v.trim() : null);

export const dynamic = "force-dynamic";

export default async function AdminProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, contributors] = await Promise.all([
    getProjectAdmin(id),
    listContributors(id),
  ]);
  if (!project) notFound();

  const color = disciplineColor(primaryDiscipline(project));

  // Dedupe runs (same logic as the public ProjectView).
  const seen = new Set<string>();
  const runs = runsByRecency(project).filter((r) => {
    const key = [r.term, r.course, r.discipline]
      .map((v) => v.trim().toLowerCase())
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const timelineTerms = projectTerms(project).sort(
    (a, b) => termRank(b) - termRank(a),
  );

  // Group contributors by term (semester); null/empty term → "Unspecified".
  const byTerm = new Map<string, Contributor[]>();
  for (const c of contributors) {
    const t = muted(c.term) ?? "Unspecified term";
    if (!byTerm.has(t)) byTerm.set(t, []);
    byTerm.get(t)!.push(c);
  }
  const contribTerms = [...byTerm.keys()].sort((a, b) => {
    if (a === "Unspecified term") return 1;
    if (b === "Unspecified term") return -1;
    return termRank(b) - termRank(a);
  });

  // The Tech note is the raw PD cell, kept for nuance the public tags drop. When
  // it's just a tag list that parses to the SAME tags as the public chips, it's
  // pure duplication — suppress it. Keep it when it's prose or curated differently.
  const techNoteRaw = muted(project.techNote);
  let techNoteRedundant = false;
  if (techNoteRaw && project.tech && project.tech.length) {
    const parsed = parseTechStack(techNoteRaw);
    if (parsed.mode === "list" && parsed.tags.length) {
      const norm = (a: string[]) => a.map((t) => t.trim().toLowerCase()).sort();
      const a = norm(parsed.tags);
      const b = norm(project.tech);
      techNoteRedundant = a.length === b.length && a.every((v, i) => v === b[i]);
    }
  }

  // Per-run team entries (roles + class instructors) for the Team section below.
  // Each run carries its own semester team; only runs with someone assigned show.
  const runTeams = runsByRecency(project).map((r) => {
    const roles = TEAM_ROLES.map(([key, label]) => {
      let v = muted(r[key] as string | null | undefined);
      if (key === "eir" && v && r.eirIsInstructor) v = `${v} (class instructor acting as EIR)`;
      return [label, v] as const;
    }).filter(([, v]) => v) as (readonly [string, string])[];
    if (r.classInstructors && r.classInstructors.length) {
      roles.push(["Class Instructor", r.classInstructors.join(", ")] as const);
    }
    return { run: r, roles };
  });

  const isDraft = project.published === false;
  const latestTerm = timelineTerms[0] ?? runs[0]?.term ?? null;

  // "To publish, add…" checklist — what's still missing for a public-ready page.
  const missing: string[] = [];
  if (!project.images || project.images.length === 0) missing.push("Cover & gallery images");
  if (!muted(project.repoUrl)) missing.push("GitHub repo link");
  if (!muted(cleanBlurb(project.blurb))) missing.push("Description");
  if (runs.length === 0) missing.push("Course / semester run");

  return (
    <>
      <PageHeader eyebrow="Catalog / Project" title={project.title}>
        <Link href={`/admin/edit/${project.id}`} className="btn btn-teal">
          Edit project
        </Link>
      </PageHeader>

      <div className="content">
        <Link
          href="/admin/projects"
          className="back"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--ink-3)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 16,
          }}
        >
          ← All projects
        </Link>

        {/* Draft banner — shown only when hidden from the public gallery */}
        {isDraft && (
          <div className="banner amber">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#e0a93c"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <div>
              <span className="bt">Draft — hidden from the public gallery.</span>{" "}
              <span className="bs">Publish from the edit form to make it live.</span>
            </div>
          </div>
        )}

        <div
          className="layout"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            gap: 20,
            alignItems: "start",
          }}
        >
          {/* ───────────── MAIN COLUMN ───────────── */}
          <div style={{ minWidth: 0 }}>
            {/* Image gallery (resolved /api/img URLs from getProjectAdmin) */}
            <div style={{ marginBottom: 4 }}>
              {/* Primary / cover image */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "16 / 8",
                  borderRadius: 14,
                  overflow: "hidden",
                  ...(project.images?.[0]
                    ? { background: "none" }
                    : {
                        background: `repeating-linear-gradient(${90 + (project.id.length % 4) * 30}deg, color-mix(in oklab, ${color} 16%, #fff) 0 14px, color-mix(in oklab, ${color} 7%, #fff) 14px 28px)`,
                      }),
                }}
              >
                {project.images?.[0] ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={project.images[0]}
                    alt={`${project.title} image 1`}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <NoImg />
                )}
              </div>
              {/* Thumbnails */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      position: "relative",
                      aspectRatio: "4 / 3",
                      borderRadius: 10,
                      overflow: "hidden",
                      ...(project.images?.[i]
                        ? { background: "none" }
                        : {
                            background: `repeating-linear-gradient(${90 + ((i * 37 + project.id.length) % 4) * 30}deg, color-mix(in oklab, ${color} ${16 - i * 2}%, #fff) 0 14px, color-mix(in oklab, ${color} 7%, #fff) 14px 28px)`,
                          }),
                    }}
                  >
                    {project.images?.[i] ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={project.images[i]}
                        alt={`${project.title} image ${i + 1}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <NoImg />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Discipline eyebrow */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--ink-3)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                margin: "18px 0 0",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" }} />
              {projectDisciplines(project).join(" · ")}
            </div>

            <h1
              style={{
                fontFamily: "var(--display)",
                fontSize: 30,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                margin: "10px 0 14px",
                color: "var(--ink)",
              }}
            >
              {project.title}
            </h1>

            {/* Status badges */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {isDraft ? (
                <span className="badge b-amber">Draft (hidden)</span>
              ) : (
                <span className="badge b-grn">Published</span>
              )}
              {project.featured && <span className="badge b-teal">Featured</span>}
              {project.custom && <span className="badge b-teal">Admin-added</span>}
            </div>

            {/* Client block */}
            {project.partner && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "16px 18px",
                  borderRadius: 13,
                  marginBottom: 22,
                  background: "color-mix(in oklab, var(--teal) 6%, #fafbfa)",
                  border: "1px solid color-mix(in oklab, var(--teal) 16%, #eee)",
                }}
              >
                <div
                  style={{
                    width: 46,
                    height: 46,
                    flexShrink: 0,
                    borderRadius: 11,
                    background: "#fff",
                    border: "1px solid var(--line)",
                    display: "grid",
                    placeItems: "center",
                    fontFamily: "var(--display)",
                    fontWeight: 700,
                    fontSize: 16,
                    color: "var(--teal-deep)",
                  }}
                >
                  {project.partner
                    .replace(/^(The )/, "")
                    .trim()
                    .split(/[\s—-]+/)
                    .slice(0, 2)
                    .map((w) => (w ? w[0] : ""))
                    .join("")}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="eyebrow" style={{ fontSize: 10 }}>Client</div>
                  <div
                    style={{
                      fontFamily: "var(--display)",
                      fontWeight: 600,
                      fontSize: 17,
                      color: "var(--ink)",
                      lineHeight: 1.2,
                      marginTop: 2,
                    }}
                  >
                    {project.partner}
                  </div>
                </div>
                {project.clientType && (
                  <span
                    style={{
                      marginLeft: "auto",
                      flexShrink: 0,
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--teal-deep)",
                      border: "1px solid color-mix(in oklab, var(--teal) 32%, #fff)",
                      borderRadius: 999,
                      padding: "4px 12px",
                    }}
                  >
                    {project.clientType}
                  </span>
                )}
              </div>
            )}

            <p
              style={{
                fontSize: 16,
                lineHeight: 1.6,
                color: "var(--ink-2)",
                margin: "0 0 24px",
                whiteSpace: "pre-line",
              }}
            >
              {cleanBlurb(project.blurb)}
            </p>

            {/* Where it ran */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20, marginTop: 22 }}>
              <div className="eyebrow">{runs.length > 1 ? "Where it ran" : "Course"}</div>

              {timelineTerms.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", margin: "16px 0 4px" }}>
                  {timelineTerms.map((term, i) => (
                    <div key={term} style={{ display: "contents" }}>
                      {i > 0 && (
                        <div
                          style={{
                            flex: 1,
                            minWidth: 24,
                            height: 2,
                            borderRadius: 2,
                            background: "color-mix(in oklab, var(--teal) 28%, #e4e4e4)",
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
                          background: "color-mix(in oklab, var(--teal) 9%, #fff)",
                          border: "1.5px solid color-mix(in oklab, var(--teal) 26%, #ddd)",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: "var(--teal)",
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontFamily: "var(--body)",
                            fontSize: 12.5,
                            fontWeight: 550,
                            color: "var(--ink)",
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
                  gap: 0,
                  marginTop: timelineTerms.length > 1 ? 0 : 10,
                }}
              >
                {runs.map((r, i) => (
                  <div
                    key={`${r.term}-${r.course}-${i}`}
                    style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "5px 0", flexWrap: "wrap" }}
                  >
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12, minWidth: 92, color: "var(--ink)" }}>
                      {r.term}
                    </span>
                    <span style={{ fontSize: 14.5, color: "var(--ink-2)" }}>{courseLabel(r.course)}</span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
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

            {/* Tech stack */}
            {project.tech && project.tech.length > 0 && (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20, marginTop: 22 }}>
                <div className="eyebrow">Tech stack</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  {project.tech.map((tch) => (
                    <span
                      key={tch}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 12.5,
                        color: "var(--ink-2)",
                        border: "1px solid var(--field)",
                        borderRadius: 7,
                        padding: "5px 11px",
                        background: "var(--bg2)",
                      }}
                    >
                      {tch}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Public links */}
            {(project.repoUrl || project.prodUrl) && (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20, marginTop: 22 }}>
                <div className="eyebrow">Public links</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                  {project.repoUrl && (
                    <a
                      href={project.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-dark"
                      style={{ fontSize: 13.5, padding: "10px 18px" }}
                    >
                      View project →
                    </a>
                  )}
                  {project.prodUrl && (
                    <a
                      href={project.prodUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost"
                      style={{ fontSize: 13.5, padding: "10px 18px" }}
                    >
                      View live →
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* ───────────── ADMIN-ONLY SECTIONS ───────────── */}
            <div className="divider-label">
              <span className="ln" />
              <span className="tx">Admin only — never public</span>
              <span className="ln" />
            </div>

            {/* Team & PD — by semester (internal) */}
            <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: 16 }}>
              <h3 style={{ fontFamily: "var(--display)", fontSize: 15, margin: "0 0 6px" }}>
                Team &amp; PD — by semester (internal)
              </h3>
              <p style={{ fontSize: 12.5, color: "var(--ink-4)", margin: "0 0 16px", lineHeight: 1.5 }}>
                Spark! staff roles, the PD doc, and the student team for each semester — never shown publicly.
              </p>
              {runTeams.length === 0 ? (
                <div style={{ fontSize: 14, color: "var(--ink-4)" }}>No runs yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  {runTeams.map(({ run: r, roles }, i) => (
                    <div
                      key={`${r.term}-${r.course}-${i}`}
                      style={{ borderTop: i ? "1px solid var(--line-2)" : undefined, paddingTop: i ? 16 : 0 }}
                    >
                      <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink)", marginBottom: 10 }}>
                        {r.term || "—"} · {courseLabel(r.course)}
                        {muted(r.teamId) && <span style={{ color: "var(--ink-4)" }}> · Team ID {r.teamId!.trim()}</span>}
                        {muted(r.pdUrl) && (
                          <>
                            {" · "}
                            <a href={r.pdUrl!.trim()} target="_blank" rel="noopener noreferrer" className="tlink">
                              PD doc ↗
                            </a>
                          </>
                        )}
                      </div>
                      {roles.length > 0 ? (
                        <div className="kv" style={{ marginBottom: 10 }}>
                          {roles.map(([label, value]) => (
                            <div key={label} style={{ display: "contents" }}>
                              <span className="k">{label}</span>
                              <span className="v">{value}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: "var(--ink-4)", marginBottom: 10 }}>
                          No staff roles recorded for this semester.
                        </div>
                      )}
                      {r.students && r.students.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {r.students.map((s, si) => (
                            <span key={si} className="chip">{s}</span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: 13, color: "var(--ink-4)" }}>No students recorded for this semester.</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Student contributors */}
            <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: 16 }}>
              <h3 style={{ fontFamily: "var(--display)", fontSize: 15, margin: "0 0 14px" }}>
                Student contributors (internal)
              </h3>
              <p style={{ fontSize: 12.5, color: "var(--ink-4)", margin: "0 0 14px", lineHeight: 1.5 }}>
                Students are admin-only — never shown publicly. Grouped by semester.
              </p>
              {contributors.length === 0 ? (
                <div style={{ fontSize: 14, color: "var(--ink-4)" }}>No contributors recorded.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  {contribTerms.map((term) => (
                    <div key={term} style={{ marginBottom: 14 }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                        {term}
                        <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>
                          {" "}· {byTerm.get(term)!.length}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {byTerm.get(term)!.map((c) => {
                          const name = [muted(c.firstName), muted(c.lastName)]
                            .filter(Boolean)
                            .join(" ");
                          return (
                            <div
                              key={c.id}
                              style={{
                                display: "flex",
                                alignItems: "baseline",
                                gap: 8,
                                flexWrap: "wrap",
                                padding: "4px 0",
                                fontSize: 14,
                              }}
                            >
                              <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                                {name || "—"}
                              </span>
                              {muted(c.githubUsername) && (
                                <a
                                  href={`https://github.com/${c.githubUsername!.trim()}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--teal-deep)", textDecoration: "none" }}
                                >
                                  · @{c.githubUsername!.trim()}
                                </a>
                              )}
                              {muted(c.email) && (
                                <a
                                  href={`mailto:${c.email!.trim()}`}
                                  style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-4)", textDecoration: "none" }}
                                >
                                  · {c.email!.trim()}
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Internal fields */}
            <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: 16 }}>
              <h3 style={{ fontFamily: "var(--display)", fontSize: 15, margin: "0 0 14px" }}>
                Internal fields
              </h3>
              <p style={{ fontSize: 12.5, color: "var(--ink-4)", margin: "0 0 14px", lineHeight: 1.5 }}>
                Contacts, Drive folder, and tech note — admin-only. (PD doc, roles, and
                student teams are per-semester, shown above.)
              </p>
              <div className="kv">
                <span className="k">Contacts</span>
                <span
                  className="v"
                  style={{ color: (project.contacts?.length ?? 0) ? "var(--ink)" : "var(--ink-4)" }}
                >
                  {project.contacts && project.contacts.length ? (
                    <span style={{ display: "grid", gap: 4 }}>
                      {project.contacts.map((c, i) => (
                        <span key={i}>
                          {c.name || "—"}
                          {c.email ? (
                            <>
                              {" "}
                              <a href={`mailto:${c.email}`} className="tlink" style={{ wordBreak: "break-all" }}>
                                &lt;{c.email}&gt;
                              </a>
                            </>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>

                <span className="k">Drive folder</span>
                {muted(project.driveUrl) ? (
                  <a
                    href={project.driveUrl!.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tlink v"
                    style={{ wordBreak: "break-all" }}
                  >
                    Open Drive folder ↗
                  </a>
                ) : (
                  <span className="v" style={{ color: "var(--ink-4)" }}>—</span>
                )}

                <span className="k">Tech note</span>
                {!techNoteRaw ? (
                  <span className="v" style={{ color: "var(--ink-4)" }}>—</span>
                ) : techNoteRedundant ? (
                  <span className="v" style={{ color: "var(--ink-4)", fontStyle: "italic" }}>
                    Same as the public tech stack above.
                  </span>
                ) : (
                  <span className="v" style={{ color: "var(--ink-2)", whiteSpace: "pre-line", lineHeight: 1.55 }}>
                    {techNoteRaw}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ───────────── SIDE PANEL ───────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card card-pad">
              <div className="eyebrow" style={{ marginBottom: 14 }}>At a glance</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <GlanceRow
                  k="Status"
                  v={
                    isDraft ? (
                      <span className="badge b-amber">Draft</span>
                    ) : (
                      <span className="badge b-grn">Published</span>
                    )
                  }
                />
                <GlanceRow k="Discipline" v={projectDisciplines(project).join(" · ") || "—"} />
                {latestTerm && <GlanceRow k="Term" v={latestTerm} />}
                {project.partner && (
                  <GlanceRow
                    k="Client"
                    v={project.partner + (project.clientType ? ` · ${project.clientType}` : "")}
                  />
                )}
              </div>
            </div>

            {isDraft && missing.length > 0 && (
              <div
                className="card card-pad"
                style={{ background: "var(--amber-bg)", borderColor: "var(--amber-line)" }}
              >
                <div className="eyebrow" style={{ marginBottom: 8, color: "var(--amber)" }}>
                  To publish, add
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, color: "#7a5a14" }}>
                  {missing.map((m) => (
                    <span key={m}>○ {m}</span>
                  ))}
                </div>
                <Link
                  href={`/admin/edit/${project.id}`}
                  className="btn btn-teal"
                  style={{ marginTop: 14, width: "100%", justifyContent: "center", fontSize: 13.5, padding: "10px" }}
                >
                  Complete in editor →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Discipline-tinted "No image" placeholder marker (top-left chip).
function NoImg() {
  return (
    <span
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        fontFamily: "var(--mono)",
        fontSize: 9,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--ink-4)",
        background: "rgba(255,255,255,0.82)",
        padding: "2px 6px",
        borderRadius: 3,
      }}
    >
      No image
    </span>
  );
}

function GlanceRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-4)",
        }}
      >
        {k}
      </span>
      <span style={{ fontSize: 14, color: "var(--ink)" }}>{v}</span>
    </div>
  );
}
