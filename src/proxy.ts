import { NextRequest, NextResponse } from "next/server";

const publicPaths = ["/login", "/register", "/api/auth", "/api/health"];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (publicPaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return NextResponse.next();
  if (!request.cookies.get("budget_session")?.value) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"] };
