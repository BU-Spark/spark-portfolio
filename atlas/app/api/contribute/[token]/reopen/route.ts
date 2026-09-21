// Public, token-gated un-submit. "Submit for review" used to be one-way: a PM
// who forgot a screenshot, or a teammate opening a link someone else had
// already submitted, needed a whole new link minted and emailed. This puts the
// request back to 'open' (images kept) so the same link can take more and be
// resubmitted. Refused once an admin has approved, or after expiry.
import { reopenUploadRequest } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ok = await reopenUploadRequest(token);
  if (!ok) {
    return Response.json(
      { error: "This link can't be reopened — it was already reviewed, or has expired." },
      { status: 409 }
    );
  }
  return Response.json({ ok: true });
}
