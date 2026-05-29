/**
 * Machine-to-machine auth for inbound integration APIs (e.g. Kapioo Admin).
 *
 * Uses a static bearer token from ROUTE_OPTIMIZER_INBOUND_TOKEN. This is intentionally
 * separate from the admin session cookie auth (`requireAdminSession`) so existing admin
 * and driver flows are unaffected. The token is read from process.env directly and is
 * NOT added to the required env list, so deployments without it keep booting normally.
 */

import crypto from "node:crypto";
import { ApiError, unauthorized } from "@/lib/http/errors";

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Throws ApiError(503) if the integration API is not configured,
 * ApiError(401) if the Authorization header is missing/malformed or the token is invalid.
 */
export function requireIntegrationAuth(request: Request): void {
  const expected = process.env.ROUTE_OPTIMIZER_INBOUND_TOKEN;
  if (!expected || !expected.trim()) {
    throw new ApiError(
      503,
      "Integration API is not configured. Set ROUTE_OPTIMIZER_INBOUND_TOKEN.",
      "INTEGRATION_NOT_CONFIGURED"
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw unauthorized("Missing or malformed Authorization header. Expected: Bearer <token>.");
  }

  const provided = match[1].trim();
  if (!timingSafeEqualStr(provided, expected.trim())) {
    throw unauthorized("Invalid integration token.");
  }
}
