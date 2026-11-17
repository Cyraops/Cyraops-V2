import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError, prioritySchema, taskKindSchema, taskSourceSchema, taskStatusSchema, taskTypeSchema } from "@/lib/validators";
import { listTaskAssignees, normaliseAssigneeSet, setTaskAssignees } from "@/lib/tasks/assignees";

/**
 * Ticket triage.
 *
 * A ticket desk is shared: everyone sees the queue and anyone on the desk can
 * triage it — set status, priority, assignee, source, type, group, category and
 * the resolution. That is the point of a queue.
 *
 * `PATCH /api/tasks/:id` deliberately does not work this way: it is scoped to
 * project membership, because a task inside a project belongs to that project's
 * people. Using it from the queue meant a member saw a ticket, clicked the
 * assignee, and got "Task not found" — the row was visible but untouchable.
 *
 * So this endpoint owns desk semantics and nothing else:
 *   - allowed for any signed-in teammate: the triage fields
 *   - NOT allowed here: title, description, project moves, archiving. Those stay
 *     on /api/tasks/:id where project rules apply.
 */

type Context = { params: Promise<{ id: string }> };

const triageSchema = z.object({
  // Correcting a ticket is part of triage: the subject is often wrong because the
  // requester wrote it in an email. Moving it between projects and archiving stay
  // project-scoped, on /api/tasks/:id.
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().max(10000).optional(),
  /// Filing a ticket in the right project is triage. Archiving it is not.
  projectId: z.string().min(1).optional(),
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  kind: taskKindSchema.nullable().optional(),
  source: taskSourceSchema.nullable().optional(),
  type: taskTypeSchema.nullable().optional(),
  groupName: z.string().trim().max(80).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  requesterName: z.string().trim().max(120).optional().nullable(),
  requesterEmail: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  resolution: z.string().max(10000).optional(),
  assigneeIds: z.array(z.string()).optional(),
  agentSlugs: z.array(z.string()).optional(),
});

export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const parsed = triageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the ticket details", 400);
  const data = parsed.data;

  const existing = await db.task.findFirst({
    where: { id, archivedAt: null },
    select: { id: true, title: true, projectId: true, closedAt: true, status: true },
  });
  if (!existing) return jsonError("Ticket not found", 404);

  if (data.projectId && data.projectId !== existing.projectId) {
    const project = await db.project.findFirst({ where: { id: data.projectId }, select: { id: true } });
    if (!project) return jsonError("That project does not exist", 400);
  }

  // Assignment: any active teammate may own a ticket. The project-membership
  // rule belongs to project tasks, not to a shared desk.
  let nextAssignees: ReturnType<typeof normaliseAssigneeSet> | null = null;
  if (data.assigneeIds !== undefined || data.agentSlugs !== undefined) {
    nextAssignees = normaliseAssigneeSet({ userIds: data.assigneeIds ?? [], agentSlugs: data.agentSlugs ?? [] });
    for (const userId of nextAssignees.userIds) {
      const person = await db.user.findFirst({ where: { id: userId, disabledAt: null }, select: { id: true } });
      if (!person) return jsonError("That teammate is not available", 400);
    }
  }

  // Closing records when; reopening clears it.
  const closing = data.status === "DONE" && !existing.closedAt;
  const reopening = data.status !== undefined && data.status !== "DONE";

  const updated = await db.task.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.source !== undefined ? { source: data.source } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.groupName !== undefined ? { groupName: data.groupName } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.requesterName !== undefined ? { requesterName: data.requesterName } : {}),
      ...(data.requesterEmail !== undefined ? { requesterEmail: data.requesterEmail || null } : {}),
      ...(data.resolution !== undefined ? { resolution: data.resolution } : {}),
      ...(closing ? { closedAt: new Date() } : {}),
      ...(reopening ? { closedAt: null } : {}),
      ...(nextAssignees ? { assigneeId: nextAssignees.userIds[0] ?? null } : {}),
    },
    select: {
      id: true,
      number: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      kind: true,
      source: true,
      type: true,
      groupName: true,
      category: true,
      requesterName: true,
      requesterEmail: true,
      resolution: true,
      closedAt: true,
      updatedAt: true,
      project: { select: { id: true, name: true } },
    },
  });

  if (nextAssignees) await setTaskAssignees(id, nextAssignees);

  const changed = Object.keys(data).filter((key) => key !== "assigneeIds" && key !== "agentSlugs");
  if (changed.length > 0 || nextAssignees) {
    await logActivity({
      action: "updated",
      entity: "task",
      entityId: id,
      summary: `triaged ticket ${existing.title}${changed.length ? ` (${changed.join(", ")})` : ""}`,
      userId: user.id,
      projectId: existing.projectId,
      taskId: id,
    });
  }

  const assignees = await listTaskAssignees([id]);
  return Response.json({ task: { ...updated, assignees: assignees.get(id) ?? [] } });
}

/** The ticket as the desk reads it: same shape the queue uses. */
export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const task = await db.task.findFirst({
    where: { id, archivedAt: null },
    include: {
      creator: { select: publicUserSelect },
      project: { select: { id: true, name: true } },
      comments: { include: { author: { select: publicUserSelect } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!task) return jsonError("Ticket not found", 404);

  const assignees = await listTaskAssignees([id]);
  return Response.json({ task: { ...task, assignees: assignees.get(id) ?? [] } });
}
