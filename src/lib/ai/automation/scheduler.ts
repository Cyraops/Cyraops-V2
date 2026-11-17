import { db } from "@/lib/db";
import { nextCronRun } from "./cron";
import { executeRoutine } from "./routines";
import { buildInstagramBrief, formatBriefForNotification } from "./instagram-brief";

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
  if (status === "AWAITING_APPROVAL") {
    return "Routine prepared work that needs your approval before it can continue.";
  }
  if (status === "FAILED") {
    return `Routine failed: ${error || "unknown error"}`;
  }
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
 * Runs every enabled routine whose `nextRunAt` is due.
 *
 * The schema always carried cronExpression/nextRunAt/lastRunAt, but nothing
 * consumed them, so routines only ran when a human clicked Run. This is the
 * loop that makes scheduled work actually happen. It is safe to call often:
 * `nextRunAt` is advanced before the next sweep can see the same routine.
 */
export async function runDueRoutines(now: Date = new Date()): Promise<number> {
  const due = await db.aiRoutine.findMany({
    where: {
      isEnabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    include: { skill: true },
    orderBy: { createdAt: "asc" },
  });

  let executed = 0;

  for (const routine of due) {
    const upcoming = nextCronRun(routine.cronExpression, now);
    if (!upcoming) {
      if (!warnedInvalidCron.has(routine.id)) {
        warnedInvalidCron.add(routine.id);
        console.warn(
          `[RoutineScheduler] Skipping routine "${routine.name}" (${routine.id}): invalid cron expression "${routine.cronExpression}".`
        );
      }
      continue;
    }

    const actorId = await resolveActorId(routine.createdById);
    if (!actorId) {
      console.warn(`[RoutineScheduler] Skipping routine "${routine.name}": no owner available to attribute the run to.`);
      continue;
    }

    // Claim it first so a slow run cannot be picked up twice.
    await db.aiRoutine.update({
      where: { id: routine.id },
      data: { nextRunAt: upcoming, lastRunAt: now },
    });

    try {
      let status: string;
      let title: string;
      let body: string;

      if (routine.skill?.slug === "instagram_daily_plan") {
        // The brief is written deterministically from CRM data, so it does not
        // depend on the planner producing a sensible multi-step plan.
        const brief = await buildInstagramBrief({ userId: actorId });
        status = "COMPLETED";
        title = `Instagram plan: ${brief.headline}`;
        body = formatBriefForNotification(brief);
      } else {
        const task = await executeRoutine(routine.id, actorId);
        status = task?.status ?? "FAILED";
        title = `Scheduled routine: ${routine.name}`;
        body = summariseOutcome(status, task?.result ?? null, task?.error ?? null);
      }

      await db.aiRoutine.update({
        where: { id: routine.id },
        data: { lastStatus: status },
      });

      await db.notification.create({
        data: {
          userId: actorId,
          type: "SYSTEM",
          title,
          body,
          href: "/ai/tasks",
          dedupeKey: `routine-${routine.id}-${dateKey(now)}`,
        },
      });

      executed += 1;
      console.log(`[RoutineScheduler] Ran "${routine.name}" -> ${status}. Next run ${upcoming.toISOString()}.`);
    } catch (err: any) {
      console.error(`[RoutineScheduler] Routine "${routine.name}" failed:`, err);
      await db.aiRoutine
        .update({ where: { id: routine.id }, data: { lastStatus: "FAILED" } })
        .catch(() => {});
      const reason = String(err?.message || "The routine could not be started.");
      await db.notification
        .create({
          data: {
            userId: actorId,
            type: "SYSTEM",
            title: `Scheduled routine failed: ${routine.name}`,
            // Keep provider output out of the notice: it can be long and may
            // contain model-generated text the user did not ask to see.
            body: reason.length > 200 ? `${reason.slice(0, 200)}…` : reason,
            href: "/ai/tasks",
            dedupeKey: `routine-${routine.id}-${dateKey(now)}`,
          },
        })
        .catch(() => {});
    }
  }

  return executed;
}
