import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAdminSessionEdge, SESSION_COOKIE_NAME } from "@/lib/auth/adminSessionEdge";

const ADMIN_PAGES = ["/dashboard", "/edit-run", "/run-details", "/create-run", "/drivers", "/driver-payments"];

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const fullPath = pathname + search;

  if (pathname === "/") {
    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookie && (await verifyAdminSessionEdge(cookie))) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/login") {
    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookie && (await verifyAdminSessionEdge(cookie))) {
      const redirect = request.nextUrl.searchParams.get("redirect");
      const target = redirect?.startsWith("/") && !redirect.startsWith("//") ? redirect : "/dashboard";
      return NextResponse.redirect(new URL(target, request.url));
    }
    return NextResponse.next();
  }

  if (ADMIN_PAGES.some((p) => pathname === p || pathname.startsWith(p + "?"))) {
    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookie || !(await verifyAdminSessionEdge(cookie))) {
      return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(fullPath)}`, request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/dashboard", "/edit-run", "/run-details", "/create-run", "/drivers", "/driver-payments"],
};
