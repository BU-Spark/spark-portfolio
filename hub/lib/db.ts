// Postgres data layer (Railway). Server-only. Replaces the localStorage store:
// the gallery and project pages read from here, and admin writes go through the
// API routes that call these functions. Image columns store S3 object keys;
// they're resolved to servable URLs (/api/img/<key>) on the way out.
import "server-only";
import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Client, Pool, type PoolClient } from "pg";
import type {
  Project,
  ProjectContact,
  GallerySettings,
  UploadRequest,
  UploadRequestStatus,
  Person,
  Contributor,
} from "./types";
import { DEFAULT_GALLERY_SETTINGS, disciplineFromCourse, SURFACE_KEYS } from "./data";
import { deleteObject } from "./s3";
import { normalizeName, matchKey, PROJECT_ALIASES, cleanPersonName } from "./gdocs";
import { semesterRank } from "./semester";
import { ORGS, canEdit, canMerge, type Actor } from "./authz";

// Reuse one pool across hot reloads / warm serverless invocations.
const globalForPool = globalThis as unknown as { sparkPool?: Pool };

type HyperdriveBinding = { connectionString?: string };

type DatabaseClient = Client | PoolClient;

async function getHyperdriveConnectionString(): Promise<string | undefined> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as { HYPERDRIVE?: HyperdriveBinding }).HYPERDRIVE?.connectionString;
  } catch {
    // No Cloudflare context is expected for ordinary local Next.js commands.
    return undefined;
  }
}

function getPool(): Pool {
  if (!globalForPool.sparkPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
    globalForPool.sparkPool = new Pool({
      connectionString,
      // Railway's public Postgres requires TLS; local does not.
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      // Small per-instance cap: on Vercel each warm lambda holds its own pool, so
      // many instances under a spike would otherwise multiply connections past
      // Railway Postgres's max. Keep it low; pair with caching + a pooler at scale.
      max: 3,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForPool.sparkPool;
}

async function acquireClient(): Promise<{ client: DatabaseClient; release: () => Promise<void> }> {
  const hyperdriveConnectionString = await getHyperdriveConnectionString();
  if (hyperdriveConnectionString) {
    // Hyperdrive owns the origin-side pool. Do not retain a pg Pool in the
    // Worker isolate: its stale client sockets cause intermittent 1101 errors.
    const client = new Client({ connectionString: hyperdriveConnectionString });
    await client.connect();
    return { client, release: () => client.end() };
  }

  const client = await getPool().connect();
  return { client, release: async () => client.release() };
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  let release: (() => Promise<void>) | undefined;
  try {
    const acquired = await acquireClient();
    release = acquired.release;
    const res = await acquired.client.query(text, params as never);
    return res.rows as T[];
  } catch (error) {
    // Cloudflare otherwise reports only pg-pool's rethrow frame. Keep this
    // intentionally limited to connection/error metadata: query parameters and
    // DATABASE_URL may contain customer data or credentials.
    const dbError = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      errno?: unknown;
      syscall?: unknown;
    };
    console.error("Postgres query failed", {
      name: typeof dbError.name === "string" ? dbError.name : undefined,
      message: typeof dbError.message === "string" ? dbError.message : undefined,
      code: typeof dbError.code === "string" ? dbError.code : undefined,
      errno: typeof dbError.errno === "string" ? dbError.errno : undefined,
      syscall: typeof dbError.syscall === "string" ? dbError.syscall : undefined,
    });
    throw error;
  } finally {
    await release?.();
  }
}

// Turn a stored image key into a servable URL. Full URLs pass through; bare
// keys are served via the cached /api/img proxy so the bucket can stay private.
export function imageUrl(key: string): string {
  if (/^https?:\/\//i.test(key)) return key;
  return `/api/img/${key.split("/").map(encodeURIComponent).join("/")}`;
}

import type { Run, ProjectDataset } from "./types";

interface ProjectRow {
  id: string;
  title: string;
  blurb: string;
  client_type: string;
  partner: string;
  contact: string | null;
  contacts: ProjectContact[] | null;
  tech: string[];
  images: string[];
  featured: boolean;
  custom: boolean;
  published: boolean;
  surfaces: string[] | null;
  owner_org: string | null;
  repo_url: string | null;
  prod_url: string | null;
  code_private: boolean;
  client_url: string | null;
  client_desc: string | null;
  topics: string[] | null;
  datasets: ProjectDataset[] | null;
  pd_url: string | null;
  drive_url: string | null;
  tech_note: string | null;
  blurb_locked: boolean;
  spark_program_lead: string | null;
  pm: string | null;
  tpm: string | null;
  senior_advisor: string | null;
  tech_advisor: string | null;
  eir: string | null;
  eir_is_instructor: boolean;
  class_instructors: string[] | null;
  runs: Run[] | null;
}

// includePrivate=false (the default for anything feeding public pages) strips
// students + teamId from each run — those are admin-only and must never reach
// the client/HTML.
function rowToProject(r: ProjectRow, includePrivate = false): Project {
  const runs: Run[] = (r.runs ?? []).map((run) => ({
    term: run.term,
    course: run.course,
    discipline: disciplineFromCourse(run.course) || run.discipline,
    students: includePrivate ? run.students ?? [] : [],
    teamId: includePrivate ? run.teamId ?? null : null,
    // Per-semester admin-only roles + PD link — stripped from public reads.
    ...(includePrivate
      ? {
          sparkProgramLead: run.sparkProgramLead ?? null,
          pm: run.pm ?? null,
          tpm: run.tpm ?? null,
          seniorAdvisor: run.seniorAdvisor ?? null,
          techAdvisor: run.techAdvisor ?? null,
          eir: run.eir ?? null,
          eirIsInstructor: run.eirIsInstructor ?? false,
          classInstructors: run.classInstructors ?? [],
          pdUrl: run.pdUrl ?? null,
        }
      : {}),
  }));
  // Project-level roles + pdUrl are DERIVED from the latest run (highest
  // semesterRank). Falls back to the legacy project columns when a run hasn't
  // got the value yet (transition / pre-migration safety). Admin reads only.
  const latest = includePrivate
    ? [...(r.runs ?? [])].sort((a, b) => semesterRank(b.term) - semesterRank(a.term))[0]
    : undefined;
  return {
    id: r.id,
    title: r.title,
    blurb: r.blurb,
    clientType: r.client_type,
    partner: r.partner,
    // Contact person(s) are admin-only — only included for privileged reads.
    contact: includePrivate ? r.contact ?? null : null,
    contacts: includePrivate ? r.contacts ?? [] : [],
    // PD doc link is admin-only — DERIVED from the latest run (per-semester now).
    pdUrl: includePrivate ? (latest?.pdUrl ?? r.pd_url ?? null) : null,
    driveUrl: includePrivate ? r.drive_url ?? null : null,
    // Raw tech-stack cell is admin-only context for curating the public tech[].
    techNote: includePrivate ? r.tech_note ?? null : null,
    // Importer reads this to skip overwriting hand-edited blurbs (see /api/import).
    blurbLocked: r.blurb_locked ?? false,
    // Team roles are admin-only and PER-SEMESTER — these project-level values are
    // DERIVED from the latest run (falling back to legacy columns pre-migration).
    sparkProgramLead: includePrivate ? (latest?.sparkProgramLead ?? r.spark_program_lead ?? null) : null,
    pm: includePrivate ? (latest?.pm ?? r.pm ?? null) : null,
    tpm: includePrivate ? (latest?.tpm ?? r.tpm ?? null) : null,
    seniorAdvisor: includePrivate ? (latest?.seniorAdvisor ?? r.senior_advisor ?? null) : null,
    techAdvisor: includePrivate ? (latest?.techAdvisor ?? r.tech_advisor ?? null) : null,
    eir: includePrivate ? (latest?.eir ?? r.eir ?? null) : null,
    eirIsInstructor: includePrivate ? (latest?.eirIsInstructor ?? r.eir_is_instructor ?? false) : undefined,
    classInstructors: includePrivate ? (latest?.classInstructors ?? r.class_instructors ?? []) : [],
    tech: r.tech ?? [],
    images: (r.images ?? []).map(imageUrl),
    featured: r.featured,
    custom: r.custom,
    published: r.published,
    repoUrl: r.repo_url,
    prodUrl: r.prod_url ?? null,
    // Public-safe operational fields (no PII).
    codePrivate: r.code_private ?? false,
    clientUrl: r.client_url ?? null,
    clientDesc: r.client_desc ?? null,
    surfaces: r.surfaces ?? ["spark"],
    // Which team may EDIT this project (authority), as opposed to `surfaces`
    // above, which is only which gallery shows it (visibility).
    //
    // Set unconditionally, NOT gated on includePrivate. The importer reads via
    // getAllProjects(), which uses the public projection — if this were private,
    // every ownerOrg would be undefined, the importer's candidate index would be
    // empty, and the PD sync would silently stop matching anything at all.
    ownerOrg: r.owner_org ?? "spark",
    topics: r.topics ?? [],
    datasets: r.datasets ?? [],
    runs,
  };
}

const COLS =
  "id, title, blurb, client_type, partner, contact, contacts, tech, images, featured, custom, published, repo_url, prod_url, code_private, client_url, client_desc, surfaces, owner_org, topics, datasets, pd_url, drive_url, tech_note, blurb_locked, spark_program_lead, pm, tpm, senior_advisor, tech_advisor, eir, eir_is_instructor, class_instructors, runs";

// PUBLIC reads — only published projects, private run fields stripped. Cached in
// the Next data cache and tagged "projects" so every visitor doesn't trigger a
// fresh full-table load + DB connection; admin mutations call revalidateTag
// ("projects") for instant updates, with a 5-min TTL as a safety net. (Admin
// reads — getAllProjects/getProjectAdmin — are intentionally NOT cached.)
export const getProjects = unstable_cache(
  async (): Promise<Project[]> => {
    const rows = await query<ProjectRow>(
      `SELECT ${COLS} FROM projects WHERE published = true ORDER BY featured DESC, custom DESC, created_at DESC, title ASC`
    );
    return rows.map((r) => rowToProject(r));
  },
  ["public-projects-list"],
  { tags: ["projects"], revalidate: 300 }
);

export const getProject = unstable_cache(
  async (id: string): Promise<Project | null> => {
    const rows = await query<ProjectRow>(
      `SELECT ${COLS} FROM projects WHERE id = $1 AND published = true`,
      [id]
    );
    return rows[0] ? rowToProject(rows[0]) : null;
  },
  ["public-project"],
  { tags: ["projects"], revalidate: 300 }
);

// ADMIN reads — all projects (incl. drafts). List view strips private fields;
// getProjectAdmin returns the full record (students/teamId) for the edit form.
export async function getAllProjects(): Promise<Project[]> {
  const rows = await query<ProjectRow>(
    `SELECT ${COLS} FROM projects ORDER BY published ASC, featured DESC, created_at DESC, title ASC`
  );
  return rows.map((r) => rowToProject(r));
}

export async function getProjectAdmin(id: string): Promise<Project | null> {
  const rows = await query<ProjectRow>(
    `SELECT ${COLS} FROM projects WHERE id = $1`,
    [id]
  );
  return rows[0] ? rowToProject(rows[0], true) : null;
}

// Owning team for a set of project ids, in ONE query. This is the read behind
// every permission check (lib/actor.ts requireProject/requireProjects), so it
// deliberately selects a single column rather than reusing getProjectAdmin — a
// permission check must not depend on the full admin projection.
//
// Ids absent from the returned map do not exist; the caller distinguishes 404
// (unknown id) from 403 (someone else's project).
export async function getProjectOrgs(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await query<{ id: string; owner_org: string | null }>(
    `SELECT id, owner_org FROM projects WHERE id = ANY($1)`,
    [ids]
  );
  return new Map(rows.map((r) => [r.id, r.owner_org ?? "spark"]));
}

// Move a project to another team. Deliberately NOT part of ProjectPatch: that
// interface is consumed by the PD importer and the inbox merge path, so an
// ownership field on it would be a bypass with two existing callers. Super-admin
// only — enforced at the route, and the CHECK constraint rejects unknown orgs.
export async function setProjectOwnerOrg(id: string, org: string): Promise<void> {
  if (!ORGS.includes(org as never)) throw new Error(`Unknown org: ${org}`);
  await query(`UPDATE projects SET owner_org = $2 WHERE id = $1`, [id, org]);
}

// Raw runs jsonb (with admin-only per-run fields: students/teamId/roles/pdUrl)
// for one project. Used by the PD importer to mutate the run matching a tracker
// row's semester WITHOUT going through the public projection (which would strip
// students/teamId and risk wiping them on write-back).
export async function getProjectRuns(id: string): Promise<Run[]> {
  const rows = await query<{ runs: Run[] | null }>(
    `SELECT runs FROM projects WHERE id = $1`,
    [id]
  );
  return rows[0]?.runs ?? [];
}

// Admin list/filter projection — like getAllProjects but WITH admin-only fields
// (incl. team-role names) so the admin projects page can show + filter by them.
// Auth-gated callers only (never a public route). getAllProjects stays public-
// projection so the importer's catalog reads carry no extra PII.
export async function getProjectsForList(): Promise<Project[]> {
  const rows = await query<ProjectRow>(
    `SELECT ${COLS} FROM projects ORDER BY published ASC, featured DESC, created_at DESC, title ASC`
  );
  // Attach the derived (admin-only) student-contributor count so the admin list
  // can flag "no contributors" the same way it flags other missingInfo() gaps.
  const counts = await getContributorCounts();
  return rows.map((r) => {
    const p = rowToProject(r, true);
    p.contributorCount = counts.get(r.id) ?? 0;
    return p;
  });
}

// `images` here are raw S3 keys (not resolved URLs); `runs` carry the
// per-semester detail including admin-only students/teamId.
export interface NewProject {
  id: string;
  title: string;
  blurb: string;
  clientType: string;
  partner: string;
  contact?: string | null;
  contacts?: ProjectContact[];
  tech: string[];
  images: string[];
  runs: Run[];
  repoUrl?: string | null;
  prodUrl?: string | null;
  pdUrl?: string | null; // admin-only PD doc link
  featured?: boolean;
  custom?: boolean;
  published?: boolean;
  /** Owning team. Callers MUST pass the acting admin's org (or, for inbox
   *  promotion, the inbox row's org) — never a client-supplied value. Omitted
   *  falls back to the DB default 'spark', which is fail-closed. */
  ownerOrg?: string;
}

// Normalize a contacts list for storage: trim name/email, drop rows that are
// entirely blank, and coerce to the {name, email} shape. Keeps a row that has
// only a name or only an email (partial entries are allowed).
function cleanContacts(list: ProjectContact[] | undefined | null): ProjectContact[] {
  return (list ?? [])
    .map((c) => ({
      name: String(c?.name ?? "").trim(),
      email: String(c?.email ?? "").trim(),
    }))
    .filter((c) => c.name || c.email);
}

// Per-run single-name role fields (Run key → directory label). class_instructors
// (array) + eirIsInstructor (bool) are handled separately.
const RUN_ROLE_FIELDS: [keyof Run, string][] = [
  ["sparkProgramLead", "Program Lead"],
  ["pm", "PM"],
  ["tpm", "TPM"],
  ["seniorAdvisor", "Senior Advisor"],
  ["techAdvisor", "Tech Advisor"],
  ["eir", "EIR"],
];

// Sanitize the per-run admin-only role fields before persisting the runs jsonb:
// placeholder names (N/A, TBD, …) become null and class-instructor lists are
// cleaned + deduped. Preserves all other run fields (term/course/students/teamId).
function cleanRuns(runs: Run[] | undefined | null): Run[] {
  return (runs ?? []).map((run) => {
    const out: Run = { ...run };
    for (const [field] of RUN_ROLE_FIELDS) {
      (out[field] as string | null) = cleanPersonName(String(out[field] ?? "")) || null;
    }
    if (out.classInstructors !== undefined) {
      const seen = new Set<string>();
      const ci: string[] = [];
      for (const raw of out.classInstructors ?? []) {
        const name = cleanPersonName(String(raw ?? ""));
        if (!name) continue;
        const key = normalizeName(name);
        if (seen.has(key)) continue;
        seen.add(key);
        ci.push(name);
      }
      out.classInstructors = ci;
    }
    if (out.pdUrl !== undefined && out.pdUrl !== null) {
      out.pdUrl = String(out.pdUrl).trim() || null;
    }
    return out;
  });
}

// True when two term strings name the same semester (rank-based, format-tolerant).
export function termsEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  const ra = semesterRank(a), rb = semesterRank(b);
  if (ra && rb) return ra === rb;
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

export async function addProject(p: NewProject): Promise<void> {
  // Fall back to 'spark' rather than trusting an unvalidated value through to the
  // CHECK constraint — an unknown org here should become an ordinary Spark project,
  // not a failed insert on the admin's create form.
  const ownerOrg = ORGS.includes((p.ownerOrg ?? "") as never) ? (p.ownerOrg as string) : "spark";
  await query(
    `INSERT INTO projects
       (id, title, blurb, client_type, partner, tech, images, featured, custom, published, repo_url, runs, contact, prod_url, pd_url, contacts, owner_org, surfaces)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16::jsonb,$17,$18)
     ON CONFLICT (id) DO UPDATE SET
       title=EXCLUDED.title, blurb=EXCLUDED.blurb, client_type=EXCLUDED.client_type,
       partner=EXCLUDED.partner, tech=EXCLUDED.tech, images=EXCLUDED.images,
       featured=EXCLUDED.featured, published=EXCLUDED.published,
       repo_url=EXCLUDED.repo_url, runs=EXCLUDED.runs,
       prod_url=EXCLUDED.prod_url, pd_url=EXCLUDED.pd_url`,
    // contact/contacts intentionally omitted from DO UPDATE: the importer/inbox
    // creation path never carries them, so an id collision must NOT wipe contacts
    // an admin already entered. New manual adds use a unique id (no conflict).
    //
    // owner_org and surfaces are omitted from DO UPDATE for the same reason and a
    // sharper one: an id collision must never silently transfer a project to
    // another team, nor reset the galleries an admin deliberately chose.
    [
      p.id,
      p.title,
      p.blurb,
      p.clientType,
      p.partner,
      p.tech,
      p.images,
      p.featured ?? false,
      p.custom ?? true,
      p.published ?? true,
      p.repoUrl ?? null,
      JSON.stringify(cleanRuns(p.runs)),
      p.contact ?? null,
      p.prodUrl ?? null,
      p.pdUrl ?? null,
      JSON.stringify(cleanContacts(p.contacts ?? [])),
      ownerOrg,
      // Surfaces DERIVES from ownership. Letting this fall through to the column
      // default ('{spark}') would mean a CDS admin's new project appears in the
      // SPARK gallery and nowhere a CDS admin would think to look for it. A super
      // admin can still add the other gallery afterwards.
      [ownerOrg],
    ]
  );
}

// Partial update for the admin edit form. Only provided fields are changed.
export interface ProjectPatch {
  title?: string;
  blurb?: string;
  clientType?: string;
  partner?: string;
  contact?: string | null;
  contacts?: ProjectContact[];
  tech?: string[];
  images?: string[];
  repoUrl?: string | null;
  prodUrl?: string | null;
  codePrivate?: boolean;
  clientUrl?: string | null;
  clientDesc?: string | null;
  surfaces?: string[];
  topics?: string[];
  datasets?: ProjectDataset[];
  pdUrl?: string | null; // admin-only PD doc link (distinct from prodUrl)
  driveUrl?: string | null; // admin-only project Drive folder
  techNote?: string | null; // admin-only raw PD tech-stack cell
  blurbLocked?: boolean; // when true, re-sync won't overwrite the blurb
  sparkProgramLead?: string | null; // admin-only team roles
  pm?: string | null;
  tpm?: string | null;
  seniorAdvisor?: string | null;
  techAdvisor?: string | null;
  eir?: string | null;
  eirIsInstructor?: boolean; // admin-only; EIR person is actually a class instructor
  classInstructors?: string[]; // admin-only; multiple names allowed
  featured?: boolean;
  published?: boolean;
  runs?: Run[];
  blurbTerm?: string | null; // provenance: semester the blurb was extracted from
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, val: unknown, cast = "") => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}${cast}`);
  };
  if (patch.title !== undefined) add("title", patch.title);
  if (patch.blurb !== undefined) add("blurb", patch.blurb);
  if (patch.clientType !== undefined) add("client_type", patch.clientType);
  if (patch.partner !== undefined) add("partner", patch.partner);
  if (patch.contact !== undefined) add("contact", patch.contact);
  if (patch.contacts !== undefined)
    add("contacts", JSON.stringify(cleanContacts(patch.contacts)), "::jsonb");
  if (patch.tech !== undefined) add("tech", patch.tech);
  if (patch.images !== undefined) add("images", patch.images);
  if (patch.repoUrl !== undefined) add("repo_url", patch.repoUrl);
  if (patch.prodUrl !== undefined) add("prod_url", patch.prodUrl);
  if (patch.codePrivate !== undefined) add("code_private", patch.codePrivate);
  if (patch.clientUrl !== undefined) add("client_url", patch.clientUrl);
  if (patch.clientDesc !== undefined) add("client_desc", patch.clientDesc);
  if (patch.surfaces !== undefined) add("surfaces", patch.surfaces);
  if (patch.topics !== undefined) add("topics", patch.topics);
  if (patch.datasets !== undefined)
    add("datasets", JSON.stringify(patch.datasets), "::jsonb");
  if (patch.pdUrl !== undefined) add("pd_url", patch.pdUrl);
  if (patch.driveUrl !== undefined) add("drive_url", patch.driveUrl);
  if (patch.techNote !== undefined) add("tech_note", patch.techNote);
  if (patch.blurbLocked !== undefined) add("blurb_locked", patch.blurbLocked);
  // Sanitize the 6 team-role names: placeholders like "N/A", "TBD", "none" mean
  // "no person assigned" and are stored as NULL, so they never seed a bogus
  // directory entry or role/count in listPeople(). Mirrors the PD importer, which
  // already cleans these via cleanPersonName — this closes the manual-edit path.
  const cleanRole = (v: string | null | undefined): string | null =>
    cleanPersonName(String(v ?? "")) || null;
  if (patch.sparkProgramLead !== undefined) add("spark_program_lead", cleanRole(patch.sparkProgramLead));
  if (patch.pm !== undefined) add("pm", cleanRole(patch.pm));
  if (patch.tpm !== undefined) add("tpm", cleanRole(patch.tpm));
  if (patch.seniorAdvisor !== undefined) add("senior_advisor", cleanRole(patch.seniorAdvisor));
  if (patch.techAdvisor !== undefined) add("tech_advisor", cleanRole(patch.techAdvisor));
  if (patch.eir !== undefined) add("eir", cleanRole(patch.eir));
  if (patch.eirIsInstructor !== undefined) add("eir_is_instructor", patch.eirIsInstructor);
  // Multi-value: clean each name, drop placeholders/blanks, dedupe by display name.
  if (patch.classInstructors !== undefined) {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of patch.classInstructors) {
      const name = cleanPersonName(String(raw ?? ""));
      if (!name) continue;
      const k = normalizeName(name);
      if (seen.has(k)) continue;
      seen.add(k);
      cleaned.push(name);
    }
    add("class_instructors", cleaned);
  }
  if (patch.featured !== undefined) add("featured", patch.featured);
  if (patch.published !== undefined) add("published", patch.published);
  if (patch.runs !== undefined) add("runs", JSON.stringify(cleanRuns(patch.runs)), "::jsonb");
  if (patch.blurbTerm !== undefined) add("blurb_term", patch.blurbTerm);
  if (!sets.length) return;
  vals.push(id);
  await query(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = $${vals.length}`,
    vals
  );
}

export async function removeProject(id: string): Promise<void> {
  // Best-effort: delete the project's S3 images before the row so removing a
  // project doesn't orphan objects in the bucket (mirrors approve/reject cleanup).
  const rows = await query<{ images: string[] }>(
    `SELECT images FROM projects WHERE id = $1`,
    [id]
  );
  for (const k of rows[0]?.images ?? []) await deleteObject(k);
  await query(`DELETE FROM projects WHERE id = $1`, [id]);
}

// Scalar project-level winners the merge modal resolved. Anything omitted falls
// back to the populated side (survivor wins ties). Per-semester data (runs/roles/
// PD, contributors, role timeline) is NOT here — it combines automatically.
export interface MergeResolution {
  title?: string;
  blurb?: string;
  // True when the chosen blurb is the absorbed project's — its blurb_term +
  // blurb_locked then travel with it (provenance follows the text).
  blurbFromAbsorbed?: boolean;
  partner?: string;
  clientType?: string;
  repoUrl?: string | null;
  prodUrl?: string | null;
  driveUrl?: string | null;
  techNote?: string | null;
  featured?: boolean;
  published?: boolean;
}

// Combine two runs that name the same (term, course): union students + class
// instructors, prefer the survivor's non-empty role/teamId/discipline/pdUrl, OR the
// eir-is-instructor flag. Pure.
function mergeRunLists(survivorRuns: Run[], absorbedRuns: Run[]): Run[] {
  const sameCourse = (a: string, b: string) =>
    (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
  const role = (x?: string | null, y?: string | null): string | null =>
    (x && x.trim() ? x : y && y.trim() ? y : x ?? y ?? null);
  const out: Run[] = survivorRuns.map((r) => ({ ...r }));
  for (const r of absorbedRuns) {
    const idx = out.findIndex((x) => termsEqual(x.term, r.term) && sameCourse(x.course, r.course));
    if (idx < 0) {
      out.push({ ...r });
      continue;
    }
    const s = out[idx];
    const seenStu = new Set<string>();
    const students: string[] = [];
    for (const n of [...(s.students ?? []), ...(r.students ?? [])]) {
      const k = normalizeName(n);
      if (n && !seenStu.has(k)) { seenStu.add(k); students.push(n); }
    }
    const seenCi = new Set<string>();
    const classInstructors: string[] = [];
    for (const n of [...(s.classInstructors ?? []), ...(r.classInstructors ?? [])]) {
      const k = normalizeName(n);
      if (n && !seenCi.has(k)) { seenCi.add(k); classInstructors.push(n); }
    }
    out[idx] = {
      ...s,
      students,
      teamId: (s.teamId && s.teamId.trim() ? s.teamId : r.teamId) ?? null,
      discipline: s.discipline || r.discipline,
      pdUrl: (s.pdUrl && s.pdUrl.trim() ? s.pdUrl : r.pdUrl) ?? null,
      sparkProgramLead: role(s.sparkProgramLead, r.sparkProgramLead),
      pm: role(s.pm, r.pm),
      tpm: role(s.tpm, r.tpm),
      seniorAdvisor: role(s.seniorAdvisor, r.seniorAdvisor),
      techAdvisor: role(s.techAdvisor, r.techAdvisor),
      eir: role(s.eir, r.eir),
      eirIsInstructor: !!s.eirIsInstructor || !!r.eirIsInstructor,
      classInstructors,
    };
  }
  return out;
}

// Merge the ABSORBED project into the SURVIVOR, then delete the absorbed record.
// Per-semester data combines automatically (each run keeps its own team); only the
// project-level scalars in `resolution` were chosen by the admin. Atomic: one
// transaction, mirroring mergePeople. Returns false if either id is missing.
export type MergeOutcome =
  | { ok: true }
  | { ok: false; reason: "missing" | "cross-org" };

export async function mergeProjects(
  survivorId: string,
  absorbedId: string,
  resolution: MergeResolution,
  actor: Actor
): Promise<MergeOutcome> {
  if (survivorId === absorbedId) return { ok: false, reason: "missing" };
  // Idempotent table guards BEFORE the txn (a missing relation would abort it).
  await ensureContributorsTable();
  await ensurePersonRolesTable();
  await ensureIngestTables(); // project_aliases

  type RawRow = {
    id: string; title: string; blurb: string; blurb_term: string | null;
    blurb_locked: boolean; partner: string; client_type: string;
    contact: string | null; contacts: ProjectContact[] | null;
    tech: string[] | null; images: string[] | null;
    repo_url: string | null; prod_url: string | null; drive_url: string | null;
    tech_note: string | null; featured: boolean; published: boolean; runs: Run[] | null;
    surfaces: string[] | null; owner_org: string | null;
  };

  const nz = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

  const { client, release } = await acquireClient();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<RawRow>(
      `SELECT id, title, blurb, blurb_term, blurb_locked, partner, client_type,
              contact, contacts, tech, images, repo_url, prod_url, drive_url,
              tech_note, featured, published, runs, surfaces, owner_org
         FROM projects WHERE id = ANY($1)
         ORDER BY id
         FOR UPDATE`,
      [[survivorId, absorbedId]]
    );
    const survivor = rows.find((r) => r.id === survivorId);
    const absorbed = rows.find((r) => r.id === absorbedId);
    if (!survivor || !absorbed) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "missing" };
    }

    // Two-sided authority check, deliberately INSIDE the transaction and against
    // the rows we just SELECTed. The route also guards, but only this check is
    // race-free: a pre-check via getProjectAdmin reads outside the txn and could be
    // invalidated by a concurrent ownership reassignment before the UPDATE lands.
    // A merge deletes the absorbed project, so a one-sided check would let a scoped
    // admin destroy the other team's record.
    //
    // FOR UPDATE is what actually makes that true. Being inside the transaction is
    // not sufficient on its own: under READ COMMITTED an unlocked SELECT lets a
    // concurrent `UPDATE projects SET owner_org = …` commit between this read and
    // the UPDATE below, and the merge would then proceed on ownership that no longer
    // holds. ORDER BY id fixes the lock order so two merges over the same pair
    // queue instead of deadlocking.
    if (
      !canMerge(
        actor,
        survivor.owner_org ?? "spark",
        absorbed.owner_org ?? "spark"
      )
    ) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "cross-org" };
    }

    // Scalars: resolution wins; else the populated side (survivor on tie).
    const title = resolution.title ?? (survivor.title || absorbed.title);
    const blurb = resolution.blurb ?? (survivor.blurb || absorbed.blurb);
    // Blurb provenance follows the chosen text: explicit flag from the modal, or
    // (when neither was chosen) whichever side actually supplied the blurb.
    const blurbFromAbsorbed =
      resolution.blurbFromAbsorbed ?? (!survivor.blurb?.trim() && !!absorbed.blurb?.trim());
    const blurbTerm = blurbFromAbsorbed ? absorbed.blurb_term : survivor.blurb_term;
    const blurbLocked = blurbFromAbsorbed ? absorbed.blurb_locked : survivor.blurb_locked;
    const partner = resolution.partner ?? (survivor.partner || absorbed.partner);
    const clientType = resolution.clientType ?? (survivor.client_type || absorbed.client_type);
    const repoUrl = resolution.repoUrl !== undefined ? resolution.repoUrl : (nz(survivor.repo_url) ?? nz(absorbed.repo_url));
    const prodUrl = resolution.prodUrl !== undefined ? resolution.prodUrl : (nz(survivor.prod_url) ?? nz(absorbed.prod_url));
    const driveUrl = resolution.driveUrl !== undefined ? resolution.driveUrl : (nz(survivor.drive_url) ?? nz(absorbed.drive_url));
    const techNote = resolution.techNote !== undefined ? resolution.techNote : (nz(survivor.tech_note) ?? nz(absorbed.tech_note));
    const featured = resolution.featured !== undefined ? resolution.featured : survivor.featured;
    const published = resolution.published !== undefined ? resolution.published : survivor.published;
    const contact = nz(survivor.contact) ?? nz(absorbed.contact);

    // Per-semester data combines automatically.
    const runs = cleanRuns(mergeRunLists(survivor.runs ?? [], absorbed.runs ?? []));
    // tech union (case-insensitive dedupe, preserve original casing).
    const techSeen = new Set<string>();
    const tech: string[] = [];
    for (const t of [...(survivor.tech ?? []), ...(absorbed.tech ?? [])]) {
      const k = t.trim().toLowerCase();
      if (t.trim() && !techSeen.has(k)) { techSeen.add(k); tech.push(t.trim()); }
    }
    // contacts union by name+email.
    const cSeen = new Set<string>();
    const contacts: ProjectContact[] = [];
    for (const c of [...(survivor.contacts ?? []), ...(absorbed.contacts ?? [])]) {
      const k = `${(c.name || "").trim().toLowerCase()}|${(c.email || "").trim().toLowerCase()}`;
      if ((c.name || c.email) && !cSeen.has(k)) { cSeen.add(k); contacts.push(c); }
    }
    // images: survivor first, dedupe, cap at the 4-slot limit (bare keys).
    const images = [...new Set([...(survivor.images ?? []), ...(absorbed.images ?? [])])].slice(0, 4);

    // surfaces UNION. Previously `surfaces` was simply absent from the UPDATE
    // below, so a merge silently dropped the absorbed project's gallery
    // membership. Union rather than survivor-wins: a merge is a record-keeping
    // operation and must not remove a project from a gallery someone deliberately
    // put it in. Safe because surfaces grants no authority — owner_org does.
    // Never emptied, mirroring the fallback in PATCH /api/projects/[id].
    const surfaces = [
      ...new Set([...(survivor.surfaces ?? []), ...(absorbed.surfaces ?? [])]),
    ].filter((s) => SURFACE_KEYS.includes(s));

    // owner_org is NOT merged: the surviving record keeps its own owner. Union is
    // meaningless for a single-valued authority field, and "the survivor keeps its
    // owner" is the only rule that needs no explanation later. Deliberately absent
    // from MergeResolution so the merge modal can never become a covert
    // ownership-transfer path — that's setProjectOwnerOrg, which is super-only.
    await client.query(
      `UPDATE projects SET
         title=$1, blurb=$2, blurb_term=$3, blurb_locked=$4, partner=$5, client_type=$6,
         contact=$7, contacts=$8::jsonb, tech=$9, images=$10, repo_url=$11, prod_url=$12,
         drive_url=$13, tech_note=$14, featured=$15, published=$16, runs=$17::jsonb,
         surfaces=$19
       WHERE id=$18`,
      [title, blurb, blurbTerm, blurbLocked, partner, clientType, contact,
       JSON.stringify(contacts), tech, images, repoUrl, prodUrl, driveUrl, techNote,
       featured, published, JSON.stringify(runs), survivorId,
       surfaces.length ? surfaces : ["spark"]]
    );

    // Re-point per-semester satellites to the survivor.
    await client.query(`UPDATE contributors SET project_id=$1 WHERE project_id=$2`, [survivorId, absorbedId]);
    await client.query(
      `INSERT INTO person_roles (person_id, project_id, term, role)
       SELECT person_id, $1, term, role FROM person_roles WHERE project_id=$2
       ON CONFLICT (person_id, project_id, term, role) DO NOTHING`,
      [survivorId, absorbedId]
    );
    await client.query(`DELETE FROM person_roles WHERE project_id=$1`, [absorbedId]);

    // Re-point existing aliases + add the absorbed title (and survivor's old title,
    // if it changed) so future PD syncs still match the merged project.
    await client.query(`UPDATE project_aliases SET project_id=$1 WHERE project_id=$2`, [survivorId, absorbedId]);
    const aliasKeys = new Set<string>();
    const ak = matchKey(absorbed.title);
    if (ak) aliasKeys.add(ak);
    if (title !== survivor.title) {
      const sk = matchKey(survivor.title);
      if (sk) aliasKeys.add(sk);
    }
    for (const k of aliasKeys) {
      await client.query(
        `INSERT INTO project_aliases (name_key, project_id) VALUES ($1,$2)
         ON CONFLICT (name_key) DO UPDATE SET project_id=EXCLUDED.project_id, created_at=now()`,
        [k, survivorId]
      );
    }

    // Redirect old links: /projects/<absorbed> → survivor. Collapse any existing
    // chain (rows that pointed AT the absorbed id now point at the survivor), drop
    // a stale row FROM the survivor, then map the absorbed id → survivor.
    await client.query(`UPDATE project_redirects SET to_id=$1 WHERE to_id=$2`, [survivorId, absorbedId]);
    await client.query(`DELETE FROM project_redirects WHERE from_id=$1`, [survivorId]);
    await client.query(
      `INSERT INTO project_redirects (from_id, to_id) VALUES ($1,$2)
       ON CONFLICT (from_id) DO UPDATE SET to_id=EXCLUDED.to_id, created_at=now()`,
      [absorbedId, survivorId]
    );

    await client.query(`DELETE FROM projects WHERE id=$1`, [absorbedId]);
    await client.query("COMMIT");

    // Best-effort S3 cleanup AFTER commit: only absorbed keys not carried over.
    const finalImages = new Set(images);
    for (const k of absorbed.images ?? []) {
      if (!finalImages.has(k)) {
        try { await deleteObject(k); } catch { /* orphan tolerated, mirrors removeProject */ }
      }
    }
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await release();
  }
}

// Map of project id → the semester its current blurb came from (or null). Loaded
// once by the PD importer to keep the LATEST semester's blurb (see /api/import).
export async function getBlurbTermMap(): Promise<Map<string, string | null>> {
  const rows = await query<{ id: string; blurb_term: string | null }>(
    `SELECT id, blurb_term FROM projects`
  );
  return new Map(rows.map((r) => [r.id, r.blurb_term]));
}

// --- Ingestion reconciliation: import inbox + DB-backed aliases ---------------
// The futureproof half of the importer. Two problems the old "update-only" flow
// couldn't solve for an arbitrary semester/project:
//   (1) a tracker row that matches NO catalog project was silently dropped →
//       invisible forever. Now it lands in `import_inbox` so it is always
//       accounted for; an admin triages it (create / merge / dismiss).
//   (2) a project RENAMED on the tracker needed a hardcoded alias + a deploy.
//       Now "merge" writes a `project_aliases` row so the next sync auto-matches
//       — no code change. The code-level PROJECT_ALIASES is just the seed.
// Both tables are lazily created (mirrors people/upload_requests), so no
// migration-before-deploy ordering risk. Admin-only data — never public.
let ingestEnsured = false;
async function ensureIngestTables(): Promise<void> {
  if (ingestEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS import_inbox (
       id         bigserial PRIMARY KEY,
       name_key   text NOT NULL,            -- matchKey(rawName); dedup across tabs/syncs
       raw_name   text NOT NULL,            -- original tracker project name
       partner    text,
       course     text,
       term       text,
       blurb      text,
       pd_url     text,
       tech_note  text,
       tech       text[] NOT NULL DEFAULT '{}',
       repo_url   text,
       roles      jsonb NOT NULL DEFAULT '{}',  -- {sparkProgramLead,pm,tpm,...}
       status     text NOT NULL DEFAULT 'pending', -- pending | dismissed
       org        text NOT NULL DEFAULT 'spark',  -- which team's feed produced it
       first_seen timestamptz NOT NULL DEFAULT now(),
       last_seen  timestamptz NOT NULL DEFAULT now(),
       seen_count int NOT NULL DEFAULT 1
     )`
  );
  // Keyed on (org, name_key), not name_key alone: two teams' trackers can hold a
  // project with the same normalized name, and a single-column key would make one
  // team's sync UPSERT onto the other team's inbox row.
  //
  // This MUST stay in step with hub/db/migrations/001_owner_org.sql — on an
  // existing DB these are no-ops, but on a FRESH one this lazy DDL is the only
  // thing that runs, so a stale definition here silently recreates the old key.
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_import_inbox_org_name_key ON import_inbox (org, name_key)`
  );
  await query(
    `CREATE TABLE IF NOT EXISTS project_aliases (
       name_key   text PRIMARY KEY,         -- matchKey(trackerName)
       project_id text NOT NULL,            -- catalog id it resolves to
       created_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  // When two records are MERGED, the absorbed slug is deleted; this maps its old
  // /projects/<from_id> URL to the survivor so old links 308-redirect instead of
  // 404ing. Chains are collapsed on write (see mergeProjects), so to_id is always
  // a live project, never another redirect.
  await query(
    `CREATE TABLE IF NOT EXISTS project_redirects (
       from_id    text PRIMARY KEY,         -- deleted (absorbed) slug
       to_id      text NOT NULL,            -- surviving project id
       created_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  ingestEnsured = true;
}

// Resolve a slug that has no live project to its merge survivor (or null). Cheap,
// uncached — only hit on the 404 path of the public project page.
export async function getProjectRedirect(fromId: string): Promise<string | null> {
  await ensureIngestTables();
  const rows = await query<{ to_id: string }>(
    `SELECT to_id FROM project_redirects WHERE from_id = $1`,
    [fromId]
  );
  return rows[0]?.to_id ?? null;
}

// Per-role names carried alongside an inbox row, so create/merge can apply them
// without re-parsing. Empty/blank values are normalized to null before storage.
export interface InboxRoles {
  sparkProgramLead?: string | null;
  pm?: string | null;
  tpm?: string | null;
  seniorAdvisor?: string | null;
  techAdvisor?: string | null;
  eir?: string | null;
}
export interface InboxPayload {
  rawName: string;
  partner?: string | null;
  course?: string | null;
  term?: string | null;
  blurb?: string | null;
  pdUrl?: string | null;
  techNote?: string | null;
  tech?: string[];
  repoUrl?: string | null;
  roles?: InboxRoles;
}
export interface InboxRow extends InboxPayload {
  id: string; // bigserial — node-postgres returns as string
  nameKey: string;
  status: "pending" | "dismissed";
  /** Which team's feed produced this row. Triage uses THIS, not the acting
   *  admin's org, to decide who may act on it and what a created project ends up
   *  owned by. */
  org: string;
  seenCount: number;
  firstSeen: string;
  lastSeen: string;
}

const nz = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t || null;
};

// Resolved alias map: code seed first, DB rows override/extend it. Keyed by
// matchKey form — the importer looks up aliasMap[matchKey(name)]. Loaded once
// per sync request.
export async function getAliasMap(): Promise<Record<string, string>> {
  await ensureIngestTables();
  const rows = await query<{ name_key: string; project_id: string }>(
    `SELECT name_key, project_id FROM project_aliases`
  );
  const map: Record<string, string> = { ...PROJECT_ALIASES };
  for (const r of rows) map[r.name_key] = r.project_id;
  return map;
}

export async function addAlias(nameKey: string, projectId: string): Promise<void> {
  await ensureIngestTables();
  await query(
    `INSERT INTO project_aliases (name_key, project_id) VALUES ($1, $2)
     ON CONFLICT (name_key) DO UPDATE SET project_id = EXCLUDED.project_id, created_at = now()`,
    [nameKey, projectId]
  );
}

// Record an unmatched tracker row. Idempotent on name_key: re-syncs refresh the
// payload (filling only blanks, never nulling good data) and bump seen_count. A
// row the admin DISMISSED stays dismissed even if it keeps appearing (status is
// not touched by the upsert).
// `org` identifies which team's feed produced the row. It comes from the caller
// (IMPORT_ORG for the Apps Script, the acting admin's org for a CSV import) and
// is what lets triage decide ownership WITHOUT trusting whoever happens to open
// the inbox — deriving it at triage time would let a CDS admin turn a
// Spark-sourced row into a CDS-owned project.
export async function upsertInboxRow(p: InboxPayload, org: string): Promise<void> {
  const nameKey = matchKey(p.rawName);
  if (!nameKey) return;
  if (!ORGS.includes(org as never)) throw new Error(`Unknown org: ${org}`);
  await ensureIngestTables();
  // Keep only present roles, so the jsonb `roles || EXCLUDED.roles` merge below
  // can ADD newly-seen roles without a later blank cell nulling a prior one.
  const cleanRoles: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.roles ?? {})) {
    const t = nz(v);
    if (t) cleanRoles[k] = t;
  }
  await query(
    `INSERT INTO import_inbox
       (name_key, raw_name, partner, course, term, blurb, pd_url, tech_note, tech, repo_url, roles, org)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     -- Conflict target must match idx_import_inbox_org_name_key exactly; on
     -- (name_key) alone Postgres errors with "no unique or exclusion constraint
     -- matching the ON CONFLICT specification" and every sync 500s.
     ON CONFLICT (org, name_key) DO UPDATE SET
       raw_name  = EXCLUDED.raw_name,
       partner   = COALESCE(EXCLUDED.partner,   import_inbox.partner),
       course    = COALESCE(EXCLUDED.course,    import_inbox.course),
       term      = COALESCE(EXCLUDED.term,      import_inbox.term),
       blurb     = COALESCE(EXCLUDED.blurb,     import_inbox.blurb),
       pd_url    = COALESCE(EXCLUDED.pd_url,    import_inbox.pd_url),
       tech_note = COALESCE(EXCLUDED.tech_note, import_inbox.tech_note),
       tech      = CASE WHEN COALESCE(array_length(EXCLUDED.tech,1),0) > 0
                        THEN EXCLUDED.tech ELSE import_inbox.tech END,
       repo_url  = COALESCE(EXCLUDED.repo_url,  import_inbox.repo_url),
       roles     = import_inbox.roles || EXCLUDED.roles,
       last_seen = now(),
       seen_count = import_inbox.seen_count + 1`,
    [
      nameKey,
      p.rawName,
      nz(p.partner),
      nz(p.course),
      nz(p.term),
      nz(p.blurb),
      nz(p.pdUrl),
      nz(p.techNote),
      p.tech ?? [],
      nz(p.repoUrl),
      JSON.stringify(cleanRoles),
      org,
    ]
  );
}

interface InboxDbRow {
  id: string; // bigserial — node-postgres returns as string
  name_key: string;
  raw_name: string;
  partner: string | null;
  course: string | null;
  term: string | null;
  blurb: string | null;
  pd_url: string | null;
  tech_note: string | null;
  tech: string[];
  repo_url: string | null;
  roles: InboxRoles;
  status: "pending" | "dismissed";
  org: string | null;
  seen_count: number;
  first_seen: string;
  last_seen: string;
}
const toInboxRow = (r: InboxDbRow): InboxRow => ({
  id: r.id,
  nameKey: r.name_key,
  rawName: r.raw_name,
  partner: r.partner,
  course: r.course,
  term: r.term,
  blurb: r.blurb,
  pdUrl: r.pd_url,
  techNote: r.tech_note,
  tech: r.tech ?? [],
  repoUrl: r.repo_url,
  roles: r.roles ?? {},
  status: r.status,
  org: r.org ?? "spark",
  seenCount: r.seen_count,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
});

// Scoped to the actor's org unless they're a super admin. Necessary regardless of
// ownership: inbox rows carry team-role names, which are admin-only PII belonging
// to whichever team's tracker produced them.
export async function listInbox(
  status: "pending" | "dismissed" | "all" = "pending",
  actor?: Actor
): Promise<InboxRow[]> {
  await ensureIngestTables();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (status !== "all") {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (actor && !actor.isSuper) {
    params.push(actor.org);
    clauses.push(`org = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await query<InboxDbRow>(
    `SELECT * FROM import_inbox ${where} ORDER BY seen_count DESC, last_seen DESC`,
    params
  );
  return rows.map(toInboxRow);
}

export async function countInbox(): Promise<number> {
  await ensureIngestTables();
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM import_inbox WHERE status = 'pending'`
  );
  return Number(rows[0]?.n ?? 0);
}

// Status flips are org-scoped: the row's team-role names are the other team's
// admin-only PII, so a scoped admin must not be able to hide or resurface them.
// The org predicate is in the WHERE clause so the check can't race a concurrent
// change, and a no-op UPDATE is reported as `false`.
export async function dismissInboxRow(id: number, actor: Actor): Promise<boolean> {
  await ensureIngestTables();
  const rows = await query<{ id: string }>(
    `UPDATE import_inbox SET status = 'dismissed', last_seen = now()
      WHERE id = $1 AND ($3 OR org = $2) RETURNING id`,
    [id, actor.org, actor.isSuper]
  );
  return rows.length > 0;
}

async function getInboxRow(id: number): Promise<InboxRow | null> {
  await ensureIngestTables();
  const rows = await query<InboxDbRow>(`SELECT * FROM import_inbox WHERE id = $1`, [id]);
  return rows[0] ? toInboxRow(rows[0]) : null;
}

// Slugify a tracker name into a unique catalog id (matches the existing kebab id
// style). Dedups against existing ids with a numeric suffix.
async function uniqueProjectId(rawName: string): Promise<string> {
  const base =
    rawName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "project";
  const existing = await query<{ id: string }>(
    `SELECT id FROM projects WHERE id = $1 OR id LIKE $2`,
    [base, `${base}-%`]
  );
  const taken = new Set(existing.map((r) => r.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const cand = `${base}-${n}`;
    if (!taken.has(cand)) return cand;
  }
}

// Resolve an inbox row's roles into PER-RUN role fields + ensure directory stubs.
// Roles are now per-semester, so the caller merges these onto the run for the
// row's term (createProjectFromInbox / mergeInboxRow).
async function inboxRoleRunFields(roles: InboxRoles | undefined): Promise<Partial<Run>> {
  const out: Partial<Run> = {};
  if (!roles) return out;
  const fields = ["sparkProgramLead", "pm", "tpm", "seniorAdvisor", "techAdvisor", "eir"] as const;
  for (const f of fields) {
    const v = nz(roles[f]);
    if (v) {
      (out[f] as string) = v;
      await upsertPersonStub(v);
    }
  }
  return out;
}

// Triage: CREATE a new (unpublished) catalog project from an inbox row, then
// remove the row. Unpublished so unreviewed data never hits the public site;
// the admin edits/publishes via the normal edit form. The new title === rawName,
// so matchKey(title) === the row's name_key → future syncs match it directly
// (no alias needed). Returns the new project id.
export async function createProjectFromInbox(
  id: number,
  actor: Actor
): Promise<string | null | "forbidden"> {
  const row = await getInboxRow(id);
  if (!row) return null;
  // The new project is owned by whichever team's FEED produced the row — never by
  // whoever happens to be triaging. Deriving ownership from the actor would let a
  // CDS admin turn a Spark-sourced row into a CDS-owned project, which is the same
  // identity laundering the importer fix closed, one step later.
  if (!canEdit(actor, row.org)) return "forbidden";
  const projectId = await uniqueProjectId(row.rawName);
  // Roles + PD link are per-semester — embed them on the run for this row's term.
  const roleFields = await inboxRoleRunFields(row.roles);
  const runs: Run[] =
    row.course || row.term
      ? [{
          term: row.term || "",
          course: row.course || "",
          discipline: disciplineFromCourse(row.course || ""),
          students: [],
          teamId: null,
          pdUrl: row.pdUrl || null,
          ...roleFields,
        }]
      : [];
  await addProject({
    id: projectId,
    title: row.rawName,
    blurb: row.blurb || "",
    clientType: "",
    partner: row.partner || "",
    tech: row.tech ?? [],
    images: [],
    runs,
    repoUrl: row.repoUrl,
    published: !!(row.blurb && row.blurb.trim()), // auto-publish when blurb present; stay draft otherwise
    custom: false,
    ownerOrg: row.org, // addProject derives surfaces from this
  });
  // addProject doesn't carry tech_note / blurb_term — apply via patch.
  const patch: ProjectPatch = {};
  if (row.techNote) patch.techNote = row.techNote;
  if (row.term) patch.blurbTerm = row.term;
  if (Object.keys(patch).length) await updateProject(projectId, patch);
  await query(`DELETE FROM import_inbox WHERE id = $1`, [id]);
  return projectId;
}

// Triage: MERGE an inbox row into an existing project — writes a durable alias
// (so the tracker name auto-matches next sync) and applies the row's payload to
// the project (fill-not-clobber, same rules as the importer), then removes the
// row. Returns false if either side is missing.
export async function mergeInboxRow(
  id: number,
  projectId: string,
  actor: Actor
): Promise<boolean | "forbidden"> {
  const row = await getInboxRow(id);
  if (!row) return false;
  const target = await getProjectAdmin(projectId);
  if (!target) return false;

  // BOTH sides, and checked BEFORE addAlias below. Ordering is load-bearing: the
  // alias is durable, and one pointing at the other team's project would make every
  // FUTURE sync match it, permanently defeating the importer's org pre-filter. A
  // late check would leave that alias behind even on a rejected merge.
  if (!canEdit(actor, row.org) || !canEdit(actor, target.ownerOrg ?? "spark")) {
    return "forbidden";
  }

  await addAlias(row.nameKey, projectId);

  const patch: ProjectPatch = {};
  if (row.partner) patch.partner = row.partner;
  if (row.blurb && !target.blurbLocked) {
    patch.blurb = row.blurb;
    if (row.term) patch.blurbTerm = row.term;
  }
  if (row.techNote) patch.techNote = row.techNote;
  if (row.tech && row.tech.length && !(target.tech && target.tech.length)) patch.tech = row.tech;
  if (row.repoUrl && !target.repoUrl) patch.repoUrl = row.repoUrl;
  // Roles + PD link are per-semester: merge onto the run matching the row's term
  // (target.runs is the admin projection, so students/teamId are preserved).
  const roleFields = await inboxRoleRunFields(row.roles);
  if (row.term && (Object.keys(roleFields).length || row.pdUrl)) {
    const idx = target.runs.findIndex((rn) => termsEqual(rn.term, row.term));
    if (idx >= 0) {
      patch.runs = target.runs.map((rn, i) =>
        i === idx
          ? { ...rn, ...roleFields, ...(row.pdUrl && !rn.pdUrl ? { pdUrl: row.pdUrl } : {}) }
          : rn
      );
    }
  }

  if (Object.keys(patch).length) await updateProject(projectId, patch);
  await query(`DELETE FROM import_inbox WHERE id = $1`, [id]);
  return true;
}

export async function restoreInboxRow(id: number, actor: Actor): Promise<boolean> {
  await ensureIngestTables();
  const rows = await query<{ id: string }>(
    `UPDATE import_inbox SET status = 'pending', last_seen = now()
      WHERE id = $1 AND ($3 OR org = $2) RETURNING id`,
    [id, actor.org, actor.isSuper]
  );
  return rows.length > 0;
}

export async function listAliases(): Promise<{ nameKey: string; projectId: string; createdAt: string }[]> {
  await ensureIngestTables();
  const rows = await query<{ name_key: string; project_id: string; created_at: string }>(
    `SELECT name_key, project_id, created_at FROM project_aliases ORDER BY created_at DESC`
  );
  return rows.map((r) => ({ nameKey: r.name_key, projectId: r.project_id, createdAt: r.created_at }));
}

// Scoped by the OWNER of the project the alias resolves to: deleting it changes
// what that team's next PD sync will match, so it is their data even though the
// row itself carries no org. Returns false when the alias is absent or foreign.
export async function removeAlias(nameKey: string, actor: Actor): Promise<boolean> {
  await ensureIngestTables();
  const rows = await query<{ name_key: string }>(
    `DELETE FROM project_aliases a
      USING projects p
      WHERE a.name_key = $1 AND p.id = a.project_id AND ($3 OR p.owner_org = $2)
      RETURNING a.name_key`,
    [nameKey, actor.org, actor.isSuper]
  );
  return rows.length > 0;
}

// --- Student contributors (ADMIN-ONLY) ---------------------------------------
// Per-project student rosters with first/last name, GitHub handle, BU email.
// Keyed per-semester (term) because a project run across multiple semesters has
// a DIFFERENT team each term. Students are admin-only by the project's hard rule
// — these are read ONLY through auth-gated routes and never enter a public
// payload (the public getProjects/getProject don't touch this table). Lazily
// created (mirrors people/import_inbox). A future person identity can layer on.
let contributorsEnsured = false;
async function ensureContributorsTable(): Promise<void> {
  if (contributorsEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS contributors (
       id              bigserial PRIMARY KEY,
       project_id      text NOT NULL,
       term            text,
       first_name      text,
       last_name       text,
       github_username text,
       email           text,
       created_at      timestamptz NOT NULL DEFAULT now()
     )`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_contributors_project ON contributors (project_id)`);
  contributorsEnsured = true;
}

interface ContributorRow {
  id: string; // bigserial — node-postgres returns as string
  project_id: string;
  term: string | null;
  first_name: string | null;
  last_name: string | null;
  github_username: string | null;
  email: string | null;
}
const toContributor = (r: ContributorRow): Contributor => ({
  id: r.id,
  projectId: r.project_id,
  term: r.term,
  firstName: r.first_name,
  lastName: r.last_name,
  githubUsername: r.github_username,
  email: r.email,
});

// All contributors for one project, ordered by term then surname. Admin-only.
export async function listContributors(projectId: string): Promise<Contributor[]> {
  await ensureContributorsTable();
  const rows = await query<ContributorRow>(
    `SELECT * FROM contributors WHERE project_id = $1
     ORDER BY term NULLS LAST, last_name NULLS LAST, first_name NULLS LAST`,
    [projectId]
  );
  return rows.map(toContributor);
}

// Map projectId → contributor count (admin list badges / coverage reporting).
export async function getContributorCounts(): Promise<Map<string, number>> {
  await ensureContributorsTable();
  const rows = await query<{ project_id: string; n: string }>(
    `SELECT project_id, COUNT(*)::text AS n FROM contributors GROUP BY project_id`
  );
  return new Map(rows.map((r) => [r.project_id, Number(r.n)]));
}

export interface ContributorInput {
  term?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  githubUsername?: string | null;
  email?: string | null;
}

// Replace the FULL contributor set for a project (the admin edit form sends the
// whole list). Transactional delete-then-insert so a save is atomic and the row
// set always matches the form exactly. Blank-only rows are dropped.
export async function setProjectContributors(
  projectId: string,
  contributors: ContributorInput[]
): Promise<void> {
  await ensureContributorsTable();
  const clean = contributors.filter(
    (c) => nz(c.firstName) || nz(c.lastName) || nz(c.githubUsername) || nz(c.email)
  );
  const { client, release } = await acquireClient();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM contributors WHERE project_id = $1`, [projectId]);
    for (const c of clean) {
      await client.query(
        `INSERT INTO contributors (project_id, term, first_name, last_name, github_username, email)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [projectId, nz(c.term), nz(c.firstName), nz(c.lastName), nz(c.githubUsername), nz(c.email)]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await release();
  }
}

// Bulk loader helper (scripts/import-contributors.ts): append rows for a project
// without wiping existing ones — used when ingesting the master roster sheet.
export async function addContributors(
  projectId: string,
  contributors: ContributorInput[]
): Promise<number> {
  await ensureContributorsTable();
  let n = 0;
  for (const c of contributors) {
    if (!(nz(c.firstName) || nz(c.lastName) || nz(c.githubUsername) || nz(c.email))) continue;
    await query(
      `INSERT INTO contributors (project_id, term, first_name, last_name, github_username, email)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [projectId, nz(c.term), nz(c.firstName), nz(c.lastName), nz(c.githubUsername), nz(c.email)]
    );
    n++;
  }
  return n;
}

// --- People directory (ADMIN-ONLY) ------------------------------------------
// A curated overlay mapping canonical staff names → email, used for mailto links
// on the admin edit form and to drive the admin people filter. Lazily created
// (like settings/upload_requests). The importer only ever inserts a STUB
// (name_key, name) ON CONFLICT DO NOTHING — it NEVER writes email/notes/aliases,
// so admin-curated data is structurally safe from re-syncs. A person's roles are
// DERIVED from the project role columns (never accumulated destructively), so a
// future dated person_roles timeline can layer on the stable surrogate id.
let peopleEnsured = false;
async function ensurePeopleTable(): Promise<void> {
  if (peopleEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS people (
       id         bigserial PRIMARY KEY,
       name_key   text NOT NULL,
       name       text NOT NULL,
       aliases    text[] NOT NULL DEFAULT '{}',
       email      text,
       notes      text,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_people_name_key ON people (name_key)`);
  peopleEnsured = true;
}

interface PersonRow {
  id: string; // bigserial — node-postgres returns as string
  name: string;
  email: string | null;
  aliases: string[];
  notes: string | null;
}


// Ensure a directory stub exists for a name. Idempotent; never touches an
// existing row's admin-curated email/notes/aliases. Also will NOT recreate a
// name that was merged away into another person — a merge folds the variant's
// name_key into the target's aliases, so we skip insertion when the name_key is
// already either an existing name_key OR an alias of any person.
export async function upsertPersonStub(name: string, email?: string | null): Promise<void> {
  const clean = (name || "").trim();
  if (!clean) return;
  await ensurePeopleTable();
  const key = normalizeName(clean);
  await query(
    `INSERT INTO people (name_key, name)
     SELECT $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM people WHERE name_key = $1 OR $1 = ANY(aliases))`,
    [key, clean]
  );
  // Backfill an authoritative email (e.g. from the PD contact table) ONLY when
  // the person has none yet — never overwrite an admin-curated address. Resolves
  // through aliases so a merged variant fills the canonical person.
  const mail = (email || "").trim();
  if (mail && /\S+@\S+\.\S+/.test(mail)) {
    await query(
      `UPDATE people SET email = $2, updated_at = now()
       WHERE (name_key = $1 OR $1 = ANY(aliases)) AND (email IS NULL OR email = '')`,
      [key, mail]
    );
  }
}

// Manual "Add person" for the admin People page. Unlike upsertPersonStub (which
// only ever INSERTs name_key/name and silently no-ops on a collision), this sets
// email/notes/aliases up front and RETURNs the new id so the UI can route to it.
// Rejects — rather than silently no-ops — when the normalized name already exists
// as another person's name_key OR alias, so a manual add can't shadow a row and
// show a false success.
export async function addPerson(input: {
  name: string;
  email?: string | null;
  notes?: string | null;
  aliases?: string[];
}): Promise<{ id: string } | { error: string }> {
  const clean = (input.name || "").trim();
  if (!clean) return { error: "A name is required." };
  await ensurePeopleTable();
  const key = normalizeName(clean);
  if (!key) return { error: "A name is required." };
  const email = (input.email ?? null) && (input.email || "").trim() ? (input.email as string).trim() : null;
  const notes = (input.notes ?? null) && (input.notes || "").trim() ? (input.notes as string).trim() : null;
  const aliases = (input.aliases ?? [])
    .map((a) => normalizeName(a))
    .filter(Boolean)
    // never let an alias duplicate the canonical key
    .filter((a) => a !== key);
  // Dedupe aliases while preserving order.
  const uniqAliases = Array.from(new Set(aliases));
  const rows = await query<{ id: string }>(
    `INSERT INTO people (name_key, name, email, notes, aliases)
     SELECT $1, $2, $3, $4, $5::text[]
     WHERE NOT EXISTS (SELECT 1 FROM people WHERE name_key = $1 OR $1 = ANY(aliases))
     RETURNING id`,
    [key, clean, email, notes, uniqAliases]
  );
  if (!rows.length) return { error: "A person with that name already exists." };
  return { id: rows[0].id };
}

// Lightweight alias map used by the importer to canonicalize display names.
// name_key entries are written first so that intentional alias mappings win over
// accidental stub collisions on the same key.
export async function getPeopleAliasMap(): Promise<Record<string, string>> {
  await ensurePeopleTable();
  const rows = await query<{ name: string; name_key: string; aliases: string[] }>(
    `SELECT name, name_key, aliases FROM people`
  );
  const map: Record<string, string> = {};
  for (const p of rows) map[p.name_key] = p.name;
  for (const p of rows) for (const a of p.aliases ?? []) map[a] = p.name;
  return map;
}

// Build name_key (and each alias) → {id,name,email} for mailto resolution + the
// admin people filter. Reused by the edit form and the projects list.
export async function getPeopleMap(): Promise<
  Map<string, { id: string; name: string; email: string | null }>
> {
  await ensurePeopleTable();
  const people = await query<PersonRow>(`SELECT id, name, email, aliases FROM people`);
  const m = new Map<string, { id: string; name: string; email: string | null }>();
  for (const p of people) {
    const entry = { id: p.id, name: p.name, email: p.email };
    m.set(normalizeName(p.name), entry);
    for (const a of p.aliases ?? []) m.set(a, entry);
  }
  return m;
}

// Full directory for the admin people page; roles + projectCount are DERIVED
// from the PER-RUN role fields (a person may hold a role in one semester of a
// project but not another). Joined by normalized name / alias; a person is
// counted once per project even if they appear in several of its runs.
export async function listPeople(): Promise<Person[]> {
  await ensurePeopleTable();
  const people = await query<PersonRow>(
    `SELECT id, name, email, aliases, notes FROM people ORDER BY name ASC`
  );
  const projRuns = await query<{ runs: Run[] | null }>(`SELECT runs FROM projects`);
  // name_key → { roles held, # distinct projects }
  const byKey = new Map<string, { roles: Set<string>; count: number }>();
  for (const { runs } of projRuns) {
    const seenThisProject = new Set<string>(); // dedupe → count distinct projects
    const addRole = (name: string, label: string) => {
      // cleanPersonName drops placeholders (N/A, TBD, …) so junk never surfaces.
      const v = cleanPersonName(name || "");
      if (!v) return;
      const k = normalizeName(v);
      const e = byKey.get(k) ?? { roles: new Set<string>(), count: 0 };
      e.roles.add(label);
      if (!seenThisProject.has(k)) {
        e.count++;
        seenThisProject.add(k);
      }
      byKey.set(k, e);
    };
    for (const run of runs ?? []) {
      for (const [field, label] of RUN_ROLE_FIELDS) {
        const cell = run[field];
        if (typeof cell === "string") addRole(cell, label);
      }
      for (const raw of run.classInstructors ?? []) addRole(raw, "Class Instructor");
    }
  }
  return people.map((p) => {
    const keys = [normalizeName(p.name), ...(p.aliases ?? [])];
    const roles = new Set<string>();
    let count = 0;
    for (const k of keys) {
      const e = byKey.get(k);
      if (e) {
        e.roles.forEach((r) => roles.add(r));
        count += e.count;
      }
    }
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      aliases: p.aliases ?? [],
      notes: p.notes,
      roles: [...roles],
      projectCount: count,
    };
  });
}

// Admin-only edit of a directory entry. aliases are normalized to name_keys.
export async function updatePerson(
  id: number,
  patch: { name?: string; email?: string | null; notes?: string | null; aliases?: string[] }
): Promise<void> {
  await ensurePeopleTable();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  // Display name only — name_key is intentionally NOT updated, so the stable
  // identity (and every project role-column value that resolves through it)
  // survives a rename. Renaming "Omar" → "Omar Khan" keeps name_key "omar".
  if (patch.name !== undefined && patch.name.trim()) add("name", patch.name.trim());
  if (patch.email !== undefined) add("email", patch.email);
  if (patch.notes !== undefined) add("notes", patch.notes);
  if (patch.aliases !== undefined)
    add("aliases", patch.aliases.map((a) => normalizeName(a)).filter(Boolean));
  if (!sets.length) return;
  sets.push(`updated_at = now()`);
  vals.push(id);
  await query(`UPDATE people SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
}

// Hard-delete a person stub. Safe only when projectCount === 0 (the person
// doesn't appear in any project role column). The next sync will re-stub them
// if they're still in the tracker, so this is most useful for removing junk
// stubs (ADD, Teammate, etc.) that should never have been created.
export async function deletePerson(id: number): Promise<void> {
  await ensurePeopleTable();
  await query(`DELETE FROM people WHERE id = $1`, [id]);
}

// Merge the source person into the target: the source's name_key + aliases
// become aliases of the target, then the source row is deleted. This survives
// re-sync because upsertPersonStub skips any name_key already held as an alias.
// Admin-curated email/notes on the target are preserved; the source's only fill
// gaps (never overwrite). Returns false if either id is missing or they match.
export async function mergePeople(sourceId: number, targetId: number): Promise<boolean> {
  if (sourceId === targetId) return false;
  await ensurePeopleTable();
  type Row = { id: number; name: string; name_key: string; aliases: string[]; email: string | null; notes: string | null };
  const rows = await query<Row>(
    `SELECT id, name, name_key, aliases, email, notes FROM people WHERE id = ANY($1)`,
    [[sourceId, targetId]]
  );
  const source = rows.find((r) => String(r.id) === String(sourceId));
  const target = rows.find((r) => String(r.id) === String(targetId));
  if (!source || !target) return false;

  // Dedupe union of target aliases ∪ source.name_key ∪ source aliases,
  // excluding the target's own name_key (a person is never their own alias).
  const aliases = Array.from(
    new Set([
      ...(target.aliases ?? []),
      source.name_key,
      ...(source.aliases ?? []),
    ])
  ).filter((a) => a && a !== target.name_key);

  const email = target.email ?? source.email;
  const notes = target.notes ?? source.notes;

  const { client, release } = await acquireClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE people SET aliases = $1, email = $2, notes = $3, updated_at = now() WHERE id = $4`,
      [aliases, email, notes, targetId]
    );
    // Re-point the source's role timeline onto the survivor BEFORE deleting it.
    // person_roles FKs into people ON DELETE CASCADE, so a bare DELETE would
    // otherwise destroy the source's role history. Copy non-duplicate rows over
    // (the unique index makes overlaps no-ops), then the CASCADE drops the rest.
    await client.query(
      `INSERT INTO person_roles (person_id, project_id, term, role)
       SELECT $1, project_id, term, role FROM person_roles WHERE person_id = $2
       ON CONFLICT (person_id, project_id, term, role) DO NOTHING`,
      [targetId, sourceId]
    );
    await client.query(`DELETE FROM people WHERE id = $1`, [sourceId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await release();
  }
  return true;
}

// --- Person roles timeline (ADMIN-ONLY) ---------------------------------------
// Append-only log: person X held role R on project Y in term T.
// Complements the derived approach in listPeople() with a direct queryable
// timeline — needed for "all projects PM X touched" without a full table scan,
// and for semester-tagging staff roles (the project columns are project-level,
// not run-level). Student roles land here too once names are normalized via
// upsertPersonStub. Lazily created like the other tables.
let personRolesEnsured = false;
async function ensurePersonRolesTable(): Promise<void> {
  if (personRolesEnsured) return;
  await ensurePeopleTable(); // person_roles FKs into people
  await query(
    `CREATE TABLE IF NOT EXISTS person_roles (
       id         bigserial PRIMARY KEY,
       person_id  bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
       project_id text   NOT NULL,
       term       text   NOT NULL DEFAULT '',
       role       text   NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_person_roles_uniq
     ON person_roles(person_id, project_id, term, role)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_person_roles_person ON person_roles(person_id)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_person_roles_project ON person_roles(project_id)`
  );
  personRolesEnsured = true;
}

export interface PersonRole {
  projectId: string;
  projectTitle: string;
  term: string;
  role: string;
}

// Upsert a person stub + record a role for a project+term. Idempotent — safe
// to call on every import without accumulating duplicates.
export async function upsertPersonRole(
  name: string,
  projectId: string,
  term: string,
  role: string,
  email?: string | null
): Promise<void> {
  const clean = (name || "").trim();
  if (!clean || !projectId) return;
  await upsertPersonStub(clean, email);
  const key = normalizeName(clean);
  const rows = await query<{ id: string }>(
    `SELECT id FROM people WHERE name_key = $1 OR $1 = ANY(aliases) LIMIT 1`,
    [key]
  );
  if (!rows.length) return;
  const personId = rows[0].id;
  await ensurePersonRolesTable();
  await query(
    `INSERT INTO person_roles (person_id, project_id, term, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (person_id, project_id, term, role) DO NOTHING`,
    [personId, projectId, term || "", role]
  );
}

// All projects+roles for a person, newest term first.
export async function getPersonTimeline(personId: string): Promise<PersonRole[]> {
  await ensurePersonRolesTable();
  const rows = await query<{
    project_id: string; title: string | null; term: string; role: string;
  }>(
    `SELECT pr.project_id, p.title, pr.term, pr.role
     FROM person_roles pr
     LEFT JOIN projects p ON p.id = pr.project_id
     WHERE pr.person_id = $1
     ORDER BY pr.term DESC NULLS LAST, p.title ASC`,
    [personId]
  );
  return rows.map((r) => ({
    projectId: r.project_id,
    projectTitle: r.title ?? r.project_id,
    term: r.term,
    role: r.role,
  }));
}

// Person profile — everything the /admin/people/[id] page + SparkFlow need.
// Derives role "stints" (oldest→newest term per role) and a per-term project
// breakdown straight from person_roles; no separate role_stints table needed.
// Legacy/unparseable terms (e.g. the empty-term backfill rows) are dropped from
// the academic-axis derivations but still counted toward distinct projects.
export interface PersonProfile {
  id: string;
  name: string;
  email: string | null;
  aliases: string[];
  notes: string | null;
  roles: { role: string; start: string; end: string | null }[];
  detail: Record<string, { kind: "projects"; label: string; byTerm: Record<string, string[]> }>;
  projects: { id: string; title: string; term: string; role: string }[];
  stats: { rolesHeld: number; termsActive: number; projects: number; sinceTerm: string | null };
}

export async function getPersonProfile(personId: string): Promise<PersonProfile | null> {
  await ensurePersonRolesTable();
  const prow = await query<{ id: string; name: string; email: string | null; aliases: string[] | null; notes: string | null }>(
    `SELECT id, name, email, aliases, notes FROM people WHERE id = $1`,
    [personId]
  );
  if (!prow.length) return null;
  const p = prow[0];

  const rows = await query<{ project_id: string; title: string | null; term: string; role: string }>(
    `SELECT pr.project_id, pj.title, pr.term, pr.role
     FROM person_roles pr
     LEFT JOIN projects pj ON pj.id = pr.project_id
     WHERE pr.person_id = $1`,
    [personId]
  );

  // Only terms that place on the academic axis power Flow (drop '' / unparseable).
  const valid = rows.filter((r) => semesterRank(r.term) > 0);

  const byRole = new Map<string, { terms: Set<string>; byTerm: Map<string, Set<string>> }>();
  for (const r of valid) {
    const e = byRole.get(r.role) ?? { terms: new Set<string>(), byTerm: new Map<string, Set<string>>() };
    e.terms.add(r.term);
    const t = e.byTerm.get(r.term) ?? new Set<string>();
    t.add(r.title ?? r.project_id);
    e.byTerm.set(r.term, t);
    byRole.set(r.role, e);
  }

  const roles = [...byRole.entries()]
    .map(([role, e]) => {
      const sorted = [...e.terms].sort((a, b) => semesterRank(a) - semesterRank(b));
      return { role, start: sorted[0], end: sorted[sorted.length - 1] };
    })
    .sort((a, b) => semesterRank(a.start) - semesterRank(b.start));

  const detail: PersonProfile["detail"] = {};
  for (const [role, e] of byRole) {
    const byTerm: Record<string, string[]> = {};
    for (const [term, set] of e.byTerm) byTerm[term] = [...set].sort();
    detail[role] = { kind: "projects", label: "Projects", byTerm };
  }

  // Distinct projects, keyed to the person's most-recent term + role on each.
  const projMap = new Map<string, { id: string; title: string; term: string; role: string; rank: number }>();
  for (const r of rows) {
    const rank = semesterRank(r.term);
    const cur = projMap.get(r.project_id);
    if (!cur || rank > cur.rank) {
      projMap.set(r.project_id, { id: r.project_id, title: r.title ?? r.project_id, term: r.term, role: r.role, rank });
    }
  }
  const projects = [...projMap.values()]
    .sort((a, b) => b.rank - a.rank)
    .map(({ rank: _rank, ...x }) => x);

  const allTerms = new Set(valid.map((r) => r.term));
  const sinceTerm = [...allTerms].sort((a, b) => semesterRank(a) - semesterRank(b))[0] ?? null;

  return {
    id: p.id,
    name: p.name,
    email: p.email,
    aliases: p.aliases ?? [],
    notes: p.notes,
    roles,
    detail,
    projects,
    stats: { rolesHeld: byRole.size, termsActive: allTerms.size, projects: projMap.size, sinceTerm },
  };
}

// All people+roles for a project (for the edit form or a project detail view).
export async function getProjectRoles(
  projectId: string
): Promise<{ personId: string; name: string; email: string | null; term: string; role: string }[]> {
  await ensurePersonRolesTable();
  const rows = await query<{
    person_id: string; name: string; email: string | null; term: string; role: string;
  }>(
    `SELECT pr.person_id, pe.name, pe.email, pr.term, pr.role
     FROM person_roles pr
     JOIN people pe ON pe.id = pr.person_id
     WHERE pr.project_id = $1
     ORDER BY pr.term DESC NULLS LAST, pr.role ASC`,
    [projectId]
  );
  return rows.map((r) => ({
    personId: r.person_id,
    name: r.name,
    email: r.email,
    term: r.term,
    role: r.role,
  }));
}

// --- Users (admin allowlist) -------------------------------------------------
// Admins sign in with Google (see auth.ts); the users table is purely an
// allowlist of which @bu.edu addresses are permitted. There are no passwords —
// the row's mere existence is the grant.
export interface UserRow {
  id: number;
  email: string;
  name: string | null;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    `SELECT id, email, name FROM users WHERE lower(email) = lower($1)`,
    [email]
  );
  return rows[0] ?? null;
}

// Allowlist check used by the Google signIn callback. Runs on a possibly-cold
// serverless invocation, where the first connection to Railway's public Postgres
// proxy can time out — and a throw here bounces the admin to /api/auth/error.
// Retry once after a short delay so a transient connection hiccup self-heals
// instead of failing the sign-in (the user previously saw an error that worked
// on retry). A genuine DB outage still surfaces after the second attempt.
export async function isAdminEmail(email: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rows = await query<{ ok: boolean }>(
        `SELECT true AS ok FROM users WHERE lower(email) = lower($1) LIMIT 1`,
        [email]
      );
      return rows.length > 0;
    } catch (e) {
      if (attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

// Add an email to the admin allowlist. Returns true if a new row was inserted,
// false if the email was already present (idempotent). No password involved.
//
// `org` scopes what the new admin can edit and is REQUIRED by the caller (the
// route validates it). is_super is intentionally not a parameter: super admins
// are created by SQL alone, so no request can ever mint one, which is what makes
// "forgetting to tag someone" produce a scoped admin rather than a super admin.
//
// ON CONFLICT targets lower(email), matching users_email_lower_key from
// 001_owner_org.sql. The old case-sensitive users_email_key still exists, but
// conflicting on it would let A@bu.edu and a@bu.edu become two rows with
// different orgs — privilege confusion now that org carries authority.
export async function addAdminEmail(
  email: string,
  name: string,
  org: string
): Promise<boolean> {
  if (!ORGS.includes(org as never)) throw new Error(`Unknown org: ${org}`);
  const rows = await query<{ inserted: boolean }>(
    `INSERT INTO users (email, name, org)
     VALUES ($1, $2, $3)
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING true AS inserted`,
    [email, name, org]
  );
  return rows.length > 0;
}

// Public-safe user shape (no password hash) for the admin Manage Users panel.
export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  createdAt: string;
  org: string;
  isSuper: boolean;
}

export async function listUsers(): Promise<AdminUser[]> {
  const rows = await query<{
    id: number;
    email: string;
    name: string | null;
    created_at: string;
    org: string | null;
    is_super: boolean | null;
  }>(
    `SELECT id, email, name, created_at, org, is_super FROM users ORDER BY created_at ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    createdAt: r.created_at,
    org: r.org ?? "spark",
    isSuper: r.is_super === true,
  }));
}

export async function countUsers(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
  return rows[0]?.n ?? 0;
}

// Guard for DELETE /api/users/[id]: refuse to remove the last super admin.
// is_super is grantable only by SQL, so deleting the final one would make
// granting admin, editing the vocabulary, cross-org merges and ownership
// reassignment unreachable by ANY account — recoverable only with DB access.
export async function countSuperAdmins(): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users WHERE is_super`
  );
  return rows[0]?.n ?? 0;
}

/**
 * Deletes an admin, refusing to remove the final super admin.
 *
 * The rule is enforced HERE rather than by the route's preceding count, because
 * count-then-delete is not atomic: two supers removing each other at the same
 * moment both read a count of 2, both pass, and both commit — leaving zero supers,
 * which is exactly the lockout the rule exists to prevent and is recoverable only
 * with direct database access.
 *
 * Note that folding the count into the DELETE as
 * `AND (SELECT count(*) FROM users WHERE is_super) > 1` does NOT fix this. Under
 * READ COMMITTED each statement evaluates that subquery against its own snapshot,
 * and because the two deletions target DIFFERENT rows they never conflict — so both
 * still commit. The lock below is what actually serialises them: the second
 * transaction blocks on the super rows, then re-reads and sees the true count.
 *
 * Returns false when the row survived because it was the last super admin.
 */
export async function removeUser(id: number): Promise<boolean> {
  const { client, release } = await acquireClient();
  try {
    await client.query("BEGIN");
    const { rows: supers } = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE is_super ORDER BY id FOR UPDATE`
    );
    if (supers.length <= 1 && supers.some((r) => r.id === id)) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(`DELETE FROM users WHERE id = $1`, [id]);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await release();
  }
}

// --- Gallery settings (admin-editable taxonomy + facet visibility) -----------
// Stored as a single JSONB row keyed 'gallery'. The table is created on demand
// (CREATE TABLE IF NOT EXISTS) so this works without a separate migration step.
// Run the lazy DDL at most once per warm instance — getGallerySettings fires on
// every public gallery render, so skip the extra round-trip once ensured.
let settingsEnsured = false;
async function ensureSettingsTable(): Promise<void> {
  if (settingsEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, data jsonb NOT NULL)`
  );
  settingsEnsured = true;
}

// Cached + tagged "gallery-settings" (read on every gallery render); saveGallerySettings
// revalidates the tag. 5-min TTL safety net.
export const getGallerySettings = unstable_cache(
  async (): Promise<GallerySettings> => {
    try {
      await ensureSettingsTable();
      const rows = await query<{ data: Partial<GallerySettings> }>(
        `SELECT data FROM settings WHERE key = 'gallery'`
      );
      const stored = rows[0]?.data ?? {};
      // Merge over defaults so a partial/missing row never breaks the UI, and any
      // facet key added in future code defaults to visible.
      return {
        disciplines:
          stored.disciplines?.length
            ? stored.disciplines
            : DEFAULT_GALLERY_SETTINGS.disciplines,
        clientTypes:
          stored.clientTypes?.length
            ? stored.clientTypes
            : DEFAULT_GALLERY_SETTINGS.clientTypes,
        programs: stored.programs?.length
          ? stored.programs
          : DEFAULT_GALLERY_SETTINGS.programs,
        showFacets: {
          ...DEFAULT_GALLERY_SETTINGS.showFacets,
          ...(stored.showFacets ?? {}),
        },
        courseNames: stored.courseNames ?? {},
        intro: stored.intro ?? DEFAULT_GALLERY_SETTINGS.intro,
        heroStats: stored.heroStats ?? DEFAULT_GALLERY_SETTINGS.heroStats,
        topics: stored.topics?.length ? stored.topics : DEFAULT_GALLERY_SETTINGS.topics,
        facetOrder: stored.facetOrder?.length
          ? stored.facetOrder
          : DEFAULT_GALLERY_SETTINGS.facetOrder,
        thumbBadge: stored.thumbBadge ?? DEFAULT_GALLERY_SETTINGS.thumbBadge,
      };
    } catch {
      // If the DB is unreachable or the table can't be made, fall back to defaults
      // rather than failing the whole gallery render.
      return DEFAULT_GALLERY_SETTINGS;
    }
  },
  ["gallery-settings"],
  { tags: ["gallery-settings"], revalidate: 300 }
);

// Distinct terms actually present in the DB, sorted newest-first. Terms live in
// the runs JSONB column (the scalar `term` column is dead for rows after the
// runs migration). Cached under "projects" — auto-revalidates on every sync.
export const getDistinctTerms = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await query<{ term: string }>(
      `SELECT DISTINCT r->>'term' AS term
       FROM projects, jsonb_array_elements(runs) AS r
       WHERE r->>'term' IS NOT NULL AND trim(r->>'term') != ''`
    );
    return rows
      .map((r) => r.term.trim())
      .filter(Boolean)
      .sort((a, b) => semesterRank(b) - semesterRank(a));
  },
  ["distinct-terms"],
  { tags: ["projects"], revalidate: 300 }
);

// Total student "experiences" = one contributors row per student per project-run
// (a student on two projects counts twice). Public-safe: a bare count, no PII.
// Falls back to 0 if the table doesn't exist yet.
export const countStudentExperiences = unstable_cache(
  async (): Promise<number> => {
    try {
      await ensureContributorsTable();
      const rows = await query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM contributors`
      );
      return Number(rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  },
  ["student-experiences-count"],
  { tags: ["projects"], revalidate: 300 }
);

export async function saveGallerySettings(s: GallerySettings): Promise<void> {
  await ensureSettingsTable();
  await query(
    `INSERT INTO settings (key, data) VALUES ('gallery', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
    [JSON.stringify(s)]
  );
}

// --- Upload requests (delegated screenshot uploads via magic link) -----------
// An admin mints a token scoped to one project and sends the link to a PM. The
// token IS the capability — no login. Uploaded keys accumulate in `images`
// (pending; NOT on the project) until an admin approves them. Table is lazily
// created (like settings) so no separate migration step is needed.
const UPLOAD_REQ_CAP = 4; // max screenshots per request

let uploadReqEnsured = false;
async function ensureUploadRequestsTable(): Promise<void> {
  if (uploadReqEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS upload_requests (
       token        text PRIMARY KEY,
       project_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       recipient    text,
       status       text NOT NULL DEFAULT 'open',
       images       text[] NOT NULL DEFAULT '{}',
       created_at   timestamptz NOT NULL DEFAULT now(),
       expires_at   timestamptz NOT NULL DEFAULT now() + interval '14 days',
       submitted_at timestamptz,
       reviewed_at  timestamptz,
       reviewed_by  text,
       review_note  text
     )`
  );
  // Indexes for the queue/lookup query patterns (status filter, per-project list,
  // expiry checks). Cheap; matters once there are many requests.
  await query(`CREATE INDEX IF NOT EXISTS idx_upload_requests_status ON upload_requests (status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_upload_requests_project ON upload_requests (project_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_upload_requests_expires ON upload_requests (expires_at)`);
  uploadReqEnsured = true;
}

interface UploadReqRow {
  token: string;
  project_id: string;
  project_title?: string;
  project_images?: string[];
  recipient: string | null;
  status: UploadRequestStatus;
  images: string[];
  created_at: string;
  expires_at: string;
  submitted_at: string | null;
  review_note: string | null;
}

function rowToUploadRequest(r: UploadReqRow): UploadRequest {
  return {
    token: r.token,
    projectId: r.project_id,
    projectTitle: r.project_title,
    recipient: r.recipient,
    status: r.status,
    images: r.images ?? [],
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    submittedAt: r.submitted_at,
    reviewNote: r.review_note,
  };
}

const UPLOAD_REQ_COLS =
  "token, project_id, recipient, status, images, created_at, expires_at, submitted_at, review_note";

export async function createUploadRequest(
  projectId: string,
  recipient: string | null
): Promise<{ token: string; expiresAt: string }> {
  await ensureUploadRequestsTable();
  const token = randomUUID();
  const rows = await query<{ expires_at: string }>(
    `INSERT INTO upload_requests (token, project_id, recipient)
     VALUES ($1, $2, $3)
     RETURNING expires_at`,
    [token, projectId, recipient]
  );
  return { token, expiresAt: rows[0].expires_at };
}

// For the public page/endpoints: only a live (open + unexpired) request.
export async function getOpenUploadRequest(
  token: string
): Promise<UploadRequest | null> {
  await ensureUploadRequestsTable();
  const rows = await query<UploadReqRow>(
    `SELECT ${UPLOAD_REQ_COLS} FROM upload_requests
     WHERE token = $1 AND status = 'open' AND expires_at > now()`,
    [token]
  );
  return rows[0] ? rowToUploadRequest(rows[0]) : null;
}

// Any-status fetch (drives the submitted/expired/thank-you UI states).
export async function getUploadRequest(
  token: string
): Promise<UploadRequest | null> {
  await ensureUploadRequestsTable();
  const rows = await query<UploadReqRow>(
    `SELECT ${UPLOAD_REQ_COLS} FROM upload_requests WHERE token = $1`,
    [token]
  );
  return rows[0] ? rowToUploadRequest(rows[0]) : null;
}

// Atomic append: the WHERE clause enforces open + unexpired + under cap so two
// simultaneous uploads can't both slip past a JS-side length check. Returns the
// updated request, or null if the append was refused (closed/expired/full).
export async function addUploadRequestImage(
  token: string,
  key: string
): Promise<UploadRequest | null> {
  await ensureUploadRequestsTable();
  const rows = await query<UploadReqRow>(
    `UPDATE upload_requests
       SET images = array_append(images, $2)
     WHERE token = $1 AND status = 'open' AND expires_at > now()
       AND cardinality(images) < $3
     RETURNING ${UPLOAD_REQ_COLS}`,
    [token, key, UPLOAD_REQ_CAP]
  );
  return rows[0] ? rowToUploadRequest(rows[0]) : null;
}

// Atomic remove BY VALUE (not index → no index-shift race). Best-effort S3 delete.
export async function removeUploadRequestImage(
  token: string,
  key: string
): Promise<UploadRequest | null> {
  await ensureUploadRequestsTable();
  const rows = await query<UploadReqRow>(
    `UPDATE upload_requests
       SET images = array_remove(images, $2)
     WHERE token = $1 AND status = 'open' AND expires_at > now()
     RETURNING ${UPLOAD_REQ_COLS}`,
    [token, key]
  );
  if (!rows[0]) return null;
  await deleteObject(key);
  return rowToUploadRequest(rows[0]);
}

// PM finalizes. Guarded so you can't submit an empty set or a closed request.
export async function submitUploadRequest(token: string): Promise<boolean> {
  await ensureUploadRequestsTable();
  const rows = await query<{ token: string }>(
    `UPDATE upload_requests
       SET status = 'submitted', submitted_at = now()
     WHERE token = $1 AND status = 'open' AND expires_at > now()
       AND cardinality(images) >= 1
     RETURNING token`,
    [token]
  );
  return rows.length > 0;
}

// Admin queue. Joins the project title + its current images (raw keys) so the
// review UI can offer the full union (existing ∪ pending) to choose from.
// Org-filtered: the queue exposes external recipient emails, and it is a WORKLIST
// — rows you cannot act on are noise, unlike the projects list where cross-org
// visibility exists so mis-filed projects get noticed. The JOIN on projects was
// already here, so the predicate is free.
export async function listUploadRequests(
  status?: UploadRequestStatus,
  actor?: Actor
): Promise<UploadRequest[]> {
  await ensureUploadRequestsTable();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    clauses.push(`u.status = $${params.length}`);
  }
  if (actor && !actor.isSuper) {
    params.push(actor.org);
    clauses.push(`p.owner_org = $${params.length}`);
  }
  const rows = await query<UploadReqRow>(
    `SELECT u.token, u.project_id, u.recipient, u.status, u.images,
            u.created_at, u.expires_at, u.submitted_at, u.review_note,
            p.title AS project_title, p.images AS project_images
       FROM upload_requests u
       JOIN projects p ON p.id = u.project_id
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY u.submitted_at DESC NULLS LAST, u.created_at DESC`,
    params
  );
  return rows.map((r) => ({
    ...rowToUploadRequest(r),
    // Surface the project's current raw image keys for the review union.
    projectImages: r.project_images ?? [],
  })) as (UploadRequest & { projectImages: string[] })[];
}

// All requests for one project (any status) — powers the edit page's "existing
// links" list so an admin can re-copy or see what's outstanding.
export async function listProjectUploadRequests(
  projectId: string
): Promise<UploadRequest[]> {
  await ensureUploadRequestsTable();
  const rows = await query<UploadReqRow>(
    `SELECT ${UPLOAD_REQ_COLS} FROM upload_requests
      WHERE project_id = $1
      ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map(rowToUploadRequest);
}

// Org-scoped to match listUploadRequests — otherwise the rail badge counts work
// the admin cannot see or act on.
export async function countUploadRequests(
  status: UploadRequestStatus,
  actor?: Actor
): Promise<number> {
  await ensureUploadRequestsTable();
  if (actor && !actor.isSuper) {
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM upload_requests u JOIN projects p ON p.id = u.project_id
        WHERE u.status = $1 AND p.owner_org = $2`,
      [status, actor.org]
    );
    return rows[0]?.n ?? 0;
  }
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM upload_requests WHERE status = $1`,
    [status]
  );
  return rows[0]?.n ?? 0;
}

// Approve: write the admin-chosen final set as the project's images. Validates
// every key belongs to either the project's current images or THIS request's
// pending uploads (blocks arbitrary-key injection), caps at 4, and cleans up the
// request's leftover (un-kept) pending objects from S3. Idempotent via the
// status guard. Returns an error string on validation failure.
// Promoting a contributor's pending images onto the project is a WRITE to that
// project, so it is org-scoped. The gate lives in the SELECT that was already
// joining projects — a foreign token simply finds no row and gets the existing
// "not found" message, which leaks nothing about whose project it is.
export async function approveUploadRequest(
  token: string,
  finalKeys: string[],
  actor: Actor
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureUploadRequestsTable();
  const rows = await query<{ project_id: string; images: string[]; project_images: string[] }>(
    `SELECT u.project_id, u.images, p.images AS project_images
       FROM upload_requests u JOIN projects p ON p.id = u.project_id
      WHERE u.token = $1 AND u.status = 'submitted' AND ($3 OR p.owner_org = $2)`,
    [token, actor.org, actor.isSuper]
  );
  const req = rows[0];
  if (!req) return { ok: false, error: "Request not found or not awaiting review." };

  const allowed = new Set([...(req.project_images ?? []), ...(req.images ?? [])]);
  const keys = finalKeys.filter((k) => allowed.has(k)).slice(0, UPLOAD_REQ_CAP);
  if (finalKeys.some((k) => !allowed.has(k))) {
    return { ok: false, error: "An image is not part of this project or request." };
  }

  await query(`UPDATE projects SET images = $1 WHERE id = $2`, [keys, req.project_id]);
  await query(
    `UPDATE upload_requests
       SET status = 'approved', reviewed_at = now(), reviewed_by = $2
     WHERE token = $1`,
    [token, actor.email]
  );
  // Clean up this request's pending objects that didn't make the final cut.
  const kept = new Set(keys);
  for (const k of req.images ?? []) {
    if (!kept.has(k)) await deleteObject(k);
  }
  return { ok: true };
}

// Reject: send a submitted request back to 'open' with an optional note shown to
// the PM, so the same link lets them fix and resubmit within the 14-day window.
// NOTE: unlike approveUploadRequest, this never joined `projects`, so the org
// predicate needs an explicit subquery rather than an extra AND. Easy to miss by
// assuming the approve/reject pair are symmetric — they are not.
export async function rejectUploadRequest(
  token: string,
  actor: Actor,
  note: string | null
): Promise<boolean> {
  await ensureUploadRequestsTable();
  const rows = await query<{ token: string }>(
    `UPDATE upload_requests u
       SET status = 'open', submitted_at = NULL,
           reviewed_at = now(), reviewed_by = $2, review_note = $3
     WHERE u.token = $1 AND u.status = 'submitted'
       AND ($5 OR EXISTS (
             SELECT 1 FROM projects p
              WHERE p.id = u.project_id AND p.owner_org = $4))
     RETURNING u.token`,
    [token, actor.email, note, actor.org, actor.isSuper]
  );
  return rows.length > 0;
}
