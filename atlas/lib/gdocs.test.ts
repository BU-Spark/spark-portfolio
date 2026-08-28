import { describe, it, expect } from "vitest";
import {
  extractPdBlurb,
  extractTechStack,
  extractContacts,
  extractDriveFolder,
  cleanBlurb,
  recleanBlurb,
  matchKey,
  splitClientProject,
  cleanClientName,
} from "./gdocs";

describe("extractPdBlurb", () => {
  it("slices between the heading and the end marker", () => {
    const doc =
      "Header junk\nProject Description:\nWe build a thing for people.\nIdeal Output & Final Deliverables:\nA, B, C";
    expect(extractPdBlurb(doc)).toBe("We build a thing for people.");
  });

  it("handles a bare 'Description' heading (UX docs)", () => {
    const doc = "Description\nThe summary.\nIdeal Output and Final Deliverables\nx";
    expect(extractPdBlurb(doc)).toBe("The summary.");
  });

  it("returns '' when there is no usable heading", () => {
    expect(extractPdBlurb("just some text with no headings")).toBe("");
    expect(extractPdBlurb("")).toBe("");
  });

  it("excludes a 'Final Deliverables to …' subsection before the end marker", () => {
    // Mirrors the real doc the user flagged: a deliverables subsection sits
    // BEFORE 'Ideal Output & Final Deliverables' and must not leak in.
    const doc = [
      "Project Description:",
      "The project aims to refine AI-assisted grading.",
      "",
      "More description here.",
      "Final Deliverables to Mike and ETI:",
      "Set up and configure a local testing system.",
      "Provide support to the assessment pilot.",
      "Ideal Output & Final Deliverables:",
      "The final deliverables should include:",
    ].join("\n");
    const out = extractPdBlurb(doc);
    expect(out).toContain("The project aims to refine AI-assisted grading.");
    expect(out).toContain("More description here.");
    expect(out).not.toContain("Final Deliverables to Mike");
    expect(out).not.toContain("Set up and configure");
    expect(out).not.toContain("Ideal Output");
  });

  it("does not cut on the word 'deliverables' mid-prose", () => {
    const doc =
      "Project Description:\nWe will produce deliverables for the client team.\nIdeal Output & Final Deliverables:\nx";
    expect(extractPdBlurb(doc)).toBe(
      "We will produce deliverables for the client team."
    );
  });

  it("cuts at 'Ideal Output & Deliverables' (no 'Final')", () => {
    // The common variant that used to leak the entire rest of the doc.
    const doc =
      "Project Description:\nThe real summary.\nIdeal Output & Deliverables\n• Cleaned data set\nProject Contact Information:\nrole\tname";
    expect(extractPdBlurb(doc)).toBe("The real summary.");
  });

  it("cuts at a 'What Was Completed This Semester' wrap-up", () => {
    // Docs with no Ideal-Output heading are still bounded by wrap-up headings.
    const doc =
      "Project Description:\nThe summary sentence.\nWhat Was Completed This Semester (FALL 2025)\nThe team did things.";
    expect(extractPdBlurb(doc)).toBe("The summary sentence.");
  });

  it("cuts at 'Project Details' / 'Project Milestones' headings", () => {
    const doc =
      "Description\nA tidy blurb.\nProject Details\n\tPreferred Tech Stack\n\t• CSV";
    expect(extractPdBlurb(doc)).toBe("A tidy blurb.");
  });

  it("does not cut on 'overview' or 'next steps' used mid-prose", () => {
    const doc =
      "Project Description:\nThis overview covers next steps for the team.\nIdeal Output & Deliverables\nx";
    expect(extractPdBlurb(doc)).toBe(
      "This overview covers next steps for the team."
    );
  });
});

describe("extractTechStack", () => {
  it("captures the tech block under a 'Preferred Tech Stack' label up to the next field", () => {
    const doc =
      "Project Details\nPreferred Tech Stack\nReact, Node.js, PostgreSQL\nKey Questions\nWhere are prices rising?";
    expect(extractTechStack(doc)).toBe("React, Node.js, PostgreSQL");
  });
  it("handles the value on the same line as the label", () => {
    expect(extractTechStack("Preferred Tech Stack: Looker Studio\nData Sets\nfoo")).toBe(
      "Looker Studio"
    );
  });
  it("matches the 'Tech Stack / Design System Used' heading variant", () => {
    const doc = "Tech Stack/ Design System Used (Preferred Tech Stack)\nArcGIS / Python\nProject Milestones\nx";
    expect(extractTechStack(doc)).toBe("ArcGIS / Python");
  });
  it("returns '' when there is no tech field", () => {
    expect(extractTechStack("Project Description:\nA summary.\nIdeal Output\nx")).toBe("");
    expect(extractTechStack("")).toBe("");
  });
  it("does not start on the title line containing 'Project Description'", () => {
    expect(extractTechStack("DS594 Project Description Template\nProject Description:\nSummary.")).toBe("");
  });
});

describe("extractContacts", () => {
  // The Doc contact table exports as one cell per line (tabs stripped by the parser).
  const doc = [
    "Project Contact Information:",
    "Role", "First Name", "Last Name", "Email",
    "Spark Advisor / Professor", "Tom", "Gardos", "tgardos@bu.edu",
    "Spark! Tech Advisor", "Michelle", "Voong", "mvoong@bu.edu",
    "Program Lead / Spark! Support", "Daniel", "Oh", "danoh@bu.edu",
    "PM", "Lina", "Dellanno", "dellanno@bu.edu",
    "TPM", "Maxine", "Yu",
    "Client", "Andrea", "Lizarao", "abelt@bu.edu",
  ].join("\n");

  it("maps each role to a full name + email", () => {
    const c = extractContacts(doc);
    expect(c.sparkProgramLead).toEqual({ name: "Daniel Oh", email: "danoh@bu.edu" });
    expect(c.pm).toEqual({ name: "Lina Dellanno", email: "dellanno@bu.edu" });
    expect(c.techAdvisor).toEqual({ name: "Michelle Voong", email: "mvoong@bu.edu" });
  });
  it("handles a missing email (next cell is another role)", () => {
    expect(extractContacts(doc).tpm).toEqual({ name: "Maxine Yu", email: null });
  });
  it("skips Client / faculty advisor / teammates (not our six roles)", () => {
    const c = extractContacts(doc);
    expect(c.seniorAdvisor).toBeUndefined();
    expect(c.eir).toBeUndefined();
    // Andrea (Client) must not leak into any role.
    expect(JSON.stringify(c)).not.toContain("Andrea");
  });
  it("returns {} when there is no contact section", () => {
    expect(extractContacts("Project Description:\nA summary.")).toEqual({});
  });
});

describe("extractDriveFolder", () => {
  it("finds a Drive folder link in the PD text", () => {
    const doc = "Key Project Links\nGoogle Drive Folder\nhttps://drive.google.com/drive/folders/1e5DF9Ax?usp=drive_link\nmore";
    expect(extractDriveFolder(doc)).toBe(
      "https://drive.google.com/drive/folders/1e5DF9Ax?usp=drive_link"
    );
  });
  it("returns '' when there is no Drive folder link", () => {
    expect(extractDriveFolder("no links here")).toBe("");
    expect(extractDriveFolder("https://drive.google.com/file/d/abc/view")).toBe(""); // a file, not a folder
  });
});

describe("cleanBlurb", () => {
  it("normalizes bullet markers to •", () => {
    expect(cleanBlurb("intro\n* one\n- two\n• three")).toBe(
      "intro\n• one\n• two\n• three"
    );
  });
  it("is idempotent", () => {
    const once = cleanBlurb("* a\n* b");
    expect(cleanBlurb(once)).toBe(once);
  });
  it("collapses 3+ blank lines and trims", () => {
    expect(cleanBlurb("  a\n\n\n\nb  ")).toBe("a\n\nb");
  });
  it("strips a trailing 'Read more' link label", () => {
    expect(cleanBlurb("The summary ends here.\nRead more")).toBe(
      "The summary ends here."
    );
    expect(cleanBlurb("Body.\n• Learn more »")).toBe("Body.");
  });
  it("keeps 'more' when it's part of real prose", () => {
    expect(cleanBlurb("We want more users to read more easily.")).toBe(
      "We want more users to read more easily."
    );
  });
});

describe("recleanBlurb", () => {
  it("trims a leaked section from an already-stored blurb", () => {
    const stored =
      "The real summary.\nIdeal Output & Deliverables\n• a\nProject Contact Information:\nrole\tname";
    expect(recleanBlurb(stored)).toBe("The real summary.");
  });
  it("strips a trailing 'Read more' from a stored blurb", () => {
    expect(recleanBlurb("Body text here.\nRead more")).toBe("Body text here.");
  });
  it("leaves a clean blurb unchanged (idempotent)", () => {
    const clean = "A tidy summary.\n• one\n• two";
    expect(recleanBlurb(clean)).toBe(clean);
    expect(recleanBlurb(recleanBlurb(clean))).toBe(clean);
  });
});

describe("splitClientProject", () => {
  it("splits 'Client: Project'", () => {
    expect(splitClientProject("Act On Mass: House Roll Call Tracker")).toEqual({
      client: "Act On Mass",
      project: "House Roll Call Tracker",
    });
  });
  it("splits on a spaced dash too", () => {
    expect(splitClientProject("Open Justice Lab - Prison Overcrowding")).toEqual({
      client: "Open Justice Lab",
      project: "Prison Overcrowding",
    });
  });
  it("returns empty client for a bare name", () => {
    expect(splitClientProject("Kingdom App")).toEqual({
      client: "",
      project: "Kingdom App",
    });
  });
});

describe("matchKey", () => {
  it("is tolerant of punctuation, &/and, and a trailing 'project'", () => {
    expect(matchKey("Foo & Bar Project")).toBe(matchKey("foo and bar"));
  });
  it("strips parentheticals and Team A/B markers", () => {
    expect(matchKey("Geotag Tree (One Acre Fund)")).toBe("geotag tree");
    expect(matchKey("Widget Team A")).toBe("widget");
  });
});

describe("cleanClientName", () => {
  it("takes the first line and drops a trailing email", () => {
    expect(cleanClientName("Courtney Pike, cpike@bu.edu\nextra")).toBe(
      "Courtney Pike"
    );
  });
});
