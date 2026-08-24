# BU Spark! Project Gallery — project guide

Next.js 15 (App Router) + TS + React 19 gallery/admin for BU Spark! projects.
Backend is **live**: Railway Postgres (`pg`) + Railway S3 + Auth.js (Google OAuth,
`@bu.edu` allowlist). Repo is the `BU-Spark/spark-portfolio` monorepo, this app in
`hub/`. Design is inline-style; fonts are IBM Plex Sans (body) and Space Grotesk
(display/bold).

## Where this actually runs (measured 2026-08-24)
**The production domain is `atlas.buspark.io`.** Two deployment targets exist and they
disagree — check before assuming, and note the Vercel one is expected to be torn down.

| | State |
|---|---|
| `atlas.buspark.io` (+ `int.atlas.buspark.io`) | **the real production host.** Cloudflare Worker, live, but on **stale code**: `/api/import` answers 401, while `/api/digest/weekly` and `/api/pd-complete` 404 — so the build predates `95a0353` |
| `sparkshowcase.vercel.app` | interim host, **current code**, kept alive only until the Worker is redeployed |
| `hub.buspark.io` / `int.hub.buspark.io` | **never existed.** No DNS record on Cloudflare's own nameservers |

`hub/` is built for Cloudflare Workers: `wrangler.jsonc` (prod) / `wrangler.int.jsonc`
(int), `@opennextjs/cloudflare`, Hyperdrive. There is no committed `.vercel`;
`npm run deploy` is `wrangler deploy`.

**A wrong conclusion recorded here on 2026-08-21, so nobody repeats it:** the config
said `hub.buspark.io`, that name had no DNS record, and `custom_domain: true` creates
the record on deploy — from which I concluded the Worker had never been deployed. It
had. It was deployed to `atlas.buspark.io`, and the config in git was simply stale.
The lesson: `custom_domain` proves a *route* was never deployed, not that the *Worker*
wasn't. Check the account's actual routes before concluding anything about a missing
hostname.

**Consequence, and the trap:** the DB can be in the intended state while users see
something else. `visibility` only takes effect once code that filters on it is
serving traffic — the deployed query is the boundary, never the column. The legacy
`published` boolean is still dual-written for exactly this reason (see the gallery
section below), which is why old code keeps working and why "the DB is right" is not
the same claim as "the public sees the right thing".

## Hard rules
- **Commit as `kush.zingade@gmail.com`** (`git -c user.email=…`) or the Vercel deploy
  of `sparkshowcase` stalls. Still load-bearing while that project is live.
- **Never paste secrets in chat.** Use `.env.local` (gitignored) locally, and
  `wrangler secret put` / the Cloudflare dashboard for the Workers. A secret pasted
  into a message is in the transcript and on disk before anyone reads it — hand it
  over via a mode-`600` file outside the repo, or set it in the shell so the value
  never enters a conversation (`gh secret set X --body "$TOK"`).
- **Students and Team IDs are admin-only** — never render them publicly or include
  them in any public payload/projection.
- `.env.local`, CSVs, and `course-discipline.json` are gitignored — don't commit them.

## Parallelize aggressively — sequential is the exception, not the default

Most work here is run more sequentially than it needs to be. Before working
step-by-step, ask: "do these steps actually depend on each other?" If not, do them
at the same time. Only sequence on a true data dependency.

- **Batch independent tool calls into one message** — reads, greps, globs, and edits
  to *unrelated* files run concurrently, so send them together, not one-at-a-time.
- **Fan out exploration with subagents.** Scoping a feature across the db layer /
  API routes / components? Launch multiple `Explore` agents in a single message,
  each with a distinct area — don't trace one layer, then the next.
- **Use the Workflow tool for fan-out / multi-phase work** (audits, sweeps,
  migrations, multi-file reviews, "do X across N projects/files"). Run stages in
  parallel instead of looping serially.
- **Independent edits in parallel** — when touching several files that don't depend
  on each other, dispatch the edits together.

Reserve sequential steps for genuine dependencies (B needs A), ordering
constraints, or a cheap first step that decides whether later work is needed.
Going sequential should be a deliberate choice, not the default.

## Org-scoped admin permissions (CDS / Spark)
- **`projects.owner_org` is authority; `projects.surfaces` is visibility.** Never
  derive one from the other. Every `cds`-tagged project is *also* `spark`-tagged
  (there are zero cds-only rows), so `surfaces` cannot express an edit boundary.
- All 170 projects were backfilled to `owner_org='spark'` **on purpose** — the
  cds-surface tag was applied to news/media projects and does not indicate CDS
  ownership. A super admin reassigns the real CDS ones by hand. Do not "fix" this
  with an `UPDATE … WHERE 'cds' = ANY(surfaces)`.
- Rules live in `lib/authz.ts` (pure, unit-tested, imports nothing). Session/DB
  resolution and the route guards live in `lib/actor.ts`. Routes use
  `requireAdmin` / `requireSuper` / `requireProject(s)` — never a bare `auth()`.
- `is_super` is granted by **SQL only**. No API accepts the field, so a mistake
  yields a scoped admin, never a super admin.
- Reassigning a project to CDS removes it from the Spark PD sync (the importer
  pre-filters candidates by org and the Apps Script runs as `IMPORT_ORG=spark`).
  That's intended, but it looks like a bug if you don't expect it.

## Three independent axes on a project
Never derive one from another. This has already been the source of one near-miss
(`surfaces` was almost used as an edit boundary) and is the reason `status` exists.

| Axis | Column | Question it answers |
|---|---|---|
| Authority | `owner_org` | which team may edit it |
| Visibility | `visibility` (+ `surfaces`) | whether/where the public sees it |
| Pipeline | `status` | where the work actually is |

- `status` is `pending` \| `active` \| `in_review` \| `complete` (`PROJECT_STATUSES` in
  `lib/data.ts`, mirroring the `projects_status_chk` CHECK). Keep the two in step.
- **`in_review` is written by exactly one thing:** `/api/pd-complete`, on a submission
  that failed the checks. It means "someone claimed this was done and the data
  disagreed" — which neither `pending` ("nobody started") nor `active` ("in progress,
  no claim made") can express. Nothing else should set it, and no UI offers it as a
  destination for a project that hasn't been submitted.
- `004_status_in_review.sql` **drops and re-adds** the CHECK rather than guarding on
  `pg_constraint` like 002 did. A guard would find the existing narrow constraint and
  do nothing, leaving the DB rejecting a value the app thinks is valid — invisible
  until the first webhook rejection 500s. Widening an enum CHECK always means replace,
  never add-if-absent.
- Its rollback deliberately **fails** if any row is `in_review`, rather than rewriting
  those rows to `active`. That row is the only record a completion was submitted and
  bounced; a rollback script that quietly mutates data loses exactly what you needed.
- **A complete project can be unpublished** (finished, still missing a screenshot) and
  **an active one can be public**. That combination is the whole point of the field —
  don't add logic that couples them.
- **Don't infer status from the latest run's term.** A past term means the semester
  ended, not that the work finished. All 170 rows were seeded `complete` because every
  latest run was Spring 2026 or earlier and there were no Fall 2026 runs at all.
- `002_project_status.sql` uses two defaults deliberately: `ADD COLUMN … DEFAULT
  'complete'` backfills existing rows, then `SET DEFAULT 'pending'` applies to future
  inserts only. That replaces a backfill `UPDATE` and avoids a table rewrite.
- `status` is **absent from the merge UPDATE on purpose** — the survivor keeps its own.
  Unlike `surfaces` (a set, which had to become a union), there is no sensible merge of
  `active` with `complete`.
- The importer never sets it, and it's excluded from `addProject`'s `DO UPDATE`, so a
  re-synced tracker row can't drag a project an admin moved to `active` back again.

## The gallery is OPT-IN (`visibility`)
`hidden` (draft) → `internal` (ready, staff-only) → `public` (live). `VISIBILITIES` in
`lib/data.ts` mirrors `projects_visibility_chk`.

- **Public reads filter `visibility = 'public'`, never `<> 'hidden'`.** The second form
  would leak all 140 `internal` projects onto the anonymous gallery. `getProjects`/
  `getProject` are `unstable_cache`d under a shared key, so they must stay
  session-independent — a viewer-aware read belongs in its own uncached function, or
  one visitor's payload becomes every visitor's.
- `published` is now **derived** (`visibility !== 'hidden'`) on the `Project` type, so
  the admin UI's draft/not-draft concept keeps working off one source of truth. It does
  NOT mean "publicly visible" — an `internal` project has `published === true`.
- The DB column `published` is **still written** (expand-contract: the migration and
  the Worker deploy aren't atomic, so a code rollback must still find a correct
  boolean). `updateProject` handles both in one branch so they can't diverge. Don't
  read it in new code; a later migration drops it.
- **Legacy boolean writes never promote to `public` and never demote from it.** `true`
  maps to `internal` via a SQL `CASE` that preserves an existing `public` — otherwise
  hide-then-show would quietly pull a live project off the gallery.
- 140 projects became `internal`, not `public`: `published = true` only ever meant "the
  data looked complete enough", never "someone opted in". **The public gallery is empty
  until someone opts projects in** — that's the intended launch posture, and
  `003_visibility.sql` carries the one-line SQL to bulk-publish instead.
- `internal` projects are previewed at `/admin/projects/<id>`, which already mirrors the
  public layout. They are deliberately **not** in the approvals queue — 140 rows would
  bury the handful someone can actually clear.

## PD completion checks (`lib/checks.ts` + `/api/pd-complete`)
- `lib/checks.ts` is **pure** (no db/session/network) — that's what makes it testable
  and it's also the honest boundary. Link *liveness* needs the network and lives in the
  route, behind an opt-in `checkLinks` flag so a form submission doesn't pay for it.
- **There is no ML here, on purpose.** The spec floated RAG/a classifier for discipline
  tagging. Measured first: of 38 runs with no discipline, **16 already resolved under
  the existing `disciplineFromCourse` map** (a stale-data bug, since backfilled) and the
  other 22 are internships, which have no course discipline to infer. No residue left
  for a model. If an unmapped course appears, add a line to that map.
- A discipline **mismatch is reported but never auto-fixed** — the course map is a
  heuristic and an admin may have overridden it deliberately. Only an *empty* stored
  discipline gets an `autoFix`.
- **Missing images is a warning, never a blocker.** All 140 ready projects have none, so
  blocking on it would score the whole catalogue 0 and make the audit say nothing.
- `db/audit-projects.ts` runs the checks over the live DB (read-only; `--fix-disciplines`
  applies the mechanical backfill). It uses `pg` + pure lib modules directly, because
  `lib/db.ts` is `server-only` and unresolvable outside Next's bundler.
- The webhook **never changes visibility.** Accepting a completion sets `status`, and
  putting a project on the gallery stays a separate deliberate opt-in.
- On rejection it sets status `in_review`, **not** `pending` as the spec says: `pending`
  means "scoped, not yet started", so reusing it for "submitted but rejected" would make
  those two indistinguishable. It was `active` until `004_status_in_review.sql` added the
  fourth status; `active` was less wrong than `pending` but still lost the signal a
  supervisor needs — that a completion claim was made and rejected.
- `pd_completions` is **append-only** — "rejected in January and again in May" is the
  signal a supervisor needs, and one mutable row would erase it.
- Not built: writing suggested edits back into the PD Google Doc (needs Docs API
  credentials + a service account with per-doc access).

## Approvals queue + weekly Slack digest
- `/admin/approvals` is a **worklist**, so it shows only rows the actor can act on
  (supers see all) — unlike `/admin/projects`, where foreign rows stay visible so a
  mis-filed project is noticeable. Ordered oldest-first, never grouped by kind.
- **Waiting-on-a-person items and standing data gaps are separate.** Nothing is
  "waiting" on a missing tech stack, and today 100% of projects have no images, so
  mixing the backlog into the queue would bury the rows someone can actually clear.
- The digest **stays silent when nothing is waiting on a person.** That's the
  anti-noise mechanism: the backlog half is near-static, so a digest that fired
  regardless would send a near-identical message weekly and get muted.
- `digest_snapshots` stores each run's counts so the backlog renders as a delta.
  Snapshots are written on a successful post *and* on a silent week, but **not** on a
  failed Slack post — recording that would make the next diff silently swallow a week.
- Env: `DIGEST_TOKEN` (bearer secret), `SLACK_WEBHOOK_URL`, `DIGEST_ORG`
  (validated against `ORGS` like `IMPORT_ORG`, never taken from the request).
  Scheduled by `.github/workflows/weekly-digest.yml`, **not** a Cloudflare cron —
  a Worker cron needs a `scheduled` export and OpenNext emits a fetch-only worker.
  `?dry=1` renders the message without posting or snapshotting.
- The draft ready/blocked split in `listOpenApprovals` mirrors `publishBlockers()`
  in `lib/project.ts`. Keep the two in step.

## Conventions worth knowing
- Image keys are bare S3 keys in a `text[]`; resolve via `imageUrl()` / `/api/img/[...key]`.
  Shared upload core is `lib/upload.ts` (admin + token uploaders share it).
- DB tables that aren't in `scripts/db-setup.ts` are **lazily created**
  (`CREATE TABLE IF NOT EXISTS`) on first use — mirror `ensureSettingsTable()`.
- Public routes live outside the `/admin` middleware matcher; gate them with a
  token at the API level (see `app/api/contribute/*`, `app/api/import`).
- Before approving a non-trivial plan, do an adversarial self-review pass (races,
  injection, leaks, cleanup) and fold fixes in.
