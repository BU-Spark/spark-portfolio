# Admin Dashboard — Design Brief

A visual-refresh brief for the BU Spark! Project Gallery admin dashboard (`/admin`).
Hand this to a design tool to propose a polished new look that stays faithful to the
existing codebase. The current dashboard works and is wired to a live backend — this
is a **visual** refresh, not a re-architecture.

---

## 1. Purpose

The admin dashboard is the home screen for **BU Spark! staff** (program leads, PMs,
TPMs, and the gallery maintainers — all `@bu.edu` Google accounts on an allowlist).
Everything published here writes to a shared live database and appears on the public
gallery (sparkshowcase.vercel.app) immediately, so the dashboard's job is to give
staff a fast, trustworthy at-a-glance read on the catalog's health — how many projects
exist, how many are published vs. draft, and which ones are missing required info — and
to be the launchpad into every admin task (add a project, manage the catalog, curate
people, work the import inbox, run screenshot outreach, review uploads, manage admins,
and edit gallery settings).

---

## 2. Current visual system (design tokens — keep these)

The entire app is styled with **inline React `style` objects** plus a handful of
shared CSS classes in `app/globals.css`. **There is no Tailwind or CSS framework, and
the designer should not introduce one.** Propose visuals as inline-style values and,
where a shared primitive is needed, as small additions to `globals.css`.

**Fonts** (loaded via `next/font` in `app/layout.tsx`, exposed as CSS variables):
- `var(--display)` → **Space Grotesk** — headings, stat numbers, card titles, brand.
- `var(--body)` → **IBM Plex Sans** — body copy, descriptions, inputs.
- `var(--mono)` → **IBM Plex Mono** — eyebrows, labels, counts, badges, "Edit →" links.
  Mono labels are typically uppercase with wide tracking (`letterSpacing: 0.08–0.12em`).

**Color**
- Accent: `#0fa392` (teal). Used for links, badges, primary-card tint, focus ring.
  Tints are mixed via `color-mix(in oklab, #0fa392 N%, #fff/#000)`.
- Page background: `#f4f5f4`.
- Card / surface background: `#fff`.
- Dark header bar: `#0e1211`; its nav links are `#c2c8c5`, the `/ admin` sub-label `#8c948f`.
- Primary text: `#16191c`. Secondary text: `#6a6f74`. Muted/meta: `#8a8a8a` / `#9a9a9a`.
- Borders: `#e6e6e6` (cards), `#f1f1f1` (row separators), `#d8d8d8` (inputs/buttons).
- "Needs info" / draft warning palette: amber `#fbbf24` (dot), text `#9a6a00` on
  `#fbf0d6`/`#fdf3dd` with `#f0dba6`/`#f3e2b3` borders. The "Needs info" stat number
  turns `#9a6a00` when > 0.
- Selection highlight: `rgba(15,163,146,0.25)`. Error/toast-error: `#b3261e`.

**Shape & spacing**
- Cards: `border-radius: 12`, `1px solid #e6e6e6`, padding ~`20–24px`.
- Buttons/inputs: `border-radius: 6–7`; shared `.fld` input primitive (focus border → accent).
- Content column: `max-width: 1080px`, centered, `padding: 0 32px`; dark header is `64px` tall.
  (Note: the public gallery uses a wider `1340px` column — see §5.)
- Toasts: dark `#0e1211` pill, fixed top-center, `box-shadow: 0 8px 30px rgba(0,0,0,0.25)`.
- Motion is subtle (`globals.css`): card hover lifts `translateY(-3px)` + soft shadow;
  rows hover to `#f7f9f8`. A `prefers-reduced-motion` block disables transforms.

---

## 3. Dashboard anatomy (`app/admin/page.tsx`, top → bottom)

1. **Dark header bar** (`#0e1211`, full-width, 64px). Left: brand "BU Spark!" in
   Space Grotesk 19px + a mono `/ admin` sub-label. Right: nav links (`#c2c8c5`, 13.5px) —
   **Manage projects** (`/admin/projects`), **People** (`/admin/people`), **Inbox**
   (`/admin/inbox`, with a teal pill **count badge** of pending import rows), **Bulk
   uploads** (`/admin/bulk-uploads`), **← Gallery** (`/`), and a bordered **Sign out**
   button (signs out to `/admin/login`).

2. **Welcome / title area.** `h1` "Dashboard" (Space Grotesk 30px) + one line of body
   copy: "An overview of the Spark! project gallery. Everything you publish here is
   saved to the shared live database and visible to every visitor immediately."

3. **Stat cards** — a responsive grid (`auto-fit, minmax(150px, 1fr)`) of 6 white cards.
   Each shows a big Space Grotesk number (34px) over a mono uppercase label. Values are
   derived client-side from `GET /api/projects`:
   - **Total projects** → links to `/admin/projects`
   - **Published** → `/admin/projects`
   - **Drafts** (unpublished) → `/admin/projects`
   - **Needs info** (any of: missing description, tech stack, repo, or images) → `/admin/projects`;
     number turns amber when > 0
   - **No description** (no stat link)
   - **No images** (no stat link)

4. **Quick-action cards** — a "QUICK ACTIONS" mono eyebrow, then a responsive grid
   (`auto-fit, minmax(240px, 1fr)`) of 8 cards. Each card is a Space Grotesk title with
   a teal `→`, plus a one-line description. The first is the **primary** card (teal-tinted
   background + teal-tinted border):
   - **Add a project** *(primary)* → `/admin/new` — "Create a new project and publish it to the gallery (or save a draft)."
   - **Manage projects** → `/admin/projects` — "Search the full catalog to edit, hide, or remove any project."
   - **People directory** → `/admin/people` — "Curate leads, PMs, TPMs, and advisors across every project."
   - **Import inbox** → `/admin/inbox` — "Review imported submissions waiting to be added to the gallery."
   - **Bulk screenshot uploads** → `/admin/bulk-uploads` — "Send PMs scoped links to upload project screenshots without logging in."
   - **Review uploads** → `/admin/uploads` — "Approve or reject screenshots PMs submitted via magic links."
   - **Manage admins** → `/admin/users` — "Add, reset, or remove who can sign in to the admin."
   - **Settings** → `/admin/settings` — "Edit the gallery taxonomy (disciplines, client types) and sidebar facets."

5. **"Needs attention" list** — a white card. Header row: "Needs attention" (Space
   Grotesk 16px) + a mono teal "Manage all →" link to `/admin/projects`. Body lists the
   **first ~5 projects** that are missing info (`missingInfo(p)`), each row being a link
   to `/admin/edit/{id}` with: an amber `!` dot, the project title (+ a "Draft" pill when
   unpublished), a mono meta line (`primary discipline · latest term · missing <fields>`),
   and a teal "Edit →" affordance. **States:** while loading → "Loading…"; when nothing
   is wrong → "Every project has its description, tech stack, repo, and images. Nothing
   to fix right now."

---

## 4. Where the cards link (destination pages — one line each)

- **`/admin/projects`** — searchable catalog manager: search box + All / Published /
  Drafts / Needs-info tabs + Program-Lead/PM/TPM role filters; per-row Edit, Show/Hide
  (publish toggle), and Remove.
- **`/admin/people`** — admin-only people directory: staff who appear in project team
  roles; edit each person's email + name aliases and merge duplicate people (PII, never public).
- **`/admin/inbox`** — import inbox: PD-sync tracker rows the importer couldn't auto-match;
  per row Create / Merge (writes a durable alias) / Dismiss / Undo — the data-integrity backstop.
- **`/admin/bulk-uploads`** — bulk screenshot outreach: lists projects missing screenshots,
  resolves each PM's email, and batch-generates magic-upload links (auto-emails when configured).
- **`/admin/new`** — the add-a-project form: full project record + S3 image slots + PD-blurb fetch;
  publish or save as draft.
- **`/admin/uploads`** — review queue for PM-submitted screenshots: pick the final set (≤4) and
  Approve (writes to project, goes live) or Reject (re-opens the link with a note).
- **`/admin/users`** — manage admins: list, add/reset by email + password, and remove who can sign in.
- **`/admin/settings`** — gallery settings: edit the discipline + client-type vocabularies and choose
  which facet groups appear in the public sidebar.

---

## 5. The public visual language to match (`app/page.tsx` → `components/Gallery.tsx`)

The public gallery is the polished face of the product; the admin should feel like its
back-of-house twin. Shared cues the refresh should echo:
- Same font pairing and accent `#0fa392`; same mono eyebrows (uppercase, wide tracking).
- White surfaces on a light ground; project cards use `border-radius`, `1px` light borders,
  and the `.spark-card-a` hover lift (`translateY(-3px)` + soft shadow).
- A big Space Grotesk hero headline (`clamp(30px, 4vw, 46px)`, `letterSpacing: -0.02em`) over
  a muted body subhead — the dashboard's title block is a calmer version of this.
- Teal pill count badges (`border-radius: 999`) and small `#f1f2f1` mono chips.
- The gallery content column is wider (`max-width: 1340px`) than the admin's `1080px`;
  the designer may align these but should do so deliberately.

---

## 6. Design goals / what to improve

Keep the inline-style approach and all tokens in §2. Propose visuals, not a framework.

- **Cohesion with the public gallery.** Make `/admin` read as the same product family as
  the gallery — shared hero treatment, card hover, badge and chip language (§5).
- **Clearer hierarchy.** Today stat cards, action cards, and the attention list are three
  flat grids of similar weight. Establish an obvious primary focus (catalog health + what
  needs fixing) and let secondary navigation recede.
- **More scannable stats.** The 6 stat cards mix "good" totals (Total/Published) with
  "to-do" counts (Drafts, Needs info, No description, No images). Consider grouping or
  visually distinguishing healthy metrics from action-needed ones, and give the amber
  "Needs info" state more presence without being alarming. (Note: "No description" and
  "No images" currently aren't clickable — making them link to a filtered view would help.)
- **Better empty / loading states.** The "Needs attention" list has only a plain "Loading…"
  and a text "all clear" state; design proper skeletons and a positive, branded empty state.
  The all-clear case is a celebratory moment worth designing for.
- **A more distinct primary action.** "Add a project" is the primary card but is only
  lightly tinted; strengthen the primary-vs-secondary action contrast.
- **Header polish.** The dark `#0e1211` bar is shared across all admin pages — any nav
  refinement should generalize cleanly to the destination pages in §4.

Constraints: do not surface students or team IDs anywhere (admin-only data stays admin-only);
keep the `1080px` admin column unless intentionally aligning to the gallery's `1340px`;
preserve `prefers-reduced-motion` behavior.
