import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Triggers that are not the clock.
 *
 * A routine used to be a cron string and nothing else, so the assistant could
 * only ever act on a schedule. These are the three events a CRM actually cares
 * about: a webhook from a form, an email landing from a client, and a record
 * changing stage. All of them enqueue a RoutineRun, so they go through exactly
 * the same durable, leased, retryable path as scheduled work.
 */

export type TriggerType = "SCHEDULE" | "WEBHOOK" | "EMAIL" | "RECORD_CHANGE";

export function newWebhookToken(): string {
  return randomUUID().replace(/-/g, "");
}

/** Enqueues one run for a routine, de-duplicated per occurrence. */
export async function enqueueTriggeredRun(routineId: string, reason: string): Promise<boolean> {
  const routine = await db.aiRoutine.findUnique({
    where: { id: routineId },
    select: { id: true, isEnabled: true },
  });
  if (!routine || !routine.isEnabled) return false;

  // Bucket to the minute so a burst of webhook retries cannot multiply the run.
  const scheduledFor = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  try {
    await db.routineRun.create({ data: { routineId, scheduledFor } });
    console.log(`[Routines] Triggered "${routineId}" by ${reason}.`);
    return true;
  } catch (error: any) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return false;
    throw error;
  }
}

/** Webhook entry point: token in, run queued. */
export async function triggerByWebhookToken(token: string): Promise<{ ok: boolean; routineId?: string }> {
  if (!token || token.length < 16) return { ok: false };
  const routine = await db.aiRoutine.findUnique({
    where: { webhookToken: token },
    select: { id: true, triggerType: true, isEnabled: true },
  });
  if (!routine || !routine.isEnabled || routine.triggerType !== "WEBHOOK") return { ok: false };
  const queued = await enqueueTriggeredRun(routine.id, "a webhook");
  return { ok: true, routineId: routine.id, ...(queued ? {} : {}) };
}

/**
 * Called from the mailbox sync when a new message arrives. Only routines that
 * watch this sender fire, and the match is by exact address, never a substring
 * of the whole header — an attacker must not be able to trigger work by putting
 * a client's address in a display name.
 */
export async function triggerOnEmail(params: { fromAddress: string }): Promise<number> {
  const from = String(params.fromAddress ?? "").trim().toLowerCase();
  if (!from) return 0;

  const routines = await db.aiRoutine.findMany({
    where: { isEnabled: true, triggerType: "EMAIL", emailSenders: { not: "" } },
    select: { id: true, emailSenders: true },
  });

  let fired = 0;
  for (const routine of routines) {
    const senders = routine.emailSenders
      .split(/[\s,;]+/)
      .map((sender) => sender.trim().toLowerCase())
      .filter(Boolean);
    if (!senders.includes(from)) continue;
    if (await enqueueTriggeredRun(routine.id, `an email from ${from}`)) fired += 1;
  }
  return fired;
}

/**
 * Watches one field of one record type. Fires only when something actually
 * changed since the last look.
 *
 * The previous design compared a single scalar (the most recently updated
 * record), so a change between sweeps was silently lost and a value that
 * changed twice could cancel itself out. This version remembers a high-water
 * timestamp and counts anything newer than it.
 */
export const WATCHABLE: Record<string, readonly string[]> = {
  Deal: ["stage", "updatedAt"],
  Lead: ["status", "updatedAt"],
};

export function isWatchable(model: string, field: string): boolean {
  const fields = WATCHABLE[model];
  return Boolean(fields && fields.includes(field));
}

/** Counts records whose `updatedAt` is newer than the stored high-water mark. */
async function changedSince(model: string, since: Date): Promise<{ count: number; max: Date }> {
  if (model === "Deal") {
    const [count, newest] = await Promise.all([
      db.deal.count({ where: { updatedAt: { gt: since } } }),
      db.deal.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    ]);
    return { count, max: newest?.updatedAt ?? since };
  }
  if (model === "Lead") {
    const [count, newest] = await Promise.all([
      db.lead.count({ where: { updatedAt: { gt: since } } }),
      db.lead.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    ]);
    return { count, max: newest?.updatedAt ?? since };
  }
  return { count: 0, max: since };
}

export async function sweepRecordChangeWatchers(): Promise<number> {
  const routines = await db.aiRoutine.findMany({
    where: { isEnabled: true, triggerType: "RECORD_CHANGE", watchModel: { not: null }, watchField: { not: null } },
    select: { id: true, watchModel: true, watchField: true, watchValue: true },
  });

  let fired = 0;
  for (const routine of routines) {
    const model = routine.watchModel!;
    const field = routine.watchField!;
    if (!isWatchable(model, field)) continue;

    const since = routine.watchValue ? new Date(routine.watchValue) : new Date(0);
    const { count, max } = await changedSince(model, since);

    // First observation only records the baseline, so enabling a watcher does
    // not immediately fire on every record in the database.
    if (routine.watchValue === null) {
      await db.aiRoutine.update({ where: { id: routine.id }, data: { watchValue: max.toISOString() } });
      continue;
    }
    if (count === 0) continue;

    // Enqueue first, then advance the baseline: if the insert fails (the minute
    // bucket is already taken), the next sweep re-fires rather than silently
    // losing a change the baseline already consumed.
    const queued = await enqueueTriggeredRun(routine.id, `${model}.${field} changed (${count} records)`);
    if (queued) {
      await db.aiRoutine.update({ where: { id: routine.id }, data: { watchValue: max.toISOString() } });
      fired += 1;
    }
  }
  return fired;
}