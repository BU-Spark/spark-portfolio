import { describe, it, expect } from "vitest";
import { missingInfo, projectTerms, termRank } from "./project";
import { SPARK_TERMS } from "./data";
import type { Project, Run } from "./types";

function run(over: Partial<Run> = {}): Run {
  return {
    term: "Fall 2025",
    course: "DS 539",
    discipline: "Data Science",
    students: [],
    teamId: null,
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1",
    title: "A Project",
    blurb: "A blurb.",
    partner: "Client",
    clientType: "Nonprofit",
    tech: ["React"],
    repoUrl: "https://github.com/x/y",
    images: ["projects/a.webp"],
    topics: ["Housing & Urban Development"],
    runs: [run()],
    ...over,
  };
}

describe("missingInfo", () => {
  it("returns [] for a complete project", () => {
    expect(missingInfo(project())).toEqual([]);
  });
  it("flags each empty public field", () => {
    const m = missingInfo(
      project({ tech: [], repoUrl: null, blurb: "", images: [] })
    );
    expect(m).toContain("Tech stack");
    expect(m).toContain("GitHub repo");
    expect(m).toContain("Description");
    expect(m).toContain("Images");
  });
  it("flags an untagged project", () => {
    expect(missingInfo(project({ topics: [] }))).toContain("Topics");
    expect(missingInfo(project({ topics: undefined }))).toContain("Topics");
    expect(missingInfo(project())).not.toContain("Topics");
  });
  it("treats whitespace-only repo/blurb as missing and null images array", () => {
    expect(missingInfo(project({ repoUrl: "   " }))).toContain("GitHub repo");
    expect(missingInfo(project({ images: [null, null] }))).toContain("Images");
  });
});

describe("projectTerms", () => {
  it("dedupes terms across runs", () => {
    const p = project({
      runs: [run({ term: "Fall 2025" }), run({ term: "Fall 2025" }), run({ term: "Spring 2026" })],
    });
    const terms = projectTerms(p);
    expect(terms.filter((t) => t === "Fall 2025")).toHaveLength(1);
    expect(terms).toContain("Spring 2026");
  });
});

describe("termRank", () => {
  it("ranks earlier entries of SPARK_TERMS as more recent (smaller)", () => {
    expect(termRank(SPARK_TERMS[0])).toBeLessThan(termRank(SPARK_TERMS[1]));
  });
});
