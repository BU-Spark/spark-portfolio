// Admin-gated BULK screenshot-upload outreach. The single-link flow
// (../route.ts) mints one link per call; this mints them for many projects at
// once, resolving each project's PM email from the people directory so a later
// send knows who to reach. It does NOT email — sending is ../email/route.ts, so
// that generating links for the whole backlog and contacting forty external
// people stay two separate decisions. Idempotent: projects that already have a
// live (open) link are skipped, never double-minted.
import { requireAdmin, requireProject, requireProjects } from "@/lib/actor";
import {
  createUploadRequest,
  getProjectsForList,
  getPeopleMap,
  listUploadRequests,
} from "@/lib/db";
import { emailConfigured } from "@/lib/email";
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
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const [projects, peopleMap, open, submitted] = await Promise.all([
    getProjectsForList(),
    getPeopleMap(),
    listUploadRequests("open", g.actor),
    listUploadRequests("submitted", g.actor),
  ]);
  // Carry the whole request, not just the token: the UI needs to know whether a
  // link was ever EMAILED. That lives only in the database — it used to live in
  // React state, so a page reload made every already-sent row look unsent and
  // invited a second round of mail to the same people.
  // First wins: the list is newest-first, and the email route sends the newest
  // open link (open.find), so the row must show that same token.
  const openByProject = new Map<string, (typeof open)[number]>();
  for (const r of open) if (!openByProject.has(r.projectId)) openByProject.set(r.projectId, r);
  // A PM who already delivered is waiting on us, not the other way round.
  const awaitingReview = new Set(submitted.map((r) => r.projectId));
  const base = baseUrl(req);

  const candidates = projects
    // Own-org only. This is a WORKLIST — rows you cannot act on are pure noise,
    // unlike the projects list, where cross-org visibility exists on purpose so
    // mis-filed projects get spotted. Supers see everything.
    .filter((p) => g.actor.isSuper || (p.ownerOrg ?? "spark") === g.actor.org)
    .filter((p) => !(p.images && p.images.length)) // needs screenshots
    .map((p) => {
      const pm = (p.pm || "").trim();
      const pmEmail = pm ? peopleMap.get(normalizeName(pm))?.email ?? null : null;
      const request = openByProject.get(p.id);
      return {
        id: p.id,
        title: p.title,
        pm: pm || null,
        pmEmail,
        openUrl: request ? `${base}/contribute/${request.token}` : null,
        emailedAt: request?.emailedAt ?? null,
        emailedTo: request?.emailedTo ?? null,
        awaitingReview: awaitingReview.has(p.id),
        semester: latestTerm(p.runs),
      };
    });

  return Response.json({ candidates, emailConfigured: emailConfigured() });
}

// POST — generate links for the given project ids. Sending is a separate
// action (../email/route.ts); nothing here emails anyone.
// Body: { projectIds: string[] }. Partial-success: one project's failure never
// aborts the batch. Returns a per-project result list + counts.
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

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

  // All-or-nothing on the batch rather than per-item "forbidden" results: because
  // GET above is already org-filtered, a mixed batch can only come from a
  // hand-crafted request, so the extra per-item plumbing would serve a case the UI
  // cannot produce.
  const pg = await requireProjects(ids);
  if (!pg.ok) return pg.res;

  const [projects, peopleMap, open, submitted] = await Promise.all([
    getProjectsForList(),
    getPeopleMap(),
    listUploadRequests("open", g.actor),
    listUploadRequests("submitted", g.actor),
  ]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const openSet = new Set(open.map((r) => r.projectId));
  const submittedSet = new Set(submitted.map((r) => r.projectId));
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
    if (submittedSet.has(id)) {
      results.push({ id, title: p.title, emailed: false, status: "skipped-existing", note: "awaiting review" });
      continue;
    }
    const pm = (p.pm || "").trim();
    const email = pm ? peopleMap.get(normalizeName(pm))?.email ?? null : null;
    const { token } = await createUploadRequest(id, email);
    const url = `${base}/contribute/${token}`;
    // Generating NEVER sends — see the note in ../route.ts. The recipient is
    // still recorded on the request so the follow-up send knows who it is for.
    results.push({
      id,
      title: p.title,
      pm: pm || null,
      url,
      emailed: false,
      status: "created",
      note: email ? undefined : "no PM email on file",
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
