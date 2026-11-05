import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const send = vi.fn();
vi.mock("resend", () => ({ Resend: class { batch = { send }; } }));

const { sendUploadInvites } = await import("./email");
const invite = (i: number) => ({ to: `pm${i}@bu.edu`, url: `https://x/${i}`, projectTitle: `P${i}`, expiresAt: "2026-12-01" });

describe("sendUploadInvites", () => {
  beforeEach(() => { send.mockReset(); process.env.RESEND_API_KEY = "k"; });

  it("uses one Resend call per 100 messages (Worker caps outbound fetches at 50)", async () => {
    send.mockResolvedValue({ data: { data: [] }, error: null });
    const r = await sendUploadInvites(Array.from({ length: 250 }, (_, i) => invite(i)));
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
    expect(r).toHaveLength(250);
    expect(r.every((x) => x.sent)).toBe(true);
  });

  it("a failed chunk fails only its own messages, with the reason", async () => {
    send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "bad address" } })
      .mockResolvedValueOnce({ data: { data: [] }, error: null });
    const r = await sendUploadInvites(Array.from({ length: 101 }, (_, i) => invite(i)));
    expect(r.slice(0, 100).every((x) => !x.sent && /bad address/.test(x.error ?? ""))).toBe(true);
    expect(r[100].sent).toBe(true);
  });

  it("sends nothing without a key", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendUploadInvites([invite(1)])).toEqual([{ sent: false }]);
    expect(send).not.toHaveBeenCalled();
  });
});
