import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { advanceGoal } from "@/lib/ai/team/goal-runner";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const goal = await db.aiGoal.findUnique({ where: { id } });
  if (!goal) return jsonError("Goal not found", 404);
  if (user.role !== "OWNER" && user.role !== "ADMIN" && goal.createdById !== user.id) {
    return jsonError("Goal not found", 404);
  }

  const [messages, tasks] = await Promise.all([
    db.aiAgentMessage.findMany({
      where: { goalId: id },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, kind: true, fromAgentSlug: true, toAgentSlug: true, body: true, createdAt: true, taskId: true },
    }),
    db.aiTask.findMany({
      where: { goalId: id },
      orderBy: { createdAt: "asc" },
      take: 60,
      select: {
        id: true,
        objective: true,
        status: true,
        error: true,
        createdAt: true,
        assignedAgent: { select: { slug: true, name: true } },
      },
    }),
  ]);

  return NextResponse.json({ goal, messages, tasks }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can steer team goals", 403);
  const { id } = await context.params;

  const parsed = z
    .object({ action: z.enum(["advance", "pause", "resume", "cancel", "nudge"]) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Unknown action", 400);

  const goal = await db.aiGoal.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!goal) return jsonError("Goal not found", 404);

  const note = async (body: string) =>
    db.aiAgentMessage.create({ data: { goalId: goal.id, kind: "USER", body } });

  if (parsed.data.action === "pause") {
    await db.aiGoal.update({ where: { id }, data: { status: "PAUSED" } });
    await note("Paused by the owner. Nothing new will be assigned until it is resumed.");
    return NextResponse.json({ ok: true, status: "PAUSED" });
  }
  if (parsed.data.action === "cancel") {
    await db.aiGoal.update({ where: { id }, data: { status: "CANCELLED" } });
    await note("Cancelled by the owner.");
    return NextResponse.json({ ok: true, status: "CANCELLED" });
  }
  if (parsed.data.action === "resume") {
    await db.aiGoal.update({ where: { id }, data: { status: "ACTIVE", lastAdvancedAt: null } });
    await note("Resumed by the owner.");
    const result = await advanceGoal(id);
    return NextResponse.json({ ok: true, status: "ACTIVE", result });
  }

  // advance / nudge: run a round now, regardless of the quiet window.
  if (goal.status !== "ACTIVE") {
    await db.aiGoal.update({ where: { id }, data: { status: "ACTIVE" } });
  }
  const result = await advanceGoal(id, { force: parsed.data.action === "nudge" });
  return NextResponse.json({ ok: true, result });
}
