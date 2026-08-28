// Pure helpers for the runs-based project model. Used on both server and
// client, so no "use client" / "server-only" here.
import { semesterRank } from "./semester";
import { courseLabel } from "./data";
import type { Project, Run } from "./types";

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

// Lower rank = more recent. Negated semesterRank so newest term sorts first.
// Number.MAX_SAFE_INTEGER for unrecognized terms (avoids NaN from Infinity math).
export function termRank(term: string): number {
  const r = semesterRank(term);
  return r === 0 ? Number.MAX_SAFE_INTEGER : -r;
}

export function projectTerms(p: Project): string[] {
  return uniq(p.runs.map((r) => r.term));
}
export function projectDisciplines(p: Project): string[] {
  return uniq(p.runs.map((r) => r.discipline));
}
export function projectPrograms(p: Project): string[] {
  return uniq(p.runs.map((r) => r.course)); // program was always === course
}
// The Program facet groups by friendly program NAME: several course codes can
// map to one program (DS488 + DS688 -> "Spark! UX Practicum"), so this yields
// one facet row per program instead of one per code (fixes the visual dupes).
export function projectProgramLabels(p: Project): string[] {
  return uniq(p.runs.map((r) => courseLabel(r.course)));
}
export function projectCourses(p: Project): string[] {
  return uniq(p.runs.map((r) => r.course));
}

// The most recent run — drives card/thumbnail display (discipline color, etc.).
export function primaryRun(p: Project): Run | undefined {
  if (!p.runs.length) return undefined;
  return [...p.runs].sort((a, b) => termRank(a.term) - termRank(b.term))[0];
}

export function primaryDiscipline(p: Project): string {
  return primaryRun(p)?.discipline || "Misc";
}

export function latestTerm(p: Project): string {
  return primaryRun(p)?.term || "";
}

// Runs sorted newest-first for display on the detail page.
export function runsByRecency(p: Project): Run[] {
  return [...p.runs].sort((a, b) => termRank(a.term) - termRank(b.term));
}

// Extract a short course code (e.g. "XC473", "DS539") from a course value that
// may be a bare code or a friendly string like "DS 549: Spark! Data Science…".
export function courseCode(course: string): string {
  const m = (course || "").match(/[A-Z]{2}\s?\d{3}/i);
  if (m) return m[0].replace(/\s+/g, "").toUpperCase();
  return (course || "").split(":")[0].trim();
}

// The most-recent run's course code — shown on the thumbnail badge.
export function primaryCourseCode(p: Project): string {
  return courseCode(primaryRun(p)?.course || "");
}

// Human-readable labels for the public-facing fields a project is still missing.
// Empty array means the project is complete. Used by the admin manager to flag
// projects that need attention before they look good in the public gallery.
// Admin-only: which CORE team roles are absent on the most-recent run. Uses the
// per-run role fields (only populated on the admin list projection), so it only
// flags meaningfully there — public payloads have no run roles and shouldn't call
// this. Distinct from missingInfo()'s "Contributors" (students) check.
export function missingTeam(p: Project): string[] {
  const run = primaryRun(p);
  if (!run) return [];
  const has = (v?: string | null) => !!(v && v.trim());
  const out: string[] = [];
  if (!has(run.sparkProgramLead)) out.push("Program Lead");
  if (!has(run.pm)) out.push("PM");
  if (!has(run.tpm)) out.push("TPM");
  return out;
}

export function missingInfo(p: Project): string[] {
  const out: string[] = [];
  if (!p.runs.some((r) => r.course?.trim())) out.push("Course");
  if (!p.tech || p.tech.length === 0) out.push("Tech stack");
  if (!p.repoUrl || !p.repoUrl.trim()) out.push("GitHub repo");
  if (!p.blurb || !p.blurb.trim()) out.push("Description");
  if (!p.images || p.images.filter(Boolean).length === 0) out.push("Images");
  // Subject-matter topics drive the Topic facet. An untagged project is invisible
  // to every topic filter, so this is a real gap rather than cosmetic metadata —
  // and unlike Contributors it is public data, so no projection guard is needed.
  if (!p.topics || p.topics.length === 0) out.push("Topics");
  // Admin-only: contributorCount is set only on the admin list projection. When
  // defined and zero, the project has no student contributors loaded yet. Guarded
  // with `=== 0` so public payloads (undefined) never flag this.
  if (p.contributorCount === 0) out.push("Contributors");
  return out;
}

// Admin-only "needs a human glance" flags — not missing data, but data that was
// auto-populated and should be verified. Rendered as review badges in the manager.
export function reviewFlags(p: Project): string[] {
  const out: string[] = [];
  if (p.datasets?.some((d) => d.uncertain)) out.push("Dataset link");
  return out;
}

// Fields a draft must have before it can be published (publish gate).
// Returns the blockers as human-readable strings; empty array = ready to publish.
export function publishBlockers(p: Pick<Project, "blurb" | "runs">): string[] {
  const out: string[] = [];
  if (!p.blurb?.trim()) out.push("description");
  if (!p.runs.some((r) => r.term && r.course?.trim())) out.push("course & term");
  return out;
}
