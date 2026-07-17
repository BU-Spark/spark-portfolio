// S3-compatible object storage (Railway bucket). Server-only.
import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const globalForS3 = globalThis as unknown as { sparkS3?: S3Client };

function getClient(): S3Client {
  if (!globalForS3.sparkS3) {
    globalForS3.sparkS3 = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      // Path-style addressing is required by most S3-compatible providers
      // (MinIO / Railway) where the bucket isn't a DNS subdomain.
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return globalForS3.sparkS3;
}

const BUCKET = () => process.env.S3_BUCKET || "";

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
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: BUCKET(), Key: key })
    );
  } catch {
    // best-effort
  }
}
