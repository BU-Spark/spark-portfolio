// PD-sync ingestion core, shared by the two entry points that feed it:
//   • POST /api/import          — Google Apps Script, shared-secret token, org from IMPORT_ORG
//   • POST /api/admin/import-csv — admin CSV paste, org from the signed-in admin
//
// It lives here rather than in the route because the CSV path used to reach the
// importer by HTTP-fetching /api/import with the machine IMPORT_TOKEN, which threw
// away the admin's identity: any admin could push rows that patched ANY project in
// either org, and no permission check on /api/import could see it. Calling this
// function directly is what closes that hole — the org is now an argument, decided
// server-side by each caller.
import "server-only";
import { revalidateTag } from "next/cache";
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
} from "@/lib/gdocs";
// IncomingRow/coerceRows live in import-match.ts because this module is
// `server-only` and therefore untestable; re-exported so the feed contract still
// reads as belonging to the importer.
import { buildIndex, findMatch, type IncomingRow } from "@/lib/import-match";
export { coerceRows, type IncomingRow } from "@/lib/import-match";
import { semesterRank } from "@/lib/semester";
import { parseTechStack } from "@/lib/tech";
import type { Run } from "@/lib/types";

export interface ImportResult {
  ok: true;
  received: number;
  updated: number;
  skippedCount: number;
  skipped: string[];
  /** Matched a project owned by the OTHER team. Reported, never inboxed. */
  crossOrg: string[];
  inboxed: number;
  noBlurb: string[];
  fuzzyMatched: string[];
}

/**
 * Apply tracker rows to the catalog, scoped to one org.
 *
 * `org` is the authority boundary and must always be decided server-side — from
 * IMPORT_ORG for the token path, or the session for the admin path. It is never
 * read from the request body: a shared secret that can nominate its own scope is
 * the original bypass one layer down.
 */
export async function runImport(rows: IncomingRow[], org: string): Promise<ImportResult> {
  const [all, blurbTermById, aliasMap, peopleAliasMap] = await Promise.all([
    getAllProjects(),
    getBlurbTermMap(),
    getAliasMap(),
    getPeopleAliasMap(),
  ]);

  // The org boundary. `index` is the only thing we match or write against;
  // `otherIndex` exists purely so a miss can be reported as "belongs to the other
  // team" instead of the misleading "no such project".
  const index = buildIndex(all.filter((p) => (p.ownerOrg ?? "spark") === org));
  const otherIndex = buildIndex(all.filter((p) => (p.ownerOrg ?? "spark") !== org));

  const updated: string[] = [];
  const skipped: string[] = []; // name didn't match any project in this org
  const crossOrg: string[] = []; // matched, but the other org owns it
  const noBlurb: string[] = []; // matched, but PD text had no extractable block
  const fuzzyMatched: string[] = []; // resolved via edit-distance fallback
  let inboxed = 0;

  for (const r of rows) {
    // Strip newline-appended bundle metadata ("ProjectName\nBundle N: SE/UX: X")
    // that some tracker tabs concatenate into a single cell.
    const name = (r.project || "").trim().split(/\n/)[0].trim();
    if (!name) continue;

    const hit = findMatch(index, name, aliasMap);
    if (!hit) {
      // Before treating this as unknown, check whether the other team owns it.
      const otherHit = findMatch(otherIndex, name, aliasMap);
      if (otherHit && !otherHit.fuzzy) {
        // Deliberately NOT inboxed. An inbox row invites an admin to "create" a
        // project that already exists under the other org, producing a permanent
        // duplicate plus a project_aliases row that binds this tracker name to the
        // wrong record — which would defeat the org pre-filter on every future sync.
        crossOrg.push(name);
        continue;
      }
      // Only an EXACT cross-org hit is strong enough to suppress the inbox row. A
      // fuzzy hit is a guess with an edit-distance-2 tolerance, so a genuinely new
      // project whose name merely resembles one of the other team's would otherwise
      // be neither imported nor inboxed — silently dropped, with recovery depending
      // on someone reading the crossOrg list. Report the resemblance, still triage it.
      if (otherHit) crossOrg.push(name);
      skipped.push(name);
      // Never silently dropped: capture the unmatched row for admin triage. Skip
      // obvious noise — a header/contact cell read as a project name.
      if (!/@/.test(name) && name.length >= 2) {
        let inboxLead = cleanPersonName(r.programLead || "");
        if (inboxLead) inboxLead = peopleAliasMap[normalizeName(inboxLead)] || inboxLead;
        const parsedTech =
          r.techText && r.techText.trim() ? parseTechStack(r.techText) : null;
        const pd = (r.pdUrl || "").trim();
        const repo = (r.github || "").trim();
        await upsertInboxRow(
          {
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
          },
          // Stamped with the FEED's org, so triage can decide ownership without
          // trusting whoever later opens the inbox.
          org
        );
        inboxed++;
      }
      continue;
    }

    const match = hit.project;
    if (hit.fuzzy) fuzzyMatched.push(`${name} → ${match.title}`);

    const patch: ProjectPatch = {};

    // Keep the LATEST semester's data: only overwrite if this row's semester is
    // newer-or-equal to the one the stored blurb came from (or none yet).
    const incoming = semesterRank(r.semester);
    const stored = semesterRank(blurbTermById.get(match.id));
    const blurb = extractPdBlurb(r.pdText || "");
    if (incoming >= stored) {
      // Don't overwrite a blurb an admin has locked (hand-curated).
      if (blurb && !match.blurbLocked) {
        patch.blurb = blurb;
        patch.blurbTerm = r.semester || null;
      }
    }
    if (!blurb && r.pdText) noBlurb.push(name); // had a doc, but no recognizable block

    // Project Drive folder (admin-only). Prefer the direct "GFolder" URL; fall back
    // to the PD text. Fill-not-clobber.
    const gfolderDirect = (r.gfolder || "").trim();
    const drive =
      (gfolderDirect && /^https?:\/\//i.test(gfolderDirect) ? gfolderDirect : null) ??
      extractDriveFolder(r.pdText || "");
    if (drive && !match.driveUrl) patch.driveUrl = drive;

    // Client from the Organization cell, else from the "Client:" name prefix.
    const client = cleanClientName(r.client || "") || splitClientProject(name).client;
    if (client) patch.partner = client;

    // Only fill the repo link if we don't already have one (don't clobber).
    const repo = (r.github || "").trim();
    if (repo && /^https?:\/\//i.test(repo) && !match.repoUrl) {
      patch.repoUrl = repo;
    }

    // Tech stack: keep the raw cell as an admin-only note, and only auto-fill the
    // public tech[] tags when the project has NONE yet.
    const techRaw =
      r.techText && r.techText.trim() ? r.techText : extractTechStack(r.pdText || "");
    if (techRaw && techRaw.trim()) {
      const parsed = parseTechStack(techRaw);
      patch.techNote = parsed.raw;
      if (parsed.tags.length && !(match.tech && match.tech.length)) {
        patch.tech = parsed.tags;
      }
    }

    // Spark! team roles, per-semester. The tracker cell usually holds only a FIRST
    // name; the PD's contact table holds the full name + email, so prefer the PD
    // full name when it's the same person, else keep the tracker value.
    const rawRuns = await getProjectRuns(match.id);
    // Only attribute per-run roles/PD when the tracker semester is unambiguous — a
    // blank/unreadable semester must NOT silently land on an arbitrary run.
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
      let personName = cleanPersonName(trackerRaw || "");
      if (isLead && personName) {
        personName = peopleAliasMap[normalizeName(personName)] || personName;
      }
      const pd = contacts[field];
      let email: string | null = null;
      if (pd) {
        const sameFirst =
          !!personName &&
          pd.name.split(" ")[0].toLowerCase() === personName.split(" ")[0].toLowerCase();
        if (!personName) personName = pd.name; // no tracker value → adopt the PD name
        else if (sameFirst) personName = pd.name; // same person → upgrade to full name
        // else: different first names → keep the tracker value
        if (pd.email && pd.name === personName) email = pd.email;
      }
      if (personName) {
        (roleUpdates[field] as string) = personName;
        // The dated timeline row is independent of where the run lives. People are
        // shared across orgs by design, so this is not org-scoped.
        await upsertPersonRole(personName, match.id, r.semester || "", roleLabel, email);
      }
    };
    await resolveRole("sparkProgramLead", "Program Lead", r.programLead, true);
    await resolveRole("pm", "PM", r.pm);
    await resolveRole("tpm", "TPM", r.tpm);
    await resolveRole("seniorAdvisor", "Senior Advisor", r.seniorAdvisor);
    await resolveRole("techAdvisor", "Tech Advisor", r.techAdvisor);
    await resolveRole("eir", "EIR", r.eir);

    // Per-semester PD doc link — fill-not-clobber.
    const pdLink = (r.pdUrl || "").trim();
    if (runIdx >= 0 && pdLink && /^https?:\/\//i.test(pdLink) && !rawRuns[runIdx].pdUrl) {
      roleUpdates.pdUrl = pdLink;
    }
    if (runIdx >= 0 && Object.keys(roleUpdates).length) {
      patch.runs = rawRuns.map((rn, i) => (i === runIdx ? { ...rn, ...roleUpdates } : rn));
    }

    if (Object.keys(patch).length) {
      await updateProject(match.id, patch);
      updated.push(name);
    }
  }

  if (updated.length) revalidateTag("projects"); // refresh cached public pages

  return {
    ok: true,
    received: rows.length,
    updated: updated.length,
    skippedCount: skipped.length,
    skipped,
    crossOrg,
    inboxed,
    noBlurb,
    fuzzyMatched,
  };
}
