// Admin-gated BULK screenshot-upload outreach. The single-link flow
// (../route.ts) mints one link per call; this generates links for many projects
// at once, resolving each project's PM email from the people directory and
// auto-emailing when a Resend domain is configured (copy-links otherwise — same
// dormant-email behavior as the single flow). Idempotent: projects that already
// have a live (open) link are skipped, never double-minted.
import { auth } from "@/auth";
import {
  createUploadRequest,
  getProjectsForList,
  getPeopleMap,
  listUploadRequests,
} from "@/lib/db";
import { sendUploadInvite, emailConfigured } from "@/lib/email";
import { normalizeName } from "@/lib/gdocs";
import { semesterRank } from "@/lib/semester";

// A project's most-recent semester (from its runs), for the outreach filter.
function latestTerm(runs: { term: string }[] | undefined): string | null {
  if (!runs || !runs.length) return null;
  let best = runs[0];
  for (const r of runs) if (semesterRank(r.term) > semesterRank(best.term)) best = r;
  return best.term || null;
}

function baseUrl(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return new URL(req.url).origin;
}

// GET — the outreach worklist: projects that still need screenshots (no images),
// each with its PM + resolved email + any existing live link.
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const [projects, peopleMap, open] = await Promise.all([
    getProjectsForList(),
    getPeopleMap(),
    listUploadRequests("open"),
  ]);
  const openByProject = new Map(open.map((r) => [r.projectId, r.token]));
  const base = baseUrl(req);

  const candidates = projects
    .filter((p) => !(p.images && p.images.length)) // needs screenshots
    .map((p) => {
      const pm = (p.pm || "").trim();
      const pmEmail = pm ? peopleMap.get(normalizeName(pm))?.email ?? null : null;
      const token = openByProject.get(p.id);
      return {
        id: p.id,
        title: p.title,
        pm: pm || null,
        pmEmail,
        openUrl: token ? `${base}/contribute/${token}` : null,
        semester: latestTerm(p.runs),
      };
    });

  return Response.json({ candidates, emailConfigured: emailConfigured() });
}

// POST — generate (and email where possible) links for the given project ids.
// Body: { projectIds: string[] }. Partial-success: one project's failure never
// aborts the batch. Returns a per-project result list + counts.
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { projectIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const ids = Array.isArray(body.projectIds)
    ? (body.projectIds as unknown[]).map(String).filter(Boolean)
    : [];
  if (!ids.length) return Response.json({ error: "No projectIds provided." }, { status: 400 });

  const [projects, peopleMap, open] = await Promise.all([
    getProjectsForList(),
    getPeopleMap(),
    listUploadRequests("open"),
  ]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const openSet = new Set(open.map((r) => r.projectId));
  const base = baseUrl(req);
  const configured = emailConfigured();

  type Result = {
    id: string;
    title?: string;
    pm?: string | null;
    url?: string;
    emailed: boolean;
    status: "created" | "emailed" | "skipped-existing" | "not-found";
    note?: string;
  };
  const results: Result[] = [];

  for (const id of ids) {
    const p = byId.get(id);
    if (!p) {
      results.push({ id, emailed: false, status: "not-found" });
      continue;
    }
    if (openSet.has(id)) {
      results.push({ id, title: p.title, emailed: false, status: "skipped-existing" });
      continue;
    }
    const pm = (p.pm || "").trim();
    const email = pm ? peopleMap.get(normalizeName(pm))?.email ?? null : null;
    const { token } = await createUploadRequest(id, email);
    const url = `${base}/contribute/${token}`;
    let emailed = false;
    let note: string | undefined;
    if (email && configured) {
      const r = await sendUploadInvite(email, url, p.title);
      emailed = r.sent;
      if (!r.sent) note = r.error || "send failed";
    } else {
      note = email ? "email not configured (copy the link)" : "no PM email on file";
    }
    results.push({
      id,
      title: p.title,
      pm: pm || null,
      url,
      emailed,
      status: emailed ? "emailed" : "created",
      note,
    });
  }

  return Response.json({
    results,
    created: results.filter((r) => r.url).length,
    emailed: results.filter((r) => r.emailed).length,
    skipped: results.filter((r) => r.status === "skipped-existing").length,
    emailConfigured: configured,
  });
}
