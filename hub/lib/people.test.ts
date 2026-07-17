import { describe, it, expect } from "vitest";
import { cleanPersonName, normalizeName } from "./gdocs";

describe("cleanPersonName", () => {
  it("keeps a plain name", () => {
    expect(cleanPersonName("Abby Gualda")).toBe("Abby Gualda");
  });

  it("strips a trailing , email (like the tracker cells)", () => {
    expect(cleanPersonName("Jane Doe, jane@bu.edu")).toBe("Jane Doe");
  });

  it("takes only the first line", () => {
    expect(cleanPersonName("Jane Doe\nSomeone Else")).toBe("Jane Doe");
  });

  it("collapses whitespace", () => {
    expect(cleanPersonName("  Nolan   Thompson ")).toBe("Nolan Thompson");
  });

  it("drops placeholder values", () => {
    for (const v of ["TBD", "tbd", "N/A", "n/a", "TBA", "None", "—", "-", "??"]) {
      expect(cleanPersonName(v)).toBe("");
    }
  });

  it("empty / whitespace → empty", () => {
    expect(cleanPersonName("")).toBe("");
    expect(cleanPersonName("   ")).toBe("");
  });
});

describe("normalizeName (people name_key + alias resolution)", () => {
  it("nickname and full name normalize distinctly (so an alias is needed)", () => {
    expect(normalizeName("Abby")).toBe("abby");
    expect(normalizeName("Abby Gualda")).toBe("abby gualda");
    expect(normalizeName("Abby")).not.toBe(normalizeName("Abby Gualda"));
  });

  it("is case- and whitespace-insensitive (stable name_key)", () => {
    expect(normalizeName("  Daniel   OH ")).toBe(normalizeName("Daniel Oh"));
  });
});
