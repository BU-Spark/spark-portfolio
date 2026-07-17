// Admin-only image upload. Accepts the downscaled WebP data URL produced by
// <ImageSlot>, stores it in the S3 bucket, and returns the object key. The key
// (not a data URL) is what gets persisted on the project. Validation + storage
// live in lib/upload so the token-gated PM uploader shares identical rules.
import { auth } from "@/auth";
import { processImageUpload } from "@/lib/upload";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
