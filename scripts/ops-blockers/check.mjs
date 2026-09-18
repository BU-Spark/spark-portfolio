#!/usr/bin/env node
// Unblock loop: probe the things we depend on other people to configure, and
// ask for them in Slack exactly once.
//
// WHY THIS EXISTS: progress on atlas repeatedly stalled on access nobody on the
// dev side has — a Cloudflare secret, a DNS record, a Resend key. Each stall
// cost a day of round-trips, and twice the round-trip itself was wrong: a
// variable reported as added had been deleted by the next deploy, and a key
// reported as working was revoked.
//
// So the loop never trusts a human's "done". Each blocker carries a PROBE that
// checks the live system, and only the probe can clear it. A Slack reply is a
// courtesy; the API is the truth.
//
// State lives in GitHub issues labelled `ops-blocker` — one open issue per
// unresolved blocker. That gives durable state across runs for free (an Actions
// cache expires; a committed state file pollutes history) and an audit trail of
// how long each ask sat unanswered.
//
//   node scripts/ops-blockers/check.mjs --dry-run    # probe only, print, post nothing
//   node scripts/ops-blockers/check.mjs --self-check # verify the logic, no network
//   node scripts/ops-blockers/check.mjs              # CI mode: reconcile + notify

const DRY = process.argv.includes("--dry-run");
const SELF_CHECK = process.argv.includes("--self-check");

// Slack member IDs, so an ask reaches whoever can act on it. A missing ID posts
// the ask unmentioned rather than failing — better a quiet notice than none.
const OWNERS = {
  cloudflare: process.env.SLACK_OWNER_CLOUDFLARE || "",
  dns: process.env.SLACK_OWNER_DNS || "",
  resend: process.env.SLACK_OWNER_RESEND || "",
};

const mention = (who) => (OWNERS[who] ? `<@${OWNERS[who]}> ` : "");

const ATLAS = process.env.ATLAS_BASE_URL || "https://atlas.buspark.io";

async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Sample an endpoint until it passes, or give up.
 *
 * One sample is not a signal. atlas returned a single 500 during development of
 * this script and 0 in the following 40 requests — a one-shot probe would have
 * opened an issue and pinged someone about a deployment that was fine, which is
 * the fastest way to make the whole loop ignorable.
 *
 * Only a failure that survives every attempt counts as blocked. Passing once is
 * enough to be green: a service that answers correctly is not broken because it
 * also hiccuped.
 */
async function sampleUntilOk(check, attempts = 4, delayMs = 3000) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, delayMs));
    try {
      last = await check();
      if (last.ok) return { ok: true, attempts: i + 1 };
    } catch (e) {
      last = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ...last, attempts };
}

// ── Probes ────────────────────────────────────────────────────────────────
// A probe returns { ok } when the dependency is satisfied, or { ok: false,
// detail } naming what the system actually said. `skipped` means the probe
// could not run (a missing secret), which is NOT the same as blocked — an
// unrunnable probe must never open an issue asking someone to fix something we
// failed to check.

const PROBES = [
  {
    id: "atlas-storage",
    title: "atlas object storage is not answering cleanly",
    owner: "cloudflare",
    // A key that cannot exist. 404 proves storage is reachable AND reporting
    // misses properly; 503 means the R2 binding/vars are missing; 5xx means the
    // worker is crashing. Deliberately not a real key: a real one can be
    // deleted, and then the probe fails for a reason that is not the blocker.
    async run() {
      const out = await sampleUntilOk(async () => {
        const res = await fetchWithTimeout(
          `${ATLAS}/api/img/projects/__ops_probe_does_not_exist.png`
        );
        if (res.status === 404) return { ok: true };
        return {
          ok: false,
          detail: `GET /api/img/<nonexistent> returned ${res.status}, expected 404. `
            + (res.status === 503
              ? "503 means object storage is not configured — the R2 binding or R2_* values are missing on the Worker."
              : "A 5xx here means the Worker is throwing rather than reporting a missing object."),
        };
      });
      if (out.ok) return { ok: true };
      return {
        ...out,
        detail: `${out.detail} (failed all ${out.attempts} attempts)`,
        ask: "the R2 binding in atlas/wrangler.jsonc still resolves, and the Worker is deployed",
      };
    },
  },
  {
    id: "atlas-up",
    title: "atlas.buspark.io is not serving",
    owner: "cloudflare",
    async run() {
      const out = await sampleUntilOk(async () => {
        const res = await fetchWithTimeout(`${ATLAS}/`);
        return res.ok ? { ok: true } : { ok: false, detail: `GET / returned ${res.status}` };
      });
      if (out.ok) return { ok: true };
      return {
        ...out,
        detail: `${out.detail} on all ${out.attempts} attempts — this is sustained, not a hiccup.`,
        ask: "the latest deploy succeeded",
      };
    },
  },
  {
    id: "resend-key",
    title: "the Resend API key is invalid",
    owner: "resend",
    async run() {
      const key = process.env.RESEND_API_KEY;
      if (!key) return { skipped: "RESEND_API_KEY is not set for this run" };
      const res = await fetchWithTimeout("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) return { ok: true };
      return {
        ok: false,
        detail: `Resend returned ${res.status} for GET /domains — the key is revoked, rotated, or from another account.`,
        ask: "a new Resend API key, set as the RESEND_API_KEY secret on the spark-portfolio Worker AND as a repo secret",
      };
    },
  },
  {
    id: "resend-domain",
    title: "buspark.io is not verified in Resend",
    owner: "dns",
    // Distinct from the key being valid: a good key still cannot send from an
    // unverified domain, and emailConfigured() in lib/email.ts cannot tell the
    // difference — it only checks the key exists. So every PM invite would fail
    // while the UI reported email as available.
    async run() {
      const key = process.env.RESEND_API_KEY;
      if (!key) return { skipped: "RESEND_API_KEY is not set for this run" };
      const res = await fetchWithTimeout("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return { skipped: `cannot check: Resend returned ${res.status}` };
      const body = await res.json();
      const domain = (body.data || []).find((d) => d.name === "buspark.io");
      if (!domain) {
        return {
          ok: false,
          detail: "buspark.io is not registered in this Resend account at all.",
          ask: "buspark.io added as a domain in Resend",
        };
      }
      if (domain.status === "verified") return { ok: true };
      return {
        ok: false,
        detail: `buspark.io status is "${domain.status}". EMAIL_FROM is no-reply@buspark.io, so every invite is rejected until this verifies.`,
        ask: "the three DNS records from Resend added to buspark.io (DKIM TXT on resend._domainkey, MX on send priority 10, SPF TXT on send), then Verify clicked",
      };
    },
  },
];

// ── Notification ──────────────────────────────────────────────────────────

function slackMessage(probe, result) {
  return [
    `${mention(probe.owner)}*Blocked:* ${probe.title}`,
    "",
    `> ${result.detail}`,
    "",
    result.ask ? `*Needed:* ${result.ask}` : null,
    "",
    "_This was detected automatically and will clear itself once the live check passes — no need to reply, just the change._",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

async function postSlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  // Fail closed and loudly. A notifier that silently does nothing when
  // misconfigured is worse than none: the loop looks healthy while every ask is
  // discarded.
  if (!url) throw new Error("SLACK_WEBHOOK_URL is not set — refusing to run without a notification path");
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
}

// ── GitHub issues as state ────────────────────────────────────────────────

const REPO = process.env.GITHUB_REPOSITORY || "BU-Spark/spark-portfolio";
const LABEL = "ops-blocker";

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const res = await fetchWithTimeout(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${opts.method || "GET"} ${path} → ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// The probe id is carried in the issue BODY as a marker rather than parsed out
// of the title, so retitling an issue by hand cannot orphan its state.
const marker = (id) => `<!-- ops-blocker:${id} -->`;

export function findIssueFor(id, issues) {
  return issues.find((i) => (i.body || "").includes(marker(id)));
}

export function decide(result, hasOpenIssue) {
  if (result.skipped) return "skip";
  if (result.ok) return hasOpenIssue ? "resolve" : "none";
  return hasOpenIssue ? "still-blocked" : "open";
}

// ── Self-check ────────────────────────────────────────────────────────────

async function selfCheck() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`self-check failed: ${msg}`);
  };

  assert(decide({ ok: true }, false) === "none", "green with no issue does nothing");
  assert(decide({ ok: true }, true) === "resolve", "green with an open issue closes it");
  assert(decide({ ok: false }, false) === "open", "red with no issue opens one");
  assert(decide({ ok: false }, true) === "still-blocked", "red with an open issue stays quiet");
  // The one that matters: an unrunnable probe must never open an issue, or a
  // missing secret in CI would page someone about a system that is fine.
  assert(decide({ skipped: "no key" }, false) === "skip", "skipped never opens");
  assert(decide({ skipped: "no key" }, true) === "skip", "skipped never resolves");

  const issues = [{ body: `text ${marker("resend-key")} more` }, { body: "unrelated" }];
  assert(findIssueFor("resend-key", issues) === issues[0], "marker match");
  assert(findIssueFor("atlas-up", issues) === undefined, "no false match");

  assert(mention("nobody") === "", "unknown owner yields no mention");

  // Sampling: a service that hiccups once is not blocked, and one that never
  // answers is. Zero delay so the self-check stays instant.
  let calls = 0;
  const flaky = async () => ({ ok: ++calls >= 2, detail: "500" });
  const recovered = await sampleUntilOk(flaky, 4, 0);
  assert(recovered.ok === true, "a probe that passes on retry is green");
  assert(calls === 2, "sampling stops at the first success");

  calls = 0;
  const dead = async () => ({ ok: false, detail: "500" });
  const stillDead = await sampleUntilOk(dead, 4, 0);
  assert(stillDead.ok === false && stillDead.attempts === 4, "a sustained failure is blocked after every attempt");

  calls = 0;
  const throws = async () => {
    calls++;
    throw new Error("ENOTFOUND");
  };
  const threw = await sampleUntilOk(throws, 3, 0);
  assert(threw.ok === false && calls === 3, "a throwing probe is retried, not fatal");
  assert(String(threw.detail).includes("ENOTFOUND"), "the thrown reason survives");

  const msg = slackMessage(
    { title: "t", owner: "dns" },
    { detail: "d", ask: "a" }
  );
  assert(msg.includes("*Blocked:* t") && msg.includes("*Needed:* a"), "message shape");

  console.log("self-check passed");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (SELF_CHECK) return await selfCheck();

  const results = [];
  for (const probe of PROBES) {
    let result;
    try {
      result = await probe.run();
    } catch (e) {
      // A probe that throws is a probe that could not run — treated as skipped,
      // never as a blocker. A DNS blip must not page anyone.
      result = { skipped: `probe threw: ${e instanceof Error ? e.message : String(e)}` };
    }
    results.push({ probe, result });
    const state = result.skipped ? `SKIP (${result.skipped})` : result.ok ? "OK" : "BLOCKED";
    console.log(`${state.padEnd(10)} ${probe.id}${result.detail ? ` — ${result.detail}` : ""}`);
  }

  if (DRY) {
    const blocked = results.filter((r) => !r.result.ok && !r.result.skipped);
    if (blocked.length) {
      console.log("\n--- would post to Slack ---");
      for (const { probe, result } of blocked) console.log(slackMessage(probe, result) + "\n");
    } else {
      console.log("\nnothing to post");
    }
    return;
  }

  const open = await gh(`/repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=100`);

  for (const { probe, result } of results) {
    const existing = findIssueFor(probe.id, open);
    switch (decide(result, !!existing)) {
      case "open": {
        const issue = await gh(`/repos/${REPO}/issues`, {
          method: "POST",
          body: JSON.stringify({
            title: `[blocked] ${probe.title}`,
            labels: [LABEL],
            body: `${marker(probe.id)}\n\n**What the probe saw:** ${result.detail}\n\n**Needed:** ${result.ask}\n\nDetected automatically by \`scripts/ops-blockers/check.mjs\`. This issue closes itself when the live check passes — it is not cleared by anyone saying it is done.`,
          }),
        });
        await postSlack(`${slackMessage(probe, result)}\n\n${issue.html_url}`);
        console.log(`  → opened ${issue.html_url} and posted to Slack`);
        break;
      }
      case "resolve": {
        await gh(`/repos/${REPO}/issues/${existing.number}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "closed" }),
        });
        await postSlack(
          `*Unblocked:* ${probe.title.replace(/^the /, "")} — the live check now passes. Thanks ${mention(probe.owner).trim() || "all"}.\n${existing.html_url}`
        );
        console.log(`  → closed #${existing.number} and posted to Slack`);
        break;
      }
      case "still-blocked":
        console.log(`  → still blocked, issue #${existing.number} already open (not re-posting)`);
        break;
      default:
        break;
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
