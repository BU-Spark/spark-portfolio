import { describe, it, expect } from "vitest";
import { buildIndex, findMatch, coerceRows } from "./import-match";
import type { Project } from "./types";

// buildIndex/findMatch only read id + title, so a narrow fixture is honest here —
// widening it would just be noise that rots when Project gains fields.
const project = (id: string, title: string, ownerOrg: string): Project =>
  ({ id, title, ownerOrg }) as Project;

// Deliberately near-identical titles owned by different teams: one edit apart
// ("Analytics" vs "Analytic"), which is exactly the case the fuzzy fallback would
// otherwise resolve across the org boundary.
const sparkProject = project("wbur-analytics", "WBUR: Newsroom Analytics", "spark");
const cdsProject = project("cds-newsroom", "WBUR: Newsroom Analytic", "cds");
// A Spark project with no near-twin in CDS, so a CDS-scoped lookup for it has
// nothing to fall back to and must come back empty.
const sparkOnly = project("herbaria", "Herbaria Digitization", "spark");
const all = [sparkProject, cdsProject, sparkOnly];

const forOrg = (org: string) => buildIndex(all.filter((p) => p.ownerOrg === org));
const noAliases: Record<string, string> = {};

describe("buildIndex org scoping", () => {
  it("matches within the caller's org", () => {
    const hit = findMatch(forOrg("spark"), "WBUR: Newsroom Analytics", noAliases);
    expect(hit?.project.id).toBe("wbur-analytics");
    expect(hit?.fuzzy).toBe(false);
  });

  // The regression that matters: a CDS-scoped sync must never resolve to a project
  // Spark owns, even when the tracker name is an EXACT match for that project's
  // title. If this fails, the org filter has moved to write-time and cross-org
  // writes are reachable.
  it("never resolves to another org's project, even on an exact title match", () => {
    const hit = findMatch(forOrg("cds"), "WBUR: Newsroom Analytics", noAliases);
    expect(hit?.project.id).not.toBe("wbur-analytics");
    // It does legitimately fuzzy-match CDS's own near-identically named project —
    // that is the filter working, not leaking: the candidate set never contained
    // the Spark row.
    expect(hit?.project.ownerOrg).toBe("cds");
  });

  it("returns nothing when the org owns no plausible candidate", () => {
    expect(findMatch(forOrg("cds"), "Herbaria Digitization", noAliases)).toBeUndefined();
  });

  // Same name against the "other" index is how the importer distinguishes
  // "belongs to the other team" from "no such project" — the first is reported as
  // crossOrg, the second is inboxed for triage. Conflating them either hides real
  // work or creates duplicate projects.
  it("resolves against the other-org index so a miss can be labelled crossOrg", () => {
    const other = buildIndex(all.filter((p) => p.ownerOrg !== "cds"));
    const hit = findMatch(other, "WBUR: Newsroom Analytics", noAliases);
    expect(hit?.project.id).toBe("wbur-analytics");
    // Exact, so runImport is entitled to suppress the inbox row: the project
    // demonstrably already exists under the other team.
    expect(hit?.fuzzy).toBe(false);
  });

  // The counterpart, and the distinction runImport now branches on. Only an EXACT
  // cross-org hit suppresses the inbox row; a fuzzy one is a guess with an
  // edit-distance-2 tolerance. If this stopped being distinguishable, a genuinely
  // new project whose name merely resembles the other team's would be neither
  // imported nor inboxed — silently dropped, recoverable only by someone reading
  // the crossOrg list.
  it("flags a near-miss against the other-org index as fuzzy, not exact", () => {
    const other = buildIndex(all.filter((p) => p.ownerOrg !== "spark"));
    // One edit from the CDS title, so it can only resolve via the fuzzy fallback.
    const hit = findMatch(other, "WBUR: Newsroom Analytir", noAliases);
    expect(hit?.project.id).toBe("cds-newsroom");
    expect(hit?.fuzzy).toBe(true);
  });

  // Curated aliases are scoped for free because byId only holds indexed projects.
  // This test is what keeps that true if the alias lookup is ever refactored.
  it("ignores a curated alias pointing at another org's project", () => {
    const aliases = { "some tracker name": "wbur-analytics" };
    expect(findMatch(forOrg("cds"), "some tracker name", aliases)).toBeUndefined();
    // …and still honours it for the org that owns the target.
    expect(findMatch(forOrg("spark"), "some tracker name", aliases)?.project.id).toBe(
      "wbur-analytics"
    );
  });

  it("prefers an exact same-org match over a fuzzy candidate", () => {
    // Both projects visible: the exact title must win, and must not be flagged fuzzy.
    const hit = findMatch(buildIndex(all), "WBUR: Newsroom Analytic", noAliases);
    expect(hit?.project.id).toBe("cds-newsroom");
    expect(hit?.fuzzy).toBe(false);
  });

  it("still falls back to fuzzy within an org when nothing exact matches", () => {
    // One character off the Spark title, Spark-only index → fuzzy hit, flagged.
    const hit = findMatch(forOrg("spark"), "WBUR: Newsroom Analytcs", noAliases);
    expect(hit?.project.id).toBe("wbur-analytics");
    expect(hit?.fuzzy).toBe(true);
  });
});

// coerceRows is the trust boundary for both import entry points: the Apps Script
// feed and an admin's pasted CSV. Everything it lets through gets .trim() called on
// it downstream, so these are the cases that used to be unhandled 500s.
describe("coerceRows", () => {
  it("keeps well-formed rows untouched", () => {
    const rows = coerceRows([{ project: "Herbaria", semester: "Fall 2025" }]);
    expect(rows).toEqual([{ project: "Herbaria", semester: "Fall 2025" }]);
  });

  it("drops non-object elements instead of throwing on them", () => {
    // The original bug: a null element reached r.project and 500'd the whole sync.
    expect(coerceRows([null, "x", 42, [], { project: "Herbaria" }])).toEqual([
      { project: "Herbaria" },
    ]);
  });

  it("strips non-string fields but keeps the row", () => {
    // A tracker column that starts emitting a number must not silently shrink the
    // sync — the project name is what matching needs, so the row survives without
    // the bad field rather than vanishing before runImport can count it.
    expect(coerceRows([{ project: "Herbaria", semester: 2026, pm: { name: "x" } }])).toEqual([
      { project: "Herbaria" },
    ]);
  });

  it("drops rows with no usable project name", () => {
    expect(coerceRows([{ project: 1 }, { project: "" }, { semester: "Fall 2025" }])).toEqual([]);
  });

  it("returns empty for anything that isn't an array", () => {
    for (const bad of [null, undefined, "rows", 7, { rows: [] }]) {
      expect(coerceRows(bad)).toEqual([]);
    }
  });

  it("never returns a value that would throw on .trim()", () => {
    // The invariant the two routes actually depend on, stated directly.
    const rows = coerceRows([
      { project: "A", techText: 5, github: null, pdUrl: undefined },
      { project: "B", client: "Acme" },
    ]);
    for (const r of rows) {
      for (const v of Object.values(r)) expect(typeof v).toBe("string");
      expect(() => r.project.trim()).not.toThrow();
    }
    expect(rows).toHaveLength(2);
  });
});
