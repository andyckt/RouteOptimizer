import crypto from "crypto";
import { getServerEnv } from "@/lib/env";

/**
 * Generate a driver link token for a run ID.
 * Uses HMAC-SHA256 with DRIVER_LINK_SECRET.
 */
export function makeDriverToken(runId: string): string {
  const { DRIVER_LINK_SECRET } = getServerEnv();
  return crypto.createHmac("sha256", DRIVER_LINK_SECRET).update(runId).digest("hex");
}

/**
 * Verify driver token with constant-time comparison.
 */
export function verifyDriverToken(runId: string, token: string): boolean {
  const expected = makeDriverToken(runId);
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
}
