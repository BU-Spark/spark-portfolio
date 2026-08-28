// Project-Description parsing — kept as a standalone, runtime-agnostic module so
// the central "everything Spark" system can reuse it server-side later (e.g. an
// OAuth-backed Docs fetch) without dragging in any web/DB code.
//
// The PD docs follow a template: a "Project Description:" heading, the summary
// beneath it, then an "Ideal Output & Final Deliverables" heading. We slice the
// text strictly between those two markers. No LLM — pure string work.

// The body summary heading. DS docs use "Project Description:"; UX docs use a
// bare "Description". Match a line that STARTS with "Description" or "Project
// Description", followed by a colon or end-of-line. The line-start anchor rejects
// mid-line uses ("Client Name and Description", "Customer/End User Description")
// and the title line ("DS488 Project Description Template…" starts with "DS488").
// Global → take the LAST match before the end marker (the summary sits just above
// deliverables, so a DS doc still lands on "Project Description:" not an earlier
// "Description").
const HEAD_RE = /(?:^|\n)[^\S\n]*(?:project )?description[^\S\n]*(?::|(?=\n|$))/gi;
// The description ends at the first POST-description section heading. All
// alternatives are LINE-ANCHORED (a heading on its own line), so the words in
// prose ("the final deliverable will…", "an overview of…") can't trigger a cut;
// earliest match wins (extractPdBlurb uses .match, no /g). The set is the union
// of headings the PD template puts after the summary — crucially "Ideal Output"
// matches whether the doc writes "Ideal Output & Deliverables", "…& Final
// Deliverables", or a bare "Ideal Output:" (the old marker only caught the
// "…Final Deliverables" phrasing, so the common "& Deliverables" variant leaked
// the entire rest of the doc — contact tables, milestones, meeting notes — into
// the blurb). Docs with none of these headings (e.g. a "What Was Completed This
// Semester" wrap-up only) are still bounded by those wrap-up headings.
const END_RE = new RegExp(
  "(?:^|\\n)[^\\S\\n]*(?:" +
    [
      "ideal output", // "Ideal Output", "…& Deliverables", "…& Final Deliverables"
      "final deliverables",
      "project details\\b",
      "project milestones\\b",
      "project contact information",
      "semester wrap[ -]?up",
      "what was completed",
      "future next steps",
      "handoff instructions",
      "client meeting notes",
      "last updated\\s*:",
    ].join("|") +
    ")",
  "i"
);

/**
 * Extract the verbatim Project Description summary from a doc's full plain text.
 * Returns "" when no usable heading is found (caller logs it as noBlurb).
 */
export function extractPdBlurb(docText: string): string {
  if (!docText) return "";
  const text = docText.replace(/\r\n/g, "\n");

  // Bound the search at the end marker so a stray heading after it can't win.
  const end = text.match(END_RE);
  const endIdx = end && end.index !== undefined ? end.index : text.length;
  const before = text.slice(0, endIdx);

  const heads = [...before.matchAll(HEAD_RE)];
  if (!heads.length) return "";
  const last = heads[heads.length - 1];
  const body = before.slice((last.index ?? 0) + last[0].length);

  return cleanBlurb(body);
}

/**
 * Re-clean an ALREADY-EXTRACTED blurb (the body, no leading heading) by applying
 * the same end-marker trim + cleanBlurb. Lets us repair blurbs already stored in
 * the DB — where an old extractor leaked a later section into the text — WITHOUT
 * re-fetching the source doc. Idempotent: a clean blurb has no end heading, so it
 * just normalizes and returns unchanged. Re-extraction on the next sync yields
 * the same result.
 */
export function recleanBlurb(stored: string): string {
  if (!stored) return "";
  const text = stored.replace(/\r\n/g, "\n");
  const end = text.match(END_RE);
  const endIdx = end && end.index !== undefined ? end.index : text.length;
  return cleanBlurb(text.slice(0, endIdx));
}

// Label that opens the PD's tech-stack field (in the "Project Details" table or
// a "Tech Stack / Design System Used" section). Line-anchored; the title-line
// "…Project Description…" is excluded by requiring the label at line start.
const TECH_LABEL_RE = /^[^\S\n]*(?:#+\s*)?\**\s*(?:preferred tech stack|tech stack(?:\s*\/\s*design system used)?|design system used)\b\s*\**\s*[:\-|]?\s*/i;
// The next field/section labels that CLOSE the tech block (so we don't run past
// it into questions, datasets, milestones, contacts, etc.).
const TECH_END_RE = /^[^\S\n]*(?:#+\s*)?\**\s*(?:key questions|user stories|data ?sets?|datasets|data dictionary|key project links|project milestones|deliverable|background readings|common misconceptions|ethical considerations|glossary|recommended steps|project links|client avail|key metrics|project contact|ideal output|final deliverables|project description)\b/i;

/**
 * Extract the PD's tech-stack cell from the full plain-text doc the Apps Script
 * sends (the same `pdText` blurbs come from) — DETERMINISTICALLY, no LLM. Finds
 * the "Preferred Tech Stack" / "Tech Stack" / "Design System Used" label and
 * captures the lines under it up to the next known field/section label. The
 * caller runs parseTechStack() on the result (dictionary match + prose flag).
 * Returns "" when no tech field is present. This replaces the Apps Script's
 * fragile table-cell reader — the server already has the doc text, so parse here.
 */
export function extractTechStack(docText: string): string {
  if (!docText) return "";
  const lines = docText.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => TECH_LABEL_RE.test(l));
  if (start < 0) return "";
  const out: string[] = [];
  // Strip the label, then any leftover "(Preferred Tech Stack)" parenthetical
  // and separators, leaving only a value that shared the label's line.
  const sameLine = lines[start]
    .replace(TECH_LABEL_RE, "")
    .replace(/^\s*\([^)]*\)\s*[:\-|]?\s*/, "")
    .trim();
  if (sameLine) out.push(sameLine);
  for (let j = start + 1; j < lines.length; j++) {
    if (TECH_END_RE.test(lines[j])) break;
    out.push(lines[j]);
    if (out.join("\n").length > 800) break; // safety cap against runaway capture
  }
  return cleanBlurb(out.join("\n")).trim();
}

/**
 * Tidy a blurb for display. The doc's own line breaks delimit bullets and
 * paragraphs (they survive in the stored text), so we DON'T infer bullet
 * boundaries — we just normalize the marker glyph and whitespace, and let the
 * renderer keep the line breaks (white-space: pre-line). Google Docs exported as
 * plain text prefix list items with "* " / "- " (occasionally a unicode bullet);
 * left raw they read as stray asterisks. Convert any leading marker to "• ".
 * Idempotent — re-running on cleaned text is a no-op.
 */
export function cleanBlurb(text: string): string {
  if (!text) return "";
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    // Leading bullet marker (after optional indent) → a clean "• ".
    .map((line) => line.replace(/^(\s*)[*•●○▪◦‣·-]\s+/, "$1• "))
    .map((l) => l.replace(/\s+$/g, ""));
  // Drop trailing orphan link/CTA labels — a "Read more" / "Learn more"
  // hyperlink that exported as its own line, plus any blank lines — so the
  // blurb ends on real prose rather than a dangling link word.
  const CTA = /^\s*(?:•\s*)?(?:read|learn|see|view|find out)\s+more\b[\s.»)]*$/i;
  while (lines.length && (!lines[lines.length - 1].trim() || CTA.test(lines[lines.length - 1]))) {
    lines.pop();
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Role label (in the PD contact table) → our project role field. Order matters:
// TPM is tested before PM so "TPM" doesn't fall through to the PM rule. "Spark
// Advisor / Professor" and "Instructor" map to nothing (that's the faculty
// contact, not one of our six roles); Client/Teammate are skipped too.
const CONTACT_ROLES: [RegExp, keyof PdContacts][] = [
  [/program lead/i, "sparkProgramLead"],
  [/\btpm\b|technical project manager/i, "tpm"],
  [/\bpm\b|project manager/i, "pm"],
  [/senior.*advisor/i, "seniorAdvisor"],
  [/tech\w*\.?\s*advisor/i, "techAdvisor"],
  [/\beir\b|entrepreneur in residence/i, "eir"],
];
export interface PdContact { name: string; email: string | null }
export type PdContacts = {
  sparkProgramLead?: PdContact; pm?: PdContact; tpm?: PdContact;
  seniorAdvisor?: PdContact; techAdvisor?: PdContact; eir?: PdContact;
};
const roleOf = (cell: string): (keyof PdContacts) | null =>
  CONTACT_ROLES.find(([re]) => re.test(cell))?.[1] ?? null;

/**
 * Pull the project's Google Drive FOLDER link out of the PD text (it appears
 * under "Key Project Links" / "Google Drive Folder"). Returns the first
 * drive.google.com/drive/folders/<id> URL found, or "". Stored admin-only.
 */
export function extractDriveFolder(docText: string): string {
  if (!docText) return "";
  const m = docText.match(/https?:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+(?:\?[^\s)]*)?/i);
  return m ? m[0] : "";
}

/**
 * Parse the PD "Project Contact Information" table out of the full plain-text
 * doc — the authoritative source of FULL staff names (the tracker columns carry
 * only first names) and their emails. The Doc table exports as a flat run of
 * one-cell-per-line tabs: a Role / First / Last / Email header, then repeating
 * (role, first, last, email?) groups (email is sometimes blank). We anchor on
 * recognized role labels and read the next two cells as first/last and a
 * following email-shaped cell as the email. Deterministic — no LLM.
 */
export function extractContacts(docText: string): PdContacts {
  if (!docText) return {};
  const idx = docText.search(/(?:project )?contact information/i);
  if (idx < 0) return {};
  let section = docText.slice(idx);
  // Bound before the meeting-notes / wrap-up boilerplate that follows.
  const tail = section.slice(25).search(/_{5,}|semester wrap|client (?:meeting )?notes|notes section/i);
  if (tail >= 0) section = section.slice(0, tail + 25);
  const cells = section
    .split("\n")
    .map((s) => s.replace(/^[\s>*|]+|[\s|]+$/g, "").trim())
    .filter(Boolean);

  const out: PdContacts = {};
  const looksEmail = (s: string) => /\S+@\S+\.\S+/.test(s || "");
  for (let i = 1; i < cells.length; i++) {
    const role = roleOf(cells[i]);
    if (!role || out[role]) continue;
    const first = cells[i + 1] || "";
    const last = cells[i + 2] || "";
    // First cell after the role must be a plain name, not another role/email/header.
    if (!first || looksEmail(first) || roleOf(first) || /^(first|last) name$/i.test(first)) continue;
    const parts = [first, last].filter((x) => x && !looksEmail(x) && !roleOf(x) && !/name$/i.test(x));
    const name = parts.join(" ").trim();
    const email = looksEmail(cells[i + 3]) ? cells[i + 3] : looksEmail(last) ? last : null;
    if (name) out[role] = { name, email };
  }
  return out;
}

/**
 * Normalize a project name for matching across data sources (PM tracker rows vs
 * the imported catalog). Mirrors the importer's normalizer: strip surrounding
 * quotes, unescape doubled quotes, collapse whitespace, lowercase.
 */
export function normalizeName(s: string): string {
  return (s || "")
    .replace(/^"+|"+$/g, "")
    .replace(/""/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Split a "Client: Project Name" (or "Client - Project Name") string into its
 * parts. Tracker master tabs and the catalog both use this convention; per-class
 * tabs use a bare project name (no client prefix → client "").
 */
export function splitClientProject(name: string): { client: string; project: string } {
  const m = (name || "").match(/^(.{2,}?)\s*[:–—-]\s+(.+)$/);
  if (m) return { client: m[1].trim(), project: m[2].trim() };
  return { client: "", project: (name || "").trim() };
}

/**
 * Normalized key for matching project names across sources. Lowercases, maps
 * "&"→"and", strips punctuation, drops a trailing "Project", collapses spaces.
 * Tolerant of colon/dash/"&"/"|"/suffix drift — NOT of word typos
 * (Educational↔Education), which need fuzzy matching.
 */
/** Levenshtein edit distance between two strings. */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

export function matchKey(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // drop parentheticals: (Team A & B), (TBD), (BCH)…
    .replace(/-\s*aligned\b/g, " ") // trailing "- ALIGNED" marker
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\bteam [ab]\b/g, " ") // stray "Team A"/"Team B" without parens
    .replace(/\s+/g, " ")
    .replace(/\s*\bproject\b\s*$/, "")
    .trim();
}

/**
 * Curated aliases for projects whose tracker/sheet name differs from the
 * editorial catalog title by more than punctuation — renames, acronyms, or
 * reworded names that the fuzzy matchKey deliberately WON'T bridge (broadening
 * it would risk wrong-joins, e.g. "RAG" colliding with an unrelated project).
 *
 * Keyed by matchKey(sheetName) → catalog project id; the importer consults this
 * BEFORE fuzzy matching. To fix a future rename that breaks the sync, add one
 * line here (keys must be in matchKey-normalized form — lowercase, no punct).
 */
// Bootstrapped into project_aliases DB via `npm run db:setup` (ON CONFLICT DO NOTHING,
// so DB entries created through the admin inbox always win). Kept here as a fallback
// so renames still resolve if db:setup hasn't run yet in a fresh environment.
// Future renames go through the admin inbox UI — not this constant.
export const PROJECT_ALIASES: Record<string, string> = {
  "ai autograding tool": "bu-met-autograding", // catalog: "Autograding Tool for Written Answers…"
  rag: "bpl-rag", // catalog: "Retrieval Augmented Generation"
  "colombia extradition": "ciss-colombia-ext", // SP25 tab "Colombia Extradition Project"
  "colombia extraditions to the us": "ciss-colombia-ext", // canonical name
  barterloo: "barterloo-se", // catalog: "Kelly Dempsey — Mobile App Dev"
  "blackfacts redesign": "blackfacts", // catalog: "BlackFacts.com — Website Redesign"
  bpi: "bpi", // bare "BPI"/"BPI Project" tab rows; catalog: "Boston Police Index"
  "computerized mapping": "cmovf", // catalog: "…Computerized Mapping of Visual Fields"
  "deportation data exploration": "gbh-deportation", // catalog: "GBH — Deportation Data"
  unified5k: "adaptx-united-5k", // "Unified5K" (no space); catalog: "AdaptX — Unified 5K"
  "mapc website analytics": "mapc-analytics", // catalog: "Alexa DeRosa — Website Analytics"
  "domestic violence in nh": "granite-dv", // catalog: "…Domestic Violence in New Hampshire"
  "transparency hub": "berkman-social-media", // Harvard Berkman Applied Social Media Lab
  "cds redesign": "cds-web-redesign", // catalog: "Website Redesign" (CDS)
  blackfacts: "blackfacts", // catalog: "Website Redesign" (BlackFacts.com)
  "mass housing navigator": "mass-housing-nav", // catalog: "Data Common"
  "housing law chatbot": "bu-law-chatbot", // catalog: "Legal Agent/Chatbot"
  "bu law housing law chatbot": "bu-law-chatbot", // "BU Law: Housing Law Chatbot" variant
  "legal chatbot": "bu-law-chatbot", // SP25 DS549 variant
  superfeet: "superfeet-commerce", // catalog: "Unified Commerce Analytics"
  "ai agent": "haynes-construction-ai", // catalog: "Haynes Construction AI Agent"
  "tech policy vizualization": "tech-pol-tracker", // catalog: "Tech Policy Tracker" (typo)
  "image classification archive": "wlf-img-class", // catalog: "Image Classification Pipeline"
};

/**
 * Pull a clean client/partner name out of the messy tracker cells. The Internship
 * tab packs "Name, email\nName, email" into one cell; practicum tabs are clean
 * org names with stray newlines. Take the first line, drop an email, trim.
 */
export function cleanClientName(raw: string): string {
  if (!raw) return "";
  const firstLine = raw.split("\n")[0] || "";
  // Drop a trailing ", someone@example.com" → keep the name before it.
  const beforeEmail = firstLine.replace(/,?\s*[^\s,]+@[^\s,]+.*$/, "");
  return beforeEmail.replace(/\s+/g, " ").trim();
}

// Placeholder cell values that mean "no person assigned" — dropped so they don't
// become bogus directory entries or project role values.
const PERSON_SKIP = /^(tbd|tba|n\/?a|none|n\.a\.?|\?+|[-–—.]+)$/i;

/**
 * Clean a person's name out of a tracker cell for the role fields (Program Lead,
 * PM, TPM, advisors, EIR). Like cleanClientName, takes the first line and drops a
 * trailing ", email"; additionally returns "" for placeholder values (TBD/N/A/…)
 * so the importer skips them instead of storing junk or stubbing a fake person.
 */
export function cleanPersonName(raw: string): string {
  const name = cleanClientName(raw);
  if (!name || PERSON_SKIP.test(name)) return "";
  return name;
}
