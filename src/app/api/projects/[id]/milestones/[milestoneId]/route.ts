import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { canAccessProject } from "@/lib/project-access";

const milestoneStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED"]);

const updateMilestoneSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional().nullable().or(z.literal("")),
  billingAmount: z.number().min(0).optional(),
  deliverables: z.union([z.string(), z.array(z.string())]).optional(),
  status: milestoneStatusSchema.optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id: projectId, milestoneId } = await params;
  if (!(await canAccessProject(user.id, user.role, projectId))) return jsonError("Project not found", 404);
  const existing = await db.projectMilestone.findFirst({
    where: { id: milestoneId, projectId },
  });
  if (!existing) return jsonError("Milestone not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updateMilestoneSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const data = parsed.data;
  const updateData: Record<string, any> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.billingAmount !== undefined) updateData.billingAmount = data.billingAmount;

  if (data.deliverables !== undefined) {
    updateData.deliverables = Array.isArray(data.deliverables)
      ? JSON.stringify(data.deliverables)
      : data.deliverables;
  }

  if (data.dueDate !== undefined) {
    updateData.dueDate = data.dueDate && data.dueDate.length > 0
      ? new Date(data.dueDate)
      : null;
  }

  if (data.status !== undefined) {
    updateData.status = data.status;
    if (data.status === "COMPLETED") {
      updateData.completedAt = new Date();
    } else if (existing.status === "COMPLETED") {
      updateData.completedAt = null;
    }
  }

  const updated = await db.projectMilestone.update({
    where: { id: milestoneId },
    data: updateData,
  });

  await logActivity({
    action: "updated",
    entity: "project",
    entityId: projectId,
    summary: `updated milestone "${updated.title}" (${updated.status})`,
    userId: user.id,
    projectId,
  });

  return Response.json({ milestone: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id: projectId, milestoneId } = await params;
  if (!(await canAccessProject(user.id, user.role, projectId))) return jsonError("Project not found", 404);
  const existing = await db.projectMilestone.findFirst({
    where: { id: milestoneId, projectId },
  });
  if (!existing) return jsonError("Milestone not found", 404);

  await db.projectMilestone.delete({ where: { id: milestoneId } });

  await logActivity({
    action: "deleted",
    entity: "project",
    entityId: projectId,
    summary: `deleted milestone "${existing.title}"`,
    userId: user.id,
    projectId,
  });

  return Response.json({ success: true });
}

