// Object storage for project screenshots. Server-only.
//
// TWO PATHS, and the first one is the one that works on Cloudflare:
//
//   1. The native R2 BINDING (env.BUCKET) when running on Workers. No signing,
//      no credentials, no XML — the platform hands the Worker a direct handle to
//      the bucket.
//   2. The S3 API via @aws-sdk/client-s3, for local development against the
//      Railway bucket, where there is no binding.
//
// Why the binding rather than the SDK everywhere: the AWS SDK parses S3's
// responses with DOMParser, which does not exist in workerd. Successful calls
// are fine — they carry no XML — but EVERY error response is XML, so any
// storage failure became `ReferenceError: DOMParser is not defined` thrown from
// inside the SDK, surfacing as Cloudflare error 1101 (an isolate crash) instead
// of a catchable error. Reproduced in a standalone worker: a PutObject that
// succeeds returns fine, and the same call against a nonexistent bucket crashes
// rather than reporting NoSuchBucket.
//
// That is unfixable from our side — we cannot catch what the SDK cannot
// construct — and it means every diagnostic we add around the SDK is dead code
// on Workers. The binding removes the XML path, the credentials, the endpoint
// and the checksum negotiation in one move.
import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/** The subset of the R2 binding this module uses. */
type R2Bucket = {
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};

/**
 * The R2 binding, or undefined when running anywhere but Workers.
 *
 * Named BUCKET rather than R2_BUCKET so it cannot be confused with the env VAR
 * of that name, which holds a bucket's name for the SDK path.
 */
async function r2(): Promise<R2Bucket | undefined> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as { BUCKET?: R2Bucket }).BUCKET;
  } catch {
    // No Cloudflare context: ordinary `next dev`, scripts, tests.
    return undefined;
  }
}

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
      // R2 does not implement the AWS flexible-checksum headers the SDK began
      // adding by default in v3.729. Left on, PutObject crashes the Worker
      // outright — Cloudflare error 1101, an uncaught exception that never
      // reaches our try/catch — while GetObject is unaffected because the
      // middleware only runs on writes. That asymmetry (reads fine, writes
      // 1101) is what identified this.
      //
      // WHEN_REQUIRED keeps checksums for the operations that genuinely need
      // them and omits them elsewhere, which is Cloudflare's documented setting
      // for using the AWS SDK against R2.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
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

/** Thrown when the bucket REJECTS a write (as opposed to not being configured).
 *  Separate from S3ConfigError because the fixes differ: one is a missing
 *  variable, the other is a credential without write permission, a bucket that
 *  does not exist, or a provider mismatch. */
export class S3WriteError extends Error {}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  const bucket = await r2();
  if (bucket) {
    // Binding path: errors arrive as ordinary exceptions with readable messages,
    // not as XML the SDK cannot parse.
    try {
      await bucket.put(key, new Uint8Array(body), { httpMetadata: { contentType } });
      return;
    } catch (e) {
      throw new S3WriteError(
        `Object storage rejected the write: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: BUCKET(),
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  } catch (e) {
    if (e instanceof S3ConfigError) throw e;
    // The SDK's error carries the actual cause — AccessDenied for a read-only
    // token, NoSuchBucket for a wrong name, InvalidAccessKeyId for keys from a
    // different provider. Uncaught, all three arrive as an identical blank 500,
    // which is indistinguishable from "not configured" and sends whoever is
    // debugging back to the variables they already set correctly.
    const name = (e as { name?: string })?.name;
    const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    throw new S3WriteError(
      `Object storage rejected the write${name ? `: ${name}` : ""}` +
        `${status ? ` (HTTP ${status})` : ""}. ` +
        `Check that the credential has WRITE access to the bucket and that all ` +
        `R2_* values come from the same account.`
    );
  }
}

export async function getObject(
  key: string
): Promise<{ body: ReadableStream; contentType: string } | null> {
  const bucket = await r2();
  if (bucket) {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return {
      body: obj.body,
      contentType: obj.httpMetadata?.contentType || "application/octet-stream",
    };
  }
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
    const bucket = await r2();
    if (bucket) {
      await bucket.delete(key);
      return;
    }
    await getClient().send(
      new DeleteObjectCommand({ Bucket: BUCKET(), Key: key })
    );
  } catch {
    // Best-effort by design, config errors included: a failed delete leaves an
    // orphaned object, which is wasted bytes, not a broken user-facing operation.
    // The upload and read paths above are where a misconfiguration gets surfaced.
  }
}
