# spark-portfolio

**One program, one monorepo.** A shared `spine/` (the project schema + data model
everything reads from and writes to) plus one subdirectory per initiative. Your code
lives in your subdirectory; coordinate on the spine, own your implementation. If your
piece currently lives on Vercel, in Drive, or in a personal repo — it moves in here.

## Layout
- `spine/` — shared schema & data model (the contract everything speaks to) — **start here**
- `atlas/` — **the project portfolio** — the showcase site (past = public, active = staff).
  Called `hub/` until 2026-08; renamed because Atlas is the project's actual name and
  `hub/` now means something else.
- `hub/` — the Spark! link-in-bio landing page: one static page of links out to
  everything else (programs, bounties, portfolio, socials)
- `drive-walker/` — Shared Drive walker + archiver / item reduction
- `semantic-extraction/` — taxonomy + theme index

_Coming later: `intake-chatbot/`, `completeness-reviewers/`._

## Working here
- One program: pieces are independent to build but integrate **through the spine**.
- Read `spine/` before extending your piece's data model.
- Subdir names aren't final — confirm yours if it doesn't fit.
