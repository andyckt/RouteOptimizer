import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { assertRateLimit } from "@/lib/rate-limit";
import { verifyAdminPassword } from "@/lib/auth/adminPassword";
import { createAdminSession, SESSION_COOKIE_NAME } from "@/lib/auth/adminSession";

function isSafeRedirect(redirect: string): boolean {
  if (typeof redirect !== "string" || !redirect.startsWith("/")) return false;
  if (redirect.startsWith("//")) return false;
  if (/^\s*javascript:/i.test(redirect)) return false;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    assertRateLimit({
      key: `login:${ip}`,
      windowMs: 15 * 60 * 1000,
      maxRequests: 5,
    });

    const body = await request.json().catch(() => ({}));
    const password = typeof body.password === "string" ? body.password : "";
    const redirectParam = request.nextUrl.searchParams.get("redirect");
    const redirect = redirectParam && isSafeRedirect(redirectParam) ? redirectParam : "/dashboard";

    if (!verifyAdminPassword(password)) {
      return json({ error: "Invalid password" }, { status: 401 });
    }

    const sessionValue = createAdminSession();
    const isProd = process.env.NODE_ENV === "production";
    const cookieOptions = [
      `${SESSION_COOKIE_NAME}=${sessionValue}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=604800", // 7 days
    ];
    if (isProd) cookieOptions.push("Secure");

    const res = json({ ok: true });
    res.headers.set("Set-Cookie", cookieOptions.join("; "));
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
