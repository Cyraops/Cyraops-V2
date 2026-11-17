import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { isWatchable, newWebhookToken, WATCHABLE } from "@/lib/ai/automation/triggers";
import { isValidCron, nextCronRun } from "@/lib/ai/automation/cron";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can change routines", 403);

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  try {
    const routine = await db.aiRoutine.findUnique({ where: { id } });
    if (!routine) return jsonError("Routine not found", 404);

    const data: {
      isEnabled?: boolean;
      cronExpression?: string;
      name?: string;
      nextRunAt?: Date | null;
      triggerType?: string;
      webhookToken?: string | null;
      emailSenders?: string;
      watchModel?: string | null;
      watchField?: string | null;
      watchValue?: string | null;
    } = {};

    if (typeof body?.isEnabled === "boolean") {
      data.isEnabled = body.isEnabled;
      if (!body.isEnabled) {
        // A PENDING run belongs to the disabled routine; letting it execute
        // would fire an AI task and a notification for work the user just
        // turned off.
        await db.routineRun.updateMany({
          where: { routineId: id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
      }
    }
    if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 120);

    if (typeof body?.cronExpression === "string") {
      const cron = body.cronExpression.trim();
      if (!isValidCron(cron)) {
        return jsonError("That cron expression is not valid. Use five fields, e.g. 0 9 * * *.", 400);
      }
      data.cronExpression = cron;
      data.nextRunAt = nextCronRun(cron, new Date());
    }

    // Triggers other than the clock. A webhook trigger gets a token once and
    // keeps it, so an integration's URL does not break on every save.
    if (typeof body?.triggerType === "string") {
      const triggerType = body.triggerType.toUpperCase();
      if (!["SCHEDULE", "WEBHOOK", "EMAIL", "RECORD_CHANGE"].includes(triggerType)) {
        return jsonError("Unknown trigger type", 400);
      }
      data.triggerType = triggerType;
      if (triggerType === "WEBHOOK" && !routine.webhookToken) data.webhookToken = newWebhookToken();
      // Keep the token across trigger switches: nulling it silently 404ed every
      // external integration the moment the type was toggled. To retire the
      // endpoint explicitly, pass revokeWebhook: true.
      if (body?.revokeWebhook === true) data.webhookToken = null;
    }
    if (typeof body?.emailSenders === "string") data.emailSenders = body.emailSenders.slice(0, 1000);
    if (typeof body?.watchModel === "string" || body?.watchModel === null) {
      const model = body.watchModel ? String(body.watchModel).slice(0, 60) : null;
      // Free-form strings made it possible to save a watcher that can never
      // fire, with no diagnostic. Only these pairs mean anything.
      if (model && !Object.keys(WATCHABLE).includes(model)) {
        return jsonError(`Watching ${model} is not supported. Allowed: ${Object.keys(WATCHABLE).join(", ")}`, 400);
      }
      data.watchModel = model;
      data.watchValue = null; // a new target resets the baseline
    }
    if (typeof body?.watchField === "string" || body?.watchField === null) {
      const field = body.watchField ? String(body.watchField).slice(0, 60) : null;
      if (field && data.watchModel !== undefined) {
        const model = (data.watchModel ?? routine.watchModel) || "";
        if (!isWatchable(model, field)) {
          return jsonError(`Watching ${model}.${field} is not supported`, 400);
        }
      }
      data.watchField = field;
      data.watchValue = null;
    }

    if (Object.keys(data).length === 0) return jsonError("Nothing to update", 400);

    const updated = await db.aiRoutine.update({ where: { id }, data });
    return NextResponse.json({ routine: updated });
  } catch (err: any) {
    console.error("[API:routines] Update failed:", err);
    return jsonError("Failed to update the routine", 500);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can delete routines", 403);

  const { id } = await context.params;

  try {
    // deleteMany so an already-gone id is a 404, not a Prisma 500.
    const deleted = await db.aiRoutine.deleteMany({ where: { id } });
    if (!deleted.count) return jsonError("Routine not found", 404);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[API:routines] Delete failed:", err);
    return jsonError("Failed to delete the routine", 500);
  }
}
