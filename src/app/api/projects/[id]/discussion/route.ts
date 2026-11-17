import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };
async function isMember(projectId: string, userId: string, role: string) {
  return role === "OWNER" || role === "ADMIN" || Boolean(await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } }));
}
export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  if (!await isMember(id, user.id, user.role)) return jsonError("Project not found", 404);
  const posts = await db.projectPost.findMany({ where: { projectId: id }, include: { author: { select: publicUserSelect } }, orderBy: { createdAt: "desc" }, take: 100 });
  return Response.json({ posts });
}
export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  if (!await isMember(id, user.id, user.role)) return jsonError("Project not found", 404);
  const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Message cannot be empty", 400);
  const post = await db.projectPost.create({ data: { projectId: id, authorId: user.id, body: parsed.data.body }, include: { author: { select: publicUserSelect } } });
  await logActivity({ action: "posted", entity: "project discussion", entityId: post.id, summary: `posted in project discussion`, userId: user.id, projectId: id });
  return Response.json({ post }, { status: 201 });
}
