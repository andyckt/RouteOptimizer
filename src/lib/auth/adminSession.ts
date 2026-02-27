/**
 * Admin session cookie: signed payload with HMAC-SHA256.
 * Node.js only - for API routes. Use adminSessionEdge for middleware.
 */

import crypto from "crypto";
import { getServerEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "admin_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string {
  return getServerEnv().ADMIN_SESSION_SECRET;
}

/**
 * Create a signed session value. Use in API route (Node).
 */
export function createAdminSession(): string {
  const exp = Date.now() + SESSION_DURATION_MS;
  const payload = JSON.stringify({ admin: true, exp });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("hex");
  return `${payloadB64}.${sig}`;
}

/**
 * Verify session. Node only - for API routes.
 */
export function verifyAdminSession(cookieValue: string | null | undefined): boolean {
  if (!cookieValue || typeof cookieValue !== "string") return false;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return false;
  const payloadB64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!payloadB64 || !sig) return false;

  let payload: { admin?: boolean; exp?: number };
  try {
    const decoded = Buffer.from(payloadB64, "base64url").toString("utf8");
    payload = JSON.parse(decoded);
  } catch {
    return false;
  }

  if (payload.admin !== true || typeof payload.exp !== "number") return false;
  if (payload.exp < Date.now()) return false;

  const expected = crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("hex");
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
}
