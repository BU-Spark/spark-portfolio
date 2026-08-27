# spine — open decisions

Five questions that must be answered before the relational model is written. Each has
evidence on both sides. Two are **live contradictions** between what
`Database++/ARCHITECTURE.md` mandates and what `hub/` ships today, so deciding them
late means migrating data, not just editing a doc.

Ordered by cost of getting it wrong.

---

## 1. Term on the role edge — LIVE CONTRADICTION

**Database++ forbids it.** `ARCHITECTURE.md:96-98`: a role assignment's term must
derive from its `project_instance → semester`, so "there is no term column on the
edge to contradict it."

**hub does exactly that.** `schema.sql:68` — `person_roles.term text`.

**Why it matters, concretely.** With term on the edge, "no term" is a representable
state that means nothing. `granite-traffic` currently has a PM role row with
`term = ''` alongside two properly-termed ones — a leftover from an earlier import
that no query can interpret. Under the derived model that row could not exist: no
instance, no edge.

**The cost of deferring.** Every reconciliation pass written against hub keys on
`(project_id, term, role)`. Changing the model later means migrating every
`person_roles` row and rewriting those passes.

**Decide:** normalize into `project_instances` + `semesters`, or accept term-on-edge
and add a NOT NULL + non-empty constraint so the meaningless state stops being
representable.

---

## 2. Categoricals: CHECK constraint vs lookup table — LIVE CONTRADICTION

**Database++ mandates lookup tables.** `ARCHITECTURE.md:76-77`: "lookup tables with
FK, not Postgres ENUMs… a new role is a row, not an ALTER TYPE."

**hub uses `text` + CHECK.** `schema.sql:137-138`.

**Evidence from practice.** hub has now widened a CHECK twice (adding `in_review`,
adding `restricted`). Both required drop-and-recreate, and both needed an explicit
warning that a `pg_constraint` guard would silently skip and leave the database
rejecting a valid value. That is real friction, twice — which is the argument
Database++ was making.

**Counter-evidence.** The CHECK is enforced by the database with no join, is visible
in one file, and has caught bad values in testing. A lookup table moves the
vocabulary into data, where it can drift per-environment and cannot be reviewed in a
diff.

**Decide:** keep CHECK for small closed sets (status, visibility) and use lookup
tables only for genuinely open ones (roles, course codes) — or go uniformly one way.
A split rule is defensible but must be written down, or the next person picks by coin
flip.

---

## 3. Free-text term and course — the mess this is already causing

hub stores term as free text in at least four places: `contributors.term`,
`person_roles.term`, `projects.blurb_term`, `import_inbox.term`. Course likewise, per
run.

**Observed damage.** The same journalism course appears as `JMCL` in the tracker,
`XC473` in most DB runs, and `XC410` in one. One project is `DS488` while its five
siblings are `DS488/688`. A cross-check of the tracker against the DB could not join
on course at all and had to alias the codes by hand.

Database++ proposes `semesters` and `courses` as first-class tables
(`ARCHITECTURE.md:111-122`), with `PRIOR-ART-RECONCILIATION.md:94-99` resolving to
keep `semesters` as the academic anchor over a generic `timeframe`.

**Decide:** this one looks like a straightforward yes. The question is only whether
it happens before or after #1, since a `semesters` table is a prerequisite for
deriving term from an instance.

---

## 4. Identity resolution — a gap hub never filled

Database++ designs `person_identities` (multi-key: bu_email / personal_email /
airtable_rec / alias) and a `merge_queue` (`ARCHITECTURE.md:133-141`, §3.5). hub has
`people.name_key` + `aliases text[]` and nothing else.

**Evidence this is needed, not speculative.** Four duplicate person records were
found and merged by hand in a single session — `Maddie Jin`/`Madelyn Jin`,
`Maxine Yu`/`Xinxin Yu`, `Gary Huang`/`Shengqin (Gary) Huang`,
`Herbert Zhang`/`Jiahe (Herbert) Zhang`. Every pair was detectable by **shared
email**, which is precisely what `person_identities` indexes and `people.email`
cannot.

Worse, name collision runs the other way too: `Maddie Jin` and `Madison Marchionna`
are *different people* who both answer to "Maddie", and five project role values
reading `Maddie`/`Madison` still cannot be attributed without reading a PD doc.

**Decide:** adopt `person_identities` + `merge_queue` roughly as designed. This is the
strongest port candidate in the whole prior-art set.

---

## 5. Intake / proposal layer — explicitly unresolved in the source docs

`PRIOR-ART-RECONCILIATION.md:79-92` leaves this open: does the model need an
intake/proposal layer above project instances (the legacy CRM's
`project → child_application → child_project → child_project_timeframe`), or does
`projects` stay execution-only?

This changes the shape of the `projects` table itself, so it should be decided before
that table is locked rather than discovered mid-migration.

**Context from hub.** hub already has a partial answer it did not intend: the
`import_inbox` table holds tracker rows that matched no project — effectively a
pre-project staging area — and `project_suggestions` stages proposed metadata.
Neither is a proposal *pipeline*, but both suggest the shape is wanted.

---

## Also: two stale assumptions in the prior art

Not decisions, just corrections for anyone reading `ARCHITECTURE.md` literally.

- **Repo layout is inverted.** `ARCHITECTURE.md:515-552` designs Database++ as its own
  top-level monorepo with the showcase migrated in as `apps/showcase`. Reality: spine
  is a subdirectory inside `spark-portfolio`, alongside `hub/`. Do not follow its file
  tree.
- **`v_public_projects` is moot.** Described as a migration scaffold for a
  JSONB-runs-to-relational transition. hub's public filtering is live application
  logic; there is no such migration in progress.

## What is NOT open

Status, visibility and the topic taxonomy. Database++ never decided them — they are
open questions at `DISCOVERY.md:43-44` and `:47-48` — and hub has since decided all
three with rationale and shipped them across 170 projects. See `vocabularies.md`.
Re-deriving them from the prior art would be a regression, not a design step.
