import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { advanceGoal } from "@/lib/ai/team/goal-runner";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const goals = await db.aiGoal.findMany({
    // Reads match the write policy: a MEMBER is refused create/steer, so they
    // only see the goals they set, never the whole team's objectives.
    where: user.role === "OWNER" || user.role === "ADMIN" ? {} : { createdById: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      title: true,
      objective: true,
      successCriteria: true,
      status: true,
      round: true,
      maxRounds: true,
      achievedAt: true,
      updatedAt: true,
      _count: { select: { tasks: true, messages: true } },
    },
  });
  return NextResponse.json({ goals }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can set team goals", 403);

  const parsed = z
    .object({
      title: z.string().trim().min(3).max(120),
      objective: z.string().trim().min(10).max(4000),
      successCriteria: z.string().trim().min(5).max(2000),
      maxRounds: z.number().int().min(1).max(20).optional(),
      // Without these a UI-created goal can never be verified against the data.
      metric: z.enum(["leads", "deals", "tasks", "contacts"]).optional(),
      minValue: z.number().int().min(1).optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("Give the goal a title, an objective and how we will know it is done", 400);
  }

  const goal = await db.aiGoal.create({
    data: {
      title: parsed.data.title,
      objective: parsed.data.objective,
      successCriteria: parsed.data.successCriteria,
      maxRounds: parsed.data.maxRounds ?? 10,
      metric: parsed.data.metric ?? null,
      minValue: parsed.data.minValue ?? null,
      createdById: user.id,
    },
    select: { id: true, title: true, status: true },
  });

  await db.aiAgentMessage.create({
    data: {
      goalId: goal.id,
      kind: "USER",
      body: `${parsed.data.objective}\n\nSuccess criteria: ${parsed.data.successCriteria}`,
    },
  });

  // Kick off round one immediately so the team starts now rather than on the
  // next minute tick.
  let kickoff: Awaited<ReturnType<typeof advanceGoal>> | null = null;
  try {
    kickoff = await advanceGoal(goal.id);
  } catch (error: any) {
    console.error("[API:ai/goals] Kickoff failed:", error?.message ?? error);
  }

  return NextResponse.json({ goal, kickoff }, { status: 201 });
}
