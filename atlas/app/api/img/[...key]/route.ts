// Public image proxy: streams an object from the S3 bucket with a long,
// immutable cache header (Vercel's CDN caches it, so the bucket is hit once).
// Keeps the bucket private — no public-read policy needed.
import { getObject, S3ConfigError } from "@/lib/s3";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params;
  const objectKey = key.map(decodeURIComponent).join("/");
  // Only serve project image objects — never repurpose this proxy to stream
  // arbitrary bucket keys (future private assets, exports, etc.).
  if (!objectKey.startsWith("projects/")) {
    return new Response("Not found", { status: 404 });
  }
  // getObject deliberately rethrows S3ConfigError rather than returning null, so
  // a misconfiguration can't be laundered into "not found" (see lib/s3.ts). That
  // only works if someone catches it: uncaught, it became a 500 with an EMPTY
  // body on every image request — and this route runs on every page that renders
  // a thumbnail, so it fails far more often than the upload path that had the
  // same gap.
  //
  // Unlike the admin-gated upload routes, this one is PUBLIC, so the message
  // (which names the missing variables) is logged rather than returned. An
  // anonymous visitor gets the status and nothing about our infrastructure.
  let obj;
  try {
    obj = await getObject(objectKey);
  } catch (e) {
    if (e instanceof S3ConfigError) {
      console.error("Image proxy unavailable:", e.message);
      return new Response("Image storage is not configured", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    throw e;
  }
  if (!obj) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
