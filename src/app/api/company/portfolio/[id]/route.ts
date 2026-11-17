import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const updatePortfolioSchema = z.object({
  title: z.string().trim().min(3).max(150).optional(),
  category: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  problem: z.string().trim().min(10).max(2000).optional(),
  solution: z.string().trim().min(10).max(2000).optional(),
  workDone: z.string().trim().min(10).max(3000).optional(),
  outcome: z.string().trim().min(10).max(2000).optional(),
  technologies: z.union([z.string(), z.array(z.string())]).optional(),
  isRealClient: z.boolean().optional(),
  clientName: z.string().trim().max(100).optional().nullable(),
  isPublic: z.boolean().optional(),
  metrics: z.string().trim().max(500).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.portfolioItem.findUnique({ where: { id } });
  if (!existing) return jsonError("Portfolio item not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updatePortfolioSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const updateData: Record<string, any> = { ...parsed.data };
  if (Array.isArray(updateData.technologies)) {
    updateData.technologies = JSON.stringify(updateData.technologies);
  }

  const item = await db.portfolioItem.update({
    where: { id },
    data: updateData,
  });

  await logActivity({
    action: "updated",
    entity: "portfolio_item",
    summary: `updated portfolio item: ${item.title}`,
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
  const existing = await db.portfolioItem.findUnique({ where: { id } });
  if (!existing) return jsonError("Portfolio item not found", 404);

  await db.portfolioItem.delete({ where: { id } });

  await logActivity({
    action: "deleted",
    entity: "portfolio_item",
    summary: `deleted portfolio item: ${existing.title}`,
    userId: user.id,
  });

  return Response.json({ success: true });
}

