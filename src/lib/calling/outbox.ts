import { db } from "@/lib/db";
import { PrismaClient, Prisma, OutboxJobStatus, CallSfuEjectionJob } from "@prisma/client";
import { removeLiveKitParticipant } from "./livekit-room";
import { isLiveKitConfigured } from "./config";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface QueueSfuEjectionParams {
  callSessionId: string;
  roomName: string;
  userId: string;
  maxAttempts?: number;
}

export interface SfuEjectionExecutorOptions {
  dbClient?: DbClient;
  roomClient?: {
    removeParticipant: (roomName: string, identity: string) => Promise<any>;
  };
  backoffBaseMs?: number;
}

export interface OutboxSweepOptions extends SfuEjectionExecutorOptions {
  limit?: number;
  crashTimeoutMs?: number;
}

/**
 * Checks whether an error from the SFU indicates the participant or room is absent.
 */
export function isNotFoundError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const status = err.status || err.statusCode || err.code;
  return (
    status === 404 ||
    msg.includes("not found") ||
    msg.includes("could not find") ||
    msg.includes("does not exist") ||
    msg.includes("participant_not_found") ||
    msg.includes("room_not_found")
  );
}

/**
 * Calculates bounded exponential backoff delay in milliseconds.
 * Sequence with baseMs=1000: 1000ms, 2000ms, 4000ms, 8000ms, 16000ms (capped at 30000ms).
 */
export function calculateBackoffMs(attempts: number, baseMs: number = 1000): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(baseMs * Math.pow(2, exponent), 30000);
}

/**
 * Queues an SFU participant ejection job within a database transaction.
 * Pure database operation: strictly NO external network calls are performed inside the transaction.
 */
export async function queueSfuEjection(
  client: DbClient,
  params: QueueSfuEjectionParams
): Promise<CallSfuEjectionJob> {
  const { callSessionId, roomName, userId, maxAttempts = 5 } = params;

  // Deduplicate: check if an active (PENDING or PROCESSING) job already exists
  const existing = await client.callSfuEjectionJob.findFirst({
    where: {
      callSessionId,
      userId,
      status: { in: [OutboxJobStatus.PENDING, OutboxJobStatus.PROCESSING] },
    },
  });

  if (existing) {
    return existing;
  }

  return await client.callSfuEjectionJob.create({
    data: {
      callSessionId,
      roomName,
      userId,
      status: OutboxJobStatus.PENDING,
      attempts: 0,
      maxAttempts,
      nextRetryAt: new Date(),
    },
  });
}

let testRoomClient: { removeParticipant: (roomName: string, identity: string) => Promise<any> } | null = null;

/**
 * Registers an SFU room client mock for automated testing and simulation.
 */
export function setGlobalSfuClientForTesting(
  client: { removeParticipant: (roomName: string, identity: string) => Promise<any> } | null
) {
  testRoomClient = client;
}

/**
 * Recovers orphaned jobs left stuck in PROCESSING state due to server crashes or restarts.
 */
export async function recoverStuckOutboxJobs(
  client: DbClient = db,
  crashTimeoutMs: number = 60000
): Promise<number> {
  const staleThreshold = new Date(Date.now() - crashTimeoutMs);
  const result = await client.callSfuEjectionJob.updateMany({
    where: {
      status: OutboxJobStatus.PROCESSING,
      updatedAt: { lt: staleThreshold },
    },
    data: {
      status: OutboxJobStatus.PENDING,
      nextRetryAt: new Date(),
    },
  });
  return result.count;
}

/**
 * Executes a single ejection job against LiveKit SFU.
 * Idempotent: 'participant not found' or 'room not found' is treated as success.
 */
export async function executeSfuEjectionJob(
  jobId: string,
  options?: SfuEjectionExecutorOptions
): Promise<{ success: boolean; job: CallSfuEjectionJob | null; error?: string }> {
  const client = options?.dbClient || db;
  const baseMs = options?.backoffBaseMs ?? 1000;

  const job = await client.callSfuEjectionJob.findUnique({ where: { id: jobId } });
  if (!job) return { success: false, job: null, error: "Job not found" };

  if (job.status === OutboxJobStatus.COMPLETED) {
    return { success: true, job };
  }
  if (job.status === OutboxJobStatus.FAILED) {
    return { success: false, job, error: job.lastError || "Job already failed" };
  }

  // Atomically claim the job to prevent duplicate concurrent execution
  const claimResult = await client.callSfuEjectionJob.updateMany({
    where: {
      id: jobId,
      status: OutboxJobStatus.PENDING,
    },
    data: { status: OutboxJobStatus.PROCESSING },
  });

  if (claimResult.count === 0) {
    const current = await client.callSfuEjectionJob.findUnique({ where: { id: jobId } });
    if (current?.status === OutboxJobStatus.COMPLETED) {
      return { success: true, job: current };
    }
    return { success: false, job: current, error: "Job already claimed by another worker" };
  }

  const claimed = job;

  try {
    const activeRoomClient = options?.roomClient || testRoomClient;
    if (activeRoomClient) {
      await activeRoomClient.removeParticipant(claimed.roomName, claimed.userId);
    } else {
      if (!isLiveKitConfigured()) {
        console.warn(`[SFU Outbox] LiveKit not configured; completing ejection job for ${claimed.userId}`);
      } else {
        await removeLiveKitParticipant(claimed.roomName, claimed.userId);
      }
    }

    // Success -> Mark COMPLETED
    const updated = await client.callSfuEjectionJob.update({
      where: { id: jobId },
      data: {
        status: OutboxJobStatus.COMPLETED,
        completedAt: new Date(),
        lastError: null,
      },
    });
    return { success: true, job: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      // Participant already gone or room closed: idempotent success
      const updated = await client.callSfuEjectionJob.update({
        where: { id: jobId },
        data: {
          status: OutboxJobStatus.COMPLETED,
          completedAt: new Date(),
          lastError: null,
        },
      });
      return { success: true, job: updated };
    }

    // Transient failure: increment attempts and schedule retry with exponential backoff
    const nextAttempts = claimed.attempts + 1;
    const isExhausted = nextAttempts >= claimed.maxAttempts;
    const errMessage = err?.message || String(err);
    const delay = calculateBackoffMs(nextAttempts, baseMs);
    const nextRetryAt = new Date(Date.now() + delay);

    const updated = await client.callSfuEjectionJob.update({
      where: { id: jobId },
      data: {
        status: isExhausted ? OutboxJobStatus.FAILED : OutboxJobStatus.PENDING,
        attempts: nextAttempts,
        lastError: errMessage,
        nextRetryAt,
      },
    });

    return { success: false, job: updated, error: errMessage };
  }
}

/**
 * Sweeps and processes pending SFU ejection jobs whose nextRetryAt has arrived.
 */
export async function processPendingSfuEjectionJobs(
  options?: OutboxSweepOptions
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const client = options?.dbClient || db;
  const limit = options?.limit ?? 50;

  // 1. Recover any stuck jobs
  await recoverStuckOutboxJobs(client, options?.crashTimeoutMs ?? 60000);

  // 2. Fetch pending jobs ready for processing
  const now = new Date();
  const pendingJobs = await client.callSfuEjectionJob.findMany({
    where: {
      status: OutboxJobStatus.PENDING,
      nextRetryAt: { lte: now },
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  let succeeded = 0;
  let failed = 0;

  for (const job of pendingJobs) {
    const res = await executeSfuEjectionJob(job.id, options);
    if (res.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return { processed: pendingJobs.length, succeeded, failed };
}

/**
 * Immediate post-commit trigger: processes the specified jobs right away.
 * Safe to call from route handlers outside the database transaction.
 */
export async function triggerImmediateSfuEjection(
  jobIds: string[],
  options?: SfuEjectionExecutorOptions
): Promise<void> {
  if (!jobIds || jobIds.length === 0) return;
  await Promise.all(
    jobIds.map(async (id) => {
      try {
        await executeSfuEjectionJob(id, options);
      } catch (err) {
        console.warn(`[SFU Outbox] Post-commit immediate ejection notice for job ${id}:`, err);
      }
    })
  );
}

/**
 * Retrieves failed SFU ejection jobs for administrative visibility and alerting.
 */
export async function getFailedOutboxJobs(
  client: DbClient = db,
  limit: number = 50
): Promise<CallSfuEjectionJob[]> {
  return client.callSfuEjectionJob.findMany({
    where: { status: OutboxJobStatus.FAILED },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

/**
 * Resets failed SFU ejection jobs back to PENDING and triggers immediate reprocessing.
 * Used by administrative maintenance tasks after LiveKit connectivity is restored.
 */
export async function retryFailedOutboxJobs(
  client: DbClient = db,
  jobIds?: string[]
): Promise<{ resetCount: number; processed: number; succeeded: number; failed: number }> {
  const whereClause: Prisma.CallSfuEjectionJobWhereInput = {
    status: OutboxJobStatus.FAILED,
    ...(jobIds && jobIds.length > 0 ? { id: { in: jobIds } } : {}),
  };

  const resetResult = await client.callSfuEjectionJob.updateMany({
    where: whereClause,
    data: {
      status: OutboxJobStatus.PENDING,
      attempts: 0,
      nextRetryAt: new Date(),
      lastError: null,
    },
  });

  const sweep = await processPendingSfuEjectionJobs({ dbClient: client });
  return {
    resetCount: resetResult.count,
    processed: sweep.processed,
    succeeded: sweep.succeeded,
    failed: sweep.failed,
  };
}
