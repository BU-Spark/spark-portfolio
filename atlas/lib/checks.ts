// Automated quality checks for a project record, run when a PM submits the
// end-of-semester completion form (see app/api/pd-complete/route.ts) and available
// as a standing audit.
//
// PURE — no db, no session, no `server-only`, no network. That is what makes it
// testable, and it is also the honest boundary: everything here is a judgement about
// data we already hold. Link *liveness* needs the network and lives in the route.
//
// WHY THIS ISN'T A MODEL. The spec floated "RAG or a lightweight ML model to tag
// academic discipline". Measured against the live data first: of 38 runs with no
// discipline, 16 resolve under the EXISTING deterministic course→discipline map and
// are simply stale stored values (a backfill bug), and the other 22 are internships,
// which have no course discipline to infer — "Internship" is a program, not a
// subject. So there was no residue for a classifier to earn its keep on. If a genuine
// unmapped course code shows up later, adding one line to disciplineFromCourse beats
// a model that can be wrong silently.
import { disciplineFromCourse } from "./data";
import type { Project, Run } from "./types";

/** How much a finding should block. `blocker` prevents going public. */
export type Severity = "blocker" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  /** Set when the fix is mechanical, so a caller can apply it without a human. */
  autoFix?: { field: "discipline"; runTerm: string; from: string; to: string };
}

// Text that means "nobody filled this in" — PD docs and trackers are full of it.
// Matched on the WHOLE trimmed blurb, never as a substring: a real description may
// legitimately contain "TBD" mid-sentence.
const PLACEHOLDER_BLURBS = new Set([
  "tbd", "tba", "n/a", "na", "none", "-", "--", "todo", "to do",
  "coming soon", "description", "placeholder", "test", "xxx", "?",
]);

/** Shortest blurb worth showing publicly. Two sentences ≈ 120 chars; 137 of the 140
 *  ready projects already clear 200, so this only catches genuine stubs. */
const MIN_BLURB = 60;

export function checkBlurb(blurb: string | null | undefined): Finding[] {
  const s = (blurb ?? "").trim();
  if (!s) {
    return [{ code: "blurb.missing", severity: "blocker", message: "No description." }];
  }
  if (PLACEHOLDER_BLURBS.has(s.toLowerCase())) {
    return [{
      code: "blurb.placeholder",
      severity: "blocker",
      message: `Description is a placeholder ("${s}").`,
    }];
  }
  if (s.length < MIN_BLURB) {
    return [{
      code: "blurb.short",
      severity: "warning",
      message: `Description is only ${s.length} characters — likely a stub.`,
    }];
  }
  return [];
}

/**
 * Compares each run's stored discipline against what the course code implies.
 *
 * Reports drift in both directions but only offers an autoFix when the stored value
 * is EMPTY. Overwriting a non-empty disagreement would silently undo a deliberate
 * admin correction, and the course map is a heuristic, not an authority.
 */
export function checkDisciplines(runs: Run[]): Finding[] {
  const out: Finding[] = [];
  for (const r of runs) {
    const course = (r.course ?? "").trim();
    if (!course) continue;
    const implied = disciplineFromCourse(course);
    if (!implied) continue; // unmapped course (e.g. "Internship") — nothing to say
    const stored = (r.discipline ?? "").trim();
    if (!stored) {
      out.push({
        code: "discipline.missing",
        severity: "warning",
        message: `${r.term || "a run"} (${course}) has no discipline; the course implies "${implied}".`,
        autoFix: { field: "discipline", runTerm: r.term, from: "", to: implied },
      });
    } else if (stored !== implied) {
      out.push({
        code: "discipline.mismatch",
        severity: "warning",
        message: `${r.term || "a run"} (${course}) is tagged "${stored}" but the course implies "${implied}". Left alone — an admin may have set it deliberately.`,
      });
    }
  }
  return out;
}

/**
 * Dataset entries: shape only. A URL that isn't http(s) can't be a working link and
 * would render as a dead or dangerous href, so that's a blocker; whether a
 * well-formed URL actually resolves is a network question the caller answers.
 */
export function checkDatasets(datasets: Project["datasets"]): Finding[] {
  const out: Finding[] = [];
  for (const d of datasets ?? []) {
    const label = (d.label ?? "").trim();
    const url = (d.url ?? "").trim();
    if (!label) {
      out.push({ code: "dataset.nolabel", severity: "warning", message: "A dataset has no label." });
    }
    if (url && !/^https?:\/\//i.test(url)) {
      out.push({
        code: "dataset.badurl",
        severity: "blocker",
        message: `Dataset "${label || url}" has a non-http(s) link.`,
      });
    }
    if (d.uncertain) {
      out.push({
        code: "dataset.uncertain",
        severity: "warning",
        message: `Dataset "${label || url}" was auto-scraped and needs a human check.`,
      });
    }
  }
  return out;
}

/** A run needs a term and a course to be a real run. */
export function checkRuns(runs: Run[]): Finding[] {
  const real = (runs ?? []).filter((r) => (r.term ?? "").trim() && (r.course ?? "").trim());
  if (!real.length) {
    return [{ code: "runs.missing", severity: "blocker", message: "No run with both a term and a course." }];
  }
  return [];
}

/** Client/partner attribution — the gallery reads oddly without it. */
export function checkPartner(partner: string | null | undefined): Finding[] {
  return (partner ?? "").trim()
    ? []
    : [{ code: "partner.missing", severity: "warning", message: "No partner/client name." }];
}

/**
 * Every check, for one project. Order is stable so output diffs cleanly between runs.
 *
 * Images are deliberately NOT a blocker. All 140 ready projects have zero images, so
 * treating that as blocking would mark the entire catalogue un-publishable and make
 * the whole report useless. It's reported as a warning instead.
 */
export function checkProject(p: Project): Finding[] {
  const findings = [
    ...checkBlurb(p.blurb),
    ...checkRuns(p.runs ?? []),
    ...checkPartner(p.partner),
    ...checkDisciplines(p.runs ?? []),
    ...checkDatasets(p.datasets),
  ];
  if (!(p.images ?? []).filter(Boolean).length) {
    findings.push({
      code: "images.missing",
      severity: "warning",
      message: "No screenshots — the card falls back to a plain tile.",
    });
  }
  return findings;
}

export function hasBlocker(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "blocker");
}

/**
 * Higher = more presentable, for choosing which projects to opt in to the gallery
 * first. Blockers score 0 so they can never be picked.
 *
 * Weighted by what a visitor actually sees on a card and detail page, which is why
 * a screenshot is worth more than a dataset link.
 */
export function galleryReadiness(p: Project): number {
  const findings = checkProject(p);
  if (hasBlocker(findings)) return 0;
  let score = 0;
  const blurb = (p.blurb ?? "").trim();
  if (blurb.length >= 200) score += 3;
  else if (blurb.length >= MIN_BLURB) score += 1;
  if ((p.images ?? []).filter(Boolean).length) score += 4;
  if ((p.tech ?? []).length) score += 2;
  if ((p.partner ?? "").trim()) score += 2;
  if ((p.repoUrl ?? "").trim() || p.codePrivate) score += 2;
  if ((p.prodUrl ?? "").trim()) score += 2;
  if ((p.clientDesc ?? "").trim()) score += 1;
  if ((p.topics ?? []).length) score += 1;
  if ((p.datasets ?? []).length) score += 1;
  if (!findings.length) score += 2; // wholly clean
  return score;
}
