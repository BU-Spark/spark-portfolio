// Admin-gated: mint an upload magic link for a project (and optionally email it),
// and list the review queue. Uses the same auth() pattern as the other admin
// routes — a session implies the user is already allowlisted.
import { requireAdmin, requireProject, requireProjects } from "@/lib/actor";
import {
  createUploadRequest,
  listUploadRequests,
  listProjectUploadRequests,
  getProjectAdmin,
} from "@/lib/db";
import { emailConfigured } from "@/lib/email";

// Build the absolute magic-link URL. Prefer an explicit base (NEXT_PUBLIC_BASE_URL)
// so links are stable; otherwise derive from the request origin (works locally
// and on Vercel).
function baseUrl(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let body: { projectId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const projectId = (body.projectId || "").trim();
  const email = (body.email || "").trim() || null;
  if (!projectId) return Response.json({ error: "Missing projectId" }, { status: 400 });

  // Minting a link emails an external PM in the project's name — must own it.
  const pg = await requireProject(projectId);
  if (!pg.ok) return pg.res;

  const project = await getProjectAdmin(projectId);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const { token, expiresAt } = await createUploadRequest(projectId, email);
  const url = `${baseUrl(req)}/contribute/${token}`;

  // Minting NEVER sends. Generating a link and telling a PM about it are
  // separate decisions: the address on file is often stale or wrong, and an
  // auto-send meant the only way to review a link before it left was not to
  // create it. Sending is POST /api/upload-requests/email, which also lets the
  // admin pick a different recipient.
  return Response.json({ token, url, expiresAt, emailed: false, emailConfigured: emailConfigured() });
}

// GET — the review queue (?status=submitted, default), any status, or all
// requests for one project (?projectId=…, for the edit page's existing-links list).
export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  const projectId = sp.get("projectId");
  if (projectId) {
    // Per-project branch needs its own check: listProjectUploadRequests takes only
    // a project id and applies no org filter, so without this a scoped admin could
    // name any project and read back its upload TOKENS — and a token is a
    // capability, granting login-free upload rights on that project. The recipient
    // emails leaking alongside them are the smaller half of the problem.
    const pg = await requireProject(projectId);
    if (!pg.ok) return pg.res;
    const requests = await listProjectUploadRequests(projectId);
    return Response.json({ requests });
  }
  const status = sp.get("status") as "open" | "submitted" | "approved" | null;
  // Org-filtered: the queue exposes external recipient email addresses.
  const requests = await listUploadRequests(status ?? "submitted", g.actor);
  return Response.json({ requests });
}
