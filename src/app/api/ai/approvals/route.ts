import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/validators";
import { listPendingApprovals, reviewApproval } from "@/lib/ai/orchestrator/approval";
import { taskRunner } from "@/lib/ai/automation/task-runner";
import { dispatchApprovedDelegation } from "@/lib/tasks/delegate";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can view organization-wide agent approvals", 403);

  const approvals = await listPendingApprovals();
  return NextResponse.json({ approvals });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can approve agent actions", 403);

  const body = await request.json().catch(() => ({}));
  const { approvalId, action, reviewNotes } = body;

  if (!approvalId || !["APPROVED", "REJECTED"].includes(action)) {
    return jsonError("Valid approvalId and action ('APPROVED' or 'REJECTED') are required", 400);
  }

  try {
    const updated = await reviewApproval(approvalId, user.id, action, reviewNotes);

    // A teammate's request to hand work to an agent is not a paused plan, so it
    // cannot be "resumed": approving it is what dispatches the run, with the
    // requester's identity so the work stays attributed to them.
    let payload: any = {};
    try {
      payload = updated.payload ? JSON.parse(updated.payload) : {};
    } catch {
      payload = {};
    }

    if (action === "APPROVED" && payload?.kind === "agent_delegation") {
      const dispatched = await dispatchApprovedDelegation({
        approvalId: updated.id,
        requestTaskId: updated.taskId,
        payload,
        requestedById: updated.requestedById,
      });
      if (updated.requestedById && updated.requestedById !== user.id) {
        await db.notification.create({
          data: {
            userId: updated.requestedById,
            type: "SYSTEM",
            title: "Your request was approved and is running",
            body: payload.objective ? String(payload.objective).slice(0, 180) : "The agent is working on it now.",
            href: "/ai/team",
          },
        });
      }
      return NextResponse.json({ success: true, approval: updated, dispatched });
    }

    const task = action === "APPROVED"
      ? await taskRunner.resumeTask(updated.taskId, user.id)
      : undefined;
    return NextResponse.json({ success: true, approval: updated, task });
  } catch (err: any) {
    return jsonError(err?.message || "Failed to process approval", 500);
  }
}

