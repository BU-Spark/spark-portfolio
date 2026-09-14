# bounties — the Spark! Bounty Board

Paid, scoped challenges students can claim and ship. **HackBU × BU IS&T is one
track on this board, not the board itself** — that framing is already the one
`hub/links.mjs` uses ("Paid challenges — incl. the HackBU × BU IS&T track").

Astro, static-first, deployed to Cloudflare Workers, with Postgres on Railway
behind Hyperdrive.

## Hostnames

This answers the "are b & d, and c & e, the same thing?" question from the
planning thread. **They are the same application**, addressed twice:

| Hostname | Serves | What it is | State |
|---|---|---|---|
| `bounties.buspark.io/` | `src/pages/index.astro` | the whole board, every track | **live** — `routes` in `wrangler.jsonc` |
| `hackbu.buspark.io/` | `/tracks/hackbu`, from `src/pages/tracks/[track].astro` | the HackBU track's front door | **not wired yet** |

`hackbu.buspark.io` needs more than a DNS entry. Nothing in `src/` reads the
`Host` header, so pointing the hostname at this Worker as a plain custom domain
would serve the whole board there, not the HackBU page. It needs either a
Cloudflare rewrite rule (`hackbu.buspark.io/` → `/tracks/hackbu`) or a small
piece of Astro middleware doing the same. Until one exists the hostname is
intentionally absent from `wrangler.jsonc` — a missing page is a better failure
than a wrong one.

`/tracks/<id>` exists for exactly this reason: a track can have its own
hostname, heading, and blurb without being a second codebase. The other tracks
get the same treatment for free (`/tracks/spark`, `/tracks/partner`).

**Why not two initiatives.** A separate `hackbu/` directory would duplicate the
board, the card component, the Mailchimp integration and the content schema in
order to show a filtered subset of the same bounties. The only thing that
actually differs per track is copy and a filter predicate.

**Not to be confused with `hackbu.dev`.** That is the existing HackBU OS-desktop
site, in its own repo (`BU-Spark/hackbu-web`), and this change does not touch its
code or its deployment. If it ever moves in here it is a *different* thing from
this board — it is the HackBU programme site (mission, events, gallery,
leaderboard, live stream), of which bounties are one window.

## Where this sits in the spine

Read `../spine/vocabularies.md` before changing the schema. Two of its settled
vocabularies are adopted verbatim in `src/lib/spine.ts`:

- **`visibility`** — `hidden | restricted | internal | public`. Adopted as-is.
  This is new capability for bounties: previously any file in
  `src/content/bounties/` was live, so a draft bounty was impossible. Public
  reads filter `=== 'public'`, never `!== 'hidden'` — see `isPubliclyVisible()`.
- **`topic`** — the eleven-term taxonomy, one per bounty. Optional here because
  a bounty is scoped before its subject is always known, but it should be set
  before a completed bounty is handed to atlas.

One vocabulary is deliberately **not** adopted:

- **`status`.** The spine's project pipeline is
  `pending → active → in_review → complete`. A bounty keeps its own
  `open | completed | closed`, because **a bounty is pre-project**: it is an
  offer that may never be claimed. `closed` (deadline passed, nobody won) has no
  project equivalent — a project nobody ever started is not a project. Forcing a
  bounty into the project pipeline would either invent a fake `pending` project
  per unclaimed bounty, or lose the "expired unclaimed" state entirely.

  This is a concrete instance of `spine/open-decisions.md` **#5 (intake /
  proposal layer)** — "does the model need an intake/proposal layer above project
  instances, or does `projects` stay execution-only?" The bounty board *is* an
  intake layer for the work it originates. A **completed** bounty is the handoff
  point: that is when it becomes an atlas project, entering the project pipeline
  at `complete`. Offered as evidence for that decision, not as a fait accompli —
  if the answer lands the other way, the mapping lives in one enum here.

`track` is related to the spine's `owner_org` but is not the same axis: a track
says who is *offering* a bounty, not who may edit the resulting project record.
Worth reconciling if/when bounties get relational storage.

## Data

- **Bounties** — markdown in `src/content/bounties/`, baked in at build time.
  Schema in `src/content/config.ts`. Adding one is a new `.md` file; the filename
  is the slug (Astro reserves `slug:` in frontmatter — do not add it). Because
  content is compiled in, **the site must rebuild to show a new bounty.**
- **People, interest and teams** — Postgres (`db-bootstrap.sql`). Two tables:
  `person` and `bounty_interest`, one row per person per bounty.
- **Events** — Eventbrite via `src/pages/api/events.ts`, falling back to
  `src/lib/events-fallback.json`. The fallback has no year and may be stale, so
  the "next up" treatment is gated behind a `live` flag.

### Why not Mailchimp

hackbu.dev stores interest as Mailchimp tags (`interested:<slug>`,
`team:<slug>`, `solo:<slug>`, `has-team:<slug>`, `team-group:<slug>:<id>`) and
stays that way — it is legacy. This board uses Postgres instead, which removed
more than a dependency:

- Those tags encoded **mutually exclusive facts as independent booleans**, so
  every write had to explicitly deactivate the conflicting tag. A member with
  both `solo:x` and `has-team:x` active was representable; a `working_mode`
  column makes it impossible.
- Counts needed **all ~1000 members fetched and filtered in JS on every
  request**. Now one indexed `GROUP BY`.
- Re-registering meant reconciling tag state by hand. Now
  `UNIQUE (bounty_slug, person_id)` makes it a plain upsert.

**What was lost:** Mailchimp was also the *mailer* — the confirmation email
carrying the brief was a Mailchimp Automation triggered on tag-add. Nothing
sends email now, and the interest form says so ("The brief and repo are linked
under Resources") rather than promising an inbox. atlas already uses **Resend**;
that is the natural place to start if transactional email is wanted back.

## Environment

**Production** — the database arrives through the `HYPERDRIVE` binding in
`wrangler.jsonc`, not an env var. All of these are set on the `bounties-site`
service (confirmed 2026-09-14):

```
EVENTBRITE_TOKEN        # wrangler secret put EVENTBRITE_TOKEN
SLACK_SIGNING_SECRET    # wrangler secret put SLACK_SIGNING_SECRET
MAILCHIMP_API_KEY       # mailer only — see "Mailchimp" below
MAILCHIMP_AUDIENCE_ID   # 3baefe8534 ("Spark! Bounty Board")
ADMIN_KEY               # guards /api/mailchimp/reconcile and /dashboard
```

`DATABASE_URL` is deliberately **not** in that list. It was required before the
Hyperdrive binding existed; now `resolveConnectionString` takes the binding
first, so in production the secret can never be read. Setting it is harmless
but misleading — it looks like the live connection and is not.

**Local dev** — export a dev database URL before `npm run dev`:

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://user:password@host:port/db
npm run dev
```

This is not optional, and `DATABASE_URL` in `.dev.vars` will not do it. The
`HYPERDRIVE` binding is live in `wrangler.jsonc`, `astro dev` populates it, and
`resolveConnectionString` takes the binding first — so the `.dev.vars` value is
never read. Wrangler also refuses to start local emulation when a configured
Hyperdrive binding has no local connection string from either source.

Do **not** "fix" that startup error by adding a `localConnectionString` to
`wrangler.jsonc`. It silences the error and then shadows `DATABASE_URL` with an
address nothing is listening on, so every DB-backed page fails at query time
instead of failing loudly at boot.

Two traps, both of which cost real time:

1. **Use Railway's PUBLIC proxy host** (`*.proxy.rlwy.net`), never
   `*.railway.internal`. The internal hostname only resolves inside Railway's
   private network — it does not resolve from a laptop and, more importantly,
   **not from a Cloudflare Worker either**, so a Hyperdrive config built on it
   can never connect.
2. **Miniflare requires a password in the string.** A trust-auth local database
   with no password fails validation before the server even starts.

The `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_*` spelling still works but is
deprecated; wrangler checks the `CLOUDFLARE_`-prefixed name first and warns on
the old one.

## Applying the schema

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v app_password="'...'" -v postgres_password="'...'" \
  -f db-bootstrap.sql
```

Idempotent (`CREATE TABLE IF NOT EXISTS`), so re-running is safe. Note the
`spine` storage rule: categoricals are `text` + `CHECK`, not Postgres ENUMs, so
widening one is a **drop-and-recreate** of the constraint — an add-if-absent
guard silently leaves the database rejecting values the app thinks are valid.

`db-bootstrap.sql` is one ordered, idempotent file covering the schema, the
least-privilege `bounties_app` role, verification queries, and superuser
rotation. **Read section 4's warning before running it** — rotating the
`postgres` password does not update Railway's own service variables.

**The application must not connect as `postgres`.** Section 2 creates
`bounties_app`, which holds SELECT/INSERT/UPDATE/DELETE on the two tables and
nothing else — verified: it cannot CREATE TABLE, DROP TABLE, read `pg_authid`,
or create roles.

## Cloudflare notes

`nodejs_compat` is **required**: `pg` reaches for `node:net` / `node:tls`.
(It was previously required for Mailchimp's MD5 subscriber hash via
`node:crypto`; that need is gone but the driver's remains.)

`pg` and its dependencies import Node builtins as **bare** specifiers
(`events`, `net`, `stream`…), which Rollup refuses to bundle — and it reports
them one at a time, so chasing them individually never ends.
`astro.config.mjs` rewrites every bare builtin to its `node:`-prefixed form and
marks those external, leaving them to the runtime.

Per `atlas/lib/db.ts`, **do not hold a `pg.Pool` in the Worker isolate** —
Hyperdrive owns the origin-side pool and a retained pool's stale sockets cause
intermittent 1101s. `src/lib/db.ts` therefore opens a `Client` per request and
closes it in a `finally`.

`hyperdrive[].localConnectionString` is a **local-dev** concern only, despite
what you may read elsewhere. Wrangler's check is gated on local emulation
(`if (local && ...)` in `applyHyperdriveEnvVars`), and the Astro adapter builds
the platform proxy only in its `astro:server:setup` hook — which runs for
`astro dev`, not `astro build`. Deploys never reach it.

`atlas/wrangler.jsonc` *does* carry a placeholder `localConnectionString`, and
that is correct there, not an inconsistency to tidy up: `wrangler deploy` on an
OpenNext project delegates to `opennextjs-cloudflare deploy`, which calls
`getPlatformProxy()` and so trips the check at deploy time. It is also harmless
there because `getCloudflareContext()` throws under plain `next dev`, so atlas
never takes the binding locally. Here, `astro dev` does — which is exactly why
the same placeholder would break this app.

Rate limiting is still the in-memory limiter in `src/lib/rate-limit.ts`, which
resets per isolate and so is weaker on Workers than it looks. atlas uses
`@upstash/ratelimit`; worth adopting if abuse becomes real.

## Design system — open question

`src/styles/site.css` uses plain CSS with `:root` custom properties, which is
the same architecture as `atlas/app/globals.css`, and the token *names* line up
almost exactly (`--ink`, `--muted`, `--faint`, `--bg`, `--line`). The **values
do not**:

| | atlas | this board |
|---|---|---|
| accent | `#0fa392` | `#3d8c84` |
| ink | `#16191c` | `#1a1a1a` |
| page bg | `#f4f5f4` | `#ffffff` |
| display font | Space Grotesk | Bebas Neue |
| body font | IBM Plex Sans | Montserrat |
| content width | `1080px` | `1240px` |

This board follows a design handoff ("1B") that specified Montserrat/Bebas. If
the programme wants one UI across everything, the colours are a token swap but
**the fonts are a different typographic identity** and someone has to choose.
Unresolved on purpose — flagging it rather than silently diverging.

## Local

```bash
npm install
npm run dev      # http://localhost:4321
npm run build
npm run check    # astro type check
```


## Slack: one `/spark` command

Per langdon: a full bot, not a collection of one-off commands. A single Slack
command with subcommands, backed by one route
(`src/pages/api/slack/command.ts`):

```
/spark signups <slug>   addresses + names for one bounty
/spark counts           signups across every bounty
/spark help             usage
```

Adding a capability is one entry in that file's HANDLERS map — no new Slack
command to register, no re-approval, and signature verification stays in one
place. `list` and `who` are aliases, because people guess them.

Setup (api.slack.com/apps -> your app):

1. **Slash Commands** -> Create New Command
   - Command: `/spark`
   - Request URL: `https://bounties.buspark.io/api/slack/command`
   - Escape channels/users/links: **off** (it would mangle the slug)
2. **Basic Information** -> copy the *Signing Secret*, then
   `wrangler secret put SLACK_SIGNING_SECRET`
3. Install the app to the workspace.

Two deliberate properties:

- **Every reply is ephemeral.** A roster is student PII; `in_channel` would
  broadcast it to the channel and leave it in Slack's retained history. The
  option is not exposed in code, not merely defaulted.
- **Requests are signature-verified with a five-minute replay window**, then
  rate limited even when signed. This is a public URL that returns email
  addresses; the signature is the only thing in front of it.
  `src/lib/slack.test.ts` covers both.

Open question for langdon: if this bot grows past the bounty board, it should
probably not live inside this app — either a `slackbot/` initiative that calls
each app's API, or each app exposes routes and the bot proxies.

## Mailchimp: the mailer, not the database

Postgres is the source of truth for who signed up. Mailchimp exists so comms
can pick a tag and hit send without anyone copying a list by hand — the
workflow that made a CSV export or a Slack command insufficient on their own.

Tags mirror the Postgres row, and the vocabulary is the one ALREADY in the
"Spark! Bounty Board" audience (also documented in hackbu-web/CLAUDE.md):

    interested:<slug>            registered interest
    team:<slug>                  wants teammates      (intent = looking_for_team)
    solo:<slug>                  working alone        (working_mode = solo)
    has-team:<slug>              already has a team   (working_mode = team)
    team-group:<slug>:<team_id>  a formed team

`solo:` / `has-team:` are mutually exclusive and Mailchimp cannot express that,
so every write sets one and explicitly DEACTIVATES the other. Postgres enforces
the invariant via UNIQUE (bounty_slug, person_id); this keeps the mirror honest.

- `/api/respond` and `/api/withdraw` mirror through `ctx.waitUntil`, so a
  Mailchimp outage cannot fail a student's signup.
- `POST /api/mailchimp/reconcile` (Bearer ADMIN_KEY) repairs drift when a
  fire-and-forget write is lost. `?prune=1` also clears tags Postgres does not
  back — the only destructive direction, hence opt-in.

> **Do not run `?prune=1` while hackbu.dev still accepts signups.** hackbu.dev
> writes into the SAME audience (3baefe8534) from its own API, with the same
> tag vocabulary, and those signups have no row in this database. Prune would
> read them as orphans and deactivate them, removing real people from the list
> comms mails. It becomes safe once hackbu.dev is retired and this app is the
> only writer. The default (non-prune) path only adds and corrects, so it is
> safe to run at any time.

### One-time backfill

Nine signups exist only as Mailchimp tags. Migrate them BEFORE the site goes
live, or the roster reads 0 while comms still hold 9 names:

    npm run backfill              # dry run, reads Mailchimp only
    npm run backfill -- --apply   # writes Postgres in a single transaction

The apply path is all-or-nothing and verifies its own counts against Mailchimp
afterwards, exiting non-zero on a mismatch.


## Delivery state: who actually shipped

`bounty_interest` carries `submitted_at`, `completed_at` and `payout_cents`,
because signing up and DELIVERING are different facts. Without them "who did a
bounty" is unanswerable and Hall of Fame stays hand-maintained markdown.

    SELECT * FROM bounty_people;   -- bounty_count vs completed_count vs payout

Two invariants live in the database rather than in application code, so a
manual UPDATE during a scramble cannot bypass them:

- `payout_cents >= 0`
- a payout requires `completed_at` (paid implies completed)

Money is integer cents, never float — these figures get summed, and
0.1 + 0.2 != 0.3 in binary floating point.

Kept on `bounty_interest` rather than a separate table: it is already one row
per (person, bounty) and a submission has no identity of its own yet. When
submissions need history — resubmits, reviewer notes — that is when they earn
their own table.


## Deployment: Cloudflare Workers Builds

The `bounties-site` service builds from this directory on every push. Its
settings live in the Cloudflare dashboard, NOT in this repo, so they are
recorded here — a wrong value fails in a way the code cannot express:

| Setting        | Value              |
| -------------- | ------------------ |
| Root directory | `bounties`         |
| Build command  | `npm run build`    |
| Deploy command | leave as generated |

Two things that have already gone wrong:

1. **An empty build command.** Workers Builds went straight from
   `npm clean-install` to `wrangler versions upload` and failed with
   `The entry-point file at "dist/_worker.js/index.js" was not found`. Nothing
   was wrong with the code: `dist/` simply had not been generated. If that
   error reappears, the build command is empty again.
2. **`name` in wrangler.jsonc must equal the service name** (`bounties-site`).
   `wrangler deploy` refuses when they differ. This is why the name here
   breaks the `spark-*` convention that atlas and hub follow.

Non-production branches run `wrangler versions upload` (uploads a version
without releasing it); the production branch deploys for real. So a merge to
`main` publishes.

### After a green build

Both prerequisites are **done** — recorded here because neither is visible from
the repo and a future failure will look identical to them never having happened:

1. **Railway Public Access** is enabled on `Bounties Prod DB`. It has to be:
   Cloudflare cannot resolve `postgres-b1fc.railway.internal`, which is private
   Railway DNS that no Worker can reach, Hyperdrive or not. The Hyperdrive
   config was created against the `*.proxy.rlwy.net` host, so its existence is
   itself evidence this is on.
2. **Secrets are set** on `bounties-site` — see § "Environment" for the list.
   `DATABASE_URL` is not among them and is not needed; the binding wins.

The `postgres` superuser password was rotated before public access went on.
Railway's warning is accurate: anyone with the string can connect.

If `/api/*` starts returning 500 again, the first thing to check is whether the
Hyperdrive id in `wrangler.jsonc` still resolves to a live config — a deleted
or recreated Hyperdrive fails exactly like a missing secret.


## Admin: `/dashboard`

Cookie session (`spark-admin`, httpOnly, Secure, SameSite=Strict, 4h) unlocked
with `ADMIN_KEY`. Every login attempt is rate limited BEFORE the key is
compared -- hackbu.dev only counted failures, which let a correct guess through
on attempt 50 and made its limiter a message-changer rather than a control.

What it shows, per bounty: teams (by `team_id`), solo signups, people looking
for teammates, and who delivered. What it does: merge checked people into a
new team, remove someone from a team, mark checked people as delivered (with a
per-person payout and an optional https submission URL), undo a delivery, and
export everything as CSV.

- The CSV is built from an embedded JSON blob, not scraped from the DOM, so it
  cannot drift from what is displayed. Cells starting with `= + - @` are
  prefixed with `'` because Excel and Sheets execute those as formulas, and a
  student can type one as their own name.
- If Postgres is unreachable the page says so in a red alert. It does NOT show
  an empty roster, which is what `bounty-counts` used to do -- that endpoint
  now returns `degraded: true` on fallback for the same reason.
- Payout defaults to the prize split evenly across the checked people.
  `payout_cents` is per PERSON (what each one actually receives), so a team of
  two must not record double the pot.

### Production needs Hyperdrive — the Worker cannot connect directly

Verified 2026-09-09 against the live database. Local dev connects straight to
Railway's TCP proxy; **the deployed Worker cannot**, and no amount of secret
setting fixes it.

Railway's Postgres serves a certificate from a private CA:

```
subject : CN=localhost
issuer  : CN=root-ca
SAN     : DNS:localhost, DNS:postgres-b1fc.railway.internal
```

Node accepts it because `withDb` passes `rejectUnauthorized: false`. The
Workers runtime has no equivalent — `connect()`/`startTls()` validate against
Cloudflare's trust store and the [TCP socket
API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
documents no way to opt out. The handshake fails and pg surfaces the generic
`Connection terminated unexpectedly`, which is what `/dashboard` showed in
production with `DATABASE_URL` correctly set.

Hyperdrive accepts a CA, so it is the way in. Use **`verify-ca`, not
`verify-full`**: the SAN above does not include `altaria.proxy.rlwy.net`, so
hostname checking can never pass and we do not control issuance. Both results
were confirmed against the live server:

| mode | result |
|---|---|
| `verify-full` | fails — `Host: altaria.proxy.rlwy.net is not in the cert's altnames` |
| `verify-ca` | connects, `authorized=true` |

```bash
npx wrangler cert upload certificate-authority \
  --ca-cert certs/railway-postgres-root-ca.pem --name railway-bounties-ca

npx wrangler hyperdrive create spark-bounties \
  --connection-string="postgresql://bounties_app:PASSWORD@altaria.proxy.rlwy.net:52027/railway" \
  --ca-certificate-id <id from the upload> --sslmode verify-ca
```

The `hyperdrive` block in `wrangler.jsonc` is already live with the id this
returned; a re-run only needs that id swapped. No code changes:
`resolveConnectionString` already prefers the binding.

Hyperdrive also pools connections, which this app wants anyway: without it
every request opens its own Postgres connection against Railway's
`max_connections`.

The CA is committed at `certs/railway-postgres-root-ca.pem`. It is a **public
certificate, not a secret** — no private key, and the server hands it to every
client during the handshake — so it is deliberately not gitignored. It is also
not downloadable from the Railway dashboard or CLI: the
[`postgres-ssl`](https://github.com/railwayapp-templates/postgres-ssl) image
generates it inside the container and leaves it on the data volume. We take it
off the wire instead:

```bash
node scripts/dump-db-cert.mjs   # re-extract the chain
node scripts/check-db-tls.mjs   # prove verify-ca works and verify-full does not
```

It survives restarts and redeploys — `init-ssl.sh` reissues only the server
leaf and deliberately never rotates the CA — so the upload to Cloudflare is a
one-time step. See `certs/README.md`.

### Connection string gotcha: do not add `sslmode=require`

Railway's TCP proxy (`*.proxy.rlwy.net`) serves a self-signed certificate.
`pg` 8.16+ treats `sslmode=require` as `verify-full`, so a `DATABASE_URL`
carrying it fails with *self-signed certificate in certificate chain* — even
though `psql` on the identical URL connects, because psql uses real libpq where
`require` means "encrypt, do not verify".

`withDb` therefore strips `sslmode` and `uselibpqcompat` and sets
`ssl: { rejectUnauthorized: false }` itself. Traffic is encrypted; the chain is
not verified. Set the secret as a plain
`postgresql://bounties_app:PASSWORD@HOST:PORT/railway` — extra params are
harmless but pointless. See `src/lib/db.test.ts`.

### Declaring winners

`POST /api/admin/declare-winner` marks people as delivered. This is a
redesign, not a port: hackbu.dev's version did `fs.writeFileSync` into
`src/content/*.md` and `src/data/leaderboard.json` at request time, which a
serverless filesystem does not allow -- its `leaderboard.json` is still 3
bytes. Here delivery is rows in Postgres, and `/hall-of-fame` is SSR: it shows
frontmatter-declared winners (legacy) UNION rows with `completed_at`, with the
database winning for the same slug. Declaring a winner needs no redeploy.

The leaderboard was not ported. It never accumulated a single entry in
production, so there was no behaviour to preserve.

### Not ported: `/live`

hackbu.dev's `/live` was an "Off Air" livestream placeholder reading a
`streamUrl` from events JSON. No event has one, and `/events` is where a
stream link belongs when one exists. It is a hackathon-day page, not a bounty
board feature.
