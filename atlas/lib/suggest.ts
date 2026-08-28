// Community suggestions — the pure half. No DB, no session, no network, so the
// rules that decide what an outside contributor may propose are unit-testable.
//
// WHY A WHITELIST AND NOT ProjectPatch
//
// The obvious implementation is "accept a ProjectPatch and stage it". That would be
// a mistake: ProjectPatch carries `visibility`, `status`, `featured`, `pm`, `eir`,
// `blurbLocked` and the admin-only PD/Drive links. A signed-in BU viewer proposing a
// visibility change — even into a staging table an admin later clicks "accept" on —
// turns a review queue into a privilege-escalation path where the only defence is
// that the reviewer reads carefully.
//
// So the suggestable set is enumerated here, additively, and is deliberately small:
// the fields the incomplete-historical-data problem actually needs filled in.
// Anything not on this list is DROPPED, not rejected, so a well-meaning client that
// sends extra keys still gets its useful fields through.
import type { Project } from "./types";

/** Fields a non-admin may propose a value for. */
export const SUGGESTABLE = [
  "blurb",
  "repoUrl",
  "prodUrl",
  "tech",
  "topics",
  "clientDesc",
] as const;
export type SuggestableField = (typeof SUGGESTABLE)[number];

/** Free-text fields that are recorded for a human and NEVER auto-applied. */
export const NOTE_FIELDS = ["contributorsNote", "note"] as const;

const MAX_TEXT = 4000;
const MAX_URL = 500;
const MAX_TAGS = 24;
const MAX_TAG = 60;

export interface SuggestionPayload {
  blurb?: string;
  repoUrl?: string;
  prodUrl?: string;
  tech?: string[];
  topics?: string[];
  clientDesc?: string;
  /** Who worked on this, as free text. Never auto-applied — see below. */
  contributorsNote?: string;
  /** Anything else the submitter wants to say. */
  note?: string;
}

/**
 * What may be written to a project on accept. Field types are CONCRETE, not
 * `unknown`, so this assigns straight into ProjectPatch and the compiler checks the
 * two stay compatible. Declared structurally rather than as Pick<ProjectPatch, …>
 * because ProjectPatch lives in the `server-only` lib/db.ts, and importing it here
 * would make this module — and its tests — unloadable outside Next's bundler.
 */
export interface ApplicableFields {
  blurb?: string;
  repoUrl?: string;
  prodUrl?: string;
  tech?: string[];
  topics?: string[];
  clientDesc?: string;
}

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : undefined;
};

// http(s) only. A `javascript:` or `data:` url stored here would be rendered as a
// link on the project page the moment an admin accepted it.
const url = (v: unknown): string | undefined => {
  const s = str(v, MAX_URL);
  if (!s || !/^https?:\/\//i.test(s)) return undefined;
  return s;
};

const tags = (v: unknown, allowed?: readonly string[]): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(
    v.map((x) => str(x, MAX_TAG)).filter((x): x is string => !!x)
  )].slice(0, MAX_TAGS);
  // When a controlled vocabulary is supplied, anything outside it is dropped rather
  // than stored. Topics feed a facet; a free-text topic would create a filter term
  // that matches exactly one project and looks broken.
  const kept = allowed ? out.filter((t) => allowed.includes(t)) : out;
  return kept.length ? kept : undefined;
};

/**
 * Reduce an untrusted body to a stored payload. Returns `null` when nothing usable
 * survived, so a caller can 400 rather than record an empty suggestion.
 */
export function coerceSuggestion(
  body: unknown,
  opts: { topicVocabulary?: readonly string[] } = {}
): SuggestionPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: SuggestionPayload = {};
  const blurb = str(b.blurb, MAX_TEXT);
  if (blurb) out.blurb = blurb;
  const repo = url(b.repoUrl);
  if (repo) out.repoUrl = repo;
  const prod = url(b.prodUrl);
  if (prod) out.prodUrl = prod;
  const tech = tags(b.tech);
  if (tech) out.tech = tech;
  const topics = tags(b.topics, opts.topicVocabulary);
  if (topics) out.topics = topics;
  const cd = str(b.clientDesc, MAX_TEXT);
  if (cd) out.clientDesc = cd;
  const cn = str(b.contributorsNote, MAX_TEXT);
  if (cn) out.contributorsNote = cn;
  const note = str(b.note, MAX_TEXT);
  if (note) out.note = note;
  return Object.keys(out).length ? out : null;
}

/**
 * The subset of an accepted suggestion that may be written to the project.
 *
 * `contributorsNote` and `note` are excluded on purpose. Contributor records are
 * admin-only PII living in their own table keyed per semester — a free-text name
 * list cannot be turned into rows safely, and guessing which student a name refers
 * to is exactly the mistake the Maddie/Madison collision showed is easy to make.
 * The note is recorded for a human to act on instead.
 *
 * Also drops any field that would OVERWRITE existing content, unless
 * `allowOverwrite` names it. A suggestion is additive by default: filling a blank is
 * a gift, replacing a curated blurb is a demand.
 */
export function applicableFields(
  payload: SuggestionPayload,
  project: Pick<Project, "blurb" | "repoUrl" | "prodUrl" | "tech" | "topics" | "clientDesc">,
  allowOverwrite: readonly string[] = []
): ApplicableFields {
  const out: ApplicableFields = {};
  const isEmpty = (v: unknown) =>
    v === null || v === undefined || (typeof v === "string" && !v.trim()) ||
    (Array.isArray(v) && v.length === 0);
  for (const f of SUGGESTABLE) {
    const proposed = payload[f];
    if (proposed === undefined) continue;
    const current = (project as unknown as Record<string, unknown>)[f];
    if (!isEmpty(current) && !allowOverwrite.includes(f)) continue;
    // Narrowed per field so the assignment is type-checked rather than cast.
    if (f === "tech" || f === "topics") out[f] = proposed as string[];
    else out[f] = proposed as string;
  }
  return out;
}

/** What the submitter sees as "still missing" — drives the form's field order. */
export function missingFields(
  project: Pick<Project, "blurb" | "repoUrl" | "prodUrl" | "tech" | "topics" | "images">
): string[] {
  const gaps: string[] = [];
  if (!(project.blurb ?? "").trim()) gaps.push("description");
  if (!project.repoUrl) gaps.push("code repository");
  if (!project.prodUrl) gaps.push("live demo");
  if (!(project.tech ?? []).length) gaps.push("tech stack");
  if (!(project.topics ?? []).length) gaps.push("topics");
  if (!(project.images ?? []).length) gaps.push("screenshots");
  return gaps;
}
