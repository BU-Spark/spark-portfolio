import { describe, it, expect } from "vitest";
import { coerceSuggestion, applicableFields, missingFields } from "./suggest";
import type { Project } from "./types";

const VOCAB = ["Housing & Urban Development", "Education & Learning"] as const;

describe("coerceSuggestion", () => {
  it("keeps the whitelisted fields", () => {
    expect(
      coerceSuggestion({ blurb: "  A   real   description ", repoUrl: "https://github.com/x/y" })
    ).toEqual({ blurb: "A real description", repoUrl: "https://github.com/x/y" });
  });

  // The load-bearing test: ProjectPatch fields that would be privilege escalation
  // if a reviewer clicked accept without reading.
  it("DROPS fields outside the whitelist", () => {
    const out = coerceSuggestion({
      blurb: "ok",
      visibility: "public",
      status: "complete",
      featured: true,
      pm: "Someone Else",
      blurbLocked: true,
      pdUrl: "https://docs.google.com/x",
      driveUrl: "https://drive.google.com/x",
      images: ["projects/evil.png"],
    });
    expect(out).toEqual({ blurb: "ok" });
    expect(out).not.toHaveProperty("visibility");
    expect(out).not.toHaveProperty("status");
    expect(out).not.toHaveProperty("featured");
    expect(out).not.toHaveProperty("images");
  });

  it("refuses non-http urls", () => {
    expect(coerceSuggestion({ repoUrl: "javascript:alert(1)" })).toBeNull();
    expect(coerceSuggestion({ prodUrl: "data:text/html,<script>" })).toBeNull();
    expect(coerceSuggestion({ repoUrl: "ftp://x/y" })).toBeNull();
  });

  it("restricts topics to the supplied vocabulary", () => {
    expect(
      coerceSuggestion(
        { topics: ["Education & Learning", "Made Up Topic"] },
        { topicVocabulary: VOCAB }
      )
    ).toEqual({ topics: ["Education & Learning"] });
    // Nothing survives the vocabulary → no payload at all, so the caller can 400.
    expect(
      coerceSuggestion({ topics: ["Made Up Topic"] }, { topicVocabulary: VOCAB })
    ).toBeNull();
  });

  it("dedupes and caps tags", () => {
    const out = coerceSuggestion({ tech: ["React", "React", " react ", "Vue"] });
    expect(out?.tech).toEqual(["React", "react", "Vue"]);
    expect(coerceSuggestion({ tech: Array(50).fill(0).map((_, i) => `t${i}`) })?.tech)
      .toHaveLength(24);
  });

  it("returns null for junk and for empty-after-trim", () => {
    expect(coerceSuggestion(null)).toBeNull();
    expect(coerceSuggestion("nope")).toBeNull();
    expect(coerceSuggestion({})).toBeNull();
    expect(coerceSuggestion({ blurb: "   " })).toBeNull();
  });
});

const proj = (over: Partial<Project> = {}) =>
  ({ blurb: "", repoUrl: null, prodUrl: null, tech: [], topics: [], clientDesc: null, images: [], ...over }) as Project;

describe("applicableFields", () => {
  it("fills blanks", () => {
    expect(applicableFields({ blurb: "new", repoUrl: "https://a/b" }, proj()))
      .toEqual({ blurb: "new", repoUrl: "https://a/b" });
  });

  it("refuses to overwrite existing content by default", () => {
    expect(applicableFields({ blurb: "new" }, proj({ blurb: "curated" }))).toEqual({});
    expect(applicableFields({ tech: ["Vue"] }, proj({ tech: ["React"] }))).toEqual({});
  });

  it("overwrites only when explicitly allowed", () => {
    expect(applicableFields({ blurb: "new" }, proj({ blurb: "old" }), ["blurb"]))
      .toEqual({ blurb: "new" });
  });

  it("never applies the note fields", () => {
    const out = applicableFields(
      { contributorsNote: "Alice, Bob", note: "please fix", blurb: "b" },
      proj()
    );
    expect(out).toEqual({ blurb: "b" });
    expect(out).not.toHaveProperty("contributorsNote");
    expect(out).not.toHaveProperty("note");
  });

  it("treats empty string and empty array as blank", () => {
    expect(applicableFields({ blurb: "x" }, proj({ blurb: "   " }))).toEqual({ blurb: "x" });
  });
});

describe("missingFields", () => {
  it("lists every gap", () => {
    expect(missingFields(proj())).toEqual([
      "description", "code repository", "live demo", "tech stack", "topics", "screenshots",
    ]);
  });
  it("is empty for a complete project", () => {
    expect(
      missingFields(proj({
        blurb: "b", repoUrl: "https://a", prodUrl: "https://b",
        tech: ["x"], topics: ["y"], images: ["z"],
      }))
    ).toEqual([]);
  });
});
