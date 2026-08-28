# Handoff: BU Spark! Project Gallery + Admin

## Overview

A public-facing, searchable **project gallery** for BU Spark! (an innovation & experiential-learning lab at Boston University). It is a centralized showcase of all student-built projects so that external collaborators — judges, mentors, Experts-in-Residence, guest speakers, and prospective partners — can browse and understand the work the lab produces.

The product has **two screens**:

1. **Project Gallery** (`Spark Project Gallery.html`) — the public showcase. A masthead + intro, a left sidebar of filter facets, a search/sort/view toolbar, and the results shown as either a **card grid** (default) or a **list/table**. Clicking any project opens a right-side **detail drawer**.
2. **Admin — Add a Project** (`Spark Admin.html`) — an internal form to add a new project (including up to four images) that then appears in the public gallery immediately.

The two screens share one data model and one persistence layer.

---

## About the Design Files

The files in this bundle are **design references created in HTML/React-via-Babel** — runnable prototypes that demonstrate the intended look, layout, and behavior. **They are not meant to be shipped as-is.**

Your task is to **recreate these designs in the target codebase's environment**, using its established framework, component library, routing, and data layer. The prototype happens to use React 18 (loaded from a CDN and transpiled in-browser with Babel) only because that is the fastest way to make an interactive mock — in a real app you would use the project's normal build pipeline (Vite/Next/etc.), a real database/API instead of `localStorage`, and the codebase's existing form, button, and input primitives.

If there is **no existing environment**, a good default stack is **React + TypeScript + Vite**, CSS Modules or vanilla-extract for styles (the design relies on plain CSS, CSS variables, `oklch()`, `color-mix()`, grid/flex with `gap`, and `aspect-ratio` — no Tailwind), and a small client-side store that can later swap to a real backend.

---

## Fidelity

**High-fidelity (hifi).** Colors, typography, spacing, radii, shadows, and interactions are final and intentional. Recreate the UI as closely as possible — ideally indistinguishable from the prototype. Every measurement below is exact. Where a value reads like `padding: "17px 18px 19px"`, those asymmetric numbers are deliberate; preserve them.

The **only** parts that are deliberately placeholder:
- **Project images** are CSS striped/gradient placeholders (see "Image system"). Replace with real images when available.
- The "View project →" and "Contact team" buttons in the detail drawer are non-wired.
- Persistence is `localStorage` (prototype stand-in for a database).

---

## Tech & Architecture (prototype)

```
Spark Project Gallery.html      Public gallery shell — loads fonts, base CSS, scripts, #root
Spark Admin.html                Admin shell — fonts, base CSS, scripts, #root
data/projects.js                window.SPARK_PROJECTS + facet vocab arrays (seed data)
js/store.jsx                    window.SparkStore — merges seed + localStorage-added projects
js/shared.jsx                   window.SparkShared — discipline colors, <Thumb>, useFilters()
js/detail.jsx                   window.ProjectDetail — right-side detail drawer + <GalleryImage>
js/directionA.jsx               window.DirectionA — the gallery (masthead, sidebar, grid+list)
js/app.jsx                      Root <App> for the gallery: tweaks, detail, Admin button
js/admin.jsx                    Root <App> for the admin form
tweaks-panel.jsx                Design-time control panel (NOT part of the product — see note)
image-slot.js                   Drag-and-drop image placeholder web component (admin uploads)
```

**Load order matters** (each `<script type="text/babel">` is its own scope; shared code is hung on `window`). In the gallery HTML: React → ReactDOM → Babel → `data/projects.js` → `image-slot.js` → `tweaks-panel.jsx` → `js/store.jsx` → `js/shared.jsx` → `js/detail.jsx` → `js/directionA.jsx` → `js/app.jsx`.

> **The Tweaks panel is a design tool, not a product feature.** It lets the designer flip accent/font/density/default-view/images live. In production you do **not** need to build it; instead, **bake in the chosen defaults**: accent `#0fa392`, font pairing "Grotesk", density "compact", default view "grid", images on. (It is documented in "Configurable design tokens" only so you know which knobs were considered.)

---

## Design Tokens

### Colors

| Token | Value | Usage |
|---|---|---|
| Accent / teal (default) | `#0fa392` | Primary brand accent: active filters, links, eyebrows, focus rings, dots |
| Accent alternates | `#12b9a4`, `#0a7d70`, `#168fb0` | Alternate teals offered in tweaks (ship `#0fa392`) |
| Ink (headings) | `#16191c` | Titles, primary text, dark buttons |
| Body text | `#3a3f44` | Paragraph / detail body |
| Secondary text | `#55595e` | Sidebar labels, nav |
| Muted text | `#6a6f74` | Card descriptions, captions |
| Faint text | `#9a9a9a` | Counts, result totals, mono meta |
| Faintest text | `#a0a0a0`–`#b4b4b4` | Table header labels, facet counts |
| Page background (gallery) | `#ffffff` | — |
| Page background (admin) | `#f4f5f4` | — |
| Dark header (admin) | `#0e1211` | Admin masthead, floating buttons, dark CTA bg via `#16191c` |
| Hairline border | `#ececec` | Masthead/section dividers, card borders |
| Input border | `#dcdcdc` / `#d8d8d8` | Inputs, selects, view toggle |
| Card/panel border | `#e6e6e6` | Admin cards |
| Row divider | `#f2f2f2` / `#f0f0f0` | List rows, card footers |
| List header bg | `#f7f7f6` | Table header strip |
| Row hover bg | `#f7f9f8` | `.spark-row:hover` |
| Tech chip bg | `#f1f2f1` (list) / `#fafafa` (detail) | — |
| Error | `#b3261e` | Admin toast error, "clear all" |
| Selection highlight | `rgba(15,163,146,0.25)` | `::selection` |

**Discipline accent colors** (used for the colored dot, thumbnail tint, list dot, detail avatar). Harmonious oklch set — fixed lightness/chroma, hue varied:

| Discipline | Color | Thumbnail abbr |
|---|---|---|
| UX | `oklch(0.64 0.15 25)` | `UX` |
| SWE | `oklch(0.62 0.14 255)` | `SWE` |
| ML | `oklch(0.60 0.16 305)` | `ML` |
| Data Visualization | `oklch(0.66 0.13 205)` | `DATAVIZ` |
| Data Science | `oklch(0.64 0.13 160)` | `DATA SCI` |
| Innovation | `oklch(0.70 0.14 75)` | `INNOV` |
| Misc | `oklch(0.62 0.03 260)` | `MISC` |

Tints are derived at runtime with CSS `color-mix(in oklab, <disciplineColor> N%, #fff)` (e.g. dot backgrounds use 22%, hover surfaces 7–14%, borders 18–20%).

### Typography

Google Fonts: **Space Grotesk** (400/500/600/700), **IBM Plex Sans** (400/500/600/700), **IBM Plex Mono** (400/500/600). Alternate display font for the "Editorial" pairing: **Spectral**.

CSS variables on the root:
```css
--display: 'Space Grotesk', sans-serif;   /* headings, titles, buttons */
--body:    'IBM Plex Sans', sans-serif;    /* body, inputs, nav */
--mono:    'IBM Plex Mono', monospace;     /* eyebrows, labels, counts, tags, captions */
```
(Editorial pairing swaps `--display` to `'Spectral', Georgia, serif`. Ship Grotesk.)

Type ramp actually used (px):

| Role | Family | Size | Weight | Tracking / line-height | Notes |
|---|---|---|---|---|---|
| H1 (intro) | display | `clamp(30px, 4vw, 46px)` | 700 | `-0.02em` / 1.05 | max-width 720 |
| Intro paragraph | body | 16.5 | 400 | 1.6 | color `#55595e`, max-width 620 |
| Eyebrow / label | mono | 10–12 | 400–600 | `0.08–0.16em`, UPPERCASE | accent or `#9a9a9a` |
| Masthead wordmark "BU Spark!" | display | 19 (gallery) / 17–20 | 700 | `white-space: nowrap` | |
| Nav items | body | 13.5 | 400 (active 600) | active color = accent | |
| Card title (grid) | display | 17.5 | 600/700 | `-0.01em` / 1.2 | |
| Card description | body | 13.5 | 400 | 1.5 | clamp 3 lines (`-webkit-line-clamp`) |
| Card footer partner | body | 12.5 | 500 | ellipsis | |
| Card footer program | mono | 10 | 400 | `0.06em` UPPERCASE, accent | |
| List row title | display | 15 | 600 | 1.25, ellipsis | |
| List meta (clientType·program) | mono | 10 | 400 | `0.05em` UPPERCASE `#a4a4a4` | |
| Detail H2 (title) | display | 28 | 700-ish | `-0.01em` / 1.12 | |
| Detail body | body | 16 | 400 | 1.6 | `#3a3f44` |
| Detail meta value | body | 15 | 400 | 1.4 | |
| Tech chip | mono | 12.5 (detail) / 10.5 (list) | 400 | — | |
| Result count | mono | 12 | 400 | — | `#9a9a9a` |
| Admin H1 | display | 26 | — | `-0.01em` | |
| Admin field label | mono | 10.5 | 400 | `0.12em` UPPERCASE `#8a8a8a` | required adds accent `*` |

### Spacing, radius, shadows

- **Page gutters**: gallery `40px`, admin `32px`. Max content width: gallery `1340px`, admin `1080px`.
- **Sidebar / content grid (gallery)**: `grid-template-columns: 248px 1fr; gap: 44px; align-items: start;` sidebar is `position: sticky; top: 16px`.
- **Admin grid**: `1fr 300px; gap: 40px; align-items: start;` right column sticky `top: 24px`.
- **Card grid**: `repeat(auto-fill, minmax(<min>px, 1fr))` where `<min>` = compact `230` / regular `270` / comfy `320`; `gap` = compact `18` / regular `26` / comfy `34`.
- **Border radius**: cards `8px`; detail drawer image primary `10`, thumbnails `7`; chips/buttons `4–7px`; pills/toggles `999px`; admin panels `12–14px`; avatar/logos `8px`; circular avatars/dots `50%`.
- **Card padding**: compact `14px 15px 16px`, regular/comfy `17px 18px 19px`.
- **List row padding**: `15px 20px`; list header `11px 20px`.
- **Shadows**: card hover `0 10px 26px rgba(0,0,0,0.10)`; drawer `-20px 0 60px rgba(0,0,0,0.25)`; floating buttons `0 8px 28px rgba(0,0,0,0.28)`; toast `0 8px 30px rgba(0,0,0,0.25)`.

---

## Screen 1 — Project Gallery

Vertical structure (top → bottom): **Masthead → Intro band → [Sidebar | Results] → Floating "Add a project" button → Detail drawer (overlay, when a project is open)**.

### Masthead
- Full-width, `border-bottom: 1px solid #ececec`, inner row `height: 64px`, max-width 1340, horizontal padding 40.
- Left: wordmark **"BU Spark!"** (display 19, 700, `#16191c`, nowrap) · a `1×16px #d4d4d4` divider · "Project Gallery" (body 14, `#6a6f74`), baseline-aligned, gap 10.
- Right: nav — "About", "Programs", **"Projects"** (active: accent, 600), "Partner with us" (body 13.5, `#55595e`, gap 26). Decorative in the prototype.

### Intro band
- Padding `44px 40px 30px`, max-width 1340.
- Eyebrow "EXPLORE OUR WORK" (mono 12, `0.12em`, accent, uppercase, margin-bottom 14).
- H1 "Student-built projects, with real partners and real impact." (display, `clamp(30px,4vw,46px)`, 1.05, `-0.02em`, `#16191c`, max-width 720).
- Paragraph "Browse work from our practicums, hackathons, and co-labs — searchable by discipline, program, partner, and the technologies behind each build." (body 16.5, 1.6, `#55595e`, max-width 620, margin-top 18).

### Sidebar (filters)
- Header row: "Filters" (display 16, 700) + a **Clear (N)** button (mono 12.5, accent) shown only when `activeCount > 0`.
- Four **facet groups**, in order: **Discipline, Program, Client Type, Term** (margin-bottom 26 each).
  - Group title: mono 10.5, `0.14em`, uppercase, `#9a9a9a`, margin-bottom 12.
  - Each value is a clickable `<label>` (gap 10, font 14): a **17×17 checkbox** (`border-radius: 3`; unchecked `1px solid #cdcdcd` on `#fff`; checked `1px solid accent` filled accent with a white `✓` at 12px), the value label (flex:1; checked `#16191c`, else `#55595e`), and a right-aligned **count** (mono 11.5, `#b4b4b4`).
- Facet vocab comes from the data file (see Data model). Counts are computed over the full dataset.

### Toolbar (above results)
- Flex row, gap 12, wrap, margin-bottom 24:
  - **Search input** (flex:1, min-width 220): left magnifier glyph `⌕` at 15px `#aaa`; input padding `12px 14px 12px 38px`, `1px solid #dcdcdc`, radius 6, font 14.5; focus border = accent. Placeholder "Search projects, partners, tech…". Searches title, blurb, partner, course, discipline, program, clientType, tech[], team[] (case-insensitive substring).
  - **Sort `<select>`**: padding `12px 14px`, `1px solid #dcdcdc`, radius 6, font 14. Options: "Newest first" (`term`) and "A–Z" (`az`).
  - **View toggle**: a 2-button segmented control, `1px solid #dcdcdc`, radius 6, overflow hidden. Buttons `42×44px`; active = bg `#16191c`, white icon; inactive = bg `#fff`, `#9a9a9a` icon; the list button has a `1px solid #ececec` left divider. Icons: grid `▦`, list `≣`. **Grid is default.**
- **Result count**: mono 12, `#9a9a9a`, margin-bottom 18 — `"{n} projects"` (singular "project").
- **Empty state**: centered, padding `80px 0`, `#9a9a9a` 15px: "No projects match your filters." + a "Reset" text button (accent).

### Results — GRID view (default)
- `display: grid; grid-template-columns: repeat(auto-fill, minmax(<min>px, 1fr)); gap: <gap>` (see spacing).
- Each card (`<article class="spark-card-a">`, cursor pointer, radius 8, `1px solid #ececec`, bg `#fff`, column flex):
  - **Thumbnail** (if images on): `<Thumb ratio="4 / 3">` — striped placeholder tinted by discipline, with a discipline abbr badge top-left (mono 10.5, 600, `0.1em`, white text on the discipline color, padding `3px 8px`, radius 2) and a centered "project image" pill (mono 11, uppercase, `rgba(255,255,255,0.7)` bg).
  - **Body** (padding per density): eyebrow row = `8×8` discipline dot + mono 10.5 `"{discipline} · {term}"` uppercase `#9a9a9a`; **title** (display 17.5, 1.2, `-0.01em`, `#16191c`); **description** (body 13.5, 1.5, `#6a6f74`, clamp 3 lines, `flex:1`); **footer** (margin-top 14, padding-top 13, `border-top: 1px solid #f0f0f0`): partner name (12.5, 500, ellipsis) left, program (mono 10, `0.06em`, accent, uppercase) right.

### Results — LIST view
- A bordered table card (`1px solid #ececec`, radius 8, bg `#fff`).
- **Header strip**: `grid-template-columns: minmax(260px,2.2fr) 1.1fr 1.3fr 0.8fr; gap: 16; padding: 11px 20px;` bg `#f7f7f6`, bottom hairline; labels (mono 10, `0.1em`, uppercase, `#a0a0a0`): **Project · Discipline · Client · Term**.
- **Rows** (`.spark-row`, same grid, padding `15px 20px`, items center, pointer, bottom `1px solid #f2f2f2` except last; hover bg `#f7f9f8`):
  - **Project cell**: optional `54×40` rounded-5 thumbnail + a column with title (display 15, 600, ellipsis) and a row of up to 3 tech chips (mono 10.5, `#6a6f74` on `#f1f2f1`, radius 3, padding `2px 6px`).
  - **Discipline cell**: `8×8` dot + label (13, `#3a3f44`).
  - **Client cell**: partner name (13, `#16191c`, ellipsis) + sub-line "{clientType} · {program}" (mono 10, `0.05em`, uppercase, `#a4a4a4`).
  - **Term cell**: mono 12, `#6a6f74`.

### Floating "Add a project" button
- `position: fixed; bottom: 24; right: 24; z-index: 500`. Pill: bg `#16191c`, white, padding `12px 20px 12px 17px`, radius 999, shadow `0 8px 28px rgba(0,0,0,0.28)`, body 14/600. Leading `22×22` circle (bg accent, `#08110f` `+` glyph 17px). Links to the Admin screen.

---

## Screen 1b — Project Detail Drawer (`ProjectDetail`)

Opens when a project card/row is clicked. Right-anchored overlay.

- **Backdrop**: `position: fixed; inset: 0; z-index: 1000; background: rgba(15,18,20,0.55); backdrop-filter: blur(3px)`; click to close; fades in (`sparkFade` 0.2s).
- **Panel**: `width: min(580px, 95vw); height: 100%; background: #fff; box-shadow: -20px 0 60px rgba(0,0,0,0.25)`; slides in from the right (`sparkSlide` 0.28s `cubic-bezier(0.22,1,0.36,1)`); inner content scrolls. **Body scroll locks** while open. **Esc** closes.
- **Close button**: absolute top-right `16/16`, `38×38` circle, `rgba(255,255,255,0.95)`, `×` 20px, shadow.
- **Image gallery** (top): a primary 16:9 image, then a 3-column row (`gap 6`, padding `6px 6px 0`) of 4:3 thumbnails — **4 images total**, captioned "Overview", "Interface", "Process", "Outcome". For admin-added projects these render real `<image-slot>` components keyed by stored ids; otherwise striped placeholders tinted by discipline.
- **Content** (padding `26px 32px 48px`):
  - Eyebrow row: `8×8` discipline dot + mono 11.5 `0.1em` accent uppercase `"{discipline} · {program} · {term}"`.
  - **H2 title** (display 28, 1.12, `-0.01em`, `#16191c`).
  - **Client block** (prominent): flex card, padding `16px 18px`, bg `color-mix(in oklab, accent 7%, #fafafa)`, border `1px solid color-mix(in oklab, accent 18%, #eee)`, radius 10. Contains: a `44×44` rounded-8 white **logo monogram** (initials from the org name, display 700 16, accent), a column with "Client" (mono 10, `0.12em`, uppercase, `#8a8a8a`) over the **org name** (display 16/600 17, `#16191c`), and a right-aligned **client-type pill** (mono 11, uppercase, accent text, `1px solid color-mix(accent 35% #fff)`, radius 999, padding `4px 11px`).
  - **Blurb** (body 16, 1.6, `#3a3f44`).
  - **Meta grid**: 2-col, gap `22px 24px`, top `1px solid #ececec`, padding-top 24. Pairs: Course, Term, Program, Discipline. Each = mono label (10.5, `0.12em`, uppercase, `#8a8a8a`) over value (15, `#1a1a1a`).
  - **Tech Stack**: mono label + wrap of chips (mono 12.5, `#2a2f33`, `1px solid #dcdcdc`, radius 3, padding `5px 10px`, bg `#fafafa`).
  - **Student Team**: mono label + wrap of members; each = a `26×26` circular initials avatar (bg `color-mix(disciplineColor 22% #fff)`, text `color-mix(disciplineColor 75% #000)`, mono 11/700) + name (14).
  - **Actions**: "View project →" (flex:1, bg `#16191c`, white, display 14.5/600, radius 4, padding `13px 18px`) and "Contact team" (bg `#fff`, `#16191c`, `1px solid #d4d4d4`). Not wired in the prototype.

---

## Screen 2 — Admin: Add a Project (`Spark Admin.html` / `admin.jsx`)

Page bg `#f4f5f4`. Root CSS vars are hard-set to the shipped defaults (accent `#0fa392`, Grotesk fonts).

### Header
- Dark bar (`#0e1211`, white), inner max-width 1080, padding `0 32px`, height 64.
- Left: "BU Spark!" (display 19/700, nowrap) + "/ admin" (mono 12, `#8c948f`).
- Right: "← Back to gallery" link (`#c2c8c5`, 13.5/500) → gallery.

### Layout
- `grid-template-columns: 1fr 300px; gap: 40; max-width 1080; padding: 40px 32px 90px; align-items: start`.

### Form card (left)
- White, radius 14, `1px solid #e6e6e6`, padding `34px 36px`.
- H1 "Add a project" (display 26, `-0.01em`). Sub "New projects appear in the public gallery immediately and are searchable by every facet." (14.5, `#6a6f74`).
- **Fields** (label = mono 10.5 `0.12em` uppercase `#8a8a8a`, margin-bottom 7; required fields show an accent `*`; inputs use the `.fld` style: full-width, padding `11px 13px`, `1px solid #d8d8d8`, radius 7, font 14.5, bg `#fff`, focus border accent):
  1. **Project title** (required) — text.
  2. **Short description** (required) — textarea (`min-height 84`, line-height 1.5, resize vertical); hint "One or two sentences shown on the card and detail view."
  3. Row (2-col, gap 18): **Discipline** (required, select from `SPARK_DISCIPLINES`) · **Program** (required, select from `SPARK_PROGRAMS`).
  4. Row (`1.4fr 1fr`, gap 18): **Client / partner** (required, text; hint "The organization's name — e.g. City of Boston, The Boston Globe.") · **Client type** (required, select from `SPARK_CLIENT_TYPES`).
  5. Row (`1fr 1.4fr`, gap 18): **Term** (required, select from `SPARK_TERMS` plus an extra "Fall 2026" option) · **Course** (text, optional).
  6. **Tech stack** — `TagInput`: type + Enter/comma adds a chip; chips are mono 13 on `color-mix(accent 12% #fff)`, radius 5, padding `4px 8px`, with `×` remove. Adds on blur too.
  7. **Student team** — `TagInput`.
  8. **Project images** — a grid (`grid-template-columns: 1.6fr 1fr 1fr; gap 8`) of four `<image-slot>` drop targets: a large cover (16:11, spans 2 rows), two 4:3 slots, and a wide bottom slot (4:3, spans cols 2–4). Hint: "Drag an image onto each slot (or click to browse). The first is the cover; up to four show in the detail view." In a real app, replace `<image-slot>` with the codebase's uploader; store returned URLs on the project.
- **Footer actions** (margin-top 30, top `1px solid #eee`, padding-top 24): **"Add to gallery"** primary (`#16191c` when valid, else `#cfcfcf` + not-allowed; display 15/600, radius 7, padding `13px 26px`); **"Clear"** secondary (`#fff`, `1px solid #d8d8d8`). When invalid, a mono helper "N required field(s) left" shows.

### Sidebar (right, sticky)
- **Gallery status** card: total live count (`seedCount + customCount`) and "{customCount} added by you".
- **Your additions** card: list of admin-added projects (title + "{discipline} · {term}") each with a `×` remove; a "clear all" (error red, confirms) when non-empty; empty copy otherwise.
- **Prototype note** card (tinted accent): explains additions are saved to the browser and a production version would write to the shared database.

### Toast
- Fixed, top 80, centered. Success = `#0e1211` bg with a "View →" link to the gallery; error = `#b3261e`. Auto-dismisses after ~4.2s. Fades in (`sparkFade`).

---

## Interactions & Behavior

- **Filtering** (`useFilters`): four multi-select facet `Set`s + a query string. A project passes if it matches **every** active facet group (AND across groups; within a group, membership in the selected set). Query is a case-insensitive substring across title, blurb, partner, course, discipline, program, clientType, and joined tech/team. `activeCount = (query?1:0) + sum of set sizes`. `clearAll()` resets everything.
- **Sort**: "term" orders by the `SPARK_TERMS` array order (newest first), tiebreak A–Z; "az" is pure title A–Z.
- **Counts**: each facet value shows its count across the full dataset (not re-narrowed by other active filters — simple by design).
- **View toggle**: local state, default from the baked-in "grid". Switches grid ↔ list instantly.
- **Open/close detail**: click card/row → drawer; close via `×`, backdrop click, or Esc; body scroll locks while open.
- **Card hover**: `transform: translateY(-3px)` + shadow `0 10px 26px rgba(0,0,0,0.10)` + border `#d8d8d8`, transition `0.18s ease`. List row hover: bg `#f7f9f8`, `0.12s`. **Respect `prefers-reduced-motion: reduce`** — disable transforms/animations.
- **Admin submit**: validates required fields; on success builds the project, prepends it to the store, clears the form, regenerates the draft id (so image-slot ids reset), scrolls to top, and shows the success toast.
- **Cross-tab/page sync**: store notifies subscribers and listens to the `storage` event; the gallery also refreshes on window `focus`. So adding in Admin and returning to the gallery shows the new project.

### Animations / keyframes
```css
@keyframes sparkFade  { from { opacity: 0 } to { opacity: 1 } }           /* drawer backdrop; admin toast variant adds translateY(6px)->0 */
@keyframes sparkSlide { from { transform: translateX(40px); opacity: .4 } to { transform: translateX(0); opacity: 1 } }  /* drawer panel, 0.28s cubic-bezier(0.22,1,0.36,1) */
```

---

## State Management

**Gallery (`app.jsx`)**
- `active` — currently opened project (or null) → drives the detail drawer.
- `projects` — from `SparkStore.getProjects()`; refreshed via store subscription + window focus.
- `t` — design tokens from the tweaks panel (ship as constants instead).

**Direction A (`directionA.jsx`)**
- Everything from `useFilters(projects)` (query, four Sets, sort, derived `filtered`, `counts`, `activeCount`).
- `view` — "grid" | "list".

**Admin (`admin.jsx`)**
- `form` — all field values (`title, blurb, discipline, program, partner, clientType, term, course, tech[], team[]`).
- `draftId` — stable id for the in-progress entry's image-slot ids; regenerated after submit.
- `toast` — `{type, msg}` or null.
- `custom` — list of admin-added projects (from the store), kept in sync via subscription.

**Store (`store.jsx`)** — `localStorage` key `spark_custom_projects_v1`. API: `getProjects()` (custom-first then seed), `getCustom()`, `addProject(p)` (prepend + persist + notify), `removeCustom(id)`, `clearCustom()`, `subscribe(fn)`. In production, swap this module's body for real API/DB calls; keep the same interface.

---

## Data Model

Seed data and facet vocabularies live in `data/projects.js`.

```js
// Facet vocabularies (drive filter UIs and admin selects)
SPARK_DISCIPLINES  = ["UX","SWE","ML","Data Visualization","Data Science","Innovation","Misc"]
SPARK_PROGRAMS     = ["Civic Tech","Justice Media Co-Lab","X-Lab Practicum","CivicHacks","Demo Day"]
SPARK_CLIENT_TYPES = ["Government","Nonprofit","Media","Education","Healthcare","Startup","Research"]
SPARK_TERMS        = ["Spring 2026","Fall 2025","Spring 2025","Fall 2024","Spring 2024"]  // newest → oldest

// Project shape
{
  id: string,            // slug; admin generates `${slugify(title)}-${draftId}`
  title: string,
  blurb: string,         // 1–2 sentences
  discipline: string,    // one of SPARK_DISCIPLINES
  program: string,       // one of SPARK_PROGRAMS
  clientType: string,    // one of SPARK_CLIENT_TYPES
  partner: string,       // the client/organization NAME (e.g. "City of Boston — Analytics Team")
  term: string,          // one of SPARK_TERMS (+ "Fall 2026" allowed in admin)
  course: string,        // e.g. "DS 549: Spark! Data Science Practicum"
  tech: string[],        // e.g. ["Python","D3.js","Pandas","Mapbox"]
  team: string[],        // student names
  featured: boolean,     // (used by earlier showcase layout; harmless if kept)
  imageSlots?: string[], // admin-added only: 4 image-slot ids → real image URLs in production
  custom?: boolean       // admin-added flag
}
```
The bundle ships **23 realistic seed projects** (City of Boston, The Boston Globe, MassDOT, MBTA, Greater Boston Food Bank, GBH News, BPS, etc.) — invented but plausible. Replace with the real catalog. `slugify`: lowercase, non-alphanumerics → `-`, trim leading/trailing `-`, cap 40 chars.

---

## Image System

All project imagery in the prototype is generated, not real:
- `<Thumb>` (shared.jsx) draws a `repeating-linear-gradient` stripe (angle seeded from the id) tinted with the discipline color, a discipline-abbr badge, and a "project image" caption pill.
- `<GalleryImage>` (detail.jsx) draws the same style with per-index angle/position variation and the captions Overview/Interface/Process/Outcome — **unless** the project has `imageSlots`, in which case it renders `<image-slot id=…>` (real uploaded image).

**In production**: give each project a real `coverImage` plus a `gallery: string[]` of image URLs; render `<img>` with `object-fit: cover`. Keep the discipline-tinted placeholder only as the empty/loading fallback.

---

## Responsive Notes

The prototype is tuned for desktop (the audience is partners browsing on laptops). For production, add: collapse the 248px sidebar into a filter drawer/sheet under ~900px; make the detail drawer full-width on mobile (it already caps at `95vw`); let the toolbar wrap (it already does); and consider forcing list→stacked cards on narrow screens.

---

## Files in this bundle

- `Spark Project Gallery.html`, `Spark Admin.html` — the two screen shells.
- `data/projects.js` — seed data + facet vocab.
- `js/store.jsx`, `js/shared.jsx`, `js/detail.jsx`, `js/directionA.jsx`, `js/app.jsx`, `js/admin.jsx` — logic/UI.
- `tweaks-panel.jsx` — design-time only (do not ship; bake defaults).
- `image-slot.js` — drag-drop image web component used by Admin (replace with the codebase's uploader).

Open `Spark Project Gallery.html` in a browser to interact with the reference, and read the corresponding `.jsx` for the exact JSX/styles behind any element described above.
```
```
