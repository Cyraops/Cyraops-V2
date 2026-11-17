import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { renderPrintPage, renderStandalonePage, sanitizePageHtml } from "@/lib/pages/sanitize";
import { pageToMarkdown } from "@/lib/pages/to-markdown";

type Context = { params: Promise<{ id: string }> };

/** Filenames people can recognise: "pipeline-brief-2026-11-16.md". */
function filename(title: string, extension: string) {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "cyraops-page";
  return `${base}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const page = await db.page.findFirst({ where: { id, userId: user.id }, select: { title: true, content: true } });
  if (!page) return jsonError("Page not found", 404);

  const format = (request.nextUrl.searchParams.get("format") ?? "md").toLowerCase();

  if (format === "print") {
    // Opened in a tab: the browser's print engine makes the PDF.
    const html = renderPrintPage(page.title, sanitizePageHtml(page.content));
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  if (format === "html") {
    const html = renderStandalonePage(page.title, sanitizePageHtml(page.content));
    return new NextResponse(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${filename(page.title, "html")}"`,
      },
    });
  }

  if (format === "md") {
    const markdown = pageToMarkdown(page.title, page.content);
    return new NextResponse(markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename(page.title, "md")}"`,
      },
    });
  }

  return jsonError("Choose format=md, html or print", 400);
}
