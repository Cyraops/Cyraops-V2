import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError, prioritySchema, taskKindSchema, taskSourceSchema, taskStatusSchema, taskTypeSchema } from "@/lib/validators";
import { listTaskAssignees, normaliseAssigneeSet, setTaskAssignees, validateHumanAssignees } from "@/lib/tasks/assignees";
import { delegateAgentWork } from "@/lib/tasks/delegate";

const createSchema = z.object({ title: z.string().trim().min(1).max(180), description: z.string().max(10000).optional(), status: taskStatusSchema.optional(), priority: prioritySchema.optional(), kind: taskKindSchema.optional(), dueDate: z.string().datetime().optional().or(z.literal("")), projectId: z.string().optional(), assigneeId: z.string().optional().nullable(),
  // Several owners, and agents can be among them. `assigneeId` stays supported.
  assigneeIds: z.array(z.string()).optional(),
  agentSlugs: z.array(z.string()).optional(),
  parentId: z.string().optional().nullable(),
  // Ticket properties
  source: taskSourceSchema.optional(),
  type: taskTypeSchema.optional(),
  groupName: z.string().trim().max(80).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  requesterName: z.string().trim().max(120).optional().nullable(),
  requesterEmail: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  resolution: z.string().max(10000).optional(),
});
export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return jsonError("Choose a project to view its tasks", 400);
  const project = await db.project.findFirst({ where: { id: projectId, ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }) }, select: { id: true } });
  if (!project) return jsonError("Project not found", 404);
  const tasks = await db.task.findMany({ where: { projectId, archivedAt: null }, include: { assignee: { select: publicUserSelect }, creator: { select: publicUserSelect }, project: { select: { id: true, name: true } }, _count: { select: { comments: true, subtasks: true } } }, orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }] });
  // One query for every task's owners, instead of one per task.
  const ownerMap = await listTaskAssignees(tasks.map((task) => task.id));
  return Response.json({
    tasks: tasks.map((task) => ({ ...task, assignees: ownerMap.get(task.id) ?? [] })),
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the task details", 400);
  const data = parsed.data;
  let parentProjectId: string | null = null;
  if (data.parentId) {
    const parent = await db.task.findUnique({ where: { id: data.parentId }, select: { id: true, projectId: true, creatorId: true, assigneeId: true } });
    const parentMember = parent?.projectId ? await db.projectMember.findUnique({ where: { projectId_userId: { projectId: parent.projectId, userId: user.id } } }) : null;
    if (!parent || (user.role === "MEMBER" && !parentMember)) return jsonError("Parent task not found", 404);
    if (data.projectId && parent.projectId !== data.projectId) return jsonError("Subtasks must stay in their parent task's project", 400);
    parentProjectId = parent.projectId;
  }
  const projectId = data.projectId ?? parentProjectId;
  if (!projectId) return jsonError("Tasks must belong to a project", 400);
  if (!await db.project.findFirst({ where: { id: projectId, ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }) }, select: { id: true } })) return jsonError("Project not found", 404);
  // Owners: the legacy single `assigneeId` plus the new `assigneeIds` array.
  const owners = normaliseAssigneeSet({
    userIds: [...(data.assigneeIds ?? []), data.assigneeId ?? null],
    agentSlugs: data.agentSlugs ?? [],
  });

  // Humans must belong to the project, exactly as before; agents must exist.
  for (const assigneeId of owners.userIds) {
    if (!await db.user.findFirst({ where: { id: assigneeId, disabledAt: null, OR: [{ role: { in: ["OWNER", "ADMIN"] } }, { projectMemberships: { some: { projectId } } }] }, select: { id: true } })) {
      return jsonError("Assignee must belong to this project", 400);
    }
  }
  let delegations: Awaited<ReturnType<typeof delegateAgentWork>>[] = [];
  if (owners.agentSlugs.length > 0) {
    try {
      for (const agentSlug of owners.agentSlugs) {
        delegations.push(await delegateAgentWork({
          objective: data.title,
          prompt: data.description || data.title,
          agentSlug,
          requestedById: user.id,
          requestedByRole: user.role,
        }));
      }
    } catch (error: any) {
      return jsonError(error?.message || "That agent is not available", 400);
    }
  }

  const task = await db.task.create({ data: { title: data.title, description: data.description ?? "", status: data.status, priority: data.priority, kind: data.kind ?? null, source: data.source ?? null, type: data.type ?? null, groupName: data.groupName ?? null, category: data.category ?? null, requesterName: data.requesterName ?? null, requesterEmail: data.requesterEmail || null, resolution: data.resolution ?? "", dueDate: data.dueDate ? new Date(data.dueDate) : null, projectId, assigneeId: owners.userIds[0] ?? null, parentId: data.parentId ?? null, creatorId: user.id }, include: { assignee: { select: publicUserSelect }, project: { select: { id: true, name: true } } } });
  await setTaskAssignees(task.id, owners);

  for (const assigneeId of owners.userIds) {
    if (assigneeId === user.id) continue;
    await db.notification.create({ data: { userId: assigneeId, type: "TASK_ASSIGNED", title: "You were assigned a task", body: task.title, href: `/projects?project=${task.projectId}&tab=tasks` } });
  }
  await logActivity({ action: "created", entity: "task", entityId: task.id, summary: `created task ${task.title}`, userId: user.id, projectId: task.projectId, taskId: task.id });
  const assignees = (await listTaskAssignees([task.id])).get(task.id) ?? [];
  return Response.json({ task: { ...task, assignees }, delegations }, { status: 201 });
}
