# spark-portfolio

**One program, one monorepo.** A shared `spine/` (the project schema + data model
everything reads from and writes to) plus one subdirectory per initiative. Your code
lives in your subdirectory; coordinate on the spine, own your implementation. If your
piece currently lives on Vercel, in Drive, or in a personal repo — it moves in here.

## Layout
- `spine/` — shared schema & data model (the contract everything speaks to) — **start here**
- `hub/` — the project showcase website (past = public, active = staff)
- `drive-walker/` — Shared Drive walker + archiver / item reduction
- `semantic-extraction/` — taxonomy + theme index

_Coming later: `intake-chatbot/`, `completeness-reviewers/`._

## Working here
- One program: pieces are independent to build but integrate **through the spine**.
- Read `spine/` before extending your piece's data model.
- Subdir names aren't final — confirm yours if it doesn't fit.
