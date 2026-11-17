import { db } from "@/lib/db";
import { transitionTaskStatus } from "../agents/lifecycle";

export async function triggerEmergencyStop(userId: string, reason: string = "Emergency stop initiated by administrator") {
  // Find all tasks that are currently RUNNING, PLANNING, or WAITING_FOR_AGENT
  const activeTasks = await db.aiTask.findMany({
    where: {
      status: { in: ["RUNNING", "PLANNING", "WAITING_FOR_AGENT"] },
    },
  });

  const stoppedTaskIds: string[] = [];

  for (const task of activeTasks) {
    try {
      await transitionTaskStatus(task.id, "PAUSED", {
        result: `PAUSED BY EMERGENCY STOP: ${reason}`,
      });
      stoppedTaskIds.push(task.id);
    } catch (e) {
      console.error(`[EmergencyStop] Failed to pause task ${task.id}:`, e);
    }
  }

  // Audit log the emergency stop
  await db.aiAuditLog.create({
    data: {
      eventType: "EMERGENCY_STOP",
      entity: "AiTask",
      actorId: userId,
      actorType: "USER",
      action: "EMERGENCY_STOP_ALL",
      details: JSON.stringify({ reason, stoppedTaskIds, count: stoppedTaskIds.length }),
    },
  });

  return {
    success: true,
    pausedCount: stoppedTaskIds.length,
    stoppedTaskIds,
  };
}

export async function getSystemSafetyStatus() {
  const activeCount = await db.aiTask.count({
    where: { status: { in: ["RUNNING", "PLANNING"] } },
  });
  const pendingApprovalsCount = await db.aiApproval.count({
    where: { status: "PENDING" },
  });

  return {
    activeTasks: activeCount,
    pendingApprovals: pendingApprovalsCount,
    status: activeCount > 20 ? "HIGH_LOAD" : "NORMAL",
  };
}

