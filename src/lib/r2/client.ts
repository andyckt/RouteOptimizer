/**
 * Cloudflare R2 upload client. R2 uses S3-compatible API.
 * Server-only. Never import in client components.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  contentType: string;
  key: string;
}

let _client: S3Client | null = null;

function getR2Client(config: R2Config): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return _client;
}

const PRESIGN_EXPIRY_SEC = 300; // 5 minutes

/**
 * Generate presigned PUT URLs for direct browser upload.
 * Client uploads each file to uploadUrl with Content-Type header, then uses
 * publicUrl when calling complete-with-proof.
 */
export async function createPresignedUploadUrls(
  config: R2Config,
  runId: string,
  stopIndex: number,
  files: Array<{ name: string; type: string }>
): Promise<PresignedUpload[]> {
  const client = getR2Client(config);
  const base = config.publicUrl.replace(/\/$/, "");

  const results: PresignedUpload[] = [];
  for (const file of files) {
    const ext = getSafeExt(file.name);
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const key = `${runId}/${stopIndex}/${filename}`;
    const contentType = ALLOWED_CONTENT_TYPES.includes(file.type) ? file.type : "image/jpeg";

    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: PRESIGN_EXPIRY_SEC,
    });

    results.push({
      uploadUrl,
      publicUrl: `${base}/${key}`,
      contentType,
      key,
    });
  }

  return results;
}

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function getSafeExt(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  const allowed = ["jpg", "jpeg", "png", "webp", "heic"];
  return allowed.includes(ext) ? ext : "jpg";
}

/**
 * Upload a buffer to R2 and return the public URL.
 * Key format: {runId}/{stopIndex}/{filename}
 */
export async function uploadToR2(
  config: R2Config,
  runId: string,
  stopIndex: number,
  filename: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const client = getR2Client(config);
  const key = `${runId}/${stopIndex}/${filename}`;

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  const base = config.publicUrl.replace(/\/$/, "");
  return `${base}/${key}`;
}

export function getR2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (
    accountId &&
    accessKeyId &&
    secretAccessKey &&
    bucketName &&
    publicUrl
  ) {
    return {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      publicUrl: publicUrl.replace(/\/$/, ""),
    };
  }
  return null;
}
