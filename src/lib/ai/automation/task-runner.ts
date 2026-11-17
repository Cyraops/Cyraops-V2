import { db } from "@/lib/db";
import { executeTaskSteps } from "../orchestrator/dispatcher";
import { transitionTaskStatus } from "../agents/lifecycle";

export class TaskRunner {
  /**
   * Startup recovery sweep:
   * Inspects non-terminal tasks to detect unheartbeated or orphaned executions
   * following server restarts or process interruptions.
   */
  public async recoverOrphanedTasks(): Promise<number> {
    try {
      const now = new Date();
      // Scan for non-terminal tasks
      const activeTasks = await db.aiTask.findMany({
        where: {
          status: { in: ["RUNNING", "PLANNING", "RECOVERING"] },
        },
        include: {
          steps: { orderBy: { stepIndex: "asc" } },
        },
      });

      let recovered = 0;

      for (const task of activeTasks) {
        const isLeaseExpired = !task.leaseExpiresAt || task.leaseExpiresAt < now;
        const isHeartbeatStale = !task.lastHeartbeat || (now.getTime() - task.lastHeartbeat.getTime()) > 30000;

        // An active task whose lease expired or heartbeat ceased is considered orphaned
        if (isLeaseExpired || isHeartbeatStale) {
          if (task.retryCount < task.maxRetries) {
            const currentStep = task.steps.find((s) => s.stepIndex === task.currentStepIndex) || task.steps[0];
            const recoveryMetadata = JSON.stringify({
              recoveredAt: now.toISOString(),
              previousStatus: task.status,
              previousWorkerId: task.workerId,
              resumedStepIndex: task.currentStepIndex || 1,
              resumedStepTitle: currentStep?.title || "Pending Step",
              reason: "Durable recovery after server restart / worker lease expiration",
            });

            console.log(
              `[TaskRecovery] Resuming orphaned task "${task.id}" (${task.objective}) from step ${task.currentStepIndex || 1}`
            );

            await db.aiTask.update({
              where: { id: task.id },
              data: {
                status: "RECOVERING",
                retryCount: task.retryCount + 1,
                workerId: null,
                leaseExpiresAt: null,
                recoveryMetadata,
              },
            });

            // Resume task execution in background
            executeTaskSteps(task.id, task.requestingUserId).catch((resumeErr) => {
              console.error(`[TaskRecovery] Failed resuming task "${task.id}":`, resumeErr);
            });

            recovered++;
          } else {
            console.warn(`[TaskRecovery] Task "${task.id}" exceeded max retries during recovery.`);
            await transitionTaskStatus(task.id, "FAILED", {
              error: "Exceeded max retries during durable recovery after server restart.",
            });
          }
        }
      }

      return recovered;
    } catch (err) {
      console.error("[TaskRunner] Task recovery sweep failed:", err);
      return 0;
    }
  }

  /**
   * Records who resumed/retried a task that they may not have requested
   * themselves (for example an Owner resuming after an approval decision).
   */
  private async recordActorEvent(
    taskId: string,
    eventType: "TASK_RESUMED" | "TASK_RETRIED",
    actorId: string,
    requestingUserId: string
  ): Promise<void> {
    try {
      await db.aiAuditLog.create({
        data: {
          eventType,
          entity: "AiTask",
          entityId: taskId,
          actorId,
          actorType: "USER",
          action: eventType,
          details: JSON.stringify({ actorId, originalRequester: requestingUserId }),
        },
      });
    } catch (err) {
      console.error(`[TaskRunner] Failed to record ${eventType} audit event:`, err);
    }
  }

  public async resumeTask(taskId: string, userId: string) {
    const task = await db.aiTask.findUnique({
      where: { id: taskId },
    });

    if (!task) throw new Error("Task not found");
    if (task.status !== "READY" && task.status !== "PAUSED" && task.status !== "RECOVERING") {
      throw new Error(`Cannot resume task in ${task.status} status`);
    }

    await transitionTaskStatus(taskId, "RUNNING");
    await this.recordActorEvent(taskId, "TASK_RESUMED", userId, task.requestingUserId);

    // Execution keeps the original requester's identity so tool calls, audit
    // rows and any records the agent creates stay attributed correctly.
    return await executeTaskSteps(taskId, task.requestingUserId);
  }

  public async retryTask(taskId: string, userId: string) {
    const task = await db.aiTask.findUnique({
      where: { id: taskId },
    });

    if (!task) throw new Error("Task not found");
    if (task.status !== "FAILED") {
      throw new Error("Only failed tasks can be retried");
    }

    // Failed steps must be re-armed before execution: the step state machine
    // does not allow FAILED -> RUNNING directly.
    await db.aiTaskStep.updateMany({
      where: { taskId, status: "FAILED" },
      data: { status: "READY", error: null, completedAt: null },
    });

    await db.aiTask.update({
      where: { id: taskId },
      data: { retryCount: task.retryCount + 1, error: null },
    });

    await transitionTaskStatus(taskId, "READY");
    await transitionTaskStatus(taskId, "RUNNING");
    await this.recordActorEvent(taskId, "TASK_RETRIED", userId, task.requestingUserId);

    return await executeTaskSteps(taskId, task.requestingUserId);
  }
}

export const taskRunner = new TaskRunner();
