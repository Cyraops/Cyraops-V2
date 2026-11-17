import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };
async function canAccess(taskId: string, userId: string, role: string) {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, title: true, projectId: true, assigneeId: true } });
  if (!task) return null;
  if (role === "OWNER" || role === "ADMIN") return task;
  if (!task.projectId) return null;
  return await db.projectMember.findUnique({ where: { projectId_userId: { projectId: task.projectId, userId } } }) ? task : null;
}
export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  if (!await canAccess(id, user.id, user.role)) return jsonError("Task not found", 404);
  const comments = await db.taskComment.findMany({ where: { taskId: id }, include: { author: { select: publicUserSelect } }, orderBy: { createdAt: "asc" } });
  return Response.json({ comments });
}
export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  const task = await canAccess(id, user.id, user.role);
  if (!task) return jsonError("Task not found", 404);
  const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Comment cannot be empty", 400);
  const comment = await db.taskComment.create({ data: { body: parsed.data.body, taskId: id, authorId: user.id }, include: { author: { select: publicUserSelect } } });
  if (task.assigneeId && task.assigneeId !== user.id) await db.notification.create({ data: { userId: task.assigneeId, type: "TASK_COMMENT", title: "New task comment", body: task.title, href: `/projects?project=${task.projectId}&tab=tasks` } });
  await logActivity({ action: "commented", entity: "task", entityId: id, summary: `commented on ${task.title}`, userId: user.id, projectId: task.projectId, taskId: id });
  return Response.json({ comment }, { status: 201 });
}
