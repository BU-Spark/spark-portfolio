// Admin-gated: email an ALREADY-MINTED upload link.
//
// Minting and sending are deliberately separate actions. Generating a link used
// to email the PM on file automatically, which meant there was no way to review
// a link before it left, and no way to send it to anyone else — a stale address
// in the People directory was enough to lose the invite silently. ../route.ts
// and ../bulk/route.ts now only create; this route is the only thing that sends.
//
// Two modes:
//   { projectId, email }  — one project, to an address the admin chose
//   { projectIds: [...] } — many projects, each to its own PM on file
//
// The bulk mode exists so "generate links for everything" and "tell everyone"
// stay two decisions rather than one irreversible click.
import { requireAdmin, requireProject } from "@/lib/actor";
import {
  listUploadRequests,
  getProjectAdmin,
  getPeopleMap,
  markUploadRequestEmailed,
} from "@/lib/db";
import { sendUploadInvite, emailConfigured } from "@/lib/email";
import { normalizeName } from "@/lib/gdocs";

function baseUrl(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return new URL(req.url).origin;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let body: { projectId?: string; email?: string; projectIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!emailConfigured()) {
    return Response.json(
      { error: "Email is not configured — set RESEND_API_KEY on the Worker. Copy the link instead." },
      { status: 503 }
    );
  }

  // Scoped by the caller's actor, so a non-super admin cannot reach another
  // org's link by guessing a project id. Fetched once and shared by both modes.
  const open = await listUploadRequests("open", g.actor);
  const base = baseUrl(req);

  // ── Bulk: each project to its own PM ────────────────────────────────────
  if (Array.isArray(body.projectIds)) {
    const ids = body.projectIds.map((id) => String(id).trim()).filter(Boolean);
    if (!ids.length) return Response.json({ error: "No projects given" }, { status: 400 });
    // A guard, not a limit anyone should hit: this sends real mail to external
    // people, and an accidental thousand-id payload should fail loudly rather
    // than deliver.
    if (ids.length > 200) {
      return Response.json({ error: "Too many projects in one request" }, { status: 413 });
    }

    const peopleMap = await getPeopleMap();
    const results: {
      id: string;
      title?: string;
      to?: string;
      sent: boolean;
      reason?: string;
    }[] = [];

    for (const id of ids) {
      // Per-project ownership check: a bulk call must not become a way around
      // the gate that the single-project path enforces.
      const pg = await requireProject(id);
      if (!pg.ok) {
        results.push({ id, sent: false, reason: "not yours to send" });
        continue;
      }
      const project = await getProjectAdmin(id);
      if (!project) {
        results.push({ id, sent: false, reason: "project not found" });
        continue;
      }
      const request = open.find((r) => r.projectId === id);
      if (!request) {
        results.push({ id, title: project.title, sent: false, reason: "no open link — generate one first" });
        continue;
      }
      const pm = (project.pm || "").trim();
      const to = pm ? peopleMap.get(normalizeName(pm))?.email ?? null : null;
      if (!to || !EMAIL_RE.test(to)) {
        results.push({ id, title: project.title, sent: false, reason: "no PM email on file" });
        continue;
      }
      const r = await sendUploadInvite(to, `${base}/contribute/${request.token}`, project.title);
      // Recorded only on success. Minting does not email, so this is the only
      // record that anyone was asked — the approvals nudge and the weekly digest
      // both key off it, and a failed send must not start a 7-day chase clock.
      if (r.sent) await markUploadRequestEmailed(request.token, to);
      results.push({
        id,
        title: project.title,
        to,
        sent: r.sent,
        reason: r.sent ? undefined : r.error || "send failed",
      });
    }

    return Response.json({
      results,
      sent: results.filter((r) => r.sent).length,
      failed: results.filter((r) => !r.sent).length,
    });
  }

  // ── Single: one project, to whatever address the admin chose ────────────
  const projectId = (body.projectId || "").trim();
  const email = (body.email || "").trim();
  if (!projectId) return Response.json({ error: "Missing projectId" }, { status: 400 });
  // Not validation for its own sake: this address is what Resend is asked to
  // deliver to, and a malformed one costs a send attempt and a confusing error.
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "A valid email address is required" }, { status: 400 });
  }

  // Emailing an external PM in the project's name — must own the project. Same
  // gate as minting, because this has the same outward-facing effect.
  const pg = await requireProject(projectId);
  if (!pg.ok) return pg.res;

  const project = await getProjectAdmin(projectId);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const request = open.find((r) => r.projectId === projectId);
  if (!request) {
    return Response.json({ error: "No open upload link for this project" }, { status: 404 });
  }

  const r = await sendUploadInvite(email, `${base}/contribute/${request.token}`, project.title);
  if (r.sent) await markUploadRequestEmailed(request.token, email);
  if (!r.sent) {
    // sendUploadInvite never throws, so an unsent mail arrives here as a reason
    // rather than as a 500 with an empty body.
    return Response.json({ error: r.error || "Send failed" }, { status: 502 });
  }
  return Response.json({ sent: true, to: email });
}
