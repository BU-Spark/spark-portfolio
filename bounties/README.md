# bounties — the Spark! Bounty Board

Paid, scoped challenges students can claim and ship. **HackBU × BU IS&T is one
track on this board, not the board itself** — that framing is already the one
`hub/links.mjs` uses ("Paid challenges — incl. the HackBU × BU IS&T track").

Astro, static-first, deployed to Cloudflare. Live content is three markdown files
and two external APIs; there is no database yet (see [Data](#data)).

## Hostnames

This answers the "are b & d, and c & e, the same thing?" question from the
planning thread. **They are the same application**, addressed twice:

| Hostname | Serves | What it is |
|---|---|---|
| `bounties.buspark.io/` | `src/pages/index.astro` | the whole board, every track |
| `hackbu.buspark.io/` | `/tracks/hackbu` (via a Cloudflare route), from `src/pages/tracks/[track].astro` | the HackBU track's front door |

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
  is the slug (Astro reserves `slug:` in frontmatter — do not add it).
- **People, interest and teams** — Mailchimp tags (`interested:<slug>`,
  `solo:<slug>`, `has-team:<slug>`, `team-group:<slug>:<id>`). This is the
  closest thing to a database the board has.
- **Events** — Eventbrite via `src/pages/api/events.ts`, falling back to
  `src/lib/events-fallback.json`. The fallback has no year and may be stale, so
  the "next up" treatment is gated behind a `live` flag.

Because bounty content is compiled in, **the site must rebuild to show a new
bounty.** Anything automating bounty creation needs to trigger a deploy.

## Environment

Set as Worker secrets (`wrangler secret put`), not in this repo:

```
MAILCHIMP_API_KEY         MAILCHIMP_SERVER_PREFIX     MAILCHIMP_AUDIENCE_ID
EVENTBRITE_TOKEN
```

`MAILCHIMP_AUDIENCE_ID` is a deliberate choice, not a copy-paste: point it at the
**same** audience as hackbu.dev and interest is shared between the two sites
(counts match, one signup shows up in both); point it at a **different** one and
this board is isolated. Mailchimp keys members by `md5(email)`, so a person
registering on both is idempotent either way.

## Cloudflare notes

`nodejs_compat` is **required**, not optional. The Mailchimp subscriber hash is
an MD5 of the email address and Web Crypto has no MD5 (`crypto.subtle.digest`
does SHA-1/256/384/512 only), so `src/pages/api/*` genuinely needs
`node:crypto`. `astro.config.mjs` externalises it so Rollup leaves it alone.

`@mailchimp/mailchimp_marketing` was **removed** and replaced by a ~100-line
`fetch` client in `src/lib/mailchimp.ts`. The SDK is a Node/superagent wrapper
that imports bare `querystring`, `http` and `stream`; externalising those
cascades without end on Workers. Only four endpoints were ever used, so the REST
calls are less code than the dependency. The shim keeps the SDK's method names
and error shape (`err.status`, `err.response.body`) so the routes were untouched.

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
