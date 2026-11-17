import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { approvalBroker } from "@/lib/harness/approval-broker";

/**
 * The decision endpoint for harness approvals (TASK 1: approval mapping).
 *
 * A harness turn that needs approval streams a `{ type: "approval",
 * approvalId, summary, toolName }` payload over the bot-chat SSE and then
 * waits (the runtime's answerer waterfall holds the turn open — the harness
 * supports callback approval natively). This route resolves the pending
 * decision: `approve: true` grants exactly one run ("allowed-once"), false
 * rejects it. The turn then completes on the same SSE connection.
 *
 * The body mirrors the V1 confirm flow's decision intent ({ approve }),
 * keyed by the approvalId the SSE announced.
 */

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const approvalId = typeof body?.approvalId === "string" ? body.approvalId : "";
  const approve = Boolean(body?.approve);

  if (!approvalId) return jsonError("Approval id is required", 400);

  try {
    const outcome = approvalBroker().decide(approvalId, approve);
    return NextResponse.json({ success: true, approvalId, outcome });
  } catch (error) {
    console.error("[API:harness/approve] Failed:", error);
    if (/not found|already decided/i.test(String((error as { message?: string })?.message ?? ""))) {
      return jsonError("Approval request not found or already decided", 404);
    }
    return jsonError("Failed to process the approval", 500);
  }
}
