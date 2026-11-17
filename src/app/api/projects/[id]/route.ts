import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError, prioritySchema, projectStatusSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };
async function access(userId: string, role: string, id: string) {
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return null;
  if (role !== "OWNER" && role !== "ADMIN" && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId } } }))) return null;
  return project;
}
const updateSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), description: z.string().max(5000).optional(), status: projectStatusSchema.optional(), priority: prioritySchema.optional(), deadline: z.string().datetime().optional().nullable(), ownerId: z.string().optional(), memberIds: z.array(z.string()).optional(), archive: z.boolean().optional() });

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  if (!id || typeof id !== "string") return jsonError("Invalid project id", 400);

  const project = await db.project.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, role: true, avatarUrl: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, role: true, avatarUrl: true } },
        },
      },
      tasks: {
        where: { archivedAt: null },
        include: {
          assignee: { select: { id: true, name: true, role: true, avatarUrl: true } },
          creator: { select: { id: true, name: true, role: true, avatarUrl: true } },
        },
        orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      },
      discussion: {
        include: {
          author: { select: { id: true, name: true, role: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      files: {
        where: { deletedAt: null },
        include: {
          uploader: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!project) return jsonError("Project not found", 404);

  const isMember = project.members.some((m) => m.userId === user.id);
  const isOwnerOrAdmin = user.role === "OWNER" || user.role === "ADMIN";
  if (!isOwnerOrAdmin && !isMember) {
    return jsonError("You do not have access to this project", 403);
  }

  const totalTasks = project.tasks.length;
  const completedTasks = project.tasks.filter((t) => t.status === "DONE").length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return Response.json({
    project: {
      ...project,
      progress,
    },
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  const project = await access(user.id, user.role, id);
  if (!project) return jsonError("Project not found", 404);
  if (user.role === "MEMBER" && project.ownerId !== user.id) return jsonError("Only an owner or admin can edit this project", 403);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the project details", 400);
  const { memberIds, archive, ...fields } = parsed.data;
  // A Member may lead a project but may not hand that lead to somebody else.
  if (user.role === "MEMBER" && fields.ownerId && fields.ownerId !== user.id) return jsonError("Only an owner or admin can change the project lead", 403);
  if (fields.ownerId && !await db.user.findFirst({ where: { id: fields.ownerId, disabledAt: null }, select: { id: true } })) return jsonError("Project owner not found", 404);
  if (memberIds) {
    const validMembers = await db.user.findMany({ where: { id: { in: memberIds }, disabledAt: null }, select: { id: true } });
    if (validMembers.length !== new Set(memberIds).size) return jsonError("One or more project members could not be found", 404);
  }
  const previousMemberIds = memberIds || fields.ownerId ? (await db.projectMember.findMany({ where: { projectId: id }, select: { userId: true } })).map((member) => member.userId) : [];
  const nextOwnerId = fields.ownerId ?? project.ownerId;
  const nextMemberIds = [...new Set([project.ownerId, nextOwnerId, ...(memberIds ?? previousMemberIds)])];
  const updated = await db.$transaction(async (tx) => {
    if (memberIds || fields.ownerId) {
      await tx.projectMember.deleteMany({ where: { projectId: id } });
      await tx.projectMember.createMany({ data: nextMemberIds.map((userId) => ({ projectId: id, userId })) });
    }
    return tx.project.update({ where: { id }, data: { ...fields, deadline: fields.deadline ? new Date(fields.deadline) : fields.deadline, ...(archive !== undefined ? { archivedAt: archive ? new Date() : null, status: archive ? "ARCHIVED" : "PLANNING" } : {}) } });
  });
  if (memberIds || fields.ownerId) {
    const newlyAdded = nextMemberIds.filter((userId) => !previousMemberIds.includes(userId));
    const removed = previousMemberIds.filter((userId) => !nextMemberIds.includes(userId));
    if (newlyAdded.length) await db.notification.createMany({ data: newlyAdded.map((userId) => ({ userId, type: "PROJECT_CHANGE" as const, title: "Added to a project", body: updated.name, href: `/projects?project=${id}` })) });
    if (removed.length) await db.notification.createMany({ data: removed.map((userId) => ({ userId, type: "PROJECT_CHANGE" as const, title: "Removed from a project", body: updated.name, href: "/projects" })) });
  }
  await logActivity({ action: archive ? "archived" : "updated", entity: "project", entityId: id, summary: `${archive ? "archived" : "updated"} project ${updated.name}`, userId: user.id, projectId: id });
  return Response.json({ project: updated });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only an owner or admin can delete projects", 403);
  const { id } = await context.params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return jsonError("Project not found", 404);
  await db.project.delete({ where: { id } });
  await logActivity({ action: "deleted", entity: "project", entityId: id, summary: `deleted project ${project.name}`, userId: user.id });
  return Response.json({ ok: true });
}
