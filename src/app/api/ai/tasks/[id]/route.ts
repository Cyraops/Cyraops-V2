import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { taskRunner } from "@/lib/ai/automation/task-runner";
import { transitionTaskStatus } from "@/lib/ai/agents/lifecycle";
import { canOperateAiTask, canViewAiTask } from "@/lib/ai/access";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await context.params;

  const task = await db.aiTask.findUnique({
    where: { id },
    include: {
      assignedAgent: true,
      requestingUser: { select: { id: true, name: true, role: true } },
      steps: {
        orderBy: { stepIndex: "asc" },
        include: { toolCalls: true },
      },
      approvals: true,
      toolCalls: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!task) return jsonError("Task not found", 404);
  if (!canViewAiTask(user, task)) {
    return jsonError("You do not have access to this agent task", 403);
  }
  return NextResponse.json({ task });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  try {
    // Ownership check before any state change: Members may only operate the
    // agent tasks they requested themselves.
    const existing = await db.aiTask.findUnique({
      where: { id },
      select: { id: true, requestingUserId: true },
    });
    if (!existing) return jsonError("Task not found", 404);
    if (!canOperateAiTask(user, existing)) {
      return jsonError("You do not have access to this agent task", 403);
    }

    if (action === "retry") {
      const task = await taskRunner.retryTask(id, user.id);
      return NextResponse.json({ success: true, task });
    }

    if (action === "resume") {
      const task = await taskRunner.resumeTask(id, user.id);
      return NextResponse.json({ success: true, task });
    }

    if (action === "pause") {
      const task = await transitionTaskStatus(id, "PAUSED", {
        result: `Paused by ${user.name}`,
      });
      return NextResponse.json({ success: true, task });
    }

    if (action === "cancel") {
      const task = await transitionTaskStatus(id, "CANCELLED", {
        result: `Cancelled by ${user.name}`,
      });
      return NextResponse.json({ success: true, task });
    }

    return jsonError("Invalid action", 400);
  } catch (err: any) {
    return jsonError(err?.message || "Task action failed", 500);
  }
}

