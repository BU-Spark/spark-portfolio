// Admin-gated: approve a submitted upload request. The body carries the final
// ordered set of S3 keys the admin chose; the DB layer validates every key is
// part of the project's current images or this request's pending uploads (so a
// forged body can't inject arbitrary keys), then writes them onto the project.
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/actor";
import { approveUploadRequest } from "@/lib/db";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // requireAdmin, not requireProject: the project is reached via the token, and
  // approveUploadRequest resolves token → project → owner_org in the SELECT it was
  // already running. A foreign token finds no row and gets the existing
  // "not found" message, so it leaks nothing about whose project it is.
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { token } = await params;

  let images: unknown;
  try {
    ({ images } = await req.json());
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const finalKeys = Array.isArray(images) ? images.map(String) : [];

  // g.actor.email replaces the old `session.user?.email ?? "unknown"` — a resolved
  // actor always has an email, so the audit trail can no longer read "unknown".
  const result = await approveUploadRequest(token, finalKeys, g.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  revalidateTag("projects"); // approved screenshots are now on the project
  return Response.json({ ok: true });
}
