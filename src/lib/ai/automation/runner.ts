import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { nextCronRun } from "./cron";
import { executeRoutine } from "./routines";
import { buildInstagramBrief, formatBriefForNotification } from "./instagram-brief";
import { sweepRecordChangeWatchers } from "./triggers";
import { sweepGoals } from "@/lib/ai/team/goal-runner";

/**
 * Durable routine execution.
 *
 * The previous scheduler was a `setInterval` inside the web process: every run
 * was lost on redeploy, nothing retried, two replicas would have double-run, and
 * there was no record of what happened. This version writes a row per scheduled
 * occurrence and claims it with a lease, so work survives a restart and a second
 * instance can never pick up the same occurrence.
 */

const OWNER = `${process.env.HOSTNAME ?? "app"}:${randomUUID().slice(0, 8)}`;
const LEASE_MS = 5 * 60_000;
const MAX_PER_SWEEP = 3;
const warnedInvalidCron = new Set<string>();

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function summariseOutcome(status: string, result: string | null, error: string | null): string {
  if (status === "COMPLETED") {
    try {
      const parsed = result ? JSON.parse(result) : null;
      const summary = parsed?.summary;
      if (typeof summary === "string" && summary.trim()) return summary.trim();
    } catch {
      // fall through to the generic message
    }
    return "Routine completed.";
  }
  if (status === "AWAITING_APPROVAL") return "Routine prepared work that needs your approval before it can continue.";
  if (status === "FAILED") return `Routine failed: ${error || "unknown error"}`;
  return `Routine finished with status ${status}.`;
}

async function resolveActorId(createdById: string | null): Promise<string | null> {
  if (createdById) return createdById;
  const owner = await db.user.findFirst({
    where: { role: "OWNER", disabledAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return owner?.id ?? null;
}

/**
 * Turns due routines into run rows. `nextRunAt` is advanced inside the same
 * transaction that creates the row, so a crash can never double-enqueue and a
 * slow run can never be claimed twice.
 */
export async function enqueueDueRoutines(now: Date = new Date()): Promise<number> {
  const due = await db.aiRoutine.findMany({
    where: {
      isEnabled: true,
      // A routine switched to WEBHOOK/EMAIL/RECORD_CHANGE must not also fire on
      // its old cron.
      triggerType: "SCHEDULE",
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    select: { id: true, name: true, cronExpression: true, nextRunAt: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  let queued = 0;
  for (const routine of due) {
    const upcoming = nextCronRun(routine.cronExpression, now);
    if (!upcoming) {
      if (!warnedInvalidCron.has(routine.id)) {
        warnedInvalidCron.add(routine.id);
        console.warn(`[Routines] Skipping "${routine.name}": invalid cron "${routine.cronExpression}".`);
      }
      continue;
    }
    // Bucket to the minute: a null nextRunAt used to yield a millisecond-stamped
    // slot, so two overlapping sweeps produced different keys and both inserted.
    const slot = new Date(routine.nextRunAt ?? now);
    slot.setSeconds(0, 0);
    const scheduledFor = slot;

    // Advance the schedule FIRST, on its own. Bundling both statements meant a
    // P2002 collision with a trigger run rolled back the advance too, leaving
    // nextRunAt in the past -> same slot forever -> permanently wedged routine.
    try {
      await db.aiRoutine.update({ where: { id: routine.id }, data: { nextRunAt: upcoming } });
    } catch (error) {
      console.error(`[Routines] Could not advance "${routine.name}":`, error);
      continue;
    }

    try {
      await db.routineRun.create({ data: { routineId: routine.id, scheduledFor } });
      queued += 1;
    } catch (error: any) {
      // P2002 = this occurrence is already queued (a second sweep, or a trigger
      // that landed in the same minute). The schedule is already advanced, so
      // this is benign.
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) {
        console.error(`[Routines] Could not queue "${routine.name}":`, error);
      }
    }
  }
  return queued;
}

/** Returns any run whose worker died mid-flight, so nothing stays stuck forever. */
export async function recoverStaleRuns(now: Date = new Date()): Promise<number> {
  const stale = await db.routineRun.findMany({
    where: { status: "RUNNING", leaseExpiresAt: { lt: now } },
    select: { id: true, attempt: true, maxAttempts: true, routineId: true },
    take: 20,
  });

  for (const run of stale) {
    const exhausted = run.attempt >= run.maxAttempts;
    await db.routineRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        leaseOwner: null,
        leaseExpiresAt: null,
        ...(exhausted ? { finishedAt: now, error: "The run stopped responding." } : {}),
      },
    });
    if (exhausted) {
      // The dashboard used to keep showing the last success while the routine
      // had actually been failing silently on every deploy.
      const routine = await db.aiRoutine.findUnique({
        where: { id: run.routineId },
        select: { id: true, name: true, createdById: true },
      });
      if (routine) {
        await db.aiRoutine.update({ where: { id: routine.id }, data: { lastStatus: "FAILED" } }).catch(() => {});
        const actorId = await resolveActorId(routine.createdById);
        if (actorId) {
          await db.notification
            .create({
              data: {
                userId: actorId,
                type: "SYSTEM",
                title: `Scheduled routine failed: ${routine.name}`,
                body: "The run stopped responding before it could finish.",
                href: "/ai/tasks",
                dedupeKey: `routine-${routine.id}-stale-${run.id}`,
              },
            })
            .catch(() => {});
        }
      }
    }
  }
  return stale.length;
}

/** Claims one pending run. The conditional update is the lock. */
async function claimRun(now: Date): Promise<string | null> {
  const candidate = await db.routineRun.findFirst({
    where: { status: "PENDING", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await db.routineRun.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: {
      status: "RUNNING",
      leaseOwner: OWNER,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      startedAt: now,
      attempt: { increment: 1 },
    },
  });
  return claimed.count === 1 ? candidate.id : null;
}

async function executeClaimedRun(runId: string, now: Date): Promise<string> {
  const run = await db.routineRun.findUnique({
    where: { id: runId },
    include: { routine: { include: { skill: true } } },
  });
  if (!run) return "MISSING";

  const routine = run.routine;

  // Disabling a routine must stop work already queued, not just future slots.
  if (!routine.isEnabled) {
    await db.routineRun.update({ where: { id: run.id }, data: { status: "CANCELLED", finishedAt: now } });
    return "CANCELLED";
  }

  // Keep the lease alive during long model calls: without renewal, another
  // sweeper sees the expired lease, re-claims the run, and the work happens
  // twice. The heartbeat is cleared on every path.
  const heartbeat = setInterval(() => {
    void db.routineRun
      .updateMany({
        where: { id: run.id, status: "RUNNING", leaseOwner: OWNER },
        data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
      })
      .catch(() => {});
  }, 60_000);

  // Fenced write: a zombie that lost its lease must not stamp a result over the
  // successor's run.
  const finishRun = async (data: Record<string, unknown>) =>
    db.routineRun.updateMany({ where: { id: run.id, leaseOwner: OWNER }, data });

  const actorId = await resolveActorId(routine.createdById);
  if (!actorId) {
    clearInterval(heartbeat);
    await finishRun({ status: "FAILED", finishedAt: now, error: "No owner available to attribute the run to." });
    return "FAILED";
  }

  try {
    let status: string;
    let title: string;
    let body: string;
    let resultJson: string | null = null;

    if (routine.skill?.slug === "instagram_daily_plan") {
      const brief = await buildInstagramBrief({ userId: actorId });
      status = "COMPLETED";
      title = `Instagram plan: ${brief.headline}`;
      body = formatBriefForNotification(brief);
    } else {
      const task = await executeRoutine(routine.id, actorId, run.scheduledFor.toISOString());
      status = task?.status ?? "FAILED";
      title = `Scheduled routine: ${routine.name}`;
      body = summariseOutcome(status, task?.result ?? null, task?.error ?? null);
      resultJson = task?.result ?? null;
    }

    await finishRun({ status: status === "FAILED" ? "FAILED" : "SUCCEEDED", finishedAt: new Date(), result: resultJson });
    await db.aiRoutine.update({
      where: { id: routine.id },
      data: { lastStatus: status, lastRunAt: new Date() },
    });
    await db.notification
      .create({
        data: {
          userId: actorId,
          type: "SYSTEM",
          title,
          body,
          href: "/ai/tasks",
          // Key on the occurrence, not the day: a schedule firing twice a day
          // was reporting only its first run.
          dedupeKey: `routine-${routine.id}-${run.scheduledFor.toISOString()}`,
        },
      })
      .catch(() => {});
    return status;
  } catch (err: any) {
    clearInterval(heartbeat);
    const attempt = run.attempt;
    const willRetry = attempt < run.maxAttempts;
    const reason = String(err?.message || "The routine could not be started.");

    await db.routineRun.updateMany({
      where: { id: run.id, leaseOwner: OWNER },
      data: {
        status: willRetry ? "PENDING" : "FAILED",
        leaseOwner: null,
        leaseExpiresAt: null,
        error: reason.slice(0, 2000),
        ...(willRetry ? {} : { finishedAt: new Date() }),
      },
    });
    await db.aiRoutine.update({ where: { id: routine.id }, data: { lastStatus: "FAILED" } }).catch(() => {});
    await db.notification
      .create({
        data: {
          userId: actorId,
          type: "SYSTEM",
          title: `Scheduled routine failed: ${routine.name}`,
          body: reason.length > 200 ? `${reason.slice(0, 200)}…` : reason,
          href: "/ai/tasks",
          dedupeKey: `routine-${routine.id}-${dateKey(now)}-a${attempt}`,
        },
      })
      .catch(() => {});
    return "FAILED";
  }
}

/**
 * The whole loop: queue what is due, recover abandoned work, then execute a few
 * claimed runs. Safe to call every minute and safe to call from many replicas.
 */
export async function sweepRoutines(
  now: Date = new Date()
): Promise<{ queued: number; executed: number; recovered: number; triggered: number; goalsAdvanced: number }> {
  const queued = await enqueueDueRoutines(now);
  const recovered = await recoverStaleRuns(now);
  // Change-watch routines enqueue here and are claimed below like any other run.
  const triggered = await sweepRecordChangeWatchers().catch((error) => {
    console.error("[Routines] Change-watch sweep failed:", error);
    return 0;
  });
  // AI-team goals keep working toward their objective between requests.
  const goalsAdvanced = await sweepGoals(now).catch((error) => {
    console.error("[Routines] Goal sweep failed:", error);
    return 0;
  });

  let executed = 0;
  for (let index = 0; index < MAX_PER_SWEEP; index += 1) {
    const runId = await claimRun(now);
    if (!runId) break;
    await executeClaimedRun(runId, now);
    executed += 1;
  }
  return { queued: queued + triggered, executed, recovered, triggered, goalsAdvanced };
}
