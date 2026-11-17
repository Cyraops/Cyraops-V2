import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  mismatch?: boolean;
  inFlight?: boolean;
  cachedResponse?: any;
  cachedStatus?: number;
}

export const IDEMPOTENCY_LOCK_TTL_SECONDS = 30; // 30 seconds for in-flight operation
export const IDEMPOTENCY_RESPONSE_TTL_SECONDS = 86400; // 24 hours for completed response

export function hashPayload(payload: any): string {
  try {
    const canonical = JSON.stringify(payload ?? {});
    return createHash("sha256").update(canonical).digest("hex");
  } catch {
    return createHash("sha256").update(String(payload)).digest("hex");
  }
}

/**
 * Atomically reserves an idempotency key or returns cached/in-flight status.
 * State Lifecycle:
 *   - PENDING: Key is locked for processing by an active worker.
 *   - COMPLETED: Processing completed and response cached.
 *   - FAILED: Processing aborted/failed, allowing retry.
 */
export async function checkIdempotency(
  client: DbClient,
  options: {
    key: string;
    userId: string;
    endpoint: string;
    payload: any;
    lockTtlSeconds?: number;
  }
): Promise<IdempotencyCheckResult> {
  const { key, userId, endpoint, payload, lockTtlSeconds = IDEMPOTENCY_LOCK_TTL_SECONDS } = options;
  const scopedKey = `${userId}:${endpoint}:${key}`;
  const currentHash = hashPayload(payload);
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + lockTtlSeconds * 1000);

  // 1. Attempt atomic reservation via create (PENDING)
  try {
    await client.callIdempotencyKey.create({
      data: {
        key: scopedKey,
        userId,
        endpoint,
        payloadHash: currentHash,
        status: "PENDING",
        lockedAt: now,
        expiresAt: lockExpiresAt,
      },
    });
    // Successfully acquired reservation!
    return { isDuplicate: false };
  } catch (err: any) {
    // Unique constraint violation: Key already exists
    if (err?.code !== "P2002" && !String(err?.message).includes("unique constraint") && !String(err?.message).includes("PRIMARY KEY")) {
      throw err;
    }
  }

  // 2. Fetch existing reservation
  const existing = await client.callIdempotencyKey.findUnique({
    where: { key: scopedKey },
  });

  if (!existing) {
    // Retry once if race occurred
    try {
      await client.callIdempotencyKey.create({
        data: {
          key: scopedKey,
          userId,
          endpoint,
          payloadHash: currentHash,
          status: "PENDING",
          lockedAt: now,
          expiresAt: lockExpiresAt,
        },
      });
      return { isDuplicate: false };
    } catch {
      return { isDuplicate: true, inFlight: true };
    }
  }

  // 3. Payload mismatch check: Same key with different payload MUST return 422
  if (existing.payloadHash && existing.payloadHash !== currentHash) {
    return { isDuplicate: true, mismatch: true };
  }

  // 4. Completed response check
  if (existing.status === "COMPLETED" && existing.responseJson) {
    // If response expired past TTL:
    if (existing.expiresAt < now) {
      // Re-acquire reservation
      const reacquire = await client.callIdempotencyKey.updateMany({
        where: { key: scopedKey, expiresAt: { lt: now } },
        data: {
          status: "PENDING",
          payloadHash: currentHash,
          lockedAt: now,
          expiresAt: lockExpiresAt,
          responseJson: null,
          statusCode: null,
        },
      });
      if (reacquire.count > 0) {
        return { isDuplicate: false };
      }
    }

    let parsed: any;
    try {
      parsed = JSON.parse(existing.responseJson);
    } catch {
      parsed = existing.responseJson;
    }
    return {
      isDuplicate: true,
      mismatch: false,
      cachedResponse: parsed,
      cachedStatus: existing.statusCode ?? 200,
    };
  }

  // 5. In-flight (PENDING) check: handle process crash or abandoned reservation
  if (existing.status === "PENDING") {
    const isStale =
      !existing.lockedAt ||
      now.getTime() - existing.lockedAt.getTime() > lockTtlSeconds * 1000 ||
      existing.expiresAt < now;

    if (isStale) {
      // Previous worker crashed or abandoned reservation: take over atomically
      const takeover = await client.callIdempotencyKey.updateMany({
        where: {
          key: scopedKey,
          status: "PENDING",
          OR: [
            { lockedAt: null },
            { lockedAt: existing.lockedAt },
            { expiresAt: { lt: now } },
          ],
        },
        data: {
          status: "PENDING",
          payloadHash: currentHash,
          lockedAt: now,
          expiresAt: lockExpiresAt,
        },
      });

      if (takeover.count > 0) {
        return { isDuplicate: false };
      }
    }

    // Reservation is actively locked by concurrent request
    return { isDuplicate: true, inFlight: true };
  }

  // 6. If marked FAILED, allow re-acquisition
  if (existing.status === "FAILED") {
    const retry = await client.callIdempotencyKey.updateMany({
      where: { key: scopedKey, status: "FAILED" },
      data: {
        status: "PENDING",
        payloadHash: currentHash,
        lockedAt: now,
        expiresAt: lockExpiresAt,
      },
    });
    if (retry.count > 0) {
      return { isDuplicate: false };
    }
  }

  return { isDuplicate: true, inFlight: true };
}

/**
 * Stores the final completed response for an idempotency key.
 */
export async function saveIdempotencyResponse(
  client: DbClient,
  options: {
    key: string;
    userId: string;
    endpoint: string;
    payload: any;
    responseBody: any;
    statusCode: number;
    callSessionId?: string;
    ttlSeconds?: number;
  }
): Promise<void> {
  const {
    key,
    userId,
    endpoint,
    payload,
    responseBody,
    statusCode,
    callSessionId,
    ttlSeconds = IDEMPOTENCY_RESPONSE_TTL_SECONDS,
  } = options;
  const scopedKey = `${userId}:${endpoint}:${key}`;
  const payloadHash = hashPayload(payload);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const responseJson = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);

  await client.callIdempotencyKey.upsert({
    where: { key: scopedKey },
    create: {
      key: scopedKey,
      userId,
      endpoint,
      payloadHash,
      status: "COMPLETED",
      callSessionId,
      responseJson,
      statusCode,
      expiresAt,
    },
    update: {
      status: "COMPLETED",
      responseJson,
      statusCode,
      callSessionId,
      expiresAt,
    },
  });
}

/**
 * Releases or marks an idempotency reservation as failed if an unhandled error occurred.
 */
export async function releaseIdempotencyReservation(
  client: DbClient,
  options: {
    key: string;
    userId: string;
    endpoint: string;
  }
): Promise<void> {
  const { key, userId, endpoint } = options;
  const scopedKey = `${userId}:${endpoint}:${key}`;
  await client.callIdempotencyKey.deleteMany({
    where: { key: scopedKey, status: "PENDING" },
  }).catch(() => {});
}

/**
 * Sweeps expired idempotency keys from the database.
 */
export async function sweepExpiredIdempotencyKeys(client: DbClient): Promise<number> {
  const result = await client.callIdempotencyKey.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}
