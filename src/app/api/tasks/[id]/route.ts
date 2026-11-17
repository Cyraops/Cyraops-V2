import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError, prioritySchema, taskKindSchema, taskSourceSchema, taskStatusSchema, taskTypeSchema } from "@/lib/validators";
import { listTaskAssignees, newlyAssigned, normaliseAssigneeSet, setTaskAssignees } from "@/lib/tasks/assignees";
import { delegateAgentWork } from "@/lib/tasks/delegate";

type Context = { params: Promise<{ id: string }> };
const updateSchema = z.object({ title: z.string().trim().min(1).max(180).optional(), description: z.string().max(10000).optional(), status: taskStatusSchema.optional(), priority: prioritySchema.optional(), kind: taskKindSchema.nullable().optional(), dueDate: z.string().datetime().optional().nullable(), assigneeId: z.string().optional().nullable(),
  // Replace the owner set. Omitted = leave it alone; empty array = clear it.
  assigneeIds: z.array(z.string()).optional(),
  agentSlugs: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  archive: z.boolean().optional(),
  // Ticket properties
  source: taskSourceSchema.optional(),
  type: taskTypeSchema.optional(),
  groupName: z.string().trim().max(80).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  requesterName: z.string().trim().max(120).optional().nullable(),
  requesterEmail: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  resolution: z.string().max(10000).optional(),
});
async function accessible(id: string, userId: string, role: string) {
  const task = await db.task.findUnique({ where: { id } });
  if (!task) return null;
  if (role === "OWNER" || role === "ADMIN") return task;
  if (task.projectId && await db.projectMember.findUnique({ where: { projectId_userId: { projectId: task.projectId, userId } } })) return task;
  return null;
}
export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  if (!await accessible(id, user.id, user.role)) return jsonError("Task not found", 404);
  const task = await db.task.findUnique({ where: { id }, include: { assignee: { select: publicUserSelect }, creator: { select: publicUserSelect }, project: { select: { id: true, name: true } }, subtasks: { where: { archivedAt: null }, include: { assignee: { select: publicUserSelect } }, orderBy: { createdAt: "asc" } }, activities: { include: { user: { select: publicUserSelect } }, orderBy: { createdAt: "desc" }, take: 20 }, _count: { select: { comments: true, subtasks: true } } } });
  return Response.json({ task });
}
export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  if (!await accessible(id, user.id, user.role)) return jsonError("Task not found", 404);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the task details", 400);
  const { archive, dueDate, assigneeIds, agentSlugs, ...fields } = parsed.data;
  const existingTask = await db.task.findUnique({ where: { id }, select: { parentId: true, projectId: true, assigneeId: true, closedAt: true, subtasks: { where: { archivedAt: null }, select: { id: true } } } });
  if (existingTask?.parentId && fields.projectId !== undefined && fields.projectId !== existingTask.projectId) return jsonError("A subtask must stay in its parent task's project", 400);
  if (existingTask?.subtasks.length && fields.projectId !== undefined && fields.projectId !== existingTask.projectId) return jsonError("Move or archive this task's subtasks before changing its project", 400);
  const projectId = fields.projectId ?? existingTask?.projectId;
  if (fields.projectId && !await db.project.findFirst({ where: { id: fields.projectId, ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }) }, select: { id: true } })) return jsonError("Project not found", 404);
  if (fields.assigneeId && projectId && !await db.user.findFirst({ where: { id: fields.assigneeId, disabledAt: null, OR: [{ role: { in: ["OWNER", "ADMIN"] } }, { projectMemberships: { some: { projectId } } }] }, select: { id: true } })) return jsonError("Assignee must belong to this project", 400);
  // Closing a ticket records when it closed; reopening clears the timestamp.
  const statusPatch = fields.status === "DONE" && !existingTask?.closedAt ? { closedAt: new Date() } : fields.status && fields.status !== "DONE" ? { closedAt: null } : {};
  const updated = await db.task.update({ where: { id }, data: { ...fields, ...statusPatch, ...(fields.requesterEmail === "" ? { requesterEmail: null } : {}), ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}), ...(archive !== undefined ? { archivedAt: archive ? new Date() : null } : {}) }, include: { assignee: { select: publicUserSelect }, creator: { select: publicUserSelect }, project: { select: { id: true, name: true } }, _count: { select: { comments: true } } } });
  // Notify only on an actual reassignment. Comparing to the creator both
  // spammed the assignee on every re-save and skipped a legitimate hand-off to
  // the creator themselves.
  if (fields.assigneeId && existingTask?.assigneeId !== fields.assigneeId) {
    await db.notification.create({
      data: {
        userId: fields.assigneeId,
        type: "TASK_ASSIGNED",
        title: "You were assigned a task",
        body: updated.title,
        href: `/projects?project=${updated.projectId}&tab=tasks`,
      },
    });
  }

  // Replace the owner set when the caller sent one. Everyone new gets told, and
  // the people who were already on it are not re-notified.
  if (assigneeIds !== undefined || agentSlugs !== undefined) {
    const before = await listTaskAssignees([id]);
    const previous = (before.get(id) ?? []);
    const previousIds = previous.filter((a) => a.kind === "user").map((a) => a.id);
    let next;
    try {
      next = normaliseAssigneeSet({
        userIds: assigneeIds ?? previousIds,
        agentSlugs: agentSlugs ?? previous.filter((a) => a.kind === "agent").map((a) => a.id),
      });
      if (next.agentSlugs.length > 0) {
        for (const agentSlug of next.agentSlugs) {
          await delegateAgentWork({
            objective: updated.title,
            prompt: updated.description || updated.title,
            agentSlug,
            requestedById: user.id,
            requestedByRole: user.role,
            sourceTaskId: id,
          });
        }
      }
    } catch (error: any) {
      return jsonError(error?.message || "That agent is not available", 400);
    }
    for (const assigneeId of next.userIds) {
      if (!await db.user.findFirst({ where: { id: assigneeId, disabledAt: null }, select: { id: true } })) {
        return jsonError("Assignee must be an active teammate", 400);
      }
    }
    await setTaskAssignees(id, next);
    for (const assigneeId of newlyAssigned({ userIds: previousIds, agentSlugs: [] }, next)) {
      if (assigneeId === user.id) continue;
      await db.notification.create({
        data: {
          userId: assigneeId,
          type: "TASK_ASSIGNED",
          title: "You were assigned a task",
          body: updated.title,
          href: `/projects?project=${updated.projectId}&tab=tasks`,
        },
      });
    }
  }

  await logActivity({ action: "updated", entity: "task", entityId: id, summary: `updated task ${updated.title}`, userId: user.id, projectId: updated.projectId, taskId: id });
  const finalOwners = (await listTaskAssignees([id])).get(id) ?? [];
  return Response.json({ task: { ...updated, assignees: finalOwners } });
}
export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  const task = await accessible(id, user.id, user.role);
  if (!task) return jsonError("Task not found", 404);
  await db.task.update({ where: { id }, data: { archivedAt: new Date() } });
  await logActivity({ action: "archived", entity: "task", entityId: id, summary: `archived task ${task.title}`, userId: user.id, projectId: task.projectId, taskId: id });
  return Response.json({ ok: true });
}
