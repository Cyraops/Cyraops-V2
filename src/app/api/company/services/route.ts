import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const services = await db.serviceCapability.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return Response.json({ services });
}

const serviceSchema = z.object({
  name: z.string().trim().min(3).max(150),
  category: z.string().trim().min(2).max(100).default("Cloud & Infrastructure"),
  description: z.string().trim().max(2000).default(""),
  requiredExpertise: z.string().trim().max(500).default(""),
  minRequiredEngineers: z.number().int().min(1).default(1),
  deliveryReadiness: z.enum(["PRODUCTION_READY", "CONDITIONAL_PARTNER", "CAPACITY_CONSTRAINED", "NOT_READY"]).default("NOT_READY"),
  typicalDeliverables: z.union([z.string(), z.array(z.string())]).default("[]"),
  expectedDuration: z.string().trim().max(100).default(""),
  pricingModel: z.enum(["FIXED_PRICE", "HOURLY", "RETAINER", "MILESTONE"]).default("FIXED_PRICE"),
  startingPrice: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = serviceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const data = parsed.data;
  const deliverablesStr = Array.isArray(data.typicalDeliverables)
    ? JSON.stringify(data.typicalDeliverables)
    : data.typicalDeliverables;

  const service = await db.serviceCapability.create({
    data: {
      name: data.name,
      category: data.category,
      description: data.description,
      requiredExpertise: data.requiredExpertise,
      minRequiredEngineers: data.minRequiredEngineers,
      deliveryReadiness: data.deliveryReadiness,
      typicalDeliverables: deliverablesStr,
      expectedDuration: data.expectedDuration,
      pricingModel: data.pricingModel,
      startingPrice: data.startingPrice,
      isActive: data.isActive,
      notes: data.notes || null,
    },
  });

  await logActivity({
    action: "created",
    entity: "service_capability",
    summary: `added service: ${service.name}`,
    userId: user.id,
  });

  return Response.json({ service }, { status: 201 });
}
