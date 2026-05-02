import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

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
 * Upload a stream to R2. ContentLength is required so the AWS SDK can set
 * the Content-Length header, which R2 uses to enforce the transfer size.
 * The caller is responsible for enforcing that the stream does not exceed
 * contentLength bytes before handing it to this function.
 */
export async function putObject(
  key: string,
  contentType: string,
  contentLength: number,
  body: Readable
): Promise<void> {
  await r2Client.send(
    new PutObjectCommand({
      Bucket:        R2_BUCKET_NAME,
      Key:           key,
      ContentType:   contentType,
      ContentLength: contentLength,
      Body:          body,
    })
  );
}

/**
 * Fetch metadata for an object without downloading its body.
 * Used after upload to verify the object exists and its size matches
 * the declared blobSize — the authoritative server-side size check.
 */
export async function headObject(key: string): Promise<HeadObjectCommandOutput> {
  return r2Client.send(
    new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );
}

/**
 * Delete an object from R2.
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
