import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Cheap edge gate (spec 2026-09-13 accounts §1): pages without a session cookie go to /login,
// API calls without a cookie or a bearer token get 401. The real check — is the cookie valid, is
// the token known — happens in the handlers (src/lib/actor.ts) and pages (src/lib/session.ts);
// this only spares the server rendering a whole page for a stranger.

const PUBLIC_PAGES = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"];
const COOKIE_PREFIX = "sortie";

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  const hasSession = Boolean(getSessionCookie(req, { cookiePrefix: COOKIE_PREFIX }));

  if (pathname.startsWith("/api/")) {
    if (hasSession || req.headers.get("authorization")) return NextResponse.next();
    return NextResponse.json({ error: "登录后再试", code: "unauthenticated" }, { status: 401 });
  }

  if (isPublicPage(pathname)) {
    // A signed-in user landing on /login goes home (the reset/verify pages stay reachable).
    if (hasSession && (pathname === "/login" || pathname === "/signup")) {
      const next = req.nextUrl.searchParams.get("next");
      return NextResponse.redirect(new URL(next && next.startsWith("/") ? next : "/", req.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL("/login", req.url);
    const wanted = `${pathname}${req.nextUrl.search}`;
    if (wanted !== "/") url.searchParams.set("next", wanted);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|woff2?)$).*)"],
};
