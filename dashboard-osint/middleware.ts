import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "osint_deco_session";
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublicPage = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (isPublicPage && hasSession) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if ((pathname === "/" || pathname.startsWith("/api/osint")) && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return pathname.startsWith("/api/")
      ? NextResponse.json({ success: false, message: "Sesión requerida" }, { status: 401 })
      : NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/forgot-password", "/reset-password", "/api/osint/:path*"],
};
