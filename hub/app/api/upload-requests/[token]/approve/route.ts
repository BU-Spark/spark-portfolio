// Admin-gated: approve a submitted upload request. The body carries the final
// ordered set of S3 keys the admin chose; the DB layer validates every key is
// part of the project's current images or this request's pending uploads (so a
// forged body can't inject arbitrary keys), then writes them onto the project.
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { approveUploadRequest } from "@/lib/db";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;

  let images: unknown;
  try {
    ({ images } = await req.json());
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const finalKeys = Array.isArray(images) ? images.map(String) : [];

  const adminEmail = session.user?.email ?? "unknown";
  const result = await approveUploadRequest(token, finalKeys, adminEmail);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  revalidateTag("projects"); // approved screenshots are now on the project
  return Response.json({ ok: true });
}
