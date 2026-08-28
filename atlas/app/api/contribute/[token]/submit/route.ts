// Public, token-gated finalize step. The PM clicks "Submit for review" → moves
// the request from 'open' to 'submitted' so it enters the admin queue. Guarded
// in SQL to reject an empty set or an already-closed/expired link.
import { submitUploadRequest } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ok = await submitUploadRequest(token);
  if (!ok) {
    return Response.json(
      { error: "Add at least one screenshot before submitting (or the link has expired)." },
      { status: 400 }
    );
  }
  return Response.json({ ok: true });
}
