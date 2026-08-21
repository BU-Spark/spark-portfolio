// BU Spark! Project Gallery — facet vocabularies + seed dataset.
// Disciplines (practicum categories), Programs, Client types, Terms.
import type { GallerySettings } from "./types";

// Legacy flat shape of the seed reference projects. These are only consumed by
// scripts/db-setup.ts, which converts each into a one-run Project. The live app
// reads the runs-based model from the database, not this array.
export interface SeedProject {
  id: string;
  title: string;
  blurb: string;
  discipline: string;
  program: string;
  clientType: string;
  partner: string;
  term: string;
  course: string;
  tech: string[];
  team: string[];
  featured?: boolean;
}

export const SPARK_DISCIPLINES = [
  "UX",
  "SWE",
  "ML",
  "Data Visualization",
  "Data Science",
  "Innovation",
  "Misc",
];

export const SPARK_PROGRAMS = [
  "Civic Tech",
  "Justice Media Co-Lab",
  "X-Lab Practicum",
  "CivicHacks",
  "Demo Day",
];

export const SPARK_CLIENT_TYPES = [
  "Government",
  "Nonprofit",
  "Media",
  "Education",
  "Healthcare",
  "Startup",
  "Research",
];

// Which public galleries a project can be surfaced on (internal admin tag). A
// project can be on one or both. Extensible for future Database++ sub-brands.
export const SURFACES: { key: string; label: string; hint: string }[] = [
  { key: "spark", label: "Spark! Gallery", hint: "sparkshowcase — the main BU Spark! gallery" },
  { key: "cds", label: "CDS Gallery", hint: "/cds — Faculty of Computing & Data Sciences" },
];
export const SURFACE_KEYS = SURFACES.map((s) => s.key);

// Subject-matter topics (the Topic facet vocabulary). Admin-editable; this is a
// detailed starting set.
export const SPARK_TOPICS = [
  "Criminal Justice",
  "Healthcare",
  "Mental Health",
  "Education",
  "Housing",
  "Environment & Climate",
  "Public Safety",
  "Transportation",
  "Immigration",
  "Economic Development",
  "Civic Engagement",
  "Government & Policy",
  "Arts & Culture",
  "Food Security",
  "Accessibility",
  "Community Development",
  "Media & Journalism",
  "Sustainability",
];

// Baseline gallery config. The admin settings panel can override the
// vocabularies and toggle facets; a fresh/empty DB falls back to exactly this.
export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  disciplines: SPARK_DISCIPLINES,
  clientTypes: SPARK_CLIENT_TYPES,
  programs: SPARK_PROGRAMS,
  topics: SPARK_TOPICS,
  facetOrder: ["discipline", "topic", "clientType", "program", "term"],
  thumbBadge: "discipline",
  showFacets: { discipline: true, topic: true, program: true, clientType: true, term: true },
  intro: {
    eyebrow: "Explore our work",
    heading: "Student-built projects, with real partners and real impact.",
    body: "Browse work from our practicums, and co-labs — searchable by discipline, program, partner, and the technologies behind each build.",
  },
  heroStats: [
    { show: true, metric: "projects", text: "projects since 2019" },
    { show: true, metric: "students", text: "student experiences" },
  ],
};

// Friendly display names for course codes (the import stores raw codes like
// "DS549" as both course + program). Used for display/facets; the code stays
// the stored value. Edit these to taste — unmapped codes fall back to the code.
export const COURSE_NAMES: Record<string, string> = {
  "DS488/688": "Spark! UX Practicum",
  DS488: "Spark! UX Practicum",
  DS688: "Spark! UX Practicum",
  DS519: "Spark! Software Engineering Practicum",
  DS539: "Spark! Data Science Practicum",
  DS549: "Spark! Machine Learning Practicum",
  DS594: "Spark! Data Visualization Practicum",
  DS701: "Tools for Data Science",
  XC410: "Justice Media Co-Lab",
  XC473: "Justice Media Co-Lab",
  XC475: "Spark! Innovation Fellowship",
  CS506: "Spark! Software Engineering Practicum",
  // Consolidate the two internship program values into one facet row.
  Internship: "Spark! Internship Program",
  "Spark! Summer Internship": "Spark! Internship Program",
};

// Maps a course code (or full name) to its SPARK_DISCIPLINES value.
// Handles bare codes ("DS488"), slash forms ("DS488/688"), and friendly names
// like "Spark! UX Practicum". Returns "" when no mapping is found.
export function disciplineFromCourse(course: string): string {
  if (!course) return "";
  // Strip all non-alphanumeric characters so "Co-Lab", "DS488/688", "DS 549: …"
  // all normalize consistently for substring matching.
  const up = course.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (up.includes("DS488") || up.includes("DS688")) return "UX";
  if (up.includes("DS519") || up.includes("CS506")) return "SWE";
  if (up.includes("DS539") || up.includes("DS701")) return "Data Science";
  if (up.includes("DS549")) return "ML";
  if (up.includes("DS594")) return "Data Visualization";
  if (up.includes("XC475")) return "Innovation";
  if (up.includes("XC410") || up.includes("XC473")) return "Data Visualization";
  // Keyword fallbacks for legacy full-name strings
  if (up.includes("MACHINELEARNING")) return "ML";
  if (up.includes("DATAVISUALIZATION")) return "Data Visualization";
  if (up.includes("DATASCIENCE")) return "Data Science";
  if (up.includes("SOFTWAREENGINEERING")) return "SWE";
  if (up.includes("INNOVATION") || up.includes("FELLOWSHIP")) return "Innovation";
  if (up.includes("JUSTICEMEDIACOLLABORATORY") || up.includes("JUSTICEMEDIACOLAB")) return "Data Visualization";
  return "";
}

// overrides: optional per-request map (from GallerySettings.courseNames) that
// takes precedence over COURSE_NAMES defaults. Lookup tries exact match first,
// then space-stripped+uppercase normalisation (handles "CS 506" vs "CS506").
export function courseLabel(code: string, overrides?: Record<string, string>): string {
  const normalized = code.trim().replace(/\s+/g, "").toUpperCase();
  const map = overrides ?? COURSE_NAMES;
  return (
    map[code.trim()] ??
    map[normalized] ??
    COURSE_NAMES[code.trim()] ??
    COURSE_NAMES[normalized] ??
    code
  );
}

// Compact display of a set of course codes, grouped by 2-letter prefix:
//   ["DS488","DS688"] -> "DS 488/688"   ["DS519"] -> "DS 519"
//   mixed prefixes    -> "DS 519 / CS 506"
// Non-code strings (legacy full names) are ignored; returns "" if none qualify.
export function formatCourseCodes(codes: string[]): string {
  const groups = new Map<string, string[]>();
  for (const c of codes) {
    const m = (c || "").trim().toUpperCase().match(/^([A-Z]{2})(\d{3})$/);
    if (!m) continue;
    const pre = m[1];
    const num = m[2];
    const arr = groups.get(pre) ?? [];
    if (!arr.includes(num)) arr.push(num);
    groups.set(pre, arr);
  }
  return [...groups.entries()]
    .map(([pre, nums]) => `${pre} ${nums.sort().join("/")}`)
    .join(" / ");
}

// newest → oldest (drives the "Newest first" sort)
// Floor list of selectable terms (merged with distinct DB terms in
// /api/admin/terms). Keep the upcoming semester here so a new run / project can
// be filed against it before any project uses it yet. Newest first.
export const SPARK_TERMS = [
  "Fall 2026",
  "Summer 2026",
  "Spring 2026",
  "Fall 2025",
  "Spring 2025",
  "Fall 2024",
  "Spring 2024",
];

// Where a project is in the delivery pipeline. A THIRD axis, independent of both
// `published` (whether the public sees it) and `owner_org` (which team may edit it)
// — a project can be complete but unpublished (finished, awaiting a screenshot), or
// published while still active. Never derive one axis from another.
//
// Mirrors the projects_status_chk CHECK constraint in
// db/migrations/002_project_status.sql, as widened by 004_status_in_review.sql.
// Keep the two in step: a value added here and not there is rejected by the
// database at write time.
//
// Order is pipeline order, and the admin selects render in it.
//
//   pending    scoped, not yet worked on
//   active     currently being worked on, no completion claimed
//   in_review  a PM submitted the completion form and it did NOT pass the checks
//   complete   submitted and passed
//
// `in_review` exists because `active` and `pending` both fail to describe a bounced
// submission. `pending` means "not started" — reusing it would erase the difference
// between work nobody has begun and work someone believes is finished. `active` means
// "in progress" and loses the fact that a claim was made and rejected, which is the
// part a supervisor needs: it distinguishes a project nobody has looked at from one
// whose PM thinks it is done while the data says otherwise.
export const PROJECT_STATUSES = ["pending", "active", "in_review", "complete"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Admin-facing labels + the one-line meaning, used by the form selects. */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  pending: "Pending — scoped, not started",
  active: "Active — in progress",
  in_review: "In review — completion submitted, checks failed",
  complete: "Complete — work finished",
};

/** Short form for badges, where the full label is too long. */
export const PROJECT_STATUS_SHORT: Record<ProjectStatus, string> = {
  pending: "pending",
  active: "active",
  in_review: "in review",
  complete: "complete",
};

// Who can see a project. Widened from the old `published` boolean so the gallery can
// be OPT-IN: "ready" and "live" are different states, and a boolean cannot hold both.
//
//   hidden    draft — not finished; only the admin area shows it
//   internal  ready, not opted in. Staff preview it at /admin/projects/<id>, which
//             already mirrors the public layout.
//   public    opted in — live on the gallery
//
// Mirrors projects_visibility_chk in db/migrations/003_visibility.sql. Order matters
// here: it is least → most visible, and the admin select renders in this order.
export const VISIBILITIES = ["hidden", "internal", "public"] as const;

export type Visibility = (typeof VISIBILITIES)[number];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  hidden: "Draft — not finished",
  internal: "Ready — staff only, not on the gallery",
  public: "Public — live on the gallery",
};

/** Short label for list badges. */
export const VISIBILITY_SHORT: Record<Visibility, string> = {
  hidden: "draft",
  internal: "ready",
  public: "public",
};

export const SPARK_PROJECTS: SeedProject[] = [
  {
    id: "boston-311-equity",
    title: "Boston 311 Service Equity Dashboard",
    blurb:
      "An interactive dashboard surfacing disparities in 311 response times across Boston neighborhoods to help the city allocate resources more equitably.",
    discipline: "Data Visualization",
    program: "Civic Tech",
    clientType: "Government",
    partner: "City of Boston — Analytics Team",
    term: "Spring 2026",
    course: "DS 549: Spark! Data Science Practicum",
    tech: ["Python", "D3.js", "Pandas", "Mapbox"],
    team: ["Aisha Rahman", "Diego Fuentes", "Hannah Liu", "Marcus Webb"],
    featured: true,
  },
  {
    id: "eviction-suffolk",
    title: "Mapping Eviction Patterns in Suffolk County",
    blurb:
      "A data investigation pairing court records with census data to reveal where eviction filings concentrate, built alongside an investigative newsroom.",
    discipline: "Data Science",
    program: "Justice Media Co-Lab",
    clientType: "Media",
    partner: "The Boston Globe",
    term: "Spring 2026",
    course: "Justice Media Co-Lab Practicum",
    tech: ["Python", "GeoPandas", "Mapbox", "Jupyter"],
    team: ["Priya Nair", "Tom Shea", "Olivia Brooks"],
    featured: true,
  },
  {
    id: "mbta-delay",
    title: "MBTA Bus Delay Predictor",
    blurb:
      "A machine learning model that forecasts bus arrival delays from real-time GPS and weather feeds, with a rider-facing prototype.",
    discipline: "ML",
    program: "Civic Tech",
    clientType: "Government",
    partner: "MassDOT",
    term: "Fall 2025",
    course: "DS 549: Spark! Data Science Practicum",
    tech: ["Python", "scikit-learn", "React", "FastAPI"],
    team: ["Kevin Zhao", "Sara Okafor", "Liam Chen"],
    featured: false,
  },
  {
    id: "food-pantry-forecast",
    title: "Food Pantry Demand Forecasting",
    blurb:
      "Time-series forecasting to help a regional food bank anticipate weekly demand and reduce waste across distribution sites.",
    discipline: "Data Science",
    program: "X-Lab Practicum",
    clientType: "Nonprofit",
    partner: "Greater Boston Food Bank",
    term: "Fall 2025",
    course: "DS 488: X-Lab Practicum",
    tech: ["Python", "Prophet", "Streamlit"],
    team: ["Maya Patel", "Jordan Ellis"],
    featured: false,
  },
  {
    id: "voting-portal",
    title: "Accessible Voting Information Portal",
    blurb:
      "A WCAG-compliant redesign of the state's voter information experience, tested with screen-reader users and low-vision voters.",
    discipline: "UX",
    program: "Civic Tech",
    clientType: "Government",
    partner: "MA Secretary of the Commonwealth",
    term: "Spring 2026",
    course: "Spark! UX Practicum",
    tech: ["Figma", "React", "Next.js", "axe-core"],
    team: ["Grace Kim", "Noah Adeyemi", "Feng Li"],
    featured: true,
  },
  {
    id: "climate-story-map",
    title: "Climate Resilience Story Map",
    blurb:
      "A scrollytelling map pairing flood-risk modeling with community interviews to communicate climate vulnerability across coastal Massachusetts.",
    discipline: "Data Visualization",
    program: "Justice Media Co-Lab",
    clientType: "Media",
    partner: "GBH News",
    term: "Fall 2025",
    course: "Justice Media Co-Lab Practicum",
    tech: ["D3.js", "Mapbox", "Svelte", "Scrollama"],
    team: ["Ruth Mensah", "Caleb Stone", "Ana Reyes"],
    featured: false,
  },
  {
    id: "small-biz-loans",
    title: "Small Business Loan Equity Analysis",
    blurb:
      "Statistical analysis of small-business lending outcomes by neighborhood and ownership demographics to inform a state capital program.",
    discipline: "Data Science",
    program: "X-Lab Practicum",
    clientType: "Government",
    partner: "Mass Growth Capital Corp.",
    term: "Spring 2025",
    course: "DS 488: X-Lab Practicum",
    tech: ["R", "Tableau", "SQL"],
    team: ["Daniel Park", "Sofia Marquez"],
    featured: false,
  },
  {
    id: "volunteer-match",
    title: "Volunteer Matching Platform",
    blurb:
      "A full-stack web app that matches volunteers to nonprofit shifts based on skills, location, and availability.",
    discipline: "SWE",
    program: "X-Lab Practicum",
    clientType: "Nonprofit",
    partner: "United Way of Massachusetts Bay",
    term: "Spring 2026",
    course: "CS 506: Spark! Software Engineering",
    tech: ["TypeScript", "Node.js", "PostgreSQL", "React"],
    team: ["Emily Tran", "Raj Mehta", "Chris Donovan", "Bella Ortiz"],
    featured: false,
  },
  {
    id: "legal-aid-triage",
    title: "AI Triage Assistant for Legal Aid",
    blurb:
      "An NLP assistant that helps legal-aid intake staff categorize and prioritize tenant requests, with a human-in-the-loop review flow.",
    discipline: "ML",
    program: "Justice Media Co-Lab",
    clientType: "Nonprofit",
    partner: "Greater Boston Legal Services",
    term: "Fall 2025",
    course: "Justice Media Co-Lab Practicum",
    tech: ["Python", "spaCy", "Hugging Face", "Flask"],
    team: ["Anika Joshi", "Patrick O'Neil"],
    featured: false,
  },
  {
    id: "campus-sustainability",
    title: "Campus Sustainability Tracker",
    blurb:
      "A mobile app gamifying energy and waste reduction across dorms, piloted with the university sustainability office.",
    discipline: "Innovation",
    program: "Demo Day",
    clientType: "Education",
    partner: "BU Sustainability",
    term: "Spring 2025",
    course: "Spark! Innovation Fellowship",
    tech: ["React Native", "Firebase", "Figma"],
    team: ["Tyler Brooks", "Nina Volkov"],
    featured: false,
  },
  {
    id: "opioid-access-map",
    title: "Opioid Treatment Access Map",
    blurb:
      "A geographic analysis of treatment-center accessibility by public transit, highlighting gaps in care across the Commonwealth.",
    discipline: "Data Visualization",
    program: "Civic Tech",
    clientType: "Healthcare",
    partner: "MA Dept. of Public Health",
    term: "Fall 2024",
    course: "DS 549: Spark! Data Science Practicum",
    tech: ["Python", "Folium", "GeoPandas"],
    team: ["Hassan Ali", "Megan Wright", "Yuki Tanaka"],
    featured: false,
  },
  {
    id: "newsroom-diversity",
    title: "Newsroom Source Diversity Dashboard",
    blurb:
      "A tool that audits whose voices appear in local news coverage, helping editors track representation across beats over time.",
    discipline: "Data Visualization",
    program: "Justice Media Co-Lab",
    clientType: "Media",
    partner: "The Boston Globe",
    term: "Spring 2025",
    course: "Justice Media Co-Lab Practicum",
    tech: ["Python", "spaCy", "Plotly", "Dash"],
    team: ["Lauren Fitz", "Omar Haddad"],
    featured: false,
  },
  {
    id: "renters-chatbot",
    title: "Renter's Rights Chatbot",
    blurb:
      "A retrieval-augmented chatbot that answers tenant questions in plain language and points to local resources and legal protections.",
    discipline: "SWE",
    program: "CivicHacks",
    clientType: "Nonprofit",
    partner: "City Life / Vida Urbana",
    term: "Spring 2026",
    course: "CivicHacks 2026",
    tech: ["TypeScript", "Next.js", "LangChain", "Pinecone"],
    team: ["Isabel Cruz", "Wesley Boateng", "Mina Sato"],
    featured: false,
  },
  {
    id: "school-resource-equity",
    title: "Public School Resource Equity",
    blurb:
      "An analysis of per-pupil resource distribution across district schools, packaged as a briefing for school-committee members.",
    discipline: "Data Science",
    program: "Civic Tech",
    clientType: "Education",
    partner: "Boston Public Schools",
    term: "Fall 2024",
    course: "DS 549: Spark! Data Science Practicum",
    tech: ["Python", "Pandas", "Tableau"],
    team: ["Jasmine Lee", "Andre Costa"],
    featured: false,
  },
  {
    id: "pedestrian-safety",
    title: "Pedestrian Safety Heatmap",
    blurb:
      "A crash-data heatmap and prioritization tool supporting the city's Vision Zero commitment to eliminate traffic deaths.",
    discipline: "Data Visualization",
    program: "Civic Tech",
    clientType: "Government",
    partner: "Boston Transportation Dept.",
    term: "Spring 2025",
    course: "DS 549: Spark! Data Science Practicum",
    tech: ["Python", "Kepler.gl", "PostGIS"],
    team: ["Victor Nguyen", "Chloe Bauer", "Sam Idris"],
    featured: false,
  },
  {
    id: "inclusive-hiring",
    title: "Inclusive Hiring Screening Tool",
    blurb:
      "A redesigned applicant-screening flow that reduces bias signals and improves the candidate experience for an early-stage startup.",
    discipline: "UX",
    program: "Demo Day",
    clientType: "Startup",
    partner: "Hopskip (seed-stage)",
    term: "Fall 2025",
    course: "Spark! UX Practicum",
    tech: ["Figma", "Maze", "React"],
    team: ["Dana Cohen", "Felix Moreau"],
    featured: false,
  },
  {
    id: "wildlife-migration",
    title: "Wildlife Migration Tracker",
    blurb:
      "A computer-vision pipeline that identifies and counts species from trail-camera imagery for a conservation research lab.",
    discipline: "ML",
    program: "X-Lab Practicum",
    clientType: "Research",
    partner: "Mass Audubon",
    term: "Spring 2024",
    course: "DS 488: X-Lab Practicum",
    tech: ["Python", "PyTorch", "YOLOv8", "OpenCV"],
    team: ["Grace Holloway", "Ben Tucker"],
    featured: false,
  },
  {
    id: "civic-budget",
    title: "Civic Budget Explorer",
    blurb:
      "An interactive explorer that makes the municipal budget legible to residents, with department drill-downs and year-over-year views.",
    discipline: "Data Visualization",
    program: "Civic Tech",
    clientType: "Government",
    partner: "City of Boston — Budget Office",
    term: "Spring 2026",
    course: "DS 549: Spark! Data Science Practicum",
    tech: ["React", "D3.js", "Vite"],
    team: ["Ethan Wallace", "Priscilla Adu", "Naomi Stern"],
    featured: true,
  },
  {
    id: "misinfo-detection",
    title: "Misinformation Detection in Local News",
    blurb:
      "A model flagging potentially misleading claims in hyper-local social posts, built with editorial guardrails and explainability.",
    discipline: "ML",
    program: "Justice Media Co-Lab",
    clientType: "Media",
    partner: "GBH News",
    term: "Spring 2024",
    course: "Justice Media Co-Lab Practicum",
    tech: ["Python", "Transformers", "SHAP"],
    team: ["Leah Goldberg", "Kofi Asante"],
    featured: false,
  },
  {
    id: "energy-burden",
    title: "Energy Burden Visualizer",
    blurb:
      "A neighborhood-level visualization of household energy cost burden to guide a nonprofit's weatherization outreach.",
    discipline: "Data Visualization",
    program: "X-Lab Practicum",
    clientType: "Nonprofit",
    partner: "ABCD Inc.",
    term: "Fall 2024",
    course: "DS 488: X-Lab Practicum",
    tech: ["Python", "Plotly", "Dash"],
    team: ["Carlos Vega", "Hana Yoshida"],
    featured: false,
  },
  {
    id: "transit-equity-survey",
    title: "Transit Equity Survey Platform",
    blurb:
      "A multilingual survey tool and analysis pipeline capturing rider experiences to inform regional transit planning.",
    discipline: "SWE",
    program: "Civic Tech",
    clientType: "Government",
    partner: "Metropolitan Area Planning Council",
    term: "Fall 2025",
    course: "CS 506: Spark! Software Engineering",
    tech: ["TypeScript", "Next.js", "Supabase"],
    team: ["Aaron Blum", "Sadia Khan", "Marco Ricci"],
    featured: false,
  },
  {
    id: "shelter-capacity",
    title: "Shelter Capacity Coordination App",
    blurb:
      "A lightweight tool that lets shelter staff update available beds in real time so outreach teams can place people faster.",
    discipline: "Innovation",
    program: "CivicHacks",
    clientType: "Nonprofit",
    partner: "Pine Street Inn",
    term: "Spring 2026",
    course: "CivicHacks 2026",
    tech: ["React", "Firebase", "Twilio"],
    team: ["Julia Ferreira", "Devon Clarke"],
    featured: false,
  },
  {
    id: "lead-pipe-risk",
    title: "Lead Pipe Risk Model",
    blurb:
      "A predictive model estimating the likelihood of lead service lines by parcel to help prioritize replacement inspections.",
    discipline: "Data Science",
    program: "Civic Tech",
    clientType: "Government",
    partner: "Boston Water & Sewer Commission",
    term: "Fall 2024",
    course: "DS 549: Spark! Data Science Practicum",
    tech: ["Python", "XGBoost", "GeoPandas"],
    team: ["Renee Dubois", "Ibrahim Sow", "Katie Mills"],
    featured: false,
  },
];
