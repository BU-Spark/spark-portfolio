/**
 * Values copied verbatim from `spine/vocabularies.md`.
 *
 * These are NOT proposals and not ours to change. Per `spine/open-decisions.md`
 * § "What is NOT open": status, visibility and the topic taxonomy are decided,
 * live in atlas across 170 projects, and "re-deriving them from the prior art
 * would be a regression, not a design step."
 *
 * Source of truth today is `atlas/lib/data.ts`, mirrored by CHECK constraints in
 * `atlas/schema.sql`. When spine gets its own storage these move there; until
 * then this file is a local mirror and must be kept in step with atlas.
 */

/** spine/vocabularies.md § topic taxonomy — eleven groupings, one per item. */
export const TOPICS = [
  'Housing & Urban Development',
  'Health, Medicine & Wellbeing',
  'Government, Politics & Public Policy',
  'Environment & Sustainability',
  'Criminal Justice & Public Safety',
  'Law & Civil Rights',
  'Education & Learning',
  'Media, Technology & Communication',
  'Immigration, Community & Social Services',
  'Arts, Culture & Humanities',
  'Business, Economy & Work',
] as const;

export type Topic = (typeof TOPICS)[number];

/** spine/vocabularies.md § visibility — least to most visible. */
export const VISIBILITY = ['hidden', 'restricted', 'internal', 'public'] as const;

export type Visibility = (typeof VISIBILITY)[number];

/**
 * spine/vocabularies.md § status — the *project* pipeline. Listed here for
 * reference only: a bounty does not use it (see the `status` field comment in
 * src/content/config.ts). A completed bounty that becomes an atlas project
 * enters this pipeline at `complete`.
 */
export const PROJECT_STATUS = ['pending', 'active', 'in_review', 'complete'] as const;

/**
 * The gallery is opt-in. Never invert this to `!== 'hidden'`.
 * spine/vocabularies.md: that "would leak every internal project to anonymous
 * visitors."
 */
export function isPubliclyVisible(v: Visibility | undefined): boolean {
  return v === 'public';
}
