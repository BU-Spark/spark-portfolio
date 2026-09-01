# hub — the Spark! link-in-bio landing page

A single "linktree-style" page: dark hero with a rotating holographic Spark! logo,
a two-column grid of link cards in four groups, then social links. Built from
`design_handoff_spark_hub` (high-fidelity handoff — colours, type, spacing, copy and
animation timing are final-intent).

Not to be confused with **`atlas/`**, the project portfolio. That directory was
called `hub/` until this page took the name.

## Running it

There is no server and no framework. Open `index.html`, or:

```
python3 -m http.server 8080     # then visit localhost:8080
```

## Editing links

**Edit `links.mjs`, then run `node build.mjs`.** That regenerates `index.html`, which
is committed and is what ships.

```js
{ title: "Events & Workshops", desc: "…", icon: "calendar", href: "#" }
```

`icon` must be a key of `ICONS` in the same file — `build.mjs` throws on an unknown
one rather than emitting a card with a blank tile. Set `featured: true` for the teal
emphasis treatment; the handoff uses it on exactly one card and it stops meaning
anything if that changes.

**9 of 12 links still point at `#`.** They are the handoff's realistic placeholders.
`node build.mjs` prints which ones on every run, so it stays visible rather than
becoming permanent. The three real ones today: the Project Portfolio (`atlas`),
GitHub, and bu.edu/spark.

## Why a build step for a static page

The handoff asks for the links to be "maintainable as a data list". The two
alternatives were worse:

- **Hand-written HTML** — 12 near-identical cards drift. One ends up with a stale
  class or a missing arrow and nobody notices for months.
- **Client-side rendering from a JSON file** — ships JS to do what static HTML does
  better on a page whose entire purpose is outbound links. Worse for crawlers, worse
  on a cold phone connection, and blank with JS disabled.

So the source is a data list and the artifact is plain HTML. `build.mjs` has no
dependencies and needs no `package.json`.

## Deviations from the handoff

- **Hover states are real CSS rules** in `styles.css`. The prototype used a
  `style-hover` attribute, which belongs to its own preview tool and is not a web
  feature — reproducing it literally would have meant shipping JS to do `:hover`'s job.
- **`prefers-reduced-motion` is implemented.** The handoff requires it; the prototype
  does not include it. All three animations are disabled together — the spin, the
  float and the flicker sit on nested elements, so stopping only the spin leaves the
  logo bobbing and blinking.
- **`:focus-visible` mirrors every `:hover`.** The page is entirely links; keyboard
  users need to see where they are.
- **No `target="_blank"`.** External links get `rel="noopener"`, but the tab decision
  stays the visitor's.

## Files

| | |
|---|---|
| `links.mjs` | the link list, icon set, tagline, spin duration — **edit this** |
| `build.mjs` | renders `links.mjs` → `index.html`, and stages `dist/` |
| `index.html` | generated; committed; the reviewable artifact |
| `styles.css` | all styling, tokens as CSS custom properties |
| `assets/spark-logo.png` | the hologram asset (from hackbu-web) |
| `wrangler.jsonc` | assets-only Worker for `hub.buspark.io` |
| `dist/` | gitignored; what actually gets uploaded |

`index.html` is written to two places deliberately. The root copy is committed and CI
fails if it is stale — that is the version a reviewer reads in a diff. `dist/` is
gitignored and exists only to be deployed, holding exactly the three files a visitor
needs. Serving the directory itself would upload `links.mjs`, `build.mjs`, the README
and `package.json` to the edge: harmless, but it invites the assumption that those
files are part of the site.

## Deploying

Cloudflare Workers, as an **assets-only Worker** — there is no `main`, because there
is no server-side logic.

```
npm ci          # wrangler only
npm run cf:build
npm run deploy
```

`cf:build` is an alias for `node build.mjs`, so this directory answers the same build
command as `atlas/` and the Cloudflare project configs do not have to differ.

`package.json` exists for that reason and for the pinned wrangler — not because the
page has dependencies. It does not. `package-lock.json` is committed because Workers
Builds runs `npm clean-install`, which fails outright without a lockfile.
