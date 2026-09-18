# The unblock loop

Progress on atlas repeatedly stalled on access nobody on the dev side has: a
Cloudflare secret, a DNS record, a Resend key. Each stall cost a round-trip to
someone with the permissions, and **twice the round-trip itself was wrong** — a
variable reported as added had been silently deleted by the next deploy, and a
key reported as working had been revoked.

So this loop exists, and it has one rule:

> **A human saying "done" never clears a blocker. Only the live system does.**

## How it works

`scripts/ops-blockers/check.mjs` runs on a schedule
(`.github/workflows/ops-blockers.yml`, every 3 hours) and for each dependency:

1. **Probes the real thing** — an HTTP request to the live service, not a
   config file or a note in a doc.
2. **Opens one GitHub issue** labelled `ops-blocker` if it is failing, and posts
   the ask to Slack **once**, @-mentioning whoever can act on it.
3. **Closes the issue and posts "unblocked"** when the probe passes.

State lives in the open issues. An Actions cache expires and a committed state
file pollutes history; issues are durable, free, and leave an audit trail of how
long each ask sat unanswered.

## Design decisions worth not undoing

**Probes sample repeatedly, not once.** atlas returned a single 500 while this
script was being written, and 0 in the next 40 requests. A one-shot probe would
have paged someone about a healthy deployment. Only a failure that survives
every attempt counts; passing once is enough to be green.

**A probe that cannot run is not a blocker.** A missing `RESEND_API_KEY` in CI
means "not checked", never "broken" — otherwise a CI misconfiguration pages
someone about a system that is fine. `skipped` can neither open nor close an
issue.

**The notifier fails closed.** No `SLACK_WEBHOOK_URL` and the run errors rather
than continuing quietly. A notifier that silently discards asks is worse than
none: the loop looks healthy while nothing is delivered.

**Slack is write-only.** The webhook URL is bound to one channel by Slack at
creation, server-side, so nothing here can post anywhere else or read anything.
The loop never needs to read replies, because it verifies the system instead.

**Least-privilege token.** `contents: read`, `issues: write`. A bug here cannot
modify the codebase.

## What each probe proves

| Probe | Checks | Catches |
|---|---|---|
| `atlas-up` | `GET /` serves | The site being down |
| `atlas-storage` | `GET /api/img/<nonexistent>` returns 404 | Storage unreachable, or the Worker throwing instead of reporting a miss |
| `atlas-storage-write` | In-Worker put → read back → compare → delete | A rejected **write**, and the S3-API fallback silently replacing the binding |
| `atlas-worker-email` | The **Worker's own** Resend key is accepted | A revoked key on the Worker while a valid one sits in repo config |
| `atlas-database` | The Worker runs `SELECT 1` | A broken Hyperdrive binding or a down database — with no DB credential in CI |
| `int-up` | staging serves | A bad deploy, before it reaches production |
| `bounties-up` | `bounties.buspark.io` serves | That Worker being down |
| `resend-key` | The **repo's** Resend key is accepted | A revoked key in CI |
| `resend-domain` | `buspark.io` is `verified` | Mail that would be rejected on every send |

The last three probes in the alerting chain exist because **reads, writes, and
credentials fail independently.** Both outages this was built after had healthy
reads throughout: one was a failing write the AWS SDK could not report on
workerd, the other a dead key on the Worker while a good one sat in repo config.
A probe that only reads from outside would have shown green through both.

## What this still does NOT check

Stated explicitly so nobody mistakes a green board for full coverage:

- **Whether mail actually lands in an inbox.** A verified domain and a valid key
  do not prove delivery.
- **hub.buspark.io**, and every bounties route beyond the homepage.
- **`EVENTBRITE_TOKEN`** on bounties — the Events page will stay empty without
  it and nothing here notices.
- **Certificate and domain expiry**, DNS drift, and anything Cloudflare-account
  level.
- **Correctness of anything.** These are liveness and credential checks; a site
  serving the wrong data passes every one of them.

## Setup

Repo **secrets** (Settings → Secrets and variables → Actions):

| Secret | Why |
|---|---|
| `SLACK_WEBHOOK_URL` | Incoming webhook, bound to the one channel asks go to |
| `RESEND_API_KEY` | Lets the Resend probes run; without it they report `skipped` |
| `DIGEST_TOKEN` | Already present for the weekly digest. Doubles as the health-endpoint credential, so the in-Worker probes work with no Cloudflare change |
| `OPS_HEALTH_TOKEN` | Optional and preferred. Set it on the Worker **and** here to stop the digest token doubling as the health credential |

Repo **variables** (not secrets — Slack member IDs are not sensitive):

| Variable | Who it pings |
|---|---|
| `SLACK_OWNER_CLOUDFLARE` | Worker secrets, bindings, deploys |
| `SLACK_OWNER_DNS` | DNS records on `buspark.io` |
| `SLACK_OWNER_RESEND` | Resend account and API keys |

A missing owner variable posts the ask unmentioned rather than failing — a quiet
notice beats none.

## Running it by hand

```sh
node scripts/ops-blockers/check.mjs --self-check   # verify the logic, no network
RESEND_API_KEY=... node scripts/ops-blockers/check.mjs --dry-run   # probe, print, post nothing
```

`--dry-run` is the safe one: it never writes to Slack or GitHub.

## Adding a blocker

Add an entry to `PROBES` in `check.mjs` with an `id` (permanent — it is the
issue's state marker), a `title`, an `owner`, and a `run()` returning
`{ok: true}`, `{ok: false, detail, ask}`, or `{skipped: reason}`.

The bar for a new probe: **it must check the live system.** If the only way to
tell is to ask a person, it does not belong here — that is the problem this
replaces.
