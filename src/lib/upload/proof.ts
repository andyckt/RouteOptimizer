/**
 * Proof-of-delivery upload: R2 if configured, else local filesystem.
 * Server-only.
 */

import fs from "fs/promises";
import path from "path";
import { getR2ConfigFromEnv, uploadToR2 } from "@/lib/r2/client";

const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp", "heic"];

function getSafeExt(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  return ALLOWED_EXT.includes(ext) ? ext : "jpg";
}

function makeFilename(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Upload proof image(s). Returns array of URLs (full R2 URLs or relative /uploads/... paths).
 */
export async function uploadProofImages(
  runId: string,
  stopIndex: number,
  files: Array<{ buffer: Buffer; name: string; type: string }>
): Promise<string[]> {
  const r2Config = getR2ConfigFromEnv();

  if (r2Config) {
    const urls: string[] = [];
    for (const file of files) {
      const ext = getSafeExt(file.name);
      const filename = `${makeFilename()}.${ext}`;
      const url = await uploadToR2(
        r2Config,
        runId,
        stopIndex,
        filename,
        file.buffer,
        file.type
      );
      urls.push(url);
    }
    return urls;
  }

  const uploadDir = path.join(
    process.cwd(),
    "public",
    "uploads",
    runId,
    String(stopIndex)
  );
  await fs.mkdir(uploadDir, { recursive: true });

  const urls: string[] = [];
  for (const file of files) {
    const ext = getSafeExt(file.name);
    const filename = `${makeFilename()}.${ext}`;
    const filepath = path.join(uploadDir, filename);
    await fs.writeFile(filepath, file.buffer);
    urls.push(`/uploads/${runId}/${stopIndex}/${filename}`);
  }
  return urls;
}
