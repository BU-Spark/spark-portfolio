# Project Hub — Phase 1: Lightweight Metadata Layer

**Date:** 2026-06-26
**Status:** Design — approved for spec, pending implementation plan
**Scope:** Phase 1 only. Phases 2–3 (team-member auth tier, deployment automation) are
described as context but are explicitly out of scope here.

## Problem

Each project page in the Spark! Project Gallery is a public catalog entry. The proposal
is to extend it into a durable "front door" for every project — active or archived — so a
student, PM, instructor, or staff member can open one page and find: where the code lives,
where docs/design live, whether the project is alive, how to contact the team, and how to
restart it next semester.

Phase 1 delivers the **lightweight metadata layer** only: a lifecycle **status**, a
**generalized internal-links** set, and **knowledge-transfer notes** — all riding the
public/private projection and `@bu.edu` auth that already exist. No new infrastructure,
no automation, no new routes.

## What already exists (do not rebuild)

- **Public catalog fields:** `title`, `blurb`, `partner`, `clientType`, program facet,
  `tech[]`, `images[]`, `runs[]` (term/course/discipline), `repoUrl`, `prodUrl`.
- **Public/private projection:** `rowToProject(r, includePrivate)` already strips
  admin-only fields (students, team IDs, `contacts`, roles, `pdUrl`, `driveUrl`,
  `techNote`) from public reads. This is the exact mechanism Phase 1 gating reuses.
- **Operational seeds (admin-only):** `contacts[]` (name+email), per-semester team roles
  (`pm`, `tpm`, `seniorAdvisor`, `techAdvisor`, `eir`, `classInstructors`,
  `sparkProgramLead`), `driveUrl` (Google Drive), `pdUrl` (PD doc), `techNote`,
  `Contributor` records (per-semester student name/GitHub/BU email).
- **Auth:** Auth.js Google OAuth, `@bu.edu` allowlist (currently admin-tier only).
- **Derived:** "Last active semester" = `semesterRank()` over `runs[]`. No new field.

These are left untouched in Phase 1. They MAY be folded into the generalized `links` model
in a later cleanup, but Phase 1 does not churn them.

## Design — three additive storage changes

A single migration script `scripts/migrate-project-hub.ts` (mirrors the existing
`scripts/migrate-*.ts` pattern; `ALTER TABLE projects ADD COLUMN IF NOT EXISTS …`, run
against the live DB, idempotent) adds:

### 1. `status text` (nullable)
App-constrained lifecycle value, one of:
`active`, `paused`, `archived`, `needs-maintenance`, `candidate-for-revival`.

- A real column (not JSONB) because we will filter/badge on it and may add a status facet.
- `null` = unset (treated as "no badge" publicly; shown as "—" in admin).

**Public visibility (decision: public-simplified):**

| Stored status | Public badge | Internal (admin) display |
|---|---|---|
| `active` | "Active" | Active |
| `archived` | "Archived" | Archived |
| `paused` | *(no badge)* | Paused |
| `needs-maintenance` | *(no badge)* | Needs maintenance |
| `candidate-for-revival` | *(no badge)* | Candidate for revival |

Implemented as a pure helper `publicStatus(status)` → `"Active" | "Archived" | null`.
The public projection sends only the mapped value; the raw status never reaches public HTML.

### 2. `links jsonb` (default `'[]'`)
Array of typed links:

```ts
interface ProjectLink {
  kind: string;     // "repo" | "docs" | "api-docs" | "architecture" | "design"
                    // | "figma" | "data-source" | "dashboard" | "monitoring"
                    // | "slack" | "drive" | "wiki" | "meeting" | "staging"
                    // | "demo" | "other"  (open-ended; UI offers a known set)
  label: string;    // human label, e.g. "Frontend repo"
  url: string;      // validated http(s) on write
  internal: boolean; // true = operational, gated; false = public
}
```

- Subsumes every open-ended link the vision lists (Slack, Figma, docs, API docs,
  architecture, design docs, data sources, dashboards/monitoring, **multiple repos**,
  **staging URL**, wiki, meeting links) in one column — adding a new `kind` is data, not a
  migration. This satisfies the "extensible without redesign" principle.
- `repoUrl` / `prodUrl` remain the **primary public** repo + demo (back-compat, existing
  buttons unchanged). Additional/secondary repos and staging URLs go in `links`.

**Public visibility:** public reads filter `links` to `internal === false` only.

**Validation (on write, server-side):**
- `url` must match `^https?://`; reject otherwise (blocks `javascript:` and similar).
- `kind` coerced to a known value or `"other"`.
- `label` trimmed, non-empty (fallback to a humanized `kind`).
- Cap array length (e.g. ≤ 40) to bound payload.

### 3. `knowledge jsonb` (default `'{}'`)
Knowledge-transfer free-text, **wholly internal** (never in public projection):

```ts
interface ProjectKnowledge {
  restart?: string;      // "How to restart this project" — the headline field
  knownIssues?: string;  // known issues / bugs
  futureNotes?: string;  // notes for future teams
  deployNotes?: string;  // deployment notes
  maintenance?: string;  // maintenance checklist / tech debt
}
```

- Plain text (or light markdown rendered safely) — no rich-text editor in Phase 1.
- Deferred to Phase 3: infra config (`ops jsonb`: deployment env, server, k8s namespace,
  container registry, env notes). Nothing consumes it until automation exists — YAGNI.

## Data flow & visibility (the gating contract)

All three fields flow through the existing field path. The **single source of truth for
gating** is `rowToProject(r, includePrivate)`:

- `includePrivate === false` (public reads — `getProjects`, `getProject`):
  - `status` → replaced by `publicStatus(r.status)` (`"Active" | "Archived" | null`).
  - `links` → filtered to `internal === false`.
  - `knowledge` → omitted entirely.
- `includePrivate === true` (admin reads): all raw values included.

This mirrors how students/contacts/roles are already stripped — one chokepoint, no leak
surface scattered across components.

## UI

**IMPORTANT (verified against code):** the public detail page
`app/projects/[slug]/page.tsx` calls the **cached, public-only `getProject()`** and passes
`ProjectView` only `{ project }` — it has **no session and no admin data**. We deliberately
do NOT add auth + an uncached admin read into that route in Phase 1 (it would entangle the
`unstable_cache` public path). Instead:

**Public project page (`ProjectView.tsx`) — public data only:**
- Optional status badge near the title when `publicStatus` is non-null (reuse existing
  badge styling; "Active" = accent, "Archived" = muted).
- Public links (`internal:false`) rendered alongside the existing repo/demo buttons,
  grouped sensibly (e.g. a "Links" block).
- Receives no new props beyond the (now hub-aware) public `Project`.

**Operations section lives on the EXISTING admin detail page
(`app/admin/projects/[id]/page.tsx`):**
- That page is already under the `/admin/*` middleware auth gate, already reads via
  `getProjectAdmin()` (full record), and already renders an "Admin only" zone — it is the
  natural, zero-new-auth home for the Operations section in Phase 1.
- Shows: full status, internal links grouped by kind, and the `knowledge` blocks with
  **"How to restart this project"** as the headline.
- Phase 2 (team-member tier) later promotes this section onto the main project page for
  logged-in members; Phase 1 keeps it admin-only and avoids touching the public route's auth.

**Admin edit form (`app/admin/edit/[id]/page.tsx`):**
- Status `<select>` (the five values + "unset").
- Repeatable links editor: rows of `{ kind select, label, url, internal toggle }`; reuse
  the form's existing `urlOk()` validator for the url cells.
- Five textareas for the `knowledge` fields.
- Mechanical extension of the flat `form` state: interface (~L152), load-map (~L506),
  save-payload (~L697), plus the new inputs.

## Threading checklist (the standard column-add path — verified)

1. `lib/db.ts` — `ProjectRow` interface (+ `status`, `links`, `knowledge`).
2. `lib/db.ts` — `COLS` string (add the three columns).
3. `lib/db.ts` — `rowToProject` (map + the gating described above; this is the one chokepoint).
4. `lib/types.ts` — `Project` (+ `status`, `links: ProjectLink[]`, `knowledge`),
   plus the new `ProjectLink` / `ProjectKnowledge` interfaces and a `ProjectStatus` union.
5. `lib/db.ts` — `ProjectPatch` (+ the three fields) and the `add()`-based UPDATE builder
   (JSONB fields use the `::jsonb` cast like `contacts`/`runs`).
6. `app/api/projects/[id]/route.ts` — accept + validate the new fields on PATCH (scheme-check
   link urls; coerce `kind`; clamp `links` length; revalidateTag already present).
7. `app/admin/edit/[id]/page.tsx` — form inputs for status / links / knowledge (see above).
8. `components/ProjectView.tsx` — public status badge + public (`internal:false`) links ONLY.
9. `app/admin/projects/[id]/page.tsx` — the gated **Operations section** (full status,
   internal links, knowledge). *(This replaces the spec's earlier "gated section on the
   public page" — see IMPORTANT note above.)*
10. **Merge path** — `MergeResolution` (`lib/db.ts`) + `components/admin/MergeProjectsModal.tsx`:
    add `status` as a scalar winner; decide `knowledge` merge (field-wise, survivor wins
    blanks); `links` auto-combines (concat + dedupe by url, like `images`).
11. `scripts/migrate-project-hub.ts` — the idempotent `ADD COLUMN IF NOT EXISTS` migration.

**Minor / no-op touchpoints (acknowledge, don't over-build):**
- `app/admin/new/page.tsx` (new-project form) — new fields can be omitted at creation and
  curated later via edit; add them only if quick.
- `app/api/import` (PD sync) — builds `ProjectPatch` from the importer; it will simply not
  set the three hub fields, which is correct (they're hand-curated, not imported).

## Risks & edge cases (self-scrutiny)

- **Leak risk:** the entire privacy guarantee rests on `rowToProject` gating. Add a test
  asserting a public read of a project with internal links + knowledge returns no
  `knowledge`, no `internal:true` links, and only the mapped `publicStatus`. (Pairs with
  the existing public-projection tests.)
- **Stored XSS via links/notes:** URLs are user-entered. Validate scheme on write
  (`https?:` only), and render notes as plain text or sanitized markdown — never inject raw
  user HTML into the DOM.
- **Open redirect / link trust:** public links point off-site; render with
  `rel="noopener noreferrer"` and treat as untrusted.
- **Status as visibility confusion:** `status` is lifecycle, NOT publication. `published`
  still controls whether a project appears at all. An `archived` project can still be
  `published` (visible, badged "Archived"); an unpublished draft is hidden regardless of
  status. Document this in the form copy.
- **`null` vs `active`:** unset status shows no public badge — intentional, so legacy
  projects aren't mass-labeled "Active" until someone curates them.
- **Payload size:** cap `links` length; `knowledge` is admin-only so it never bloats the
  public cache. Public projection already omits it.
- **Caching:** `getProjects`/`getProject` are `unstable_cache` tagged `"projects"`; the
  admin PATCH must `revalidateTag("projects")` (existing pattern) so status/link edits
  show immediately.
- **Migration idempotency:** `ADD COLUMN IF NOT EXISTS` + JSONB defaults so re-runs and
  partial deploys are safe; back-compat with rows that predate the columns (treat missing
  as `null` / `[]` / `{}`).

## Out of scope (later phases)

- **Phase 2 — team-member auth tier:** widen the Operations gate from admin-only to
  "admin OR member of this project," resolving a signed-in `@bu.edu` user to projects via
  `Contributor.email` / `Person.email`. Blocked on contributor/person email completeness
  (current data is partial) — pairs with the data-rollout work.
- **Phase 3 — deployment & automation:** present approved actions (redeploy/restart/
  migrate/health) backed by an external automation platform (GHA/AWX/Semaphore) that owns
  secrets, playbooks, execution, audit. Adds `ops jsonb` for infra config.
- **Future:** GitHub sync, commit/PR/CI feeds, AI assistant, full-text doc search,
  templates, dependency viz, handoff reports.

## Success criteria (Phase 1)

- An admin can set a project's status, add public + internal links of any kind, and write
  the five knowledge-transfer notes from the edit form.
- A public visitor sees only: a simplified status badge (Active/Archived/none) and public
  links — never internal links or knowledge text (asserted by test).
- An authenticated admin sees the full Operations section, with "How to restart this
  project" prominent, on both active and archived projects.
- The migration is idempotent and safe to re-run on the live DB.
