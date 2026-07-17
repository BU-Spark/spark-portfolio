// PD-sync ingestion endpoint. The Google Apps Script (scripts/pd-sync.gs) reads
// the PM-tracker tabs under a BU identity — the one thing the server can't do,
// since the PD docs are bu.edu-restricted — and POSTs rows here. We extract the
// blurb and update the matching project's blurb / partner / repo.
//
// Auth: a shared secret (IMPORT_TOKEN), since Apps Script can't perform the
// Google session sign-in the admin UI uses. Sent as `Authorization: Bearer …`.
//
// Idempotent: matches existing projects by normalized name and PATCHes them;
// unmatched names are skipped and returned so they can be reconciled (never
// silently dropped, never auto-created → no duplicate projects).
import {
  getAllProjects,
  getBlurbTermMap,
  getAliasMap,
  getPeopleAliasMap,
  upsertInboxRow,
  updateProject,
  upsertPersonRole,
  getProjectRuns,
  termsEqual,
  type ProjectPatch,
} from "@/lib/db";
import {
  extractPdBlurb,
  extractTechStack,
  extractContacts,
  extractDriveFolder,
  cleanClientName,
  cleanPersonName,
  normalizeName,
  splitClientProject,
  matchKey,
  editDistance,
} from "@/lib/gdocs";
import type { Project, Run } from "@/lib/types";
import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { semesterRank } from "@/lib/semester";
import { parseTechStack } from "@/lib/tech";

// Constant-time bearer-token check (avoids leaking the secret via timing).
function bearerMatches(header: string | null, token: string): boolean {
  const a = Buffer.from(header || "");
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface IncomingRow {
  project: string; // project name (match key)
  client?: string; // raw Organization / "Client(s) Name & Email" cell
  github?: string; // repo URL (from the GitHub cell's link)
  gfolder?: string; // Google Drive project folder URL (direct from "GFolder" column)
  course?: string; // e.g. "DS539" (metadata/logging only for now)
  semester?: string; // e.g. "Spring 2026" (metadata/logging only for now)
  pdUrl?: string; // source PD doc link — stored admin-only for manual re-pull
  techText?: string; // raw PD "Tech Stack" table cell (list items "* "-prefixed)
  pdText?: string; // full plain text of the PD Google Doc
  programLead?: string; // Spark! roles (plain-text cells from the tracker)
  pm?: string;
  tpm?: string;
  seniorAdvisor?: string;
  techAdvisor?: string;
  eir?: string;
}


export async function POST(req: Request) {
  const token = process.env.IMPORT_TOKEN;
  if (!token) {
    return Response.json(
      { error: "Import is not configured (IMPORT_TOKEN unset)." },
      { status: 503 }
    );
  }
  if (!bearerMatches(req.headers.get("authorization"), token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { rows?: IncomingRow[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return Response.json({ error: "No rows provided." }, { status: 400 });
  }

  // Index the catalog two ways: by full normalized title, and by the project
  // portion (after a "Client:" prefix) — so a bare-name tab row matches a
  // "Client: Project" catalog entry and vice versa.
  // Pre-load all catalog data in parallel. peopleAliasMap canonicalizes short
  // first-name forms (e.g. "abby" → "Abby Gualda") from the admin people directory
  // rather than a hardcoded constant, so it stays correct as staff changes.
  const [all, blurbTermById, aliasMap, peopleAliasMap] = await Promise.all([
    getAllProjects(),
    getBlurbTermMap(),
    getAliasMap(),
    getPeopleAliasMap(),
  ]);
  const byId = new Map<string, Project>();
  const byFull = new Map<string, Project>();
  const byProject = new Map<string, Project>();
  for (const p of all) {
    byId.set(p.id, p);
    const full = matchKey(p.title);
    if (full && !byFull.has(full)) byFull.set(full, p);
    const proj = matchKey(splitClientProject(p.title).project);
    if (proj && !byProject.has(proj)) byProject.set(proj, p);
  }
  // Build a flat list of (key → project) for fuzzy scanning — all titles + project portions.
  const allKeys: { key: string; project: Project }[] = [];
  for (const [k, p] of byFull) allKeys.push({ key: k, project: p });
  for (const [k, p] of byProject) if (!byFull.has(k)) allKeys.push({ key: k, project: p });

  const fuzzyMatched: string[] = []; // names resolved via edit-distance fallback

  const findMatch = (name: string): Project | undefined => {
    // Curated alias first — handles renames the fuzzy keys can't bridge.
    const aliasId = aliasMap[matchKey(name)];
    if (aliasId && byId.has(aliasId)) return byId.get(aliasId);
    const full = matchKey(name);
    if (full && byFull.has(full)) return byFull.get(full);
    const proj = matchKey(splitClientProject(name).project);
    if (proj && byProject.has(proj)) return byProject.get(proj);
    // Fuzzy fallback: edit distance ≤ 2, only for keys ≥ 8 chars to avoid short-name collisions.
    if (full.length >= 8) {
      let best: Project | undefined;
      let bestDist = 3; // exclusive upper bound
      for (const { key, project } of allKeys) {
        if (Math.abs(key.length - full.length) >= bestDist) continue; // fast skip
        const d = editDistance(full, key);
        if (d < bestDist) { bestDist = d; best = project; }
      }
      if (best) {
        fuzzyMatched.push(`${name} → ${best.title}`);
        return best;
      }
    }
    return undefined;
  };

  const updated: string[] = [];
  const skipped: string[] = []; // name didn't match any project
  const noBlurb: string[] = []; // matched, but PD text had no extractable block

  for (const r of rows) {
    // Strip any newline-appended bundle metadata ("ProjectName\nBundle N: SE/UX: X")
    // that some tracker tabs concatenate into a single cell.
    const name = (r.project || "").trim().split(/\n/)[0].trim();
    if (!name) continue;
    const match = findMatch(name);
    if (!match) {
      skipped.push(name);
      // Never silently dropped: capture the unmatched row (with its full cleaned
      // payload) in the import inbox for admin triage. Skip obvious noise — a
      // header/contact cell read as a project name (e.g. "nbt@bu.edu", "Email").
      if (!/@/.test(name) && name.length >= 2) {
        let inboxLead = cleanPersonName(r.programLead || "");
        if (inboxLead) inboxLead = peopleAliasMap[normalizeName(inboxLead)] || inboxLead;
        const parsedTech =
          r.techText && r.techText.trim() ? parseTechStack(r.techText) : null;
        const pd = (r.pdUrl || "").trim();
        const repo = (r.github || "").trim();
        await upsertInboxRow({
          rawName: name,
          partner: cleanClientName(r.client || "") || splitClientProject(name).client,
          course: r.course || null,
          term: r.semester || null,
          blurb: extractPdBlurb(r.pdText || "") || null,
          pdUrl: pd && /^https?:\/\//i.test(pd) ? pd : null,
          techNote: parsedTech?.raw ?? null,
          tech: parsedTech?.tags ?? [],
          repoUrl: repo && /^https?:\/\//i.test(repo) ? repo : null,
          roles: {
            sparkProgramLead: inboxLead || null,
            pm: cleanPersonName(r.pm || "") || null,
            tpm: cleanPersonName(r.tpm || "") || null,
            seniorAdvisor: cleanPersonName(r.seniorAdvisor || "") || null,
            techAdvisor: cleanPersonName(r.techAdvisor || "") || null,
            eir: cleanPersonName(r.eir || "") || null,
          },
        });
      }
      continue;
    }

    const patch: ProjectPatch = {};

    // Keep the LATEST semester's data: only overwrite if this row's semester is
    // newer-or-equal to the one the stored blurb came from (or none yet).
    // Order-independent across separate per-tab POSTs.
    const incoming = semesterRank(r.semester);
    const stored = semesterRank(blurbTermById.get(match.id));
    const blurb = extractPdBlurb(r.pdText || "");
    if (incoming >= stored) {
      // Don't overwrite a blurb an admin has locked (hand-curated). The blurb is
      // ONE per project, kept from the latest semester (the PD link itself is now
      // stored per-run below, so each semester keeps its own source doc).
      if (blurb && !match.blurbLocked) {
        patch.blurb = blurb;
        patch.blurbTerm = r.semester || null;
      }
    }
    if (!blurb && r.pdText) noBlurb.push(name); // had a doc, but no recognizable block

    // Project Drive folder (admin-only). Prefer the direct sheet "GFolder" URL
    // (authoritative); fall back to extracting it from the PD doc text. Fill-not-
    // clobber: never overwrite a link an admin has already curated.
    const gfolderDirect = (r.gfolder || "").trim();
    const drive =
      (gfolderDirect && /^https?:\/\//i.test(gfolderDirect) ? gfolderDirect : null) ??
      extractDriveFolder(r.pdText || "");
    if (drive && !match.driveUrl) patch.driveUrl = drive;

    // Client from the Organization cell, else from the "Client:" name prefix.
    const client =
      cleanClientName(r.client || "") || splitClientProject(name).client;
    if (client) patch.partner = client;

    // Only fill the repo link if we don't already have one (don't clobber).
    const repo = (r.github || "").trim();
    if (repo && /^https?:\/\//i.test(repo) && !match.repoUrl) {
      patch.repoUrl = repo;
    }

    // Tech stack from the PD "Tech Stack" cell. Keep the raw cell as an admin-only
    // note (preserves nuance), and only auto-fill the public tech[] tags when the
    // project has NONE yet — never clobber admin-curated tags (same rule as repo).
    // Prefer the Apps Script's dedicated tech cell, but fall back to parsing the
    // tech-stack section straight out of the full PD text (deterministic — no
    // dependence on the gs's fragile table reader, which often sends nothing).
    const techRaw =
      r.techText && r.techText.trim() ? r.techText : extractTechStack(r.pdText || "");
    if (techRaw && techRaw.trim()) {
      const parsed = parseTechStack(techRaw);
      patch.techNote = parsed.raw;
      if (parsed.tags.length && !(match.tech && match.tech.length)) {
        patch.tech = parsed.tags;
      }
    }

    // Spark! team roles. The tracker cell usually holds only a FIRST name; the
    // PD's "Project Contact Information" table holds the full name + email. So
    // prefer the PD full name when it's the same person (matching first name),
    // else keep the tracker value (don't clobber a different assignment). Each
    // stored name gets a person stub, backfilling the directory email from the
    // PD when we have one. The Lead is also nickname→full canonicalized.
    // Roles + PD link are PER-SEMESTER now: resolve them, then write onto the run
    // matching this tracker row's semester (loaded RAW so students/teamId survive
    // the write-back). The person_roles timeline is still written, term-tagged.
    const rawRuns = await getProjectRuns(match.id);
    // Only attribute per-run roles/PD when the tracker semester is unambiguous
    // (parses to a real rank). A blank/unreadable semester must NOT silently land
    // on an arbitrary run — skip the per-run write (the timeline row still records it).
    const runIdx =
      semesterRank(r.semester) > 0
        ? rawRuns.findIndex((rn) => termsEqual(rn.term, r.semester))
        : -1;
    const roleUpdates: Partial<Run> = {};
    const contacts = extractContacts(r.pdText || "");
    const resolveRole = async (
      field: "sparkProgramLead" | "pm" | "tpm" | "seniorAdvisor" | "techAdvisor" | "eir",
      roleLabel: string,
      trackerRaw: string | undefined,
      isLead = false
    ) => {
      let name = cleanPersonName(trackerRaw || "");
      if (isLead && name) name = peopleAliasMap[normalizeName(name)] || name;
      const pd = contacts[field];
      let email: string | null = null;
      if (pd) {
        const sameFirst =
          !!name &&
          pd.name.split(" ")[0].toLowerCase() === name.split(" ")[0].toLowerCase();
        if (!name) name = pd.name; // no tracker value → adopt the PD name
        else if (sameFirst) name = pd.name; // same person → upgrade to full name
        // else: different first names → keep the tracker value
        if (pd.email && pd.name === name) email = pd.email;
      }
      if (name) {
        (roleUpdates[field] as string) = name; // onto this semester's run
        // The dated timeline row is independent of where the run lives.
        await upsertPersonRole(name, match.id, r.semester || "", roleLabel, email);
      }
    };
    await resolveRole("sparkProgramLead", "Program Lead", r.programLead, true);
    await resolveRole("pm", "PM", r.pm);
    await resolveRole("tpm", "TPM", r.tpm);
    await resolveRole("seniorAdvisor", "Senior Advisor", r.seniorAdvisor);
    await resolveRole("techAdvisor", "Tech Advisor", r.techAdvisor);
    await resolveRole("eir", "EIR", r.eir);

    // Per-semester PD doc link — fill-not-clobber (don't overwrite an admin edit
    // or null out with an empty cell), same rule as repo/drive above.
    const pdLink = (r.pdUrl || "").trim();
    if (runIdx >= 0 && pdLink && /^https?:\/\//i.test(pdLink) && !rawRuns[runIdx].pdUrl) {
      roleUpdates.pdUrl = pdLink;
    }
    // Apply the per-run updates onto the matching semester's run (if any).
    if (runIdx >= 0 && Object.keys(roleUpdates).length) {
      patch.runs = rawRuns.map((rn, i) => (i === runIdx ? { ...rn, ...roleUpdates } : rn));
    }

    if (Object.keys(patch).length) {
      await updateProject(match.id, patch);
      updated.push(name);
    }
  }

  if (updated.length) revalidateTag("projects"); // refresh cached public pages

  return Response.json({
    ok: true,
    received: rows.length,
    updated: updated.length,
    skippedCount: skipped.length,
    skipped, // unmatched names — now captured in the import inbox for triage
    inboxed: skipped.filter((n) => !/@/.test(n) && n.length >= 2).length,
    noBlurb, // matched but PD had no "Project Description:" block
    fuzzyMatched, // names resolved via edit-distance (logged for admin awareness)
  });
}
