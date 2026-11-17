import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { renderStandalonePage, sanitizePageHtml } from "@/lib/pages/sanitize";

type Context = { params: Promise<{ slug: string }> };

/**
 * Public share link for a bot-built page. Only pages explicitly marked public
 * resolve here; everything else is a 404, so an unshared page stays private
 * even if its slug leaks.
 */
export async function GET(request: NextRequest, context: Context) {
  const { slug } = await context.params;

  const page = await db.page.findFirst({
    where: { publicSlug: slug, isPublic: true },
    select: { title: true, content: true, shareExpiresAt: true },
  });
  if (!page) {
    return new Response("This page is not available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // An expiring link stops working on its own, without anyone remembering to
  // switch sharing off.
  if (page.shareExpiresAt && page.shareExpiresAt.getTime() < Date.now()) {
    return new Response("This page is not available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const html = renderStandalonePage(page.title, sanitizePageHtml(page.content));
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Uploaded/edited content must not be framed by other origins or execute.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
