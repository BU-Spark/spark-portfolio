# Project Hub Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight per-project metadata layer — lifecycle `status`, generalized `links`, and internal `knowledge` notes — gated through the existing public/private projection.

**Architecture:** Three additive columns on the `projects` table. All sanitization + visibility logic lives in one new **pure** module `lib/hub.ts` (no DB, no React) so it is unit-testable without a database. The single gating chokepoint is `rowToProject(row, includePrivate)` in `lib/db.ts`; the API route, edit form, public `ProjectView`, admin detail page, and merge path all reuse the same pure helpers. No new routes, no new dependencies, no new auth.

**Tech Stack:** Next.js 15 (App Router), TypeScript, React 19, `pg` (Railway Postgres), Vitest, inline styles (Space Grotesk / IBM Plex). Scripts run via `tsx --env-file=.env.local`.

**Spec:** `docs/superpowers/specs/2026-06-26-project-hub-phase1-design.md`

---

## Project hard rules (apply to every commit here)

- **Commit author email MUST be `kush.zingade@gmail.com`** or Vercel deploys stall. Every commit step below uses `git -c user.email=kush.zingade@gmail.com commit …`.
- **Never leak admin-only data publicly.** `knowledge` and `internal:true` links must never appear on a public read. This is enforced in `rowToProject` and asserted by tests.
- Run tests with `npx vitest run <path>` (the `test` script is `vitest run`).

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `lib/types.ts` | `ProjectStatus`, `ProjectLink`, `ProjectKnowledge` types + `Project` fields | Modify |
| `lib/hub.ts` | **NEW** pure helpers: status mapping, link/knowledge sanitize, public filter, merge | Create |
| `lib/hub.test.ts` | **NEW** unit tests for `lib/hub.ts` | Create |
| `lib/db.ts` | `ProjectRow`, `COLS`, **export** `rowToProject` + gating, `ProjectPatch`, `updateProject`, `MergeResolution`, `mergeProjects` | Modify |
| `lib/db.gating.test.ts` | **NEW** test that `rowToProject` strips on public reads | Create |
| `scripts/migrate-project-hub.ts` | **NEW** idempotent `ADD COLUMN IF NOT EXISTS` migration | Create |
| `package.json` | add `db:migrate-hub` script | Modify |
| `app/api/projects/[id]/route.ts` | accept + shape the three fields on PATCH | Modify |
| `app/admin/edit/[id]/page.tsx` | form state + load-map + save-payload + UI controls | Modify |
| `components/ProjectView.tsx` | public status badge + public links block | Modify |
| `app/admin/projects/[id]/page.tsx` | gated **Operations** section | Modify |
| `components/admin/MergeProjectsModal.tsx` | status winner control | Modify |

---

## Chunk 1: Types + pure hub module

### Task 1: Add the Project Hub types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the new types and Project fields**

In `lib/types.ts`, add near the other top-level types:

```ts
// Project Hub (Phase 1) lifecycle status. Public reads expose only a simplified
// label (see publicStatus in lib/hub.ts); the raw value is admin-only.
export type ProjectStatus =
  | "active"
  | "paused"
  | "archived"
  | "needs-maintenance"
  | "candidate-for-revival";

// A typed operational/reference link. `internal:true` = admin-only (gated);
// `internal:false` = shown publicly. See lib/hub.ts for the known `kind` set.
export interface ProjectLink {
  kind: string;
  label: string;
  url: string;
  internal: boolean;
}

// Knowledge-transfer free-text. ADMIN-ONLY — never on public payloads.
export interface ProjectKnowledge {
  restart?: string; // "How to restart this project"
  knownIssues?: string;
  futureNotes?: string;
  deployNotes?: string;
  maintenance?: string;
}
```

Then add these fields to `interface Project` (after `prodUrl`):

```ts
  // --- Project Hub (Phase 1) ---
  status?: ProjectStatus | null; // ADMIN-ONLY raw status (null on public reads)
  publicStatusLabel?: "Active" | "Archived" | null; // public-safe derived label
  links?: ProjectLink[]; // public reads carry only internal:false links
  knowledge?: ProjectKnowledge; // ADMIN-ONLY — omitted on public reads
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: add status/links/knowledge types"
```

---

### Task 2: Create the pure `lib/hub.ts` module (TDD)

**Files:**
- Create: `lib/hub.ts`
- Test: `lib/hub.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/hub.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PROJECT_STATUSES,
  publicStatus,
  sanitizeLinks,
  publicLinks,
  sanitizeKnowledge,
  mergeLinks,
  mergeKnowledge,
} from "./hub";

describe("publicStatus", () => {
  it("maps active/archived, hides the rest", () => {
    expect(publicStatus("active")).toBe("Active");
    expect(publicStatus("archived")).toBe("Archived");
    expect(publicStatus("paused")).toBeNull();
    expect(publicStatus("needs-maintenance")).toBeNull();
    expect(publicStatus(null)).toBeNull();
    expect(publicStatus(undefined)).toBeNull();
  });
});

describe("sanitizeLinks", () => {
  it("keeps valid http(s) links and coerces unknown kinds to 'other'", () => {
    const out = sanitizeLinks([
      { kind: "repo", label: "Repo", url: "https://github.com/x", internal: false },
      { kind: "weird", label: "X", url: "http://ok.test", internal: true },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].kind).toBe("other");
  });
  it("drops non-http(s) urls (blocks javascript: and similar)", () => {
    const out = sanitizeLinks([
      { kind: "repo", label: "bad", url: "javascript:alert(1)", internal: false },
      { kind: "repo", label: "ok", url: "https://ok.test", internal: false },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://ok.test");
  });
  it("defaults missing/invalid internal flag to TRUE (never leak by accident)", () => {
    const out = sanitizeLinks([{ kind: "repo", label: "x", url: "https://x.test" }]);
    expect(out[0].internal).toBe(true);
  });
  it("falls back to a humanized label when blank", () => {
    const out = sanitizeLinks([{ kind: "api-docs", label: "", url: "https://x.test", internal: false }]);
    expect(out[0].label).toBe("API docs");
  });
  it("returns [] for non-arrays and clamps to 40", () => {
    expect(sanitizeLinks(null)).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ kind: "repo", label: "x", url: `https://x${i}.test`, internal: false }));
    expect(sanitizeLinks(many)).toHaveLength(40);
  });
});

describe("publicLinks", () => {
  it("keeps only internal:false", () => {
    const links = sanitizeLinks([
      { kind: "repo", label: "pub", url: "https://a.test", internal: false },
      { kind: "slack", label: "priv", url: "https://b.test", internal: true },
    ]);
    expect(publicLinks(links)).toHaveLength(1);
    expect(publicLinks(links)[0].label).toBe("pub");
    expect(publicLinks(undefined)).toEqual([]);
  });
});

describe("sanitizeKnowledge", () => {
  it("whitelists keys and trims; drops blanks and unknown keys", () => {
    const out = sanitizeKnowledge({ restart: "  do x  ", bogus: "y", knownIssues: "   " });
    expect(out).toEqual({ restart: "do x" });
  });
  it("returns {} for non-objects", () => {
    expect(sanitizeKnowledge(null)).toEqual({});
    expect(sanitizeKnowledge("nope")).toEqual({});
  });
});

describe("mergeLinks", () => {
  it("concatenates and dedupes by url (case-insensitive)", () => {
    const a = sanitizeLinks([{ kind: "repo", label: "a", url: "https://X.test", internal: false }]);
    const b = sanitizeLinks([
      { kind: "repo", label: "dup", url: "https://x.test", internal: true },
      { kind: "slack", label: "c", url: "https://c.test", internal: true },
    ]);
    const out = mergeLinks(a, b);
    expect(out).toHaveLength(2);
  });
});

describe("mergeKnowledge", () => {
  it("survivor wins, absorbed fills blanks", () => {
    expect(mergeKnowledge({ restart: "keep" }, { restart: "drop", knownIssues: "fill" }))
      .toEqual({ restart: "keep", knownIssues: "fill" });
  });
});

describe("PROJECT_STATUSES", () => {
  it("lists the five lifecycle values", () => {
    expect(PROJECT_STATUSES).toEqual([
      "active", "paused", "archived", "needs-maintenance", "candidate-for-revival",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/hub.test.ts`
Expected: FAIL — cannot find module `./hub`.

- [ ] **Step 3: Implement `lib/hub.ts`**

Create `lib/hub.ts`:

```ts
// Pure Project Hub (Phase 1) helpers — NO database, NO React, fully unit-testable.
// Used by lib/db.ts (gating), the PATCH API, the admin edit form, and merge.
import type { ProjectLink, ProjectKnowledge, ProjectStatus } from "./types";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "active",
  "paused",
  "archived",
  "needs-maintenance",
  "candidate-for-revival",
];

// Public-simplified status: only active/archived surface publicly; everything
// else (paused / needs-maintenance / candidate-for-revival / unset) → no badge.
export function publicStatus(s: string | null | undefined): "Active" | "Archived" | null {
  if (s === "active") return "Active";
  if (s === "archived") return "Archived";
  return null;
}

export const LINK_KINDS = [
  "repo", "docs", "api-docs", "architecture", "design", "figma", "data-source",
  "dashboard", "monitoring", "slack", "drive", "wiki", "meeting", "staging",
  "demo", "other",
] as const;

const MAX_LINKS = 40;

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

// Human label fallback, e.g. "api-docs" → "API docs".
function humanizeKind(k: string): string {
  const special: Record<string, string> = { "api-docs": "API docs" };
  if (special[k]) return special[k];
  return k.charAt(0).toUpperCase() + k.slice(1).replace(/-/g, " ");
}

// Validate + normalize a links array from any untrusted source (DB row, API body).
// SECURITY: drops non-http(s) urls (blocks javascript:/data:), defaults a missing
// `internal` flag to TRUE so a malformed link can never leak publicly.
export function sanitizeLinks(raw: unknown): ProjectLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectLink[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url = String(o.url ?? "").trim();
    if (!isHttpUrl(url)) continue;
    const kindRaw = String(o.kind ?? "other").trim().toLowerCase();
    const kind = (LINK_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "other";
    const label = String(o.label ?? "").trim() || humanizeKind(kind);
    const internal = o.internal !== false; // default → internal (safe)
    out.push({ kind, label, url, internal });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export function publicLinks(links: ProjectLink[] | null | undefined): ProjectLink[] {
  return (links ?? []).filter((l) => l.internal === false);
}

const KNOWLEDGE_KEYS: (keyof ProjectKnowledge)[] = [
  "restart", "knownIssues", "futureNotes", "deployNotes", "maintenance",
];

export function sanitizeKnowledge(raw: unknown): ProjectKnowledge {
  const out: ProjectKnowledge = {};
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  for (const k of KNOWLEDGE_KEYS) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

// Merge for project-merge: concat + dedupe by url (case-insensitive), clamp.
export function mergeLinks(a: ProjectLink[] = [], b: ProjectLink[] = []): ProjectLink[] {
  const seen = new Set<string>();
  const out: ProjectLink[] = [];
  for (const l of [...a, ...b]) {
    const key = l.url.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

// Survivor wins each field; absorbed fills only blanks.
export function mergeKnowledge(
  survivor: ProjectKnowledge = {},
  absorbed: ProjectKnowledge = {}
): ProjectKnowledge {
  return sanitizeKnowledge({ ...absorbed, ...survivor });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/hub.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add lib/hub.ts lib/hub.test.ts
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: pure hub helpers (status/links/knowledge) + tests"
```

---

## Chunk 2: Database layer

### Task 3: Idempotent migration script

**Files:**
- Create: `scripts/migrate-project-hub.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the migration**

Create `scripts/migrate-project-hub.ts`:

```ts
// Project Hub (Phase 1) migration — adds status / links / knowledge to projects.
// Idempotent: safe to re-run. Run with:
//   npx tsx --env-file=.env.local scripts/migrate-project-hub.ts
import { query } from "../lib/db";

async function main() {
  await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS status text`);
  await query(
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb`
  );
  await query(
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS knowledge jsonb NOT NULL DEFAULT '{}'::jsonb`
  );
  console.log("✓ Project Hub Phase 1 columns ensured (status, links, knowledge).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

> NOTE: confirm `query` is exported from `lib/db.ts`. If it is not exported, add `export` to the existing `query` function declaration (it is used by other scripts, so it should already be exported).

- [ ] **Step 2: Add the package script**

In `package.json` `scripts`, add:

```json
"db:migrate-hub": "tsx --env-file=.env.local scripts/migrate-project-hub.ts",
```

- [ ] **Step 3: Run the migration against the live DB**

Run: `npm run db:migrate-hub`
Expected: `✓ Project Hub Phase 1 columns ensured …`. Re-run once more — must still succeed (idempotent).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-project-hub.ts package.json
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: idempotent migration for status/links/knowledge"
```

---

### Task 4: Read path — `ProjectRow`, `COLS`, gated `rowToProject` (TDD)

**Files:**
- Modify: `lib/db.ts`
- Test: `lib/db.gating.test.ts`

- [ ] **Step 1: Write the failing gating test**

Create `lib/db.gating.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// rowToProject is a PURE row mapper (no DB I/O). We export it for this test.
import { rowToProject, type ProjectRow } from "./db";

function row(): ProjectRow {
  return {
    id: "p1", title: "T", blurb: "b", client_type: "Nonprofit", partner: "Acme",
    contact: null, contacts: null, tech: [], images: [], featured: false,
    custom: false, published: true, repo_url: null, prod_url: null, pd_url: null,
    drive_url: null, tech_note: null, blurb_locked: false, spark_program_lead: null,
    pm: null, tpm: null, senior_advisor: null, tech_advisor: null, eir: null,
    eir_is_instructor: false, class_instructors: null, runs: [],
    status: "needs-maintenance",
    links: [
      { kind: "repo", label: "pub", url: "https://pub.test", internal: false },
      { kind: "slack", label: "priv", url: "https://priv.test", internal: true },
    ],
    knowledge: { restart: "secret steps" },
  } as ProjectRow;
}

describe("rowToProject gating", () => {
  it("PUBLIC read hides raw status, internal links, and all knowledge", () => {
    const p = rowToProject(row(), false);
    expect(p.status ?? null).toBeNull();
    expect(p.publicStatusLabel).toBeNull(); // needs-maintenance → no public badge
    expect(p.links).toHaveLength(1);
    expect(p.links?.[0].internal).toBe(false);
    expect(p.knowledge).toBeUndefined();
  });

  it("ADMIN read keeps everything", () => {
    const p = rowToProject(row(), true);
    expect(p.status).toBe("needs-maintenance");
    expect(p.links).toHaveLength(2);
    expect(p.knowledge?.restart).toBe("secret steps");
  });

  it("PUBLIC read of active project exposes the Active label", () => {
    const r = { ...row(), status: "active" } as ProjectRow;
    expect(rowToProject(r, false).publicStatusLabel).toBe("Active");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/db.gating.test.ts`
Expected: FAIL — `rowToProject` / `ProjectRow` not exported, and fields missing.

- [ ] **Step 3: Implement the read path**

In `lib/db.ts`:

1. Add an import at the top (near the existing `import type { Run }`):
   ```ts
   import { publicStatus, sanitizeLinks, publicLinks, sanitizeKnowledge } from "./hub";
   import type { ProjectLink, ProjectKnowledge, ProjectStatus } from "./types";
   ```

2. Add fields to `interface ProjectRow` (after `runs`):
   ```ts
     status: string | null;
     links: ProjectLink[] | null;     // jsonb — node-postgres parses to objects
     knowledge: ProjectKnowledge | null; // jsonb
   ```

3. Add `export` to both `interface ProjectRow` and `function rowToProject` (change `interface ProjectRow {` → `export interface ProjectRow {`, and `function rowToProject(` → `export function rowToProject(`).

4. In the object returned by `rowToProject`, after `prodUrl: r.prod_url ?? null,` add:
   ```ts
       // --- Project Hub (Phase 1) ---
       status: includePrivate ? ((r.status as ProjectStatus) ?? null) : null,
       publicStatusLabel: publicStatus(r.status),
       links: includePrivate
         ? sanitizeLinks(r.links)
         : publicLinks(sanitizeLinks(r.links)),
       knowledge: includePrivate ? sanitizeKnowledge(r.knowledge) : undefined,
   ```

5. Add the three columns to the `COLS` string (append): `, status, links, knowledge`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/db.gating.test.ts lib/hub.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/db.gating.test.ts
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: read path + gating in rowToProject (+ test)"
```

---

### Task 5: Write path — `ProjectPatch` + `updateProject`

**Files:**
- Modify: `lib/db.ts`

- [ ] **Step 1: Extend `ProjectPatch`**

After `prodUrl?: string | null;` in `interface ProjectPatch`, add:

```ts
  status?: ProjectStatus | null;
  links?: ProjectLink[];
  knowledge?: ProjectKnowledge;
```

- [ ] **Step 2: Extend `updateProject`**

In `updateProject`, after `if (patch.prodUrl !== undefined) add("prod_url", patch.prodUrl);` add:

```ts
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.links !== undefined)
    add("links", JSON.stringify(sanitizeLinks(patch.links)), "::jsonb");
  if (patch.knowledge !== undefined)
    add("knowledge", JSON.stringify(sanitizeKnowledge(patch.knowledge)), "::jsonb");
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: write path in ProjectPatch/updateProject"
```

---

### Task 6: Merge path — `MergeResolution` + `mergeProjects`

**Files:**
- Modify: `lib/db.ts`

- [ ] **Step 1: Add `status` to `MergeResolution`**

In `interface MergeResolution`, after `prodUrl?: string | null;` add:

```ts
  status?: ProjectStatus | null;
```

- [ ] **Step 2: Resolve the three fields inside `mergeProjects`**

In `mergeProjects` (around `lib/db.ts:577-582`), alongside the existing `repoUrl`/`prodUrl`
resolution, add:

```ts
    const status =
      resolution.status !== undefined
        ? resolution.status
        : (survivor.status ?? absorbed.status ?? null);
    const links = mergeLinks(sanitizeLinks(survivor.links), sanitizeLinks(absorbed.links));
    const knowledge = mergeKnowledge(
      sanitizeKnowledge(survivor.knowledge),
      sanitizeKnowledge(absorbed.knowledge)
    );
```

Add `mergeLinks, mergeKnowledge` to the existing `./hub` import.

- [ ] **Step 3: Write the merged values**

Find the UPDATE/write of the survivor row inside `mergeProjects` (the statement that sets
`repo_url`, `prod_url`, `drive_url`, …). Add `status`, `links`, `knowledge` to that write:
- `status = $n` (text)
- `links = $n::jsonb` with `JSON.stringify(links)`
- `knowledge = $n::jsonb` with `JSON.stringify(knowledge)`

Mirror exactly how `drive_url` / the JSONB `runs`/`contacts` columns are already parameterized
in that function.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: merge status (winner) + links/knowledge (combine)"
```

---

## Chunk 3: API + UI

### Task 7: PATCH route accepts the new fields

**Files:**
- Modify: `app/api/projects/[id]/route.ts`

- [ ] **Step 1: Import the helpers**

Add to the top imports:

```ts
import { sanitizeLinks, sanitizeKnowledge, PROJECT_STATUSES } from "@/lib/hub";
import type { ProjectStatus } from "@/lib/types";
```

- [ ] **Step 2: Shape the patch**

After the `prodUrl` block in `PATCH`, add:

```ts
  if (body.status !== undefined)
    patch.status = PROJECT_STATUSES.includes(body.status as ProjectStatus)
      ? (body.status as ProjectStatus)
      : null;
  if (Array.isArray(body.links)) patch.links = sanitizeLinks(body.links);
  if (body.knowledge !== undefined && body.knowledge !== null && typeof body.knowledge === "object")
    patch.knowledge = sanitizeKnowledge(body.knowledge);
```

(`updateProject` re-sanitizes links/knowledge, so this is defense-in-depth, not the only gate.)

- [ ] **Step 3: Type-check + verify revalidation already present**

Run: `npx tsc --noEmit`
Expected: PASS. Confirm the existing `revalidateTag("projects")` call still runs after `updateProject` (it does — no change needed).

- [ ] **Step 4: Commit**

```bash
git add "app/api/projects/[id]/route.ts"
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: accept status/links/knowledge on PATCH"
```

---

### Task 8: Admin edit form controls

**Files:**
- Modify: `app/admin/edit/[id]/page.tsx`

> This is a large (~1600-line) client form with a flat `form` state object and an existing
> `urlOk()` validator (module-local). Reuse `urlOk()` for link url cells.

- [ ] **Step 1: Extend the form-state interface**

Near the `form` state type (~L150, where `repoUrl: string; prodUrl: string; …` are declared),
add:

```ts
  status: string;            // "" = unset
  links: { kind: string; label: string; url: string; internal: boolean }[];
  knowledge: {
    restart: string; knownIssues: string; futureNotes: string;
    deployNotes: string; maintenance: string;
  };
```

- [ ] **Step 2: Map them when loading the project (~L506)**

In the block that builds `form` from the fetched `project`, add:

```ts
        status: project.status ?? "",
        links: (project.links ?? []).map((l) => ({
          kind: l.kind, label: l.label, url: l.url, internal: l.internal,
        })),
        knowledge: {
          restart: project.knowledge?.restart ?? "",
          knownIssues: project.knowledge?.knownIssues ?? "",
          futureNotes: project.knowledge?.futureNotes ?? "",
          deployNotes: project.knowledge?.deployNotes ?? "",
          maintenance: project.knowledge?.maintenance ?? "",
        },
```

- [ ] **Step 3: Include them in the PATCH payload (~L697)**

In the object sent to `PATCH /api/projects/[id]`, add:

```ts
      status: form.status || null,
      links: form.links.filter((l) => l.url.trim()),
      knowledge: form.knowledge,
```

- [ ] **Step 4: Add the UI controls**

Add a "Project Hub" section (mirror the existing section styling / `flabel` labels). Import
`LINK_KINDS` and `PROJECT_STATUSES` from `@/lib/hub`. Render:
- a status `<select>` bound to `form.status` (one `<option value="">Unset</option>` + the five values, label each readably);
- a repeatable links editor (map `form.links`; each row: kind `<select>` from `LINK_KINDS`, label `<input>`, url `<input>` with `urlOk(l.url)` red-border treatment, an internal/public toggle, a remove button; plus an "+ Add link" button that pushes `{ kind: "repo", label: "", url: "", internal: true }`);
- five `<textarea>`s bound to `form.knowledge.*`, with **"How to restart this project"** first.

Use the existing `setVal`/state-update pattern already in the file for the scalar fields, and
a small `setLinks(next)` updater for the array.

- [ ] **Step 5: Manual verification (no unit test for the client form)**

Run the dev server (`npm run dev`), open `/admin/edit/<a-real-project-id>`:
- [ ] set status, add one public + one internal link, fill "How to restart", Save.
- [ ] reload the edit page — values persist.
Expected: Save returns ok; values round-trip.

- [ ] **Step 6: Commit**

```bash
git add "app/admin/edit/[id]/page.tsx"
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: edit-form controls (status/links/knowledge)"
```

---

### Task 9: Public status badge + public links on `ProjectView`

**Files:**
- Modify: `components/ProjectView.tsx`

- [ ] **Step 1: Add a status badge near the title**

`ProjectView` is a server component receiving `{ project }` (public read). Where the
discipline tag / `<h1>` title render, conditionally render a badge when
`project.publicStatusLabel` is non-null:

```tsx
{project.publicStatusLabel && (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 6,
    fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
    padding: "4px 10px", borderRadius: 20,
    color: project.publicStatusLabel === "Active" ? "#0b7d70" : "#5a6470",
    background: project.publicStatusLabel === "Active" ? "rgba(15,163,146,0.13)" : "#f1f2f1",
    border: `1px solid ${project.publicStatusLabel === "Active" ? "rgba(15,163,146,0.30)" : "#e1e3e3"}`,
  }}>
    {project.publicStatusLabel}
  </span>
)}
```

- [ ] **Step 2: Render public links beside the existing repo/live buttons**

Where the "View project" / "View live" action buttons render, append a links block for
`project.links` (already public-filtered by `rowToProject`):

```tsx
{(project.links ?? []).map((l) => (
  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
     style={{ /* ghost-button styling, matching the page */ }}>
    {l.label}
  </a>
))}
```

> Security: links are off-site + user-entered → always `rel="noopener noreferrer"`. Never
> inject raw user strings as HTML; render as text content only (as above).

- [ ] **Step 3: Manual verification**

`npm run dev`, open `/projects/<id-you-edited>`:
- [ ] Active project shows the "Active" badge; a needs-maintenance project shows NO badge.
- [ ] The public link appears; the internal link does NOT. View source — no `knowledge` text present.

- [ ] **Step 4: Commit**

```bash
git add components/ProjectView.tsx
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: public status badge + public links on ProjectView"
```

---

### Task 10: Operations section on the admin detail page

**Files:**
- Modify: `app/admin/projects/[id]/page.tsx`

> Already auth-gated (`/admin/*` middleware) and reads via `getProjectAdmin()` — so
> `project.status` (raw), `project.links` (all), and `project.knowledge` are available here.

- [ ] **Step 1: Add an "Operations" section**

In the existing "Admin only" zone, add a section that renders:
- the raw status as a labeled badge (map the five values to readable labels + colors; reuse
  the badge styling from the mockup / Task 9);
- "Last active" = the most-recent term (the page already computes `timelineTerms`/`runs` —
  reuse `timelineTerms[0]`);
- links grouped/listed with their `kind` tag and a 🔒/public marker (`l.internal`);
- the `knowledge` blocks, **"How to restart this project"** first, each rendered as
  `white-space: pre-line` text (NOT raw HTML).

Follow the page's existing `PageHeader` + `.content` structure and inline-style conventions.

- [ ] **Step 2: Manual verification**

`npm run dev`, open `/admin/projects/<id>`:
- [ ] full status (incl. needs-maintenance) shows; all links show with internal markers;
      knowledge blocks render with restart first.

- [ ] **Step 3: Commit**

```bash
git add "app/admin/projects/[id]/page.tsx"
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: Operations section on admin detail page"
```

---

### Task 11: Merge modal — status winner

**Files:**
- Modify: `components/admin/MergeProjectsModal.tsx`

- [ ] **Step 1: Add a status resolution control**

In the merge modal, add a `status` winner control mirroring how `repoUrl`/`prodUrl` winners
are chosen, and include `status` in the `MergeResolution` payload posted to the merge API.
(Links + knowledge combine automatically server-side — no UI needed.)

- [ ] **Step 2: Type-check + manual verification**

Run: `npx tsc --noEmit` → PASS.
Manually merge two test projects (or confirm the existing merge flow still works and status
carries the chosen value; links from both appear, deduped).

- [ ] **Step 3: Commit**

```bash
git add components/admin/MergeProjectsModal.tsx
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub: status winner in merge modal"
```

---

## Chunk 4: Full verification

### Task 12: Whole-suite + build + leak audit

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (including `lib/hub.test.ts`, `lib/db.gating.test.ts`, and all pre-existing tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Public-leak audit (manual, security-critical)**

On a project with internal links + knowledge set, fetch the PUBLIC page and confirm the
payload/HTML contains **no** `knowledge` text and **no** `internal:true` link url:

Run: `curl -s http://localhost:3000/projects/<id> | grep -i "<an internal link host or knowledge phrase>"`
Expected: no matches.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git -c user.email=kush.zingade@gmail.com commit -m "Project Hub Phase 1: verification pass"
```

---

## Done criteria
- All unit tests pass; `npm run build` clean.
- Admin can set status/links/knowledge in the edit form and they round-trip.
- Public page shows only the simplified badge + public links; never internal links or knowledge (curl-audited).
- Admin detail page shows the full Operations section with "How to restart" headlined.
- Migration is idempotent (re-run safe).
- Merge carries a status winner and combines links/knowledge.
