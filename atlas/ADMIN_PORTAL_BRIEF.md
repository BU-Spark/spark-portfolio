# BU Spark! Admin Portal — Full Redesign Brief

You are redesigning the **admin portal** of the BU Spark! Project Gallery — a Next.js
(App Router) + React + TypeScript app. Propose a polished, cohesive **visual** redesign of
every page below. Keep all functionality, routes, data, and field names; do not remove
features. Each page section gives you the *purpose*, the *content/actions that must
survive*, and the *states* to handle — then design the layout freely. (We've deliberately
not described the current layouts pixel-by-pixel; don't reproduce them, improve on them.)

## Hard design constraints (keep these)
- **Styling is inline React `style` objects only — NO Tailwind/CSS framework.** Propose
  visuals as inline styles or small additions to a shared `globals.css`. Do not introduce
  a CSS framework or component library.
- **Fonts** (CSS vars): `var(--display)` Space Grotesk (headings, numbers, brand),
  `var(--body)` IBM Plex Sans (body, inputs), `var(--mono)` IBM Plex Mono (eyebrows,
  labels, counts, badges — usually uppercase, wide tracking).
- **Color tokens:** accent `#0fa392` (teal); page bg `#f4f5f4`; cards `#fff` with
  `#e6e6e6` borders + 12–14px radius; dark header bar `#0e1211` (64px tall); text
  `#16191c`/`#6a6f74`/`#9a9a9a`; dividers `#f1f1f1`; inputs/buttons `#d8d8d8`; amber warn
  `#9a6a00` on `#fbf0d6`/`#fdf3dd`; error/destructive `#b3261e`. Tints via
  `color-mix(in oklab, #0fa392 N%, #fff/#000)`.
- **Layout:** centered column (1080px admin / 1340px public gallery), 32px gutters. Motion
  is subtle (card hover lift, row hover tint); preserve `prefers-reduced-motion`.
- The admin must feel cohesive with the polished **public gallery** (same type scale +
  accent, white surfaces on light ground, mono eyebrows, teal `999px` pill count badges).
  Improve hierarchy, scannability, density, and empty/loading/error states everywhere —
  without changing behavior. Never surface students or Team IDs (admin-only data stays so).

## Shared chrome (applies to every admin page — design it once)
A dark `#0e1211` header bar (64px): left = "BU Spark!" wordmark (Space Grotesk bold, links
to `/admin`) + a mono breadcrumb `/ admin / <page>`; right = page-relevant nav links
(Manage projects, People, Inbox, Bulk uploads, etc.) + a ghost **Sign out** button (signs
out to `/admin/login`). The Inbox link carries a teal pill badge with the pending-row count
when > 0. A toast (fixed top-center, dark pill for success / `#b3261e` for error, auto-
dismiss ~4.2s) confirms actions. All pages sit behind a `@bu.edu` Google-OAuth gate. **The
login page is the one exception — it has no header/nav.** Design this chrome once; every
page below assumes it and only specifies its own body.

## Routes covered
`/admin` (dashboard), `/admin/new`, `/admin/projects`, `/admin/projects/[id]`,
`/admin/edit/[id]`, `/admin/people`, `/admin/inbox`, `/admin/bulk-uploads`,
`/admin/uploads`, `/admin/users`, `/admin/settings`, `/admin/login`.

---

## Dashboard — `/admin`

**Purpose:** The staff home screen. A fast, trustworthy at-a-glance read on catalog health
(how many projects exist, published vs. draft, which are missing required info) and the
launchpad into every admin task.

**Must include:**
- A title/welcome block noting that everything published writes to the live shared DB and
  appears publicly immediately.
- **Six stat tiles** (values derived from `GET /api/projects`): Total projects, Published,
  Drafts, **Needs info** (missing description / tech / repo / images — amber when > 0), No
  description, No images. Total/Published/Drafts/Needs-info link to `/admin/projects`.
- **Quick-action cards** to every task, with **Add a project** (`/admin/new`) as the visual
  primary: Manage projects, People directory, Import inbox, Bulk screenshot uploads, Review
  uploads, Manage admins, Settings. One-line description each.
- **"Needs attention" list** — first ~5 projects missing info, each linking to
  `/admin/edit/{id}`, showing title (+ Draft marker), a meta line (primary discipline ·
  latest term · which fields are missing).

**States:** loading (skeletons); all-clear empty state for "Needs attention" (a celebratory,
branded moment — "Everything has its description, tech, repo, and images").

**Redesign focus:** Establish clear hierarchy — today stats, actions, and the attention list
are three flat grids of equal weight; make catalog-health + what-needs-fixing the primary
focus and let navigation recede. Visually separate "healthy" metrics (Total/Published) from
"to-do" counts (Drafts/Needs-info/No-description/No-images). Strengthen the primary "Add a
project" action. Make "No description"/"No images" link to filtered views.

---

## Add a Project — `/admin/new`

**Purpose:** Manually create a new project record — all metadata, images, and publish-or-
draft choice.

**Must include (form fields):** Project title* · Short description (with a **PD-doc URL
fetcher** that auto-fills the blurb, and tech tags if empty) · Discipline* · Program ·
Client/partner · Client type · Contact (internal) · Term* · Course* · Project URL (GitHub) ·
Live/production URL · Tech stack (tag input) · Student team (internal, tag input) · Team ID
(internal) · **4 image slots** (cover + 3, drag-or-click upload to S3) · "Publish
immediately" checkbox · primary **Add to gallery** + secondary **Clear**. ( * = required;
discipline/client-type options come from `/api/settings`.)
- A right-rail context panel: gallery status (totals, drafts, "N need info"), recent
  projects with quick edit/show-hide/delete, and a "live database" note.

**States:** required-field validation (disabled submit + "N required fields left"); "Adding…"
in-flight; success toast with a "View →" link; error toast.

**Redesign focus:** Section the long form into labeled groups (Public details · Admin-only
fields · Images · Visibility) instead of one undifferentiated stack. Give admin-only fields a
persistent visual marker. Group the PD-fetch input + blurb textarea as one unit so the
fetch-then-review flow reads clearly.

---

## Manage Projects (list) — `/admin/projects`

**Purpose:** The full catalog browser — search, filter, publish/hide, delete, and the entry
point into each project.

**Must include:**
- A search box (matches title, client, discipline, course, term, and team-role names).
- **Status tabs with counts:** All · Published · Drafts · Needs info.
- **Role filters:** Program Lead / PM / TPM dropdowns (populated from the People directory),
  with a "Clear roles" affordance when active.
- **Project rows** (whole row clicks through to `/admin/projects/{id}`): warning indicator +
  missing-field markers when data is incomplete; title (+ Draft marker); meta line (primary
  discipline · latest term · partner); per-row **Edit →** (`/admin/edit/{id}`), **Show/Hide**
  (publish toggle), and **delete** (with confirm).

**States:** loading; context-aware empty ("No projects match …" vs "No projects").

**Redesign focus:** Show a live result count ("Showing 7 of 42") since tab counts reflect the
full set, not the filtered view. Separate the Draft marker (neutral) from amber data-quality
warnings so they stop competing on the title line. The two row destinations (row click → detail,
Edit → full edit) are invisibly different — clarify them. Make the destructive delete safer
on hover (red) and the near-invisible meta line more legible.

---

## Project Detail (read-only) — `/admin/projects/[id]`

**Purpose:** The canonical single-project view for staff — shows everything the public page
hides (team roles, student contributors, contact, PD/Drive links, tech note, per-run Team
IDs) alongside the public hero content. Audit-before-edit; staff reach it by clicking a list
row. Entirely read-only — all edits live on `/admin/edit/[id]`.

**Must include:**
- **Public-facing block:** image gallery (4 slots, discipline-tinted placeholders when
  empty), discipline label(s), title, status badges (Draft/Published, Featured, Admin-added),
  client block, description, "Where it ran" (runs by term/course/discipline/program, with a
  timeline for multi-term), tech stack, public links (View project / View live).
- **Admin-only section** (clearly marked admin-only): **Team (internal)** — the 6 Spark roles
  present; **Student contributors** — grouped by semester, name + GitHub + email each;
  **Internal fields** — contact, PD doc link, Drive folder link, tech note, and per-run
  student teams + Team IDs.
- A prominent **Edit →** action (and back-to-projects).

**States:** `notFound()` on missing id; per-section empty states (no roles → dash; "No
contributors recorded"; per-run "No students recorded").

**Redesign focus:** Group the three admin-only cards under a single "ADMIN ONLY" divider
instead of repeating an "Admin only" badge on each. Make the Draft state a strong above-the-
fold signal (banner / colored title accent), not a small pill. Distinguish placeholder image
slots from real images so completeness is obvious at a glance. Consider a sticky header so
**Edit →** stays reachable on tall records.

---

## Edit Project — `/admin/edit/[id]`

**Purpose:** Update every field of an existing project and control visibility. The primary
tool for correcting imported data, curating blurbs, uploading images, and managing per-
semester runs.

**Must include:** every field from *Add a Project*, pre-filled, plus —
- **PD-doc fetch** (re-pull blurb/tech), with an "Open PD doc ↗" link when a URL is saved.
- **Drive folder link** (admin-only) with an "Open Drive folder ↗" link when set.
- **Tech-stack note** (admin-only raw PD cell, auto-filled on fetch).
- **Team (internal):** 6 role inputs (Program Lead, PM, TPM, Senior Advisor, Tech Advisor,
  EIR); each resolves to a `mailto:` when the name is in the People directory, else a "no
  email — add in People directory →" link.
- **Student contributors (internal):** an editable table (Term, First, Last, GitHub, BU
  email, remove) with "+ Add contributor" and a **separate** "Save contributors" action
  (saved independently of the main project save). Team can differ per semester.
- **Semester runs:** add/remove run cards (Term*, Course*, Discipline*, Program, Student team,
  Team ID); the last run can't be removed.
- **Visibility toggles:** Featured · Published · **Lock blurb** (a PD re-sync won't overwrite
  a hand-edited blurb).
- Primary **Save changes** + secondary **Cancel**.

**States:** loading; "Project not found" / "Could not load"; "Saving…"; validation (title +
≥1 valid run required); success navigates back to `/admin` (contributor save stays put).

**Redesign focus:** Section the form (Public · Admin-only · Images · Runs · Visibility) — it's
currently one flat card. Mark admin-only fields persistently. Differentiate the two save
buttons so the page-level "Save changes" dominates the secondary "Save contributors." Show the
project's title in the heading so staff know which record they're on. Move "Lock blurb" next
to the blurb it governs. Denser, multi-column Team-role inputs.

---

## People Directory — `/admin/people`

**Purpose:** Admin-only workspace for the staff who appear in project team-role columns.
Attach an email to each person (powers `mailto:` on edit forms) and define aliases that merge
name variants (e.g. "Abby" → "Abby Gualda"). Never public.

**Must include:**
- A search box (name / email / role).
- An inline "N still need an email" data-quality callout.
- **Per-person rows:** canonical name + derived roles + project count; an editable **email**
  field; an editable **aliases** field (comma-separated); a per-row **Save**; and a **merge-
  into-another-person** control (with confirm) that folds this person's name variants into
  the target as aliases.

**States:** loading; "No people yet — they populate from project team roles on the next sync";
search-no-match.

**Redesign focus:** Give the missing-email count real visual weight (badge/callout, not muted
prose). Add a persistent dirty-row marker so unsaved edits are obvious while scrolling. The
merge control is shown on every row but rarely used — collapse it behind a per-row toggle to
cut density. Add column headers (Email / Aliases) and a "N people · M missing email" counter.

---

## Import Inbox — `/admin/inbox`

**Purpose:** The data-integrity triage queue for the PD-sync importer. Resolve every tracker
row the sync couldn't match: **Create** a new project, **Merge** into an existing one (writes
a durable alias so it auto-matches next sync), or **Dismiss** as junk. Empty inbox = every
tracker row accounted for.

**Must include:**
- **Pending / Dismissed tabs** with counts; intro explaining the three dispositions + the
  empty-inbox invariant.
- **Pending rows:** raw tracker name; a meta line (partner · course · term, plus `seen N×`,
  `PD✓`, `blurb✓` indicators); a blurb preview when present; actions **Create project**
  (→ opens the new draft in `/admin/edit`), **Merge into existing…** (project picker + Merge),
  and **Dismiss**.
- **Dismissed rows:** an **Undo** (restore-to-pending) action.
- A collapsible **Saved aliases** panel (tracker-name → project-id mappings) with per-row
  **remove** (removing one makes that name reappear in the inbox next sync).

**States:** loading; celebratory pending-empty ("🎉 Inbox empty — every tracker row matched");
"No dismissed rows"; per-row busy lock.

**Redesign focus:** Render `PD✓`/`blurb✓` as small pill tags, not one dot-separated blob.
Visually separate the destructive **Dismiss** from the constructive Create/Merge. Tint rows
with a high `seen N×` (repeated match failures = urgency). Give the empty-inbox success state
more celebratory weight than a plain muted line.

---

## Bulk Screenshot Uploads — `/admin/bulk-uploads`

**Purpose:** Find every project still missing a screenshot and batch-generate tokenized magic-
upload links — auto-emailing each project's PM when a sender domain is configured, else copy
each link manually.

**Must include:**
- A "Generate links for N projects" bulk action + a "N projects need screenshots" count.
- A warning banner when auto-email is **not** configured (links still generate; copy to PM).
- **Candidate rows:** project title; PM name + email (or "no email" / "no PM on file");
  a status indicator (emailed / has open link / note); per-row **generate**, and once a link
  exists, **open** + **copy link**.

**States:** loading (skeleton rows); "🎉 Every project has at least one screenshot"; "Generating…";
copy-success ("copied ✓") and copy-failure feedback.

**Redesign focus:** Add a leading status icon (envelope / link / check) so the status column
scans without reading. Tint or de-emphasize rows that already have an open link so the rows
needing action stand out. Clarify that per-row "generate" also emails when auto-email is on
(label suffix "(+ email)"). Give the clipboard-failure path a way to see the URL.

---

## Review Uploads — `/admin/uploads`

**Purpose:** Process screenshot submissions PMs sent via magic links. For each pending
submission, pick the final set (≤4 images, drawn from the new uploads + images already on the
project) and **Approve** to publish, or **Send back** with an optional note.

**Must include:**
- A queue of submission cards: project title; submitter email + submitted date; an "N/4
  selected" counter; a **"New screenshots"** thumbnail group and (when relevant) an **"Already
  on the project"** group, each thumbnail toggle-selectable (capped at 4); **Approve & publish**
  and **Send back** actions.

**States:** loading; "Nothing awaiting review right now"; "Working…" in-flight; selection cap
reached (currently silent — needs feedback); approve disabled at 0 selected.

**Redesign focus:** Give feedback when the 4-image cap blocks a new selection (today nothing
happens). Visually distinguish the "Already on the project" group from "New screenshots."
Replace the native `window.prompt()` reject-note dialog with an in-page textarea/modal in the
design system. Show a pending count near the title. Make thumbnails a responsive grid.

---

## Manage Admins — `/admin/users`

**Purpose:** View and control who holds admin access. Add a `@bu.edu` email to grant Google
sign-in; remove to revoke immediately.

**Must include:**
- An add-admin form (single BU-email input + **Add admin**).
- An admin list: each row shows the email + "added <date>" and a destructive **Remove** (with
  confirm).

**States:** loading (skeleton, not the empty state); "Added {email}" vs idempotent "{email} is
already an admin" vs error; "No admins on record".

**Redesign focus:** Show an admin count. Distinguish a true add from the idempotent "already an
admin" no-op (different toast tone). Surface the already-fetched display **name** under the
email to confirm identity before removing. Tag the signed-in user's own row "(you)" and guard
against self-lockout. Add `aria-label`s to Remove buttons.

---

## Settings — `/admin/settings`

**Purpose:** Configure the gallery's controlled vocabulary and sidebar filter visibility —
discipline names, client-type labels, and which of the four facet groups appear publicly.
(Removing a value only changes dropdowns/sidebar; it doesn't retag existing projects.)

**Must include:**
- **Disciplines** editor — chips with remove + add-new input.
- **Client types** editor — same pattern.
- **Sidebar filters** — toggles for Discipline / Program / Client Type / Term.
- A single **Save settings** action (all edits are local until saved; canonical values come
  back from the server on save).

**States:** loading; "None yet" empty chip rows; "Saving…"; saved / load-error / save-error
toasts.

**Redesign focus:** Distinguish the two "content vocabulary" cards from the "display control"
card. Make empty chip zones look addable (dashed drop zone). Flash feedback when a duplicate
add is blocked (today silent). Add an unsaved-changes guard since edits are local until Save.
Lay the four facet toggles as a tidy 2×2 grid.

---

## Login — `/admin/login`

**Purpose:** The unauthenticated entry point. Google OAuth restricted to the `@bu.edu`
allowlist; redirects to `/admin` on success. **No header/nav** — just a centered card on the
page background.

**Must include:** brand + "/ admin" label; a one-line explanation that access is limited to
approved `@bu.edu` admins; a **Sign in with Google** button (official multicolor G mark); a
conditional **access-denied** banner (shown via `?error` query param) telling the user to ask
an existing admin to add their `@bu.edu` email.

**States:** normal; access-denied banner; (no in-flight state today — add one).

**Redesign focus:** Add a pending/disabled state on the button after click (prevents double-
submit, signals progress). Anchor identity with the spark-logo mark above the headline. Give
the button a hover/focus-visible state. Make the denied-state copy actionable (a `mailto:` to a
Spark! admin). Improve subtitle contrast for WCAG AA.

---

## Reference — what the destination pages do (one line each)

- **`/admin/projects`** — searchable catalog: search + All/Published/Drafts/Needs-info tabs +
  role filters; per-row edit, show/hide, remove.
- **`/admin/people`** — admin-only people directory; edit emails + aliases, merge duplicates
  (PII, never public).
- **`/admin/inbox`** — PD-sync rows the importer couldn't match; Create / Merge (writes alias)
  / Dismiss / Undo.
- **`/admin/bulk-uploads`** — projects missing screenshots; resolve PM emails, batch-generate
  magic-upload links (auto-emails when configured).
- **`/admin/new`** — add-a-project form + S3 image slots + PD-blurb fetch; publish or draft.
- **`/admin/uploads`** — review PM-submitted screenshots: pick ≤4 and Approve (go live) or
  Reject (re-open with a note).
- **`/admin/users`** — manage admins: add/remove by `@bu.edu` email.
- **`/admin/settings`** — discipline + client-type vocabularies and sidebar facet toggles.

## The public gallery (the look to match)
The public gallery is the polished face of the product; the admin is its back-of-house twin.
Shared cues to echo: same font pairing + accent `#0fa392`; mono uppercase eyebrows; white
surfaces on light ground; project cards with light borders + a subtle hover lift; a big Space
Grotesk hero headline (`clamp(30px, 4vw, 46px)`, `letterSpacing: -0.02em`) over a muted
subhead; teal `999px` pill count badges and small mono chips. The gallery column is wider
(1340px) than the admin's 1080px — align them only deliberately.
