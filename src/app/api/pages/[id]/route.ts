import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { sanitizePageHtml } from "@/lib/pages/sanitize";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const page = await db.page.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      title: true,
      content: true,
      publicSlug: true,
      isPublic: true,
      currentVersion: true,
      shareExpiresAt: true,
      updatedAt: true,
    },
  });
  if (!page) return jsonError("Page not found", 404);
  return NextResponse.json({ page });
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const parsed = z
    .object({
      title: z.string().trim().min(1).max(160).optional(),
      content: z.string().max(400_000).optional(),
      isPublic: z.boolean().optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the page details", 400);

  const existing = await db.page.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!existing) return jsonError("Page not found", 404);

  const data: Record<string, unknown> = {};
  if (parsed.data.title) data.title = parsed.data.title;
  if (parsed.data.content !== undefined) data.content = sanitizePageHtml(parsed.data.content);
  if (parsed.data.isPublic !== undefined) data.isPublic = parsed.data.isPublic;

  const page = await db.page.update({
    where: { id: existing.id },
    data,
    select: { id: true, title: true, publicSlug: true, isPublic: true, updatedAt: true },
  });
  return NextResponse.json({ page });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const deleted = await db.page.deleteMany({ where: { id, userId: user.id } });
  if (!deleted.count) return jsonError("Page not found", 404);
  return NextResponse.json({ ok: true });
}
