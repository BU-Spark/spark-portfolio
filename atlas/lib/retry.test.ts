import { describe, it, expect, vi } from "vitest";
import { connectOnceMore, isReadOnly } from "./retry";

describe("connectOnceMore", () => {
  it("returns the first result without retrying", async () => {
    const connect = vi.fn().mockResolvedValue("client");
    const onRetry = vi.fn();
    expect(await connectOnceMore(connect, onRetry, 0)).toBe("client");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("retries once when the first connect fails, and reports why", async () => {
    const boom = new Error("ECONNRESET");
    const connect = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue("client");
    const onRetry = vi.fn();
    expect(await connectOnceMore(connect, onRetry, 0)).toBe("client");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(boom);
  });

  it("gives up after the second failure rather than looping", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("down"));
    await expect(connectOnceMore(connect, undefined, 0)).rejects.toThrow("down");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("surfaces the SECOND error, which is the one that actually stopped us", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValue(new Error("second"));
    await expect(connectOnceMore(connect, undefined, 0)).rejects.toThrow("second");
  });
});

describe("isReadOnly", () => {
  it("accepts plain reads", () => {
    expect(isReadOnly("SELECT * FROM projects")).toBe(true);
    expect(isReadOnly("  select 1  ")).toBe(true);
    expect(isReadOnly("WITH t AS (SELECT 1) SELECT * FROM t")).toBe(true);
  });

  it("rejects every write", () => {
    expect(isReadOnly("INSERT INTO projects VALUES (1)")).toBe(false);
    expect(isReadOnly("UPDATE projects SET title = 'x'")).toBe(false);
    expect(isReadOnly("DELETE FROM projects")).toBe(false);
    expect(isReadOnly("TRUNCATE projects")).toBe(false);
  });

  it("rejects a writing CTE, which reads as a SELECT but is not one", () => {
    expect(
      isReadOnly("WITH moved AS (DELETE FROM a RETURNING *) SELECT * FROM moved")
    ).toBe(false);
    expect(
      isReadOnly("WITH n AS (INSERT INTO a VALUES (1) RETURNING id) SELECT * FROM n")
    ).toBe(false);
  });

  it("is not fooled by a leading comment", () => {
    expect(isReadOnly("-- fetch the roster\nSELECT * FROM people")).toBe(true);
    expect(isReadOnly("/* cleanup */ DELETE FROM people")).toBe(false);
  });
});
