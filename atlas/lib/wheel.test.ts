import { describe, it, expect } from "vitest";
import { step, prevIndex } from "./wheel";

describe("step", () => {
  it("divides the circle evenly", () => {
    expect(step(6)).toBe(60);
    expect(step(5)).toBe(72);
    expect(step(1)).toBe(360);
  });
  it("returns 0 rather than Infinity for an empty wheel", () => {
    // Guards against NaN coordinates, which render as an invisible-but-present SVG.
    expect(step(0)).toBe(0);
  });
});

describe("prevIndex", () => {
  // The actual regression: five segments (a non-super admin) used to index [5].
  it("stays in range for every index at every realistic size", () => {
    for (const n of [1, 2, 5, 6, 7, 12]) {
      for (let i = 0; i < n; i++) {
        const p = prevIndex(i, n);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(n);
      }
    }
  });
  it("wraps at zero instead of going negative", () => {
    // (0 - 1) % 5 is -1 in JS; segments[-1] is undefined.
    expect(prevIndex(0, 5)).toBe(4);
    expect(prevIndex(0, 6)).toBe(5);
  });
  it("is the immediate predecessor elsewhere", () => {
    expect(prevIndex(3, 5)).toBe(2);
    expect(prevIndex(5, 6)).toBe(4);
  });
  it("survives an empty wheel", () => {
    expect(prevIndex(0, 0)).toBe(0);
  });
});
