import { describe, it, expect } from "vitest";
import { mergedVisibility, BU_VISIBLE, VISIBILITIES, type Visibility } from "./data";

describe("mergedVisibility", () => {
  // The bug: `survivorVis === "public" ? "public" : "internal"` was written when
  // visibility had three values. `restricted` then fell into the else branch and
  // was published to every @bu.edu account -- the exact audience it excludes.
  it("keeps a restricted survivor restricted", () => {
    expect(mergedVisibility("restricted", true)).toBe("restricted");
  });

  // `hidden` is excluded deliberately: publishing a hidden survivor IS the one
  // crossing the merge modal can ask for. Every other state must stay on its
  // own side of the line -- that is the invariant the old ternary broke.
  it("never moves an already-visible-or-restricted survivor across the BU line", () => {
    for (const v of VISIBILITIES.filter((x) => x !== "hidden")) {
      const out = mergedVisibility(v as Visibility, true);
      expect(BU_VISIBLE.includes(out)).toBe(BU_VISIBLE.includes(v as Visibility));
    }
  });

  it("preserves public and internal unchanged", () => {
    expect(mergedVisibility("public", true)).toBe("public");
    expect(mergedVisibility("internal", true)).toBe("internal");
  });

  it("publishes a hidden survivor only when the resolution says so", () => {
    expect(mergedVisibility("hidden", true)).toBe("internal");
    expect(mergedVisibility("hidden", false)).toBe("hidden");
  });

  it("unpublishing wins over every prior state", () => {
    for (const v of VISIBILITIES) expect(mergedVisibility(v as Visibility, false)).toBe("hidden");
  });

  // Guards the fix against the enum widening again: a new value must be handled
  // deliberately, not swept into internal by an else branch.
  it("returns a value from the vocabulary for every input", () => {
    for (const v of VISIBILITIES) {
      expect(VISIBILITIES).toContain(mergedVisibility(v as Visibility, true));
    }
  });
});
