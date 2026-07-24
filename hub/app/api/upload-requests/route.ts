// Admin-gated: mint an upload magic link for a project (and optionally email it),
// and list the review queue. Uses the same auth() pattern as the other admin
// routes — a session implies the user is already allowlisted.
import { auth } from "@/auth";
import {
  createUploadRequest,
  listUploadRequests,
  listProjectUploadRequests,
  getProjectAdmin,
} from "@/lib/db";
import { sendUploadInvite, emailConfigured } from "@/lib/email";

// Build the absolute magic-link URL. Prefer an explicit base (NEXT_PUBLIC_BASE_URL)
// so links are stable; otherwise derive from the request origin (works locally
// and on Vercel).
function baseUrl(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { projectId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const projectId = (body.projectId || "").trim();
  const email = (body.email || "").trim() || null;
  if (!projectId) return Response.json({ error: "Missing projectId" }, { status: 400 });

  const project = await getProjectAdmin(projectId);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const { token, expiresAt } = await createUploadRequest(projectId, email);
  const url = `${baseUrl(req)}/contribute/${token}`;

  let emailed = false;
  if (email && emailConfigured()) {
    const r = await sendUploadInvite(email, url, project.title);
    emailed = r.sent;
  }

  return Response.json({ token, url, expiresAt, emailed, emailConfigured: emailConfigured() });
}

// GET — the review queue (?status=submitted, default), any status, or all
// requests for one project (?projectId=…, for the edit page's existing-links list).
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const projectId = sp.get("projectId");
  if (projectId) {
    const requests = await listProjectUploadRequests(projectId);
    return Response.json({ requests });
  }
  const status = sp.get("status") as "open" | "submitted" | "approved" | null;
  const requests = await listUploadRequests(status ?? "submitted");
  return Response.json({ requests });
}
