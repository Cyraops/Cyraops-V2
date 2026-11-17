import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { createAndDispatchTask } from "@/lib/ai/orchestrator/dispatcher";

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const body = await request.json().catch(() => ({}));
    const { objective, prompt, agentSlug, priority, idempotencyKey } = body;

    if (!objective || typeof objective !== "string" || !objective.trim()) {
      return jsonError("Objective is required", 400);
    }

    const task = await createAndDispatchTask({
      objective: objective.trim(),
      prompt: (prompt || objective).trim(),
      requestingUserId: user.id,
      requestingUserRole: user.role,
      assignedAgentSlug: agentSlug,
      priority,
      idempotencyKey,
    });

    return NextResponse.json({ success: true, task }, { status: 201 });
  } catch (error: any) {
    console.error("[API:ai/dispatch] Error:", error);
    return jsonError(error?.message || "Failed to dispatch task", 500);
  }
}
