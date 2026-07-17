import { describe, it, expect } from "vitest";
import { semesterRank } from "./semester";

describe("semesterRank", () => {
  it("ranks later calendar terms higher", () => {
    expect(semesterRank("Spring 2026")).toBeGreaterThan(semesterRank("Fall 2025"));
    expect(semesterRank("Fall 2025")).toBeGreaterThan(semesterRank("Summer 2025"));
    expect(semesterRank("Summer 2025")).toBeGreaterThan(semesterRank("Spring 2025"));
    expect(semesterRank("Spring 2025")).toBeGreaterThan(semesterRank("Fall 2024"));
  });
  it("is case-insensitive and tolerant of spacing", () => {
    expect(semesterRank("fall 2025")).toBe(semesterRank("Fall 2025"));
  });
  it("returns 0 for unparseable/empty (never wins a comparison)", () => {
    expect(semesterRank("")).toBe(0);
    expect(semesterRank(null)).toBe(0);
    expect(semesterRank(undefined)).toBe(0);
    expect(semesterRank("TBD")).toBe(0);
    expect(semesterRank("Spring 2026")).toBeGreaterThan(semesterRank("TBD"));
  });
});
