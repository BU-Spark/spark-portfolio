// Name → project matching for the PD importer. Extracted from
// app/api/import/route.ts for two reasons: the org-scoped importer needs to build
// TWO indexes (one to match against, one only to label cross-org misses), and
// these are the only functions in the ingest path that can be unit-tested without
// a database. Pure — no db, no session, no `server-only`.
//
// Matching order matters and is deliberate:
//   1. curated alias  (project_aliases — survives a tracker rename)
//   2. exact full title
//   3. exact project portion (after a "Client:" prefix)
//   4. fuzzy, edit distance ≤ 2, keys ≥ 8 chars
// Anything earlier always beats anything later, so an exact same-org hit can never
// lose to a fuzzy near-twin.
import { matchKey, splitClientProject, editDistance } from "./gdocs";
import type { Project } from "./types";

export interface MatchIndex {
  byId: Map<string, Project>;
  byFull: Map<string, Project>;
  byProject: Map<string, Project>;
  /** Flat (key → project) list for the fuzzy scan. */
  allKeys: { key: string; project: Project }[];
}

/**
 * Index a set of projects two ways — by full normalized title and by the project
 * portion — so a bare-name tracker row matches a "Client: Project" catalog entry
 * and vice versa.
 *
 * The caller decides WHICH projects go in. That is the whole org boundary: pass
 * only the acting org's projects and a cross-org project simply cannot be
 * matched, let alone written. Filtering here rather than checking at write time
 * matters because the fuzzy scan picks a single best candidate — a cross-org
 * project could otherwise win and then be rejected, sending the row to `skipped`
 * even when a same-org project at distance 3 existed.
 */
export function buildIndex(projects: Project[]): MatchIndex {
  const byId = new Map<string, Project>();
  const byFull = new Map<string, Project>();
  const byProject = new Map<string, Project>();
  for (const p of projects) {
    byId.set(p.id, p);
    const full = matchKey(p.title);
    if (full && !byFull.has(full)) byFull.set(full, p);
    const proj = matchKey(splitClientProject(p.title).project);
    if (proj && !byProject.has(proj)) byProject.set(proj, p);
  }
  const allKeys: { key: string; project: Project }[] = [];
  for (const [k, p] of byFull) allKeys.push({ key: k, project: p });
  for (const [k, p] of byProject) if (!byFull.has(k)) allKeys.push({ key: k, project: p });
  return { byId, byFull, byProject, allKeys };
}

export interface MatchResult {
  project: Project;
  /** True when resolved only by edit distance — surfaced to admins for review. */
  fuzzy: boolean;
}

export function findMatch(
  index: MatchIndex,
  name: string,
  aliasMap: Record<string, string>
): MatchResult | undefined {
  const full = matchKey(name);

  // Curated alias first — handles renames the fuzzy keys can't bridge. Scoped for
  // free: byId only contains the projects the caller indexed, so an alias pointing
  // at another org's project misses instead of granting access.
  const aliasId = aliasMap[full];
  if (aliasId && index.byId.has(aliasId)) {
    return { project: index.byId.get(aliasId) as Project, fuzzy: false };
  }

  if (full && index.byFull.has(full)) {
    return { project: index.byFull.get(full) as Project, fuzzy: false };
  }
  const proj = matchKey(splitClientProject(name).project);
  if (proj && index.byProject.has(proj)) {
    return { project: index.byProject.get(proj) as Project, fuzzy: false };
  }

  // Fuzzy fallback. Restricted to keys ≥ 8 chars to avoid short-name collisions.
  if (full.length >= 8) {
    let best: Project | undefined;
    let bestDist = 3; // exclusive upper bound
    for (const { key, project } of index.allKeys) {
      if (Math.abs(key.length - full.length) >= bestDist) continue; // fast skip
      const d = editDistance(full, key);
      if (d < bestDist) {
        bestDist = d;
        best = project;
      }
    }
    if (best) return { project: best, fuzzy: true };
  }
  return undefined;
}
