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
| `build.mjs` | renders `links.mjs` → `index.html` |
| `index.html` | generated; committed; what ships |
| `styles.css` | all styling, tokens as CSS custom properties |
| `assets/spark-logo.png` | the hologram asset (from hackbu-web) |

## Not decided

Where this deploys. It is static, so anywhere works — Cloudflare Pages, a Worker with
static assets, or a route on an existing host. The handoff suggests the `hackbu-web`
Astro repo as one option; it lives here instead so the whole program is in one place.
