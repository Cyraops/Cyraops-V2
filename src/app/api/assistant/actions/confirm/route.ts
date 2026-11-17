import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { decidePendingAction } from "@/lib/ai/assistant/runtime";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const actionId = typeof body?.actionId === "string" ? body.actionId : "";
  const approve = Boolean(body?.approve);
  const alwaysAllow = Boolean(body?.alwaysAllow);

  if (!actionId) return jsonError("Action id is required", 400);

  try {
    const outcome = await decidePendingAction({
      actionId,
      userId: user.id,
      userRole: user.role,
      approve,
      alwaysAllow,
    });

    // If an action executed successfully, record a short assistant message so
    // the conversation shows what happened. Best-effort: the tool already ran,
    // so a note-write failure must never turn a success response into an error.
    if (approve && outcome.status === "EXECUTED") {
      try {
        const action = await db.assistantPendingAction.findFirst({ where: { id: actionId } });
        if (action?.conversationId) {
          const data = (outcome.result as any)?.data;
          const note = data?.message || `Ran ${outcome.toolName}.`;
          await db.assistantMessage.create({
            data: {
              assistantId: action.assistantId,
              conversationId: action.conversationId,
              role: "assistant",
              content: `✅ ${note}`,
            },
          });
        }
      } catch (noteErr) {
        console.warn("[API:assistant/actions/confirm] Could not write the result note:", noteErr);
      }
    }

    return NextResponse.json({ success: true, ...outcome });
  } catch (err: any) {
    console.error("[API:assistant/actions/confirm] Failed:", err);
    if (/not found|already decided/i.test(err?.message || "")) return jsonError(err.message, 404);
    return jsonError("Failed to process the action", 500);
  }
}
