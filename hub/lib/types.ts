// Shared data model for the Spark! Project Gallery.

// A single semester/course run of a project. A project (one slug/name/repo) can
// have several runs as it continues across terms or moves between practicums.
export interface Run {
  term: string; // semester, e.g. "Fall 2025"
  course: string; // e.g. "DS488" or "Spark! UX Practicum"
  discipline: string; // auto-derived from course via disciplineFromCourse(); one of SPARK_DISCIPLINES
  students: string[]; // ADMIN-ONLY — never rendered publicly
  teamId?: string | null; // ADMIN-ONLY internal reference (Airtable team id)
  // ADMIN-ONLY per-semester team roles — a multi-semester project can have a
  // completely different team each run. Never shown publicly. Stored as raw
  // display names; resolved to emails via the people directory.
  sparkProgramLead?: string | null;
  pm?: string | null;
  tpm?: string | null;
  seniorAdvisor?: string | null;
  techAdvisor?: string | null;
  eir?: string | null;
  eirIsInstructor?: boolean; // the EIR person is actually a class instructor acting as EIR
  classInstructors?: string[]; // multiple names allowed (peer of EIR)
  pdUrl?: string | null; // ADMIN-ONLY Project Description doc link for THIS semester
}

// A single project contact: a person plus their email. ADMIN-ONLY.
export interface ProjectContact {
  name: string;
  email: string;
}

export interface Project {
  id: string; // slug/tag — the stable project identity
  title: string; // official project name
  blurb: string; // 1–2 sentences (backfilled in admin)
  partner: string; // client/organization name (backfilled in admin)
  contact?: string | null; // ADMIN-ONLY legacy single contact name — superseded by contacts[]
  contacts?: ProjectContact[]; // ADMIN-ONLY contacts (name + email), multiple allowed
  pdUrl?: string | null; // ADMIN-ONLY — DERIVED from the latest run's pdUrl (per-semester source of truth)
  driveUrl?: string | null; // ADMIN-ONLY project Google Drive folder — never public
  techNote?: string | null; // ADMIN-ONLY raw PD tech-stack cell — never public
  blurbLocked?: boolean; // when true, PD re-sync won't overwrite the (edited) blurb
  // ADMIN-ONLY team roles — never shown publicly. These are now PER-SEMESTER and
  // live on each Run; the project-level fields below are DERIVED from the latest
  // run (for admin list search / back-compat). Edit them per-run via Run.*.
  sparkProgramLead?: string | null;
  pm?: string | null;
  tpm?: string | null;
  seniorAdvisor?: string | null;
  techAdvisor?: string | null;
  eir?: string | null;
  eirIsInstructor?: boolean; // derived from latest run
  classInstructors?: string[]; // derived from latest run
  clientType: string; // one of SPARK_CLIENT_TYPES (backfilled in admin)
  tech: string[];
  repoUrl?: string | null; // "View project →" link (GitHub, etc.)
  prodUrl?: string | null; // live/demo site — shown publicly next to the repo
  codePrivate?: boolean; // true → show "code available on request" instead of a repo link
  clientUrl?: string | null; // the client ORG's website (link icon by the org name)
  clientDesc?: string | null; // short "about the client" blurb (expandable dropdown; public)
  topics?: string[]; // subject-matter tags (Criminal Justice, Healthcare, …)
  datasets?: ProjectDataset[]; // datasets used, shown next to "View project"
  images?: (string | null)[]; // up to four image URLs; first is the cover
  featured?: boolean; // spotlighted on the gallery
  published?: boolean; // false = draft, hidden from the public gallery
  surfaces?: string[]; // which galleries it appears on: "spark" and/or "cds" (default ["spark"])
  // VISIBILITY (surfaces) vs AUTHORITY (ownerOrg) — deliberately separate axes.
  // A project can be tagged for both galleries while exactly one team may edit it.
  // Never derive one from the other: every cds-tagged project is also spark-tagged,
  // so surfaces cannot express an edit boundary. See lib/authz.ts.
  ownerOrg?: string; // owning team: "spark" | "cds" (default "spark")
  custom?: boolean; // admin-added flag
  // DERIVED, ADMIN-ONLY: number of student contributors on this project. Set only
  // by getProjectsForList() (the admin list projection); undefined on public
  // payloads. missingInfo() flags "Contributors" only when this is defined and 0.
  contributorCount?: number;
  runs: Run[]; // one or more semester/course runs
}

// A dataset used by a project — label + link, shown by "View project".
export interface ProjectDataset {
  label: string;
  url: string;
  uncertain?: boolean; // ADMIN-ONLY signal: auto-scraped link needs a human check
}

export type FacetKey = "discipline" | "topic" | "program" | "clientType" | "term";

export type FacetCounts = Record<FacetKey, Record<string, number>>;

// One entry in a person's project-role timeline (ADMIN-ONLY).
// Populated by upsertPersonRole() on each PD sync and backfill-person-roles.ts.
export interface PersonRole {
  projectId: string;
  projectTitle: string;
  term: string;
  role: string;
}

// ADMIN-ONLY people directory entry (staff: leads, PMs, TPMs, advisors, EIRs).
// A curated overlay keyed by a stable surrogate id + unique name_key. `email` is
// hand-entered by admins (never imported); `aliases` are name_keys that should
// resolve to this person (fixes name splits like "Abby" vs "Abby Gualda").
// `roles`/`projectCount` are DERIVED at read time from the project role columns.
export interface Person {
  id: string; // bigserial — node-postgres returns bigint/bigserial as strings
  name: string; // canonical display name
  email: string | null;
  aliases: string[]; // additional name_keys mapping here
  notes: string | null;
  roles?: string[]; // derived: which roles this person holds across projects
  projectCount?: number; // derived
}

// A student contributor on a project (ADMIN-ONLY — students are never public).
// Keyed per-semester (term) because the same project's team can differ across
// runs. Distinct from the staff roles (Program Lead/PM/TPM…) in `Person`.
export interface Contributor {
  id: string; // bigserial — node-postgres returns bigint/bigserial as strings
  projectId: string;
  term: string | null; // semester this student was on the team
  firstName: string | null;
  lastName: string | null;
  githubUsername: string | null;
  email: string | null; // BU email — admin-only
}

// Admin-editable gallery configuration: the discipline + client-type
// vocabularies (used for the sidebar facets and the admin form dropdowns) and
// which facet groups are shown in the sidebar. Stored as one JSONB row; reads
// merge over DEFAULT_GALLERY_SETTINGS so a missing/empty row never breaks the UI.
export interface GallerySettings {
  disciplines: string[];
  clientTypes: string[];
  programs?: string[];
  showFacets: Record<FacetKey, boolean>;
  courseNames?: Record<string, string>;
  topics?: string[]; // Topic facet vocabulary (admin-editable)
  facetOrder?: FacetKey[]; // order the facet groups render in (admin-editable)
  thumbBadge?: "discipline" | "course" | "program"; // which field the card thumbnail badge shows
  // Admin-editable homepage copy (falls back to DEFAULT_GALLERY_SETTINGS).
  intro?: { eyebrow: string; heading: string; body: string };
  // Hero stats shown by the intro logo: each renders "<live count> <text>",
  // e.g. "170 projects since 2019" / "480 student experiences". The number is
  // derived from `metric` (not editable); only `text` and visibility are.
  // `value` overrides the live count when set (admin-entered); otherwise the
  // count is derived (projects = list length, students = contributor count).
  heroStats?: { show: boolean; metric: "projects" | "students"; text: string; value?: number }[];
}

// --- Delegated screenshot uploads (magic link) -------------------------------
// An admin generates a scoped link for a project and sends it to a PM. The PM
// (or anyone they forward it to) uploads up to 4 screenshots WITHOUT logging in;
// the token is the capability. Uploads sit in `images` (pending S3 keys, not yet
// on the project) until an admin approves them in the review queue.
//   open      → link live, accepting uploads
//   submitted → PM clicked "Submit for review"; in the admin queue
//   approved  → admin approved; images merged onto the project (terminal)
// Reject sends a `submitted` request back to `open` with a `reviewNote`.
export type UploadRequestStatus = "open" | "submitted" | "approved";

export interface UploadRequest {
  token: string;
  projectId: string;
  projectTitle?: string; // joined from projects for the admin queue
  recipient: string | null; // email it was sent to (record-keeping, NOT auth)
  status: UploadRequestStatus;
  images: string[]; // pending S3 keys (≤4)
  createdAt: string;
  expiresAt: string;
  submittedAt: string | null;
  reviewNote: string | null;
}
