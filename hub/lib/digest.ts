// Weekly digest: turns the escalation queue into a Slack message.
//
// Kept out of the route handler so the message shape is testable without a DB or an
// HTTP round trip — everything here is pure, and digest.test.ts covers the parts
// that actually decide behaviour (whether to send at all, and how deltas render).
//
// NO `import "server-only"` here, deliberately: it throws under vitest, which is the
// same constraint that split lib/authz.ts (pure, tested) from lib/actor.ts (session +
// DB, untested). Nothing in this file touches a request, so it costs nothing to keep
// it importable by the test runner.

/** One line of the standing-backlog table, with movement since the last digest. */
export interface BacklogLine {
  label: string;
  now: number;
  was: number | null;
}

export interface DigestInput {
  orgLabel: string;
  /** Counts of the things waiting on a person, keyed by ApprovalKind. */
  waiting: { screenshots: number; nudge: number; inbox: number; draft: number };
  /** Drafts that would publish right now — a subset of `waiting.draft`. */
  readyToPublish: number;
  /** Days the oldest waiting item has waited. */
  oldestDays: number;
  backlog: BacklogLine[];
}

/**
 * True when at least one thing is waiting on a person.
 *
 * The digest stays SILENT otherwise, which is the whole anti-noise mechanism: the
 * backlog half is near-static (today 100% of projects have no images and nothing has
 * been created in 30 days), so a digest that fires regardless would send a
 * near-identical message every week and be muted by week three. Silence needs no
 * extra storage to implement, unlike suppressing on "nothing changed".
 */
export function hasActionableWork(input: DigestInput): boolean {
  const w = input.waiting;
  return w.screenshots + w.nudge + w.inbox + w.draft > 0;
}

function delta(line: BacklogLine): string {
  if (line.was === null) return "";
  const d = line.now - line.was;
  if (d === 0) return "  —";
  // Down is good for a backlog, so the arrow tracks the count, not sentiment.
  return d < 0 ? `  ↓${Math.abs(d)}` : `  ↑${d}`;
}

/** Pads to a fixed width so the counts line up inside Slack's code block. */
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/**
 * Slack mrkdwn. Deliberately a code block for the backlog table: Slack has no
 * table primitive and proportional text makes columns of numbers unreadable.
 */
export function buildDigest(input: DigestInput): string {
  const { waiting: w } = input;
  const lines: string[] = [];

  lines.push(`*Spark! Showcase — ${input.orgLabel} · weekly digest*`);
  lines.push("");
  lines.push("*Waiting on a person*");

  // Only non-zero rows: a list of zeroes reads as "nothing to do" and pushes the
  // real items below the fold.
  if (w.screenshots) {
    lines.push(`• ${w.screenshots} screenshot set${w.screenshots === 1 ? "" : "s"} to approve`);
  }
  if (w.inbox) {
    lines.push(`• ${w.inbox} tracker row${w.inbox === 1 ? "" : "s"} to triage`);
  }
  if (w.nudge) {
    lines.push(`• ${w.nudge} upload link${w.nudge === 1 ? "" : "s"} with no response — worth a nudge`);
  }
  if (input.readyToPublish) {
    lines.push(`• ${input.readyToPublish} draft${input.readyToPublish === 1 ? "" : "s"} ready to publish now — nothing blocking`);
  }
  const blocked = w.draft - input.readyToPublish;
  if (blocked > 0) {
    lines.push(`• ${blocked} draft${blocked === 1 ? "" : "s"} blocked — needs a description or course & term`);
  }

  if (input.oldestDays >= 14) {
    lines.push("");
    lines.push(`:hourglass: Oldest item has been waiting *${input.oldestDays} days*.`);
  }

  const moved = input.backlog.filter((b) => b.was !== null && b.now !== b.was);
  // "unchanged since last week" would be a lie on the first ever run, where there is
  // no previous snapshot to be unchanged from.
  const firstRun = input.backlog.length > 0 && input.backlog.every((b) => b.was === null);
  if (input.backlog.length) {
    lines.push("");
    lines.push(
      firstRun
        ? "*Data gaps* (first digest — nothing to compare against yet)"
        : moved.length
        ? `*Data gaps* (${moved.length} moved since last week)`
        : "*Data gaps* (unchanged since last week)"
    );
    lines.push("```");
    for (const b of [...input.backlog].sort((a, b2) => b2.now - a.now)) {
      const was = b.was === null ? "" : `${pad(String(b.was), 4)}→ `;
      // trimEnd: padding the count leaves trailing spaces on every row without a
      // delta, which Slack renders as ragged whitespace inside the code block.
      lines.push(
        `${pad("no " + b.label.toLowerCase(), 18)}${was}${pad(String(b.now), 4)}${delta(b)}`.trimEnd()
      );
    }
    lines.push("```");
  }

  return lines.join("\n");
}
