import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

/**
 * Internal notes on a ticket.
 *
 * Lives next to the desk endpoint for the same reason: a note is part of
 * triaging a shared queue, so any teammate who can see the ticket can add one.
 * Project tasks keep their own comment route with project rules.
 */

type Context = { params: Promise<{ id: string }> };

async function ticketExists(id: string) {
  const task = await db.task.findFirst({ where: { id, archivedAt: null }, select: { id: true, title: true, projectId: true } });
  return task;
}

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  if (!await ticketExists(id)) return jsonError("Ticket not found", 404);

  const comments = await db.taskComment.findMany({
    where: { taskId: id },
    include: { author: { select: publicUserSelect } },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ comments });
}

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const ticket = await ticketExists(id);
  if (!ticket) return jsonError("Ticket not found", 404);

  const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("The note cannot be empty", 400);

  const comment = await db.taskComment.create({
    data: { body: parsed.data.body, taskId: id, authorId: user.id },
    include: { author: { select: publicUserSelect } },
  });
  await logActivity({
    action: "commented",
    entity: "task",
    entityId: id,
    summary: `commented on ${ticket.title}`,
    userId: user.id,
    projectId: ticket.projectId,
    taskId: id,
  });
  return Response.json({ comment }, { status: 201 });
}
