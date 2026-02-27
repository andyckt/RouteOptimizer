/**
 * Require admin session for API routes. Throws 401 if invalid.
 */

import { NextRequest } from "next/server";
import { verifyAdminSession } from "@/lib/auth/adminSession";
import { SESSION_COOKIE_NAME } from "@/lib/auth/adminSession";
import { unauthorized } from "@/lib/http/errors";

export function requireAdminSession(request: NextRequest): void {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifyAdminSession(cookie)) {
    throw unauthorized("Authentication required");
  }
}
