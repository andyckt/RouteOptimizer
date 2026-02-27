import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/adminSession";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    maxAge: 0,
  });
  return res;
}
