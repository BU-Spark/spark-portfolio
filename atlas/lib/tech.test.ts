import { describe, it, expect } from "vitest";
import { parseTechStack } from "./tech";

describe("parseTechStack", () => {
  it("clean bullet list → one tag per item (PD Image #5)", () => {
    const r = parseTechStack("* ArcGIS\n* Python");
    expect(r.tags).toEqual(["ArcGIS", "Python"]);
    expect(r.mode).toBe("list");
    expect(r.raw).toContain("ArcGIS");
  });

  it("prose inside a bullet → dictionary match, not the whole sentence (Image #4)", () => {
    const r = parseTechStack(
      "- Client prefer R but okay with Python (the FA25 team worked with Python)"
    );
    expect(r.tags).toEqual(["Python", "R"]); // dictionary order: Python before R
    expect(r.mode).toBe("prose");
    // The raw nuance is preserved for the admin note.
    expect(r.raw).toMatch(/prefer R/);
  });

  it("comma-separated tags on one line are split", () => {
    const r = parseTechStack("Python, R, SQL");
    expect(r.tags).toEqual(["Python", "R", "SQL"]);
    expect(r.mode).toBe("list");
  });

  it("does NOT split a comma'd sentence into junk tags", () => {
    const r = parseTechStack(
      "We used Python, mostly because the client was comfortable with it."
    );
    expect(r.tags).toEqual(["Python"]);
    expect(r.mode).toBe("prose");
  });

  it("multi-word literal tags survive (Power BI, scikit-learn)", () => {
    const r = parseTechStack("• Power BI\n• scikit-learn\n• Tableau");
    expect(r.tags).toEqual(["Power BI", "scikit-learn", "Tableau"]);
  });

  it("strips trailing parenthetical notes from literal tags", () => {
    const r = parseTechStack("• Python (preferred)\n• ArcGIS");
    expect(r.tags).toEqual(["Python", "ArcGIS"]);
  });

  it("dedupes case-insensitively", () => {
    const r = parseTechStack("• Python\n• python\n• PYTHON");
    expect(r.tags).toEqual(["Python"]);
  });

  it("empty / whitespace cell → empty mode, no tags", () => {
    expect(parseTechStack("   ").mode).toBe("empty");
    expect(parseTechStack("").tags).toEqual([]);
  });

  it("does not match single 'R' inside other words", () => {
    const r = parseTechStack("This project relates to research and reporting.");
    expect(r.tags).not.toContain("R");
  });

  it("mixed list: clean tags + a prose line both contribute", () => {
    const r = parseTechStack(
      "* ArcGIS\n* The team will likely also use Python for ETL"
    );
    expect(r.tags).toContain("ArcGIS");
    expect(r.tags).toContain("Python");
  });
});
