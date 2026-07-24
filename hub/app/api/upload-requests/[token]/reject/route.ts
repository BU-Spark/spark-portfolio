// Admin-gated: reject a submitted upload request. This RE-OPENS the link (status
// back to 'open') and records an optional note shown to the PM on the contribute
// page, so the same link lets them fix and resubmit within the 14-day window.
import { auth } from "@/auth";
import { rejectUploadRequest } from "@/lib/db";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;

  let note: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.note === "string") note = body.note.trim() || null;
  } catch {
    // note is optional
  }

  const adminEmail = session.user?.email ?? "unknown";
  const ok = await rejectUploadRequest(token, adminEmail, note);
  if (!ok) return Response.json({ error: "Request not found or not awaiting review." }, { status: 400 });
  return Response.json({ ok: true });
}
