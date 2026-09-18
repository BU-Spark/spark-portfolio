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
// A one-off message sent through the real notification path, to prove the
// webhook and the channel wiring work. Deliberately posts and exits without
// probing or touching issues: a plumbing test must not be able to open, close,
// or comment on a blocker.
const TEST_MESSAGE = process.env.TEST_MESSAGE || "";

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

// Gap between the two confirmation windows. Long enough that a deploy rollout,
// a cold isolate or a transient upstream blip resolves inside it; short enough
// that a real outage is still reported within a couple of minutes.
const CONFIRM_GAP_MS = Number(process.env.CONFIRM_GAP_MS ?? 45000);

/**
 * Confirm a failure across two SEPARATED windows before believing it.
 *
 * `sampleUntilOk` retries back-to-back, which catches a single bad response but
 * not a short-lived condition affecting every request in one three-second span
 * — a deploy swapping isolates, for instance. So a failure has to survive a
 * burst, a pause, and a second burst: eight samples across ~a minute.
 *
 * Passing ONCE anywhere is enough to be green. The asymmetry is deliberate: a
 * false alarm trains people to ignore the channel, while a missed blocker is
 * caught by the next scheduled run 3 hours later.
 */
async function confirmFailure(check, gapMs = CONFIRM_GAP_MS) {
  const first = await sampleUntilOk(check);
  if (first.ok) return first;

  await new Promise((r) => setTimeout(r, gapMs));
  const second = await sampleUntilOk(check);
  if (second.ok) {
    console.log(`  (first window failed, second passed — treating as transient, not reporting)`);
    return second;
  }

  return {
    ...second,
    attempts: first.attempts + second.attempts,
    confirmed: true,
  };
}

// ── Probes ────────────────────────────────────────────────────────────────
// A probe returns { ok } when the dependency is satisfied, or { ok: false,
// detail } naming what the system actually said. `skipped` means the probe
// could not run (a missing secret), which is NOT the same as blocked — an
// unrunnable probe must never open an issue asking someone to fix something we
// failed to check.

const PROBES = [
  {
    id: "atlas-up",
    title: "atlas.buspark.io is not serving",
    owner: "cloudflare",
    async run() {
      const out = await confirmFailure(async () => {
        const res = await fetchWithTimeout(`${ATLAS}/`);
        return res.ok ? { ok: true } : { ok: false, status: res.status };
      });
      if (out.ok) return { ok: true };
      return {
        ok: false,
        status: out.status,
        detail: `GET ${ATLAS}/ returned ${out.status} on all ${out.attempts} samples across two windows ~${Math.round(CONFIRM_GAP_MS / 1000)}s apart.`,
        slack: `atlas.buspark.io returning ${out.status} for over a minute. Needs: check the latest Cloudflare Workers deploy.`,
        ask: "the latest deploy to succeed — the site is down, not slow",
      };
    },
  },
  {
    id: "atlas-storage",
    title: "atlas object storage is not answering cleanly",
    owner: "cloudflare",
    // Suppressed when the site itself is down: storage failing is then a
    // SYMPTOM, and reporting both would ping twice for one cause and point at
    // the wrong fix.
    dependsOn: "atlas-up",
    // Probes a key that CANNOT exist. 404 proves storage is reachable and
    // reports misses properly; 503 means the binding or R2_* values are gone;
    // any 5xx means the Worker is throwing instead of answering. Deliberately
    // not a real key — a real one can be deleted, and then the probe fails for
    // a reason that is not the blocker.
    async run() {
      const out = await confirmFailure(async () => {
        const res = await fetchWithTimeout(
          `${ATLAS}/api/img/projects/__ops_probe_does_not_exist.png`
        );
        return res.status === 404 ? { ok: true } : { ok: false, status: res.status };
      });
      if (out.ok) return { ok: true };
      // Scope the ask to what the status code actually proves, rather than
      // asking someone to go look at "storage".
      const configMissing = out.status === 503;
      return {
        ok: false,
        status: out.status,
        detail: `GET /api/img/<nonexistent key> returned ${out.status}, expected 404, on all ${out.attempts} samples across two windows. `
          + (configMissing
            ? "503 is the route's own S3ConfigError handler: object storage is unconfigured — the r2_buckets binding is absent and the R2_* fallback values are missing too."
            : "A 5xx means the Worker is throwing rather than reporting a missing object."),
        slack: configMissing
          ? "atlas image storage unconfigured (503). Needs: R2 binding restored on the spark-portfolio Worker, or the R2_* secrets re-added."
          : `atlas image route returning ${out.status}, expected 404. Needs: a look at the Worker logs — it is throwing, not answering.`,
        ask: configMissing
          ? "the r2_buckets binding present on the deployed Worker (it lives in atlas/wrangler.jsonc — a deploy replaces bindings, and keep_vars does not protect them)"
          : "the Worker error logs for the /api/img route",
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
      const out = await confirmFailure(async () => {
        const res = await fetchWithTimeout("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${key}` },
        });
        // 5xx is Resend having a bad day, not our key being wrong. Only an auth
        // failure is a blocker; anything else is retried and then skipped.
        if (res.ok) return { ok: true };
        return { ok: false, status: res.status, authFailure: res.status === 401 || res.status === 403 };
      });
      if (out.ok) return { ok: true };
      if (!out.authFailure) {
        return { skipped: `Resend returned ${out.status}, which is their side, not our key` };
      }
      return {
        ok: false,
        status: out.status,
        detail: `Resend returned ${out.status} for GET /domains on all ${out.attempts} samples — the key is revoked, rotated, or from another account.`,
        slack: "Resend API key rejected (401). Needs: a new key, set as RESEND_API_KEY on the spark-portfolio Worker and as a repo secret.",
        ask: "a new Resend API key in both places",
      };
    },
  },
  {
    id: "resend-domain",
    title: "buspark.io is not verified in Resend",
    owner: "dns",
    // Pointless to check if the key itself is rejected — the probe would report
    // a DNS problem caused by an auth problem.
    dependsOn: "resend-key",
    // Distinct from the key being valid: a good key still cannot send from an
    // unverified domain, and emailConfigured() in lib/email.ts only checks the
    // key EXISTS — so the UI reports email as available while every invite is
    // rejected.
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
          detail: "buspark.io is not registered as a domain in this Resend account at all.",
          slack: "buspark.io missing from Resend. Needs: the domain added in Resend, then its DNS records published.",
          ask: "buspark.io added as a domain in Resend",
        };
      }
      if (domain.status === "verified") return { ok: true };
      // Name the records rather than saying "verify the domain" — the ask is
      // then actionable without opening Resend first.
      const pending = (domain.records || [])
        .filter((r) => r.status !== "verified")
        .map((r) => `${r.type} ${r.name}`);
      return {
        ok: false,
        detail: `buspark.io status is "${domain.status}". EMAIL_FROM is no-reply@buspark.io, so every invite is rejected until it verifies. Records not yet verified: ${pending.join(", ") || "unknown"}.`,
        slack: `buspark.io unverified in Resend (${domain.status}). Needs: DNS records ${pending.slice(0, 3).join(", ") || "from Resend"} published on buspark.io.`,
        ask: "the Resend DNS records published on buspark.io, then Verify clicked",
      };
    },
  },
];

// ── Notification ──────────────────────────────────────────────────────────

// Slack gets the short version; the GitHub issue carries the full detail. The
// cap is a real constraint, not a style preference: an ask that fits in a
// notification preview gets acted on, and a paragraph gets scrolled past.
const WORD_LIMIT = 50;

export function terse(text) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  // Runtime safety net, not the primary mechanism: each probe authors its own
  // short line and the self-check asserts every one fits. This catches a status
  // code or provider string making a line longer than expected at runtime.
  return words.length <= WORD_LIMIT ? words.join(" ") : words.slice(0, WORD_LIMIT).join(" ") + "…";
}

export function wordCount(text) {
  return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
}

function slackMessage(probe, result, url) {
  // The mention and the link sit outside the word budget: one is a user ID and
  // the other is where the detail lives.
  return `${mention(probe.owner)}${terse(result.slack)}${url ? `\n${url}` : ""}`;
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

  // ── The word cap is a contract, so it is tested, not trusted ──
  assert(wordCount("one two three") === 3, "word count");
  assert(terse("a b c") === "a b c", "short text passes through");
  // Derived from the constant, not hardcoded: a fixture pinned to the old cap
  // silently stops testing the trim the moment WORD_LIMIT changes.
  const long = Array.from({ length: WORD_LIMIT + 10 }, (_, i) => `w${i}`).join(" ");
  assert(wordCount(terse(long)) === WORD_LIMIT, "overlong text is trimmed to the cap");
  assert(terse(long).endsWith("…"), "a trim is visible rather than silent");
  assert(terse("  spaced   out  ") === "spaced out", "whitespace collapses");

  // Every authored Slack line must fit, including the longest status code that
  // can be substituted into it. Checked here so a drafting mistake fails the
  // build instead of posting a paragraph into the channel.
  const SAMPLES = [
    "atlas.buspark.io returning 500 for over a minute. Needs: check the latest Cloudflare Workers deploy.",
    "atlas image storage unconfigured (503). Needs: R2 binding restored on the spark-portfolio Worker, or the R2_* secrets re-added.",
    "atlas image route returning 500, expected 404. Needs: a look at the Worker logs — it is throwing, not answering.",
    "Resend API key rejected (401). Needs: a new key, set as RESEND_API_KEY on the spark-portfolio Worker and as a repo secret.",
    "buspark.io missing from Resend. Needs: the domain added in Resend, then its DNS records published.",
    "buspark.io unverified in Resend (pending). Needs: DNS records TXT resend._domainkey, MX send, TXT send published on buspark.io.",
  ];
  for (const s of SAMPLES) {
    assert(wordCount(s) <= WORD_LIMIT, `slack line over ${WORD_LIMIT} words (${wordCount(s)}): ${s}`);
  }

  const msg = slackMessage({ title: "t", owner: "dns" }, { slack: "short line" }, "http://x");
  assert(msg.includes("short line") && msg.includes("http://x"), "message shape");

  // Suppression: a dependent probe must not be reported when its dependency is
  // already blocked, or one cause produces two pings aimed at the wrong fix.
  const ordered = PROBES.map((x) => x.id);
  for (const probe of PROBES) {
    if (!probe.dependsOn) continue;
    assert(ordered.includes(probe.dependsOn), `${probe.id} depends on unknown ${probe.dependsOn}`);
    assert(
      ordered.indexOf(probe.dependsOn) < ordered.indexOf(probe.id),
      `${probe.dependsOn} must run before ${probe.id}, or suppression cannot see it`
    );
  }

  // A transient failure that clears in the second window is NOT reported.
  let n = 0;
  const transient = async () => ({ ok: ++n > 4 });
  const cleared = await confirmFailure(transient, 0);
  assert(cleared.ok === true, "a failure that clears in the second window is green");

  console.log("self-check passed");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (SELF_CHECK) return await selfCheck();

  if (TEST_MESSAGE) {
    if (DRY) {
      console.log("--- would post to Slack ---");
      console.log(TEST_MESSAGE);
      return;
    }
    await postSlack(TEST_MESSAGE);
    console.log("posted test message to Slack");
    return;
  }

  const results = [];
  const blockedIds = new Set();
  // PROBES is ordered so a dependency runs before anything depending on it.
  for (const probe of PROBES) {
    let result;
    if (probe.dependsOn && blockedIds.has(probe.dependsOn)) {
      // Do not even run it: a dependent probe failing while its dependency is
      // down tells us nothing, and reporting both would ping twice for one
      // cause and point at the wrong fix.
      result = { skipped: `suppressed — ${probe.dependsOn} is blocked, so this would be a symptom` };
    } else {
      try {
        result = await probe.run();
      } catch (e) {
        // A probe that throws is a probe that could not run — treated as
        // skipped, never as a blocker. A DNS blip must not page anyone.
        result = { skipped: `probe threw: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    if (!result.ok && !result.skipped) blockedIds.add(probe.id);
    results.push({ probe, result });
    const state = result.skipped ? `SKIP (${result.skipped})` : result.ok ? "OK" : "BLOCKED";
    console.log(`${state.padEnd(10)} ${probe.id}${result.detail ? ` — ${result.detail}` : ""}`);
  }

  if (DRY) {
    const blocked = results.filter((r) => !r.result.ok && !r.result.skipped);
    if (blocked.length) {
      console.log("\n--- would post to Slack ---");
      for (const { probe, result } of blocked) {
        const msg = slackMessage(probe, result);
        console.log(`${msg}\n   [${wordCount(result.slack)} words]\n`);
      }
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
            body: `${marker(probe.id)}\n\n**What the probe saw:** ${result.detail}\n\n**Needed:** ${result.ask}\n\n**Confirmation:** ${result.confirmed ? `failed every sample across two windows ~${Math.round(CONFIRM_GAP_MS / 1000)}s apart` : "single-window failure"}. No language model is involved — the text above is a fixed string plus the literal status the service returned.\n\nDetected automatically by \`scripts/ops-blockers/check.mjs\`. This issue closes itself when the live check passes; it is not cleared by anyone saying it is done.`,
          }),
        });
        await postSlack(slackMessage(probe, result, issue.html_url));
        console.log(`  → opened ${issue.html_url} and posted to Slack`);
        break;
      }
      case "resolve": {
        await gh(`/repos/${REPO}/issues/${existing.number}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "closed" }),
        });
        // Link the (now closed) issue here too, so the resolution is traceable
        // back to what was actually wrong rather than just announcing itself.
        await postSlack(
          `${terse(`Resolved: ${probe.title.replace(/^the /, "")} — the live check now passes. Thanks!`)}\n${existing.html_url}`
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
