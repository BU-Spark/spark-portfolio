// Public image proxy: streams an object from the S3 bucket with a long,
// immutable cache header (Vercel's CDN caches it, so the bucket is hit once).
// Keeps the bucket private — no public-read policy needed.
import { getObject } from "@/lib/s3";

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
  const obj = await getObject(objectKey);
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
