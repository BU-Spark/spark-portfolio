// Guards the open-redirect check on /login. The absolute-url case is a regression
// test: Auth.js's middleware redirect writes a full origin, and a relative-only
// check sent every bounced admin to "/" instead of back to /admin.
import { describe, it, expect } from "vitest";
import { safeCallback } from "./callback";

const ORIGIN = "https://atlas.buspark.io";

describe("safeCallback", () => {
  it("keeps relative paths", () => {
    expect(safeCallback("/admin", ORIGIN)).toBe("/admin");
    expect(safeCallback("/admin/projects?tab=all", ORIGIN)).toBe("/admin/projects?tab=all");
  });
  it("reduces same-origin absolute urls to path + query", () => {
    expect(safeCallback(`${ORIGIN}/admin`, ORIGIN)).toBe("/admin");
    expect(safeCallback(`${ORIGIN}/admin/projects?tab=all`, ORIGIN)).toBe("/admin/projects?tab=all");
  });
  it("refuses cross-origin", () => {
    expect(safeCallback("https://evil.example/admin", ORIGIN)).toBe("/");
    expect(safeCallback("http://atlas.buspark.io.evil.example/x", ORIGIN)).toBe("/");
  });
  it("refuses protocol-relative", () => {
    expect(safeCallback("//evil.example/admin", ORIGIN)).toBe("/");
  });
  it("refuses junk and empty", () => {
    expect(safeCallback(null, ORIGIN)).toBe("/");
    expect(safeCallback("", ORIGIN)).toBe("/");
    expect(safeCallback("javascript:alert(1)", ORIGIN)).toBe("/");
  });
});
