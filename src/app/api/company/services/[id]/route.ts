import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const updateServiceSchema = z.object({
  name: z.string().trim().min(3).max(150).optional(),
  category: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  requiredExpertise: z.string().trim().max(500).optional(),
  minRequiredEngineers: z.number().int().min(1).optional(),
  deliveryReadiness: z.enum(["PRODUCTION_READY", "CONDITIONAL_PARTNER", "CAPACITY_CONSTRAINED", "NOT_READY"]).optional(),
  typicalDeliverables: z.union([z.string(), z.array(z.string())]).optional(),
  expectedDuration: z.string().trim().max(100).optional(),
  pricingModel: z.enum(["FIXED_PRICE", "HOURLY", "RETAINER", "MILESTONE"]).optional(),
  startingPrice: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
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
  const existing = await db.serviceCapability.findUnique({ where: { id } });
  if (!existing) return jsonError("Service capability not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updateServiceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const updateData: Record<string, any> = { ...parsed.data };
  if (Array.isArray(updateData.typicalDeliverables)) {
    updateData.typicalDeliverables = JSON.stringify(updateData.typicalDeliverables);
  }

  const service = await db.serviceCapability.update({
    where: { id },
    data: updateData,
  });

  await logActivity({
    action: "updated",
    entity: "service_capability",
    summary: `updated service: ${service.name}`,
    userId: user.id,
  });

  return Response.json({ service });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.serviceCapability.findUnique({ where: { id } });
  if (!existing) return jsonError("Service capability not found", 404);

  await db.serviceCapability.delete({ where: { id } });

  await logActivity({
    action: "deleted",
    entity: "service_capability",
    summary: `deleted service: ${existing.name}`,
    userId: user.id,
  });

  return Response.json({ success: true });
}

