// Object storage for project screenshots. Cloudflare R2 in production, reached
// through the S3 API — R2 is S3-compatible, which is why this still uses
// @aws-sdk/client-s3 while every variable is named R2_*. The names follow the
// provider, not the protocol, so nobody has to guess which account a credential
// belongs to (a Railway key against an R2 endpoint fails as a 403, not a clear
// error). Server-only.
import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/** Thrown when object storage isn't configured, so callers can distinguish a
 *  misconfiguration from a genuinely absent object. */
export class S3ConfigError extends Error {}

const globalForS3 = globalThis as unknown as { sparkS3?: S3Client };

function getClient(): S3Client {
  if (!globalForS3.sparkS3) {
    // Fail loudly on a missing endpoint. Left undefined, the AWS SDK silently
    // defaults to real AWS S3 — so the Worker would present Railway/R2 credentials
    // to Amazon and return an auth error or a missing bucket, with nothing in the
    // message pointing at the actual cause. Every S3-compatible provider we use
    // requires an explicit endpoint, so there is no legitimate unset case.
    //
    // Thrown here rather than at module load on purpose: this breaks only image
    // operations, instead of taking down every page that happens to import this file.
    const missing = (
      ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const
    ).filter((k) => !process.env[k]);
    if (missing.length) {
      throw new S3ConfigError(
        `Object storage is not configured — missing ${missing.join(", ")}. ` +
          `Set these as Worker secrets (R2_REGION is optional; it defaults to "auto").`
      );
    }
    globalForS3.sparkS3 = new S3Client({
      region: process.env.R2_REGION || "auto",
      endpoint: process.env.R2_ENDPOINT,
      // Path-style addressing is required by most S3-compatible providers
      // (MinIO / Railway) where the bucket isn't a DNS subdomain.
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return globalForS3.sparkS3;
}

const BUCKET = () => process.env.R2_BUCKET || "";

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getObject(
  key: string
): Promise<{ body: ReadableStream; contentType: string } | null> {
  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: BUCKET(), Key: key })
    );
    if (!res.Body) return null;
    // SDK v3 stream → web ReadableStream for a Response body.
    const body = (
      res.Body as unknown as { transformToWebStream: () => ReadableStream }
    ).transformToWebStream();
    return { body, contentType: res.ContentType || "application/octet-stream" };
  } catch (e) {
    // A real miss returns null (the caller 404s). A CONFIG error must not be
    // laundered into "not found" — that's how a missing R2_ENDPOINT turns into
    // "images are broken" with nothing to diagnose. Let it surface as a 500.
    if (e instanceof S3ConfigError) throw e;
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: BUCKET(), Key: key })
    );
  } catch {
    // Best-effort by design, config errors included: a failed delete leaves an
    // orphaned object, which is wasted bytes, not a broken user-facing operation.
    // The upload and read paths above are where a misconfiguration gets surfaced.
  }
}
