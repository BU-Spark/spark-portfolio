// Shared image-upload core. Both the admin uploader (app/api/upload) and the
// token-gated PM uploader (app/api/contribute/[token]) accept the same WebP data
// URL produced by <ImageSlot>, validate it identically, store it in S3, and
// return the object key. Kept here so the two routes can't drift on type/size
// rules — the only thing that differs between them is the auth check.
import "server-only";
import { randomUUID } from "node:crypto";
import { putObject } from "@/lib/s3";

const ALLOWED = ["image/webp", "image/png", "image/jpeg", "image/avif"];
const MAX_BYTES = 6 * 1024 * 1024; // ~6MB after the client-side downscale

export type UploadResult =
  | { ok: true; key: string }
  | { ok: false; status: number; error: string };

/**
 * Validate a base64 image data URL, store it in the bucket, and return its key.
 * Returns a discriminated result so callers can map failures to HTTP responses
 * without throwing.
 */
export async function processImageUpload(
  dataUrl: string | undefined
): Promise<UploadResult> {
  if (!dataUrl) return { ok: false, status: 400, error: "Missing dataUrl" };
  // Reject oversized payloads BEFORE base64-decoding into memory — base64 inflates
  // ~33%, so cap the string length first to avoid buffering a huge body (DoS guard).
  if (dataUrl.length > MAX_BYTES * 1.4 + 100) {
    return { ok: false, status: 413, error: "Image too large" };
  }

  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m || !ALLOWED.includes(m[1])) {
    return { ok: false, status: 400, error: "Unsupported image" };
  }
  const contentType = m[1];
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_BYTES) {
    return { ok: false, status: 413, error: "Image too large" };
  }

  const ext = contentType.split("/")[1] || "bin";
  const key = `projects/${randomUUID()}.${ext}`;
  await putObject(key, buf, contentType);
  return { ok: true, key };
}
