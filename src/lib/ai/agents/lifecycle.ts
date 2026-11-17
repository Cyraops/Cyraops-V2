import { AiTaskStatus } from "@prisma/client";
import { db } from "@/lib/db";

const VALID_TRANSITIONS: Record<AiTaskStatus, AiTaskStatus[]> = {
  // A task can be created and need a decision before it does anything at all —
  // for example a teammate asking an agent to run something, which waits on an
  // owner. Requiring it to pass through PLANNING first would mean planning work
  // that may never be approved.
  CREATED: ["PLANNING", "READY", "RUNNING", "AWAITING_APPROVAL", "CANCELLED", "FAILED"],
  PLANNING: ["AWAITING_APPROVAL", "READY", "RUNNING", "FAILED", "CANCELLED"],
  AWAITING_APPROVAL: ["READY", "RUNNING", "CANCELLED", "FAILED"],
  READY: ["RUNNING", "PAUSED", "CANCELLED", "FAILED"],
  RUNNING: ["WAITING_FOR_AGENT", "WAITING_FOR_EXTERNAL_RESULT", "AWAITING_APPROVAL", "PAUSED", "RECOVERING", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING_FOR_AGENT: ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING_FOR_EXTERNAL_RESULT: ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["READY", "RUNNING", "RECOVERING", "CANCELLED"],
  RECOVERING: ["RUNNING", "PAUSED", "AWAITING_APPROVAL", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["READY", "PLANNING", "RECOVERING"], // Allow re-try / recovery
  CANCELLED: [],
};

export function canTransition(current: AiTaskStatus, next: AiTaskStatus): boolean {
  if (current === next) return true;
  const allowed = VALID_TRANSITIONS[current];
  return allowed ? allowed.includes(next) : false;
}

export async function transitionTaskStatus(
  taskId: string,
  newStatus: AiTaskStatus,
  metadata?: { error?: string; result?: string }
) {
  const task = await db.aiTask.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, startedAt: true },
  });

  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (!canTransition(task.status, newStatus)) {
    throw new Error(`Illegal state transition from ${task.status} to ${newStatus} for task ${taskId}`);
  }

  const data: any = {
    status: newStatus,
  };

  if (newStatus === "RUNNING" && !task.startedAt) {
    data.startedAt = new Date();
  } else if (newStatus === "COMPLETED" || newStatus === "FAILED" || newStatus === "CANCELLED") {
    data.completedAt = new Date();
  }

  if (metadata?.error !== undefined) data.error = metadata.error;
  if (metadata?.result !== undefined) data.result = metadata.result;

  return await db.aiTask.update({
    where: { id: taskId },
    data,
  });
}

export async function transitionStepStatus(
  stepId: string,
  newStatus: AiTaskStatus,
  metadata?: { error?: string; output?: string }
) {
  const step = await db.aiTaskStep.findUnique({
    where: { id: stepId },
    select: { id: true, status: true, startedAt: true },
  });

  if (!step) {
    throw new Error(`Step ${stepId} not found`);
  }

  if (!canTransition(step.status, newStatus)) {
    throw new Error(`Illegal step transition from ${step.status} to ${newStatus} for step ${stepId}`);
  }

  const data: any = {
    status: newStatus,
  };

  if (newStatus === "RUNNING" && !step.startedAt) {
    data.startedAt = new Date();
  } else if (newStatus === "COMPLETED" || newStatus === "FAILED" || newStatus === "CANCELLED") {
    data.completedAt = new Date();
  }

  if (metadata?.error !== undefined) data.error = metadata.error;
  if (metadata?.output !== undefined) data.output = metadata.output;

  return await db.aiTaskStep.update({
    where: { id: stepId },
    data,
  });
}
