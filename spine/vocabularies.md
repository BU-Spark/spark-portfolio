# spine — decided vocabularies

Live in production, applied across 170 projects. Any initiative that reads or writes
project state should use these exact values.

Source of truth today: `hub/lib/data.ts`, mirrored by CHECK constraints in
`hub/schema.sql`. When spine gets its own storage these move here; until then, hub is
the implementation and this file is the contract.

## Three independent axes on a project

Never derive one from another. This has already caused one near-miss in hub
(`surfaces` was almost used as an edit boundary) and is the reason `status` exists as
a separate column.

| Axis | Column | Question it answers |
|---|---|---|
| Authority | `owner_org` | which team may edit it |
| Visibility | `visibility` | who can see it |
| Pipeline | `status` | where the work actually is |

A project can be `complete` but unpublished, or `active` and public. Collapsing
pipeline state into a publish flag is what made the previous model unable to answer
"what is in flight right now".

## `status` — pipeline

`pending` → `active` → `in_review` → `complete`

- **pending** — scoped, not yet worked on
- **active** — being worked on, no completion claimed
- **in_review** — a completion was submitted and it did NOT pass the automated checks
- **complete** — submitted and passed

`in_review` exists because neither neighbour can describe a bounced submission.
`pending` means "nobody started", so reusing it erases the difference between
unstarted work and work someone believes is finished. `active` means "in progress"
and loses the fact that a claim was made and rejected — which is the part a
supervisor needs.

Written by exactly one thing: the PD-completion webhook, on a failed submission.

`Database++/DISCOVERY.md:43-44` lists lifecycle stages as an **open question**
(`idea → scoped → matched → active → completed → archived?`). It was never decided
there. This is the decided model; adopt it rather than re-deriving one.

## `visibility` — who can see it

`hidden` → `restricted` → `internal` → `public` (least to most visible)

- **hidden** — draft, not finished. Admin only
- **restricted** — finished, deliberately closed. Admin only
- **internal** — cleared for the BU community. Any signed-in `@bu.edu` account
- **public** — everyone

`restricted` and `hidden` are both closed to BU viewers; they differ in what they say
about the *work*, not about who may see it. The distinction matters because some
project work is client-confidential and must never be BU-wide even when finished.

**The gallery is opt-in.** Public reads filter `visibility = 'public'` — never
`<> 'hidden'`, which would leak every internal project to anonymous visitors.

⚠️ `ARCHITECTURE.md:194` still shows `projects.published boolean`. That column is
deprecated in hub — kept only as a dual-write for rollback safety and derived from
`visibility`. **Do not implement the boolean.** Anyone building from that schema
block literally would reintroduce what hub already split into an enum.

## Topic taxonomy

Eleven subject-matter groupings, one per project:

```
Housing & Urban Development                 Health, Medicine & Wellbeing
Government, Politics & Public Policy        Environment & Sustainability
Criminal Justice & Public Safety            Law & Civil Rights
Education & Learning                        Media, Technology & Communication
Immigration, Community & Social Services    Arts, Culture & Humanities
Business, Economy & Work
```

Replaced an earlier 18-term set that had overlapping pairs an editor had to choose
between arbitrarily (Housing vs Community Development, Public Safety vs Criminal
Justice, Environment & Climate vs Sustainability). A facet whose terms are not
mutually exclusive splits one project across two filters, so both look sparse and
neither is trustworthy.

Validated against the real catalogue: 144 of 170 projects tagged, every term in use,
no dumping ground. Editorial decisions embedded in it, worth preserving:

- **Transit is urban infrastructure**, filed under Housing & Urban Development
  (bus delay, commuter rail, bike infrastructure). No separate Transportation term.
- **Biodiversity/archival work is environmental**, not humanities.
- **Media, Technology & Communication is for projects ABOUT media and information
  access** — journalism, platforms, bias analysis. Not for anything built with code,
  which is nearly everything.

Distinct from **discipline** (SE/DS/ML/UX/DataViz), which is a per-run property, not
a subject. `Database++/DISCOVERY.md:47-48` treats disciplines as an open question and
the legacy `project_type` table lists them; neither is a subject taxonomy.

## Storage note

Categoricals are `text` + a CHECK constraint, not Postgres ENUMs. Widening one is
therefore a **drop-and-recreate**, never an add-if-absent — a `pg_constraint` guard
finds the narrow constraint, skips, and leaves the database rejecting a value the
application thinks is valid. That failure is invisible until the first write.

`ARCHITECTURE.md:76-77` mandates lookup tables with FKs instead, for exactly this
rigidity. That disagreement is unresolved — see `open-decisions.md` #1.
