import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const updateSchema = z.object({
  title: z.string().trim().min(3).max(150).optional(),
  description: z.string().trim().min(5).max(1000).optional(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"]).optional(),
  ownerId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.businessReadinessItem.findUnique({ where: { id } });
  if (!existing) return jsonError("Readiness item not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const updateData: Record<string, any> = { ...parsed.data };
  if (parsed.data.status !== undefined) {
    if (parsed.data.status === "COMPLETED") {
      updateData.completedAt = new Date();
    } else if (existing.status === "COMPLETED") {
      updateData.completedAt = null;
    }
  }

  const item = await db.businessReadinessItem.update({
    where: { id },
    data: updateData,
    include: {
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  await logActivity({
    action: "updated",
    entity: "business_readiness",
    summary: `updated readiness item: ${item.title} (${item.status})`,
    userId: user.id,
  });

  return Response.json({ item });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.businessReadinessItem.findUnique({ where: { id } });
  if (!existing) return jsonError("Readiness item not found", 404);

  await db.businessReadinessItem.delete({ where: { id } });

  await logActivity({
    action: "deleted",
    entity: "business_readiness",
    summary: `deleted readiness item: ${existing.title}`,
    userId: user.id,
  });

  return Response.json({ success: true });
}

