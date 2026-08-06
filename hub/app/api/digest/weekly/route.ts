// Weekly approvals digest → Slack.
//
// Auth: a shared secret (DIGEST_TOKEN) as `Authorization: Bearer …`, matching
// /api/import. No session is involved because the caller is a scheduler, not a
// person.
//
// WHY AN HTTP ROUTE AND NOT A CLOUDFLARE CRON TRIGGER: a Worker cron needs the
// deployed script to export a `scheduled` handler, and @opennextjs/cloudflare
// generates a fetch-only worker — wiring one up means a custom entrypoint and new
// wrangler config on a prod deployment that is currently still 500ing for an
// unrelated missing Hyperdrive binding. A token-guarded route reuses a pattern
// already in this codebase, is callable by any scheduler (GitHub Actions here — see
// .github/workflows/weekly-digest.yml), and can be tested with one curl.
import { timingSafeEqual } from "node:crypto";
import { ORGS } from "@/lib/authz";
import {
  listOpenApprovals,
  backlogCounts,
  lastDigestCounts,
  saveDigestCounts,
} from "@/lib/db";
import { buildDigest, hasActionableWork, type BacklogLine } from "@/lib/digest";

// Constant-time bearer check (avoids leaking the secret via timing). Same helper as
// /api/import; duplicated rather than shared because it's three lines and extracting
// it would put a crypto import in the module graph of every route that imports it.
function bearerMatches(header: string | null, token: string): boolean {
  const a = Buffer.from(header || "");
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LABELS: Record<string, string> = { spark: "Spark!", cds: "CDS" };

async function run(req: Request): Promise<Response> {
  const token = process.env.DIGEST_TOKEN;
  if (!token) {
    return Response.json(
      { error: "Digest is not configured (DIGEST_TOKEN unset)." },
      { status: 503 }
    );
  }
  if (!bearerMatches(req.headers.get("authorization"), token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Which team's queue this digest reports on. Configuration, not request data —
  // same reasoning as IMPORT_ORG: a scheduler holding a shared secret must not be
  // able to nominate its own scope. Validated rather than defaulted through, so a
  // typo fails loudly instead of silently reporting an empty queue forever.
  const org = (process.env.DIGEST_ORG ?? "spark").trim();
  if (!ORGS.includes(org as never)) {
    return Response.json(
      { error: `DIGEST_ORG is "${org}", which is not a known team.` },
      { status: 503 }
    );
  }

  // isSuper: false — the digest reports exactly one team's queue, so it uses the
  // same org predicate a scoped admin would. A super-scoped digest would mix both
  // teams' work into one channel.
  const scope = { org, isSuper: false };
  const [items, counts, previous] = await Promise.all([
    listOpenApprovals(scope),
    backlogCounts(scope),
    lastDigestCounts(org),
  ]);

  const waiting = {
    screenshots: items.filter((i) => i.kind === "screenshots").length,
    nudge: items.filter((i) => i.kind === "nudge").length,
    inbox: items.filter((i) => i.kind === "inbox").length,
    draft: items.filter((i) => i.kind === "draft").length,
  };
  const readyToPublish = items.filter(
    (i) => i.kind === "draft" && i.detail.startsWith("Ready")
  ).length;
  const oldestDays = items.length
    ? Math.floor((Date.now() - new Date(items[0].waitingSince).getTime()) / 86_400_000)
    : 0;
  const backlog: BacklogLine[] = Object.entries(counts).map(([label, now]) => ({
    label,
    now,
    was: previous?.[label] ?? null,
  }));

  const input = { orgLabel: LABELS[org] ?? org, waiting, readyToPublish, oldestDays, backlog };
  const text = buildDigest(input);
  const actionable = hasActionableWork(input);

  // ?dry=1 renders the message without posting or recording a snapshot, so the
  // output can be checked before wiring up a schedule.
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  if (dry) return Response.json({ dry: true, wouldSend: actionable, text, waiting, backlog });

  if (!actionable) {
    // Snapshot anyway: skipping it would make next week's deltas measure two weeks
    // of movement while claiming to cover one.
    await saveDigestCounts(org, counts);
    return Response.json({ sent: false, reason: "nothing waiting on anyone", backlog });
  }

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    return Response.json(
      { error: "SLACK_WEBHOOK_URL unset — nothing to post to.", text },
      { status: 503 }
    );
  }

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mrkdwn: true }),
  }).catch(() => null);

  if (!res || !res.ok) {
    // Do NOT snapshot on a failed post: recording it would make the next run diff
    // against counts nobody ever saw, silently swallowing a week of movement.
    return Response.json(
      { error: `Slack rejected the digest (${res ? res.status : "network error"}).`, text },
      { status: 502 }
    );
  }

  await saveDigestCounts(org, counts);
  return Response.json({ sent: true, items: items.length, text });
}

// POST is the real entry point; GET exists so `?dry=1` is easy to hit from a browser
// or curl without remembering a method flag.
export const POST = run;
export const GET = run;
