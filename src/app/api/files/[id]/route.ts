import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { fileAccess } from "@/lib/drive";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  const file = await db.driveFile.findUnique({ where: { id } });
  if (!file || await fileAccess(file, user.id, user.role) !== "EDITOR") return jsonError("File not found", 404);
  if (request.nextUrl.searchParams.get("restore") === "1") {
    const restored = await db.driveFile.update({ where: { id }, data: { deletedAt: null }, select: { id: true, name: true, mimeType: true, size: true, projectId: true, createdAt: true } });
    return Response.json({ file: restored });
  }
  if (file.deletedAt) return jsonError("File not found", 404);
  const parsed = z.object({ name: z.string().trim().min(1).max(240) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Enter a valid file name", 400);
  const updated = await db.driveFile.update({ where: { id }, data: { name: parsed.data.name }, select: { id: true, name: true, mimeType: true, size: true, projectId: true, createdAt: true } });
  return Response.json({ file: updated });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  const file = await db.driveFile.findFirst({ where: { id, deletedAt: null } });
  if (!file || await fileAccess(file, user.id, user.role) !== "EDITOR") return jsonError("File not found", 404);
  await db.driveFile.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity({ action: "trashed", entity: "file", entityId: id, summary: `removed ${file.name}`, userId: user.id, projectId: file.projectId });
  return Response.json({ ok: true });
}
