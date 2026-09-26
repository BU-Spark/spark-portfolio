import { describe, it, expect } from "vitest";
import { parseTechStack, cleanTechNote, PD_SECTION_HEADINGS } from "./tech";
import { extractTechStack } from "./gdocs";

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

describe("PD noise (contact table, headings, template)", () => {
  const contact = [
    "Role", "First Name", "Last Name", "Email",
    "EIR", "Jane", "Doe", "jane@bu.edu",
    "Teammate – DS", "Sam", "Lee", "sam@bu.edu",
    "Program Lead", "Alex", "Kim", "alex@client.org",
    "________________",
    "Tab 2",
    "Client Meeting Template Date: Attendance:",
  ].join("\n");

  it("contact table after real tech yields only the real tech, and the note stops before it", () => {
    const r = parseTechStack(`• Python\n• React\n${contact}`);
    expect(r.tags).toEqual(["Python", "React"]);
    expect(r.raw).toBe("• Python\n• React");
    expect(r.raw).not.toMatch(/@|Role|Meeting/);
  });

  it("stops the tech note at meeting notes even without a contact table", () => {
    expect(cleanTechNote("Python\nMeeting 6: talked to client\nJane")).toBe("Python");
    expect(cleanTechNote("Python\nQuick recap\nstuff")).toBe("Python");
  });

  it("through extractTechStack: doc with contact table after the tech cell", () => {
    const doc = `Preferred Tech Stack\nArcGIS, Python\n${contact}`;
    const r = parseTechStack(extractTechStack(doc));
    expect(r.tags).toEqual(["ArcGIS", "Python"]);
    expect(r.raw).not.toMatch(/jane@bu\.edu/);
  });

  it("unfilled template example 'e.g. Tableau, PowerBI' yields nothing", () => {
    const r = parseTechStack(
      "List of tools/ tech stack preferred by client e.g. Tableau, PowerBI, Flourish, etc."
    );
    expect(r.tags).toEqual([]);
    expect(r.raw).toBe("");
    expect(parseTechStack("e.g. Tableau, PowerBI").tags).toEqual([]);
  });

  it("drops template instructions and comment anchors from the note", () => {
    const r = parseTechStack(
      "If a client works with a specific tech stack or programs, please list here\n/ Design System[b]\n[b]\nFigma[a]\nInclude links to recommended libraries"
    );
    expect(r.raw).toBe("Figma");
    expect(r.tags).toEqual(["Figma"]);
  });

  it("'Python, Jupyter Notebooks' splits into two tags", () => {
    expect(parseTechStack("Python, Jupyter Notebooks").tags).toEqual(["Python", "Jupyter Notebooks"]);
    expect(parseTechStack("• Python, Jupyter Notebooks (for EDA)").tags).toEqual([
      "Python",
      "Jupyter Notebooks",
    ]);
  });

  it("rejects section headings and bare junk", () => {
    const r = parseTechStack([...PD_SECTION_HEADINGS, "TBD", "Data", "See Figma", "PM", "React"].join("\n"));
    expect(r.tags).toEqual(["React"]);
  });

  it("strips trailing qualifiers and stray punctuation", () => {
    expect(parseTechStack("• SQL if needed\n• Python )").tags).toEqual(["SQL", "Python"]);
  });
});
