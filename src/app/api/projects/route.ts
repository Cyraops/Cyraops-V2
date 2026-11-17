import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { firstFieldError, jsonError, prioritySchema, projectStatusSchema } from "@/lib/validators";
import { listTaskAssignees } from "@/lib/tasks/assignees";

const createSchema = z.object({ name: z.string().trim().min(2).max(120), description: z.string().max(5000).optional(), status: projectStatusSchema.optional(), priority: prioritySchema.optional(), deadline: z.string().datetime().optional().or(z.literal("")), ownerId: z.string().optional(), memberIds: z.array(z.string()).optional() });
export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const projects = await db.project.findMany({ where: { archivedAt: null, ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }) }, include: { owner: { select: { id: true, name: true, avatarUrl: true } }, members: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } }, _count: { select: { tasks: true } }, tasks: { where: { archivedAt: null }, include: { assignee: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }] } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] });
  // The board renders every owner of a task, people and agents alike, so the
  // owner set has to come along with the tasks (one query for all of them).
  const ownerMap = await listTaskAssignees(projects.flatMap((project) => project.tasks.map((task) => task.id)));
  const withOwners = (task: { id: string }) => ({ ...task, assignees: ownerMap.get(task.id) ?? [] });

  return Response.json({
    projects: projects.map((project) => ({
      ...project,
      tasks: project.tasks.map(withOwners),
      progress: project.tasks.length ? Math.round(project.tasks.filter((task) => task.status === "DONE").length / project.tasks.length * 100) : 0,
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstFieldError(parsed.error), 400);
  // Anyone who delivers work can open a project, and they lead the one they open.
  // Only Owners and Admins may hand a brand-new project to somebody else.
  const ownerId = user.role === "MEMBER" ? user.id : parsed.data.ownerId ?? user.id;
  const memberIds = [...new Set([user.id, ownerId, ...(parsed.data.memberIds ?? [])])];
  const validMembers = await db.user.findMany({ where: { id: { in: memberIds }, disabledAt: null }, select: { id: true } });
  if (validMembers.length !== memberIds.length) return jsonError("One or more project members could not be found", 404);
  const project = await db.project.create({ data: { name: parsed.data.name, description: parsed.data.description ?? "", status: parsed.data.status, priority: parsed.data.priority, deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null, ownerId, members: { create: memberIds.map((userId) => ({ userId })) } }, include: { owner: { select: { id: true, name: true } }, members: { include: { user: { select: { id: true, name: true } } } } } });
  await logActivity({ action: "created", entity: "project", entityId: project.id, summary: `created project ${project.name}`, userId: user.id, projectId: project.id });
  return Response.json({ project }, { status: 201 });
}
