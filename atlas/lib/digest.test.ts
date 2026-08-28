import { describe, it, expect } from "vitest";
import { buildDigest, hasActionableWork, type DigestInput } from "./digest";

const base: DigestInput = {
  orgLabel: "Spark!",
  waiting: { screenshots: 0, nudge: 0, inbox: 0, draft: 0 },
  readyToPublish: 0,
  oldestDays: 0,
  backlog: [],
};

const input = (over: Partial<DigestInput>): DigestInput => ({ ...base, ...over });

describe("hasActionableWork", () => {
  // The load-bearing behaviour of the whole feature. Real prod numbers today: zero
  // upload requests, zero pending inbox rows, nothing created in 30 days, and 100%
  // of projects missing images. If a non-empty backlog counted as actionable, the
  // digest would fire every week with a byte-identical message and get muted.
  it("does not fire on backlog alone", () => {
    expect(
      hasActionableWork(
        input({ backlog: [{ label: "Images", now: 170, was: 170 }] })
      )
    ).toBe(false);
  });

  it("fires on any single waiting item", () => {
    for (const k of ["screenshots", "nudge", "inbox", "draft"] as const) {
      expect(hasActionableWork(input({ waiting: { ...base.waiting, [k]: 1 } }))).toBe(true);
    }
  });

  it("does not fire when nothing at all is pending", () => {
    expect(hasActionableWork(base)).toBe(false);
  });
});

describe("buildDigest", () => {
  it("omits zero rows entirely rather than listing them", () => {
    const text = buildDigest(input({ waiting: { ...base.waiting, inbox: 2 } }));
    expect(text).toContain("2 tracker rows to triage");
    // A list of zeroes reads as "nothing to do" and pushes real items below the fold.
    expect(text).not.toContain("screenshot set");
    expect(text).not.toContain("upload link");
  });

  it("separates publishable drafts from blocked ones", () => {
    const text = buildDigest(
      input({ waiting: { ...base.waiting, draft: 30 }, readyToPublish: 23 })
    );
    expect(text).toContain("23 drafts ready to publish now");
    // 30 total - 23 ready = 7 blocked; the two need different work, so one combined
    // "30 drafts" line would hide the fact that 23 are one click from done.
    expect(text).toContain("7 drafts blocked");
  });

  it("never emits a negative blocked count when every draft is publishable", () => {
    const text = buildDigest(
      input({ waiting: { ...base.waiting, draft: 5 }, readyToPublish: 5 })
    );
    expect(text).toContain("5 drafts ready to publish now");
    expect(text).not.toMatch(/-\d+ drafts blocked/);
    expect(text).not.toContain("0 drafts blocked");
  });

  it("renders a downward delta as a decrease, not a sentiment", () => {
    const text = buildDigest(
      input({
        waiting: { ...base.waiting, inbox: 1 },
        backlog: [{ label: "GitHub repo", now: 24, was: 26 }],
      })
    );
    expect(text).toContain("↓2");
    expect(text).toContain("1 moved since last week");
  });

  it("marks an unchanged backlog as unchanged", () => {
    const text = buildDigest(
      input({
        waiting: { ...base.waiting, inbox: 1 },
        backlog: [{ label: "Images", now: 170, was: 170 }],
      })
    );
    expect(text).toContain("unchanged since last week");
    expect(text).toContain("—");
  });

  // First ever run has no snapshot to diff against. It must still render, without
  // implying a delta of zero — "170 → 170" on week one would be a lie, and so would
  // calling it "unchanged since last week" when there was no last week.
  it("omits the was-column on the first run and does not claim it is unchanged", () => {
    const text = buildDigest(
      input({
        waiting: { ...base.waiting, inbox: 1 },
        backlog: [{ label: "Images", now: 170, was: null }],
      })
    );
    expect(text).toContain("no images");
    expect(text).toContain("first digest");
    expect(text).not.toContain("unchanged since last week");
    expect(text).not.toContain("→");
    expect(text).not.toContain("↓");
    expect(text).not.toContain("↑");
  });

  it("leaves no trailing whitespace inside the code block", () => {
    const text = buildDigest(
      input({
        waiting: { ...base.waiting, inbox: 1 },
        backlog: [
          { label: "Images", now: 170, was: null },
          { label: "GitHub repo", now: 24, was: 26 },
        ],
      })
    );
    for (const line of text.split("\n")) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("calls out a stale oldest item only past a fortnight", () => {
    const stale = buildDigest(input({ waiting: { ...base.waiting, draft: 1 }, oldestDays: 60 }));
    expect(stale).toContain("60 days");
    const fresh = buildDigest(input({ waiting: { ...base.waiting, draft: 1 }, oldestDays: 3 }));
    expect(fresh).not.toContain("Oldest item");
  });
});
