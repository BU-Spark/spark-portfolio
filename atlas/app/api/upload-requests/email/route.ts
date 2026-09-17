// Admin-gated: email an ALREADY-MINTED upload link to the PM.
//
// The send in ../route.ts and ../bulk/route.ts fires once, at creation. If the
// PM had no email on file then, or Resend was unconfigured, or the send simply
// failed, the link stayed valid but unsendable — the only recovery was to
// delete it and generate a new one. This route closes that gap: same link, sent
// (or re-sent) on demand, optionally to a different address.
import { requireAdmin, requireProject } from "@/lib/actor";
import { listUploadRequests, getProjectAdmin } from "@/lib/db";
import { sendUploadInvite, emailConfigured } from "@/lib/email";

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
  const email = (body.email || "").trim();
  if (!projectId) return Response.json({ error: "Missing projectId" }, { status: 400 });
  // Not validation for its own sake: this address is what Resend is asked to
  // deliver to, and a malformed one costs a send attempt and a confusing error.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "A valid email address is required" }, { status: 400 });
  }

  // Emailing an external PM in the project's name — must own the project. Same
  // gate as minting, because this has the same outward-facing effect.
  const pg = await requireProject(projectId);
  if (!pg.ok) return pg.res;

  if (!emailConfigured()) {
    return Response.json(
      { error: "Email is not configured — set RESEND_API_KEY on the Worker. Copy the link instead." },
      { status: 503 }
    );
  }

  const project = await getProjectAdmin(projectId);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  // Scoped by the caller's actor, so a non-super admin cannot reach another
  // org's link by guessing a project id.
  const open = await listUploadRequests("open", g.actor);
  const request = open.find((r) => r.projectId === projectId);
  if (!request) {
    return Response.json({ error: "No open upload link for this project" }, { status: 404 });
  }

  const url = `${baseUrl(req)}/contribute/${request.token}`;
  const r = await sendUploadInvite(email, url, project.title);
  if (!r.sent) {
    // sendUploadInvite never throws, so an unsent mail arrives here as a reason
    // rather than as a 500 with an empty body.
    return Response.json({ error: r.error || "Send failed" }, { status: 502 });
  }
  return Response.json({ sent: true, to: email });
}
