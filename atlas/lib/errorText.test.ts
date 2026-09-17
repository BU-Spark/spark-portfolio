import { describe, it, expect } from "vitest";
import { errorText } from "./errorText";

// The bug: `String(error)` on Resend's error object produced the literal text
// "[object Object]", which is what the admin uploads page showed as the reason a
// PM invite failed — destroying the only clue (unverified domain, bad address,
// rate limit) at the exact moment someone needed it.
describe("errorText", () => {
  it("never returns [object Object] for an object", () => {
    for (const input of [
      { name: "validation_error", message: "The domain is not verified", statusCode: 403 },
      { message: "rate limited" },
      { name: "unknown" },
      {},
      { nested: { deep: true } },
    ]) {
      expect(errorText(input)).not.toContain("[object Object]");
      expect(errorText(input).length).toBeGreaterThan(0);
    }
  });

  it("surfaces the provider's own wording, with the status code", () => {
    expect(errorText({ name: "validation_error", message: "The domain is not verified", statusCode: 403 }))
      .toBe("validation_error: The domain is not verified (403)");
  });

  it("passes a string through and unwraps an Error", () => {
    expect(errorText("plain")).toBe("plain");
    expect(errorText(new Error("boom"))).toBe("boom");
  });

  it("falls back to JSON rather than to nothing", () => {
    expect(errorText({ weird: 1 })).toBe('{"weird":1}');
  });

  it("does not throw on anything, including circular objects", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => errorText(circular)).not.toThrow();
    expect(errorText(circular)).toBe("send failed");
    expect(errorText(null)).toBe("send failed");
    expect(errorText(undefined)).toBe("send failed");
  });
});
