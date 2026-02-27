import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { verifyAdminSession } from "@/lib/auth/adminSession";
import { SESSION_COOKIE_NAME } from "@/lib/auth/adminSession";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!verifyAdminSession(cookie)) {
      return json({ error: "Not authenticated" }, { status: 401 });
    }
    return json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
