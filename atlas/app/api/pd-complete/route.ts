// PD completion webhook. A PM submits the end-of-semester Airtable form; Airtable
// POSTs here; we run the automated checks in lib/checks.ts and record the verdict.
//
// Auth: a shared secret (PD_COMPLETE_TOKEN) as `Authorization: Bearer …`, exactly
// like /api/import — Airtable automations can't perform the Google sign-in the admin
// UI uses. Same constant-time comparison, for the same reason.
//
// The org is configuration (PD_COMPLETE_ORG), never taken from the request: a shared
// secret that can nominate its own scope is an org-boundary bypass, which is the
// mistake /api/admin/import-csv used to make.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// 1. It does not write suggested edits back into the PD Google Doc. That needs Docs
//    API credentials and a service account with per-doc access, neither of which
//    exists yet. Findings are recorded here instead, where the data already lives and
//    where /admin/approvals already surfaces work — the Doc write-back can be layered
//    on later without changing this contract.
//
// 2. It does not set status to 'pending' on failure, despite the spec saying so.
//    'pending' means "scoped, not yet worked on" (see PROJECT_STATUSES); using it for
//    "submitted but rejected" would make the pipeline unable to distinguish work that
//    hasn't started from work that came back. Failure sets 'in_review' — submitted,
//    bounced, fixes outstanding — and success sets 'complete'.
//
//    'in_review' rather than 'active' (which is what this did before 004) because
//    'active' loses the part a supervisor needs: that a completion claim was made and
//    rejected. Requires db/migrations/004_status_in_review.sql to have been applied,
//    or the CHECK rejects the write.
import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { getProjectAdmin, updateProject, recordPdCompletion } from "@/lib/db";
import { checkProject, hasBlocker, isGone, linkVerdict, type Finding } from "@/lib/checks";
import { ORGS } from "@/lib/authz";

function bearerMatches(header: string | null, token: string): boolean {
  const a = Buffer.from(header || "");
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LINK_CHECK_CAP = 15;

/**
 * Final HTTP status of a dataset link, or null for "couldn't tell" (timeout,
 * DNS, TLS), which is reported as a warning rather than counted against the
 * submission. Callers only pass http(s) URLs (checkDatasets blocks the rest).
 */
async function linkStatus(url: string): Promise<number | null> {
  try {
    // HEAD first (cheap). Some hosts 404 a HEAD yet serve the GET, so a HEAD
    // 404/410 is retried once with GET before it counts (see linkVerdict).
    // At most 2 fetches per link × LINK_CHECK_CAP (15) = 30, under the Worker's 50.
    const head = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    if (!isGone(head.status)) return head.status;
    const get = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(5000) });
    await get.body?.cancel(); // status is all we need; don't download the page
    return get.status;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const token = process.env.PD_COMPLETE_TOKEN;
  if (!token) {
    return Response.json(
      { error: "PD completion is not configured (PD_COMPLETE_TOKEN unset)." },
      { status: 503 }
    );
  }
  if (!bearerMatches(req.headers.get("authorization"), token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Validated, not defaulted-through: a typo would silently scope every submission to
  // a team that doesn't exist. Same rule as IMPORT_ORG.
  const org = (process.env.PD_COMPLETE_ORG ?? "spark").trim();
  if (!ORGS.includes(org as never)) {
    return Response.json({ error: `PD_COMPLETE_ORG is "${org}", not a known team.` }, { status: 503 });
  }

  let body: { projectId?: unknown; submittedBy?: unknown; term?: unknown; checkLinks?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return Response.json({ error: "projectId is required." }, { status: 400 });
  }

  const project = await getProjectAdmin(projectId);
  if (!project) {
    return Response.json({ error: `No project "${projectId}".` }, { status: 404 });
  }
  // Org scoping on the project, not the payload — the token holder proves it may
  // submit, not which team's catalogue it may touch.
  if ((project.ownerOrg ?? "spark") !== org) {
    return Response.json({ error: "That project belongs to another team." }, { status: 403 });
  }

  const findings: Finding[] = checkProject(project);

  // Link liveness is opt-in per request: it's the only part that makes outbound calls,
  // so a form submission shouldn't pay for it unless asked.
  if (body.checkLinks === true) {
    // ponytail: a Worker request may make only 50 outbound fetches, and a redirect
    // costs one more, so a long dataset list would fail mid-check (the bulk-email
    // outage of 2026-11-05 was this). Check the first LINK_CHECK_CAP and say so.
    const datasets = (project.datasets ?? []).filter((d) => (d.url ?? "").trim());
    if (datasets.length > LINK_CHECK_CAP) {
      findings.push({
        code: "dataset.unchecked",
        severity: "warning",
        message: `Only the first ${LINK_CHECK_CAP} of ${datasets.length} dataset links were checked.`,
      });
    }
    for (const d of datasets.slice(0, LINK_CHECK_CAP)) {
      const url = (d.url ?? "").trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) continue; // checkDatasets already blocks these
      const status = await linkStatus(url);
      const verdict = status === null ? null : linkVerdict(status, url);
      if (verdict === "dead") {
        findings.push({
          code: "dataset.dead",
          severity: "blocker",
          message: `Dataset "${d.label || url}" returned ${status}.`,
        });
      } else if (verdict === "private") {
        findings.push({
          code: "dataset.private",
          severity: "warning",
          message: `Dataset "${d.label || url}" returned ${status} — may be private.`,
        });
      } else if (verdict === null) {
        findings.push({
          code: "dataset.unreachable",
          severity: "warning",
          message: `Couldn't reach dataset "${d.label || url}" — may be private or slow.`,
        });
      }
    }
  }

  const accepted = !hasBlocker(findings);

  // Status reflects the verdict; visibility is untouched. Accepting a completion form
  // must never put a project on the public gallery — that stays a deliberate opt-in.
  await updateProject(projectId, { status: accepted ? "complete" : "in_review" });
  await recordPdCompletion({
    projectId,
    org,
    submittedBy: typeof body.submittedBy === "string" ? body.submittedBy.trim() : null,
    term: typeof body.term === "string" ? body.term.trim() : null,
    accepted,
    findings,
  });
  revalidateTag("projects");

  return Response.json({
    ok: true,
    projectId,
    accepted,
    status: accepted ? "complete" : "in_review",
    blockers: findings.filter((f) => f.severity === "blocker"),
    warnings: findings.filter((f) => f.severity === "warning"),
  });
}
