import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const items = await db.portfolioItem.findMany({
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ items });
}

const portfolioSchema = z.object({
  title: z.string().trim().min(3).max(150),
  category: z.string().trim().min(2).max(100).default("Cloud & DevOps"),
  description: z.string().trim().min(10).max(2000),
  problem: z.string().trim().min(10).max(2000),
  solution: z.string().trim().min(10).max(2000),
  workDone: z.string().trim().min(10).max(3000),
  outcome: z.string().trim().min(10).max(2000),
  technologies: z.union([z.string(), z.array(z.string())]).default("[]"),
  isRealClient: z.boolean().default(false),
  clientName: z.string().trim().max(100).optional().nullable(),
  isPublic: z.boolean().default(false),
  metrics: z.string().trim().max(500).optional().nullable(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = portfolioSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const data = parsed.data;
  const technologiesStr = Array.isArray(data.technologies)
    ? JSON.stringify(data.technologies)
    : data.technologies;

  const item = await db.portfolioItem.create({
    data: {
      title: data.title,
      category: data.category,
      description: data.description,
      problem: data.problem,
      solution: data.solution,
      workDone: data.workDone,
      outcome: data.outcome,
      technologies: technologiesStr,
      isRealClient: data.isRealClient,
      clientName: data.clientName || null,
      isPublic: data.isPublic,
      metrics: data.metrics || null,
    },
  });

  await logActivity({
    action: "created",
    entity: "portfolio_item",
    summary: `added portfolio item: ${item.title}`,
    userId: user.id,
  });

  return Response.json({ item }, { status: 201 });
}
