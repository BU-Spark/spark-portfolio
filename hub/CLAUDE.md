# BU Spark! Project Gallery — project guide

Next.js 15 (App Router) + TS + React 19 gallery/admin for BU Spark! projects.
Backend is **live**: Railway Postgres (`pg`) + Railway S3 + Auth.js (Google OAuth,
`@bu.edu` allowlist). Repo `UgaTheDev/sparkshowcase`, deployed on Vercel at
sparkshowcase.vercel.app. Design is inline-style; fonts are IBM Plex Sans (body)
and Space Grotesk (display/bold).

## Hard rules
- **Commit as `kush.zingade@gmail.com`** (`git -c user.email=…`) or Vercel deploys stall.
- **Never paste secrets in chat.** Use `.env.local` (gitignored) + Vercel env vars.
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

## Conventions worth knowing
- Image keys are bare S3 keys in a `text[]`; resolve via `imageUrl()` / `/api/img/[...key]`.
  Shared upload core is `lib/upload.ts` (admin + token uploaders share it).
- DB tables that aren't in `scripts/db-setup.ts` are **lazily created**
  (`CREATE TABLE IF NOT EXISTS`) on first use — mirror `ensureSettingsTable()`.
- Public routes live outside the `/admin` middleware matcher; gate them with a
  token at the API level (see `app/api/contribute/*`, `app/api/import`).
- Before approving a non-trivial plan, do an adversarial self-review pass (races,
  injection, leaks, cleanup) and fold fixes in.
