/**
 * Admin password verification using PBKDF2.
 * Server-side only.
 */

import crypto from "crypto";
import { getServerEnv } from "@/lib/env";

const ITERATIONS = 100000;
const KEYLEN = 64;
const DIGEST = "sha256";

export function verifyAdminPassword(plainPassword: string): boolean {
  const stored = getServerEnv().ADMIN_PASSWORD_HASH;
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, expectedHash] = parts;
  if (!salt || !expectedHash) return false;

  const derived = crypto.pbkdf2Sync(
    plainPassword,
    salt,
    ITERATIONS,
    KEYLEN,
    DIGEST
  );
  const hash = derived.toString("hex");
  if (hash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, "utf8"), Buffer.from(expectedHash, "utf8"));
}
