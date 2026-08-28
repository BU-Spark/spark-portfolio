// Admin-only image upload. Accepts the downscaled WebP data URL produced by
// <ImageSlot>, stores it in the S3 bucket, and returns the object key. The key
// (not a data URL) is what gets persisted on the project. Validation + storage
// live in lib/upload so the token-gated PM uploader shares identical rules.
import { requireAdmin } from "@/lib/actor";
import { processImageUpload } from "@/lib/upload";

export async function POST(req: Request) {
  // Any admin: this returns an S3 key and is not project-bound. Keys only become
  // visible once written onto a project, which IS org-scoped.
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  let dataUrl: string | undefined;
  try {
    ({ dataUrl } = await req.json());
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const result = await processImageUpload(dataUrl);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ key: result.key });
}
