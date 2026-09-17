import { describe, it, expect, vi } from "vitest";
import { connectOnceMore } from "./retry";

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
