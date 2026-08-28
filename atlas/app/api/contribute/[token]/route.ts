// Public, token-gated upload endpoint for the magic-link screenshot flow. NOT
// under /admin, so the Auth.js middleware doesn't touch it — the token in the
// path IS the credential (validated by DB lookup + status + expiry here). The
// uploader can only mutate THIS request's pending images for ONE project.
import {
  getOpenUploadRequest,
  getUploadRequest,
  addUploadRequestImage,
  removeUploadRequestImage,
} from "@/lib/db";
import { processImageUpload } from "@/lib/upload";
import { deleteObject } from "@/lib/s3";
import { checkRateLimit } from "@/lib/ratelimit";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
}

// GET — current state for the uploader UI (images + status). 410 if the link is
// no longer live (expired/closed) so the client can show the right message.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const open = await getOpenUploadRequest(token);
  if (open) return Response.json({ status: "open", images: open.images });
  // Distinguish expired/submitted/unknown for a friendlier message.
  const any = await getUploadRequest(token);
  if (!any) return Response.json({ error: "Invalid link." }, { status: 404 });
  return Response.json(
    { status: any.status, images: any.images, reviewNote: any.reviewNote },
    { status: 410 }
  );
}

// POST — add one image. Validate the link is live, store to S3, then append
// atomically. If the append is refused because the 4-image cap is hit, delete
// the just-stored object so a capacity rejection doesn't orphan it.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const open = await getOpenUploadRequest(token);
  if (!open) return Response.json({ error: "Link expired or invalid." }, { status: 410 });

  // Dormant unless Upstash is configured (see lib/ratelimit). Keyed by token+IP.
  if (!(await checkRateLimit(`contribute:${token}:${clientIp(req)}`))) {
    return Response.json(
      { error: "Too many uploads — please wait a moment and try again." },
      { status: 429 }
    );
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

  const updated = await addUploadRequestImage(token, result.key);
  if (!updated) {
    await deleteObject(result.key); // cap hit / link closed between checks
    return Response.json(
      { error: "Limit of 4 screenshots reached." },
      { status: 409 }
    );
  }
  return Response.json({ key: result.key, images: updated.images });
}

// DELETE — remove a pending image by its key (not index → no shift race).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  let key: string | undefined;
  try {
    ({ key } = await req.json());
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!key) return Response.json({ error: "Missing key" }, { status: 400 });
  const updated = await removeUploadRequestImage(token, key);
  if (!updated) return Response.json({ error: "Link expired or invalid." }, { status: 410 });
  return Response.json({ images: updated.images });
}
