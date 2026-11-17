import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { canAccessProject } from "@/lib/project-access";

const milestoneStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED"]);

const createMilestoneSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().max(2000).optional().default(""),
  dueDate: z.string().datetime().optional().nullable().or(z.literal("")),
  billingAmount: z.number().min(0).optional().default(0),
  deliverables: z.union([z.string(), z.array(z.string())]).optional().default("[]"),
  status: milestoneStatusSchema.default("PENDING"),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id: projectId } = await params;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return jsonError("Project not found", 404);
  if (!(await canAccessProject(user.id, user.role, projectId))) return jsonError("Project not found", 404);

  const milestones = await db.projectMilestone.findMany({
    where: { projectId },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  return Response.json({ milestones });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id: projectId } = await params;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return jsonError("Project not found", 404);
  if (!(await canAccessProject(user.id, user.role, projectId))) return jsonError("Project not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = createMilestoneSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const data = parsed.data;
  const deliverablesStr = Array.isArray(data.deliverables)
    ? JSON.stringify(data.deliverables)
    : data.deliverables;

  const dueDate = data.dueDate && data.dueDate.length > 0
    ? new Date(data.dueDate)
    : null;

  const milestone = await db.projectMilestone.create({
    data: {
      projectId,
      title: data.title,
      description: data.description,
      dueDate,
      billingAmount: data.billingAmount,
      deliverables: deliverablesStr,
      status: data.status,
      completedAt: data.status === "COMPLETED" ? new Date() : null,
    },
  });

  await logActivity({
    action: "created",
    entity: "project",
    entityId: projectId,
    summary: `created milestone "${milestone.title}" for project "${project.name}"`,
    userId: user.id,
    projectId,
  });

  return Response.json({ milestone }, { status: 201 });
}

