import { db } from "@/lib/db";
import { RiskClass } from "@prisma/client";
import { transitionTaskStatus } from "../agents/lifecycle";

export interface CreateApprovalParams {
  taskId: string;
  stepId?: string;
  stepIndex?: number;
  proposedAction: string;
  riskClass?: RiskClass;
  description: string;
  payload?: any;
  requestedById: string;
  expiresHours?: number;
}

export async function createApprovalRequest(params: CreateApprovalParams) {
  const expiresAt = params.expiresHours
    ? new Date(Date.now() + params.expiresHours * 3600 * 1000)
    : new Date(Date.now() + 48 * 3600 * 1000); // 48 hours default

  const approval = await db.aiApproval.create({
    data: {
      taskId: params.taskId,
      stepIndex: params.stepIndex,
      proposedAction: params.proposedAction,
      riskClass: params.riskClass || "CLASS_B",
      description: params.description,
      payload: JSON.stringify(params.payload || {}),
      status: "PENDING",
      requestedById: params.requestedById,
      expiresAt,
    },
  });

  // Pause task and step
  await transitionTaskStatus(params.taskId, "AWAITING_APPROVAL");
  if (params.stepId) {
    await db.aiTaskStep.update({
      where: { id: params.stepId },
      data: {
        status: "AWAITING_APPROVAL",
        requiresApproval: true,
        approvalId: approval.id,
      },
    });
  }

  return approval;
}

export async function reviewApproval(
  approvalId: string,
  reviewerId: string,
  action: "APPROVED" | "REJECTED",
  reviewNotes?: string
) {
  const approval = await db.aiApproval.findUnique({
    where: { id: approvalId },
    include: { task: true },
  });

  if (!approval) throw new Error("Approval request not found");
  if (approval.status !== "PENDING") {
    throw new Error(`Approval is already in ${approval.status} status`);
  }
  if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
    throw new Error(
      "This approval request has expired. Re-run the task to generate a fresh approval request."
    );
  }

  const updatedApproval = await db.aiApproval.update({
    where: { id: approvalId },
    data: {
      status: action,
      reviewedById: reviewerId,
      reviewNotes: reviewNotes || null,
      updatedAt: new Date(),
    },
  });

  // Audit log. `action` is not a column on AiAuditLog, so the decision goes in
  // details — passing it as a field made every approval throw *after* the status
  // was already updated, which is the worst possible failure: the reviewer saw an
  // error while the task stayed parked forever.
  await db.aiAuditLog.create({
    data: {
      eventType: "APPROVAL_DECISION",
      entity: "AiApproval",
      entityId: approval.id,
      actorId: reviewerId,
      actorType: "USER",
      details: JSON.stringify({ action, reviewNotes, taskId: approval.taskId }),
    },
  });

  if (action === "APPROVED") {
    // Make the approved step runnable before the API route resumes the task.
    if (approval.stepIndex !== null) {
      await db.aiTaskStep.updateMany({
        where: { taskId: approval.taskId, stepIndex: approval.stepIndex, status: "AWAITING_APPROVAL" },
        data: { status: "READY" },
      });
    }
    await transitionTaskStatus(approval.taskId, "READY");
  } else {
    // Rejected: mark task cancelled or failed
    if (approval.stepIndex !== null) {
      await db.aiTaskStep.updateMany({
        where: { taskId: approval.taskId, stepIndex: approval.stepIndex, status: "AWAITING_APPROVAL" },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
    }
    await transitionTaskStatus(approval.taskId, "CANCELLED", {
      result: `Rejected by reviewer: ${reviewNotes || "No review reason provided."}`,
    });
  }

  return updatedApproval;
}

export async function listPendingApprovals() {
  return await db.aiApproval.findMany({
    where: {
      status: "PENDING",
      // Expired requests can no longer be decided, so they are not actionable.
      expiresAt: { gt: new Date() },
    },
    include: {
      task: {
        include: {
          assignedAgent: true,
          requestingUser: { select: { id: true, name: true, role: true, avatarUrl: true } },
        },
      },
      requestedBy: { select: { id: true, name: true, role: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

