import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ENDPOINT        = process.env.R2_ENDPOINT!;
const R2_BUCKET_NAME     = process.env.R2_BUCKET_NAME!;
const R2_ACCESS_KEY_ID   = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;

if (!R2_ENDPOINT || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  throw new Error(
    "R2 env vars missing. Set R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY."
  );
}

export const r2Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId:     R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: false,
});

/**
 * Generate a presigned PUT URL so the browser can upload encrypted ciphertext
 * directly to R2 without routing gigabytes through the API server.
 *
 * @param key         - R2 object key (e.g. "vault/42/7/uuid")
 * @param contentType - MIME type to set on the object (e.g. "application/octet-stream")
 * @param expiresIn   - Seconds until the URL expires (default: 3600)
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket:      R2_BUCKET_NAME,
    Key:         key,
    ContentType: contentType,
  });
  return getSignedUrl(r2Client, cmd, { expiresIn });
}

/**
 * Delete an object from R2. Used when a vault track is removed.
 */
export async function deleteObject(key: string): Promise<void> {
  await r2Client.send(
    new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );
}

/**
 * Fetch an object from R2. Returns the raw command output so the caller can
 * pipe the Body stream directly to the Express response without buffering.
 */
export async function streamObject(key: string): Promise<GetObjectCommandOutput> {
  return r2Client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );
}
