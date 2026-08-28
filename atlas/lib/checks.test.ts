import { describe, it, expect } from "vitest";
import {
  checkBlurb,
  checkDisciplines,
  checkDatasets,
  checkRuns,
  checkProject,
  hasBlocker,
  galleryReadiness,
} from "./checks";
import type { Project, Run } from "./types";

const run = (over: Partial<Run> = {}): Run => ({
  term: "Spring 2026",
  course: "DS519",
  discipline: "SWE",
  students: [],
  ...over,
});

// A project that passes everything, so each test can break exactly one thing.
const clean = (over: Partial<Project> = {}): Project =>
  ({
    id: "p",
    title: "T",
    blurb: "x".repeat(220),
    partner: "Acme",
    clientType: "Nonprofit",
    tech: ["Python"],
    runs: [run()],
    images: ["projects/a.png"],
    repoUrl: "https://github.com/x/y",
    ...over,
  }) as Project;

describe("checkBlurb", () => {
  it("blocks an empty description", () => {
    expect(checkBlurb("")[0]).toMatchObject({ code: "blurb.missing", severity: "blocker" });
    expect(checkBlurb(null)[0].severity).toBe("blocker");
  });

  it("blocks placeholder text", () => {
    for (const v of ["TBD", "n/a", "  None  ", "coming soon"]) {
      expect(checkBlurb(v)[0]).toMatchObject({ code: "blurb.placeholder", severity: "blocker" });
    }
  });

  // The distinction that keeps this from being annoying: placeholders are matched on
  // the WHOLE blurb, so a real description mentioning "TBD" is not flagged.
  it("does not flag a real description that merely contains a placeholder word", () => {
    const real = "We built a scheduling tool for the client. The launch date is TBD, pending review. " + "x".repeat(80);
    expect(checkBlurb(real)).toEqual([]);
  });

  it("warns (not blocks) on a short stub", () => {
    const f = checkBlurb("Too short.");
    expect(f[0]).toMatchObject({ code: "blurb.short", severity: "warning" });
  });
});

describe("checkDisciplines", () => {
  it("offers an autoFix only when the stored discipline is empty", () => {
    const f = checkDisciplines([run({ discipline: "" })]);
    expect(f[0]).toMatchObject({ code: "discipline.missing" });
    expect(f[0].autoFix).toEqual({ field: "discipline", runTerm: "Spring 2026", from: "", to: "SWE" });
  });

  // The safety property: a disagreement is reported but never auto-corrected, because
  // the course map is a heuristic and an admin may have overridden it deliberately.
  it("reports a mismatch WITHOUT an autoFix", () => {
    const f = checkDisciplines([run({ discipline: "ML" })]);
    expect(f[0].code).toBe("discipline.mismatch");
    expect(f[0].autoFix).toBeUndefined();
  });

  it("stays silent when stored and implied agree", () => {
    expect(checkDisciplines([run({ discipline: "SWE" })])).toEqual([]);
  });

  // Internships are the real-world case: 22 live runs have no course-derived
  // discipline, and inventing one would be worse than leaving it blank.
  it("says nothing about a course it cannot map", () => {
    expect(checkDisciplines([run({ course: "Internship", discipline: "" })])).toEqual([]);
  });
});

describe("checkDatasets", () => {
  it("blocks a non-http link", () => {
    const f = checkDatasets([{ label: "D", url: "javascript:alert(1)" }]);
    expect(f[0]).toMatchObject({ code: "dataset.badurl", severity: "blocker" });
  });

  it("accepts a well-formed link and flags an unlabelled one", () => {
    expect(checkDatasets([{ label: "Census", url: "https://data.gov/x" }])).toEqual([]);
    expect(checkDatasets([{ label: "", url: "https://data.gov/x" }])[0].code).toBe("dataset.nolabel");
  });

  it("surfaces the auto-scraped uncertainty flag", () => {
    expect(checkDatasets([{ label: "D", url: "https://x.com", uncertain: true }])[0].code)
      .toBe("dataset.uncertain");
  });
});

describe("checkRuns", () => {
  it("blocks when no run has both a term and a course", () => {
    expect(checkRuns([])[0].severity).toBe("blocker");
    expect(checkRuns([run({ course: "" })])[0].code).toBe("runs.missing");
  });
});

describe("checkProject / readiness", () => {
  it("finds nothing wrong with a complete project", () => {
    expect(checkProject(clean())).toEqual([]);
    expect(hasBlocker(checkProject(clean()))).toBe(false);
  });

  // The decision that keeps the audit usable: every one of the 140 ready projects has
  // no images, so if this were a blocker the entire catalogue would score 0 and the
  // report would say nothing.
  it("treats missing images as a warning, never a blocker", () => {
    const f = checkProject(clean({ images: [] }));
    expect(f.map((x) => x.code)).toContain("images.missing");
    expect(hasBlocker(f)).toBe(false);
    expect(galleryReadiness(clean({ images: [] }))).toBeGreaterThan(0);
  });

  it("scores 0 for anything with a blocker, so it can never be auto-picked", () => {
    expect(galleryReadiness(clean({ blurb: "" }))).toBe(0);
    expect(galleryReadiness(clean({ runs: [] }))).toBe(0);
  });

  it("ranks a richer project above a thinner one", () => {
    const rich = clean({ prodUrl: "https://live.example", topics: ["Health"], clientDesc: "About" });
    const thin = clean({ images: [], tech: [], repoUrl: null, partner: "Acme" });
    expect(galleryReadiness(rich)).toBeGreaterThan(galleryReadiness(thin));
  });
});
