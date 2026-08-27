# spine — shared schema & data model

The integration point for the whole program: the project metadata schema, lifecycle
states, and type taxonomy every initiative reads from and writes to. **Minimal
integration = shared schema, not shared code** — coordinate changes here.

_Status: partially decided. Vocabularies are settled and in production; the
relational model is not._

## What is decided

[`vocabularies.md`](vocabularies.md) — the three project axes and the topic taxonomy.
These are **not proposals**. They are live in `hub/`, applied to 170 projects, and
carry rationale for why each shape was chosen over the obvious alternative. Any
initiative reading or writing project state should speak these values.

## What is not decided

[`open-decisions.md`](open-decisions.md) — five questions that must be answered
before the relational model is written, each with the evidence for both sides. Two
of them describe a **live contradiction** between what `Database++/ARCHITECTURE.md`
mandates and what `hub/` actually ships, so they are not academic.

## Prior art

`../Database++/` (a separate working repo) holds the earlier conceptualisation:
`ARCHITECTURE.md` (identity resolution, ingestion, PII boundary),
`PRIOR-ART-RECONCILIATION.md`, and a legacy CRM schema. It is worth reading and is
NOT superseded wholesale — but see `open-decisions.md` before implementing from it
literally. Three specific things in it are stale relative to production, and one of
its file-tree assumptions is inverted.
