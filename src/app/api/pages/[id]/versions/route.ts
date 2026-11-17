import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const page = await db.page.findFirst({ where: { id, userId: user.id }, select: { id: true, currentVersion: true } });
  if (!page) return jsonError("Page not found", 404);

  const versions = await db.pageVersion.findMany({
    where: { pageId: id },
    orderBy: { version: "desc" },
    take: 40,
    select: { version: true, title: true, createdAt: true },
  });
  return NextResponse.json({ currentVersion: page.currentVersion, versions });
}

/** Restores an earlier version as a new version, so history is append-only. */
export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const parsed = z.object({ version: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose a version to restore", 400);

  const page = await db.page.findFirst({
    where: { id, userId: user.id },
    select: { id: true, currentVersion: true, title: true },
  });
  if (!page) return jsonError("Page not found", 404);

  const target = await db.pageVersion.findFirst({
    where: { pageId: id, version: parsed.data.version },
    select: { title: true, content: true },
  });
  if (!target) return jsonError("That version does not exist", 404);

  const updated = await db.$transaction(async (tx) => {
    // Increment inside the transaction: read-then-write let two concurrent
    // restores compute the same version and one of them died with a P2002 500.
    const current = await tx.page.findUniqueOrThrow({ where: { id }, select: { currentVersion: true } });
    const nextVersion = current.currentVersion + 1;
    return tx.page.update({
      where: { id },
      data: {
        title: target.title,
        content: target.content,
        currentVersion: nextVersion,
        versions: { create: { version: nextVersion, title: target.title, content: target.content } },
      },
      select: { id: true, title: true, content: true, currentVersion: true, publicSlug: true, isPublic: true },
    });
  });
  return NextResponse.json({ page: updated });
}
