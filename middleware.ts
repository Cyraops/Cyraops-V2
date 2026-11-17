import { NextResponse, type NextRequest } from "next/server";

/**
 * One canonical host.
 *
 * Both `cyraops.com` and `www.cyraops.com` answered 200 with identical content
 * and no canonical tag, which is a duplicate-content problem: two URLs, one page,
 * and a crawler has to guess. Everything now lives on www and the apex 301s to
 * it, matching sitemap.xml, robots.txt and every canonical.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  // /index.html is the same document as / — one URL per page, not two.
  if (request.nextUrl.pathname === "/index.html") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url, 301);
  }

  if (host === "cyraops.com") {
    const url = request.nextUrl.clone();
    url.host = "www.cyraops.com";
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 301);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files, which never need a host check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
