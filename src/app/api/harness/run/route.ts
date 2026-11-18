import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { finalTextOf, stepCountOf } from "@/lib/harness/events";
import {
  HarnessRunError,
  harnessSessionStore,
  isAbortError,
  runtimeFactory,
} from "@/lib/harness/runtime";
import { resolvePermissionMode, runtimePermissionMode } from "@/lib/permissions/mode";
import { jsonError } from "@/lib/validators";

/**
 * One bot turn, answered by the DeepSeek Harness through the AgentRuntime
 * adapter (`HARNESS_RUNTIME=cli` | `native`; cli is the default and keeps the
 * previous behaviour). The response keeps the established shape and adds a
 * `runtime` field reporting which runtime served the turn.
 */

const bodySchema = z.object({
  task: z.string().min(1).max(20_000),
  sessionId: z.string().min(1).max(200).optional(),
});

// One runtime for the process: sessions must survive across requests.
const runtime = runtimeFactory();

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("A task is required", 400);

  const started = Date.now();

  try {
    let session = parsed.data.sessionId ? await runtime.getSession(parsed.data.sessionId) : null;

    if (!session) {
      // No known adapter session: start one for this tenant. A provided id
      // that we do not recognise is a legacy harness session id (the value
      // the pre-adapter route returned), so resume it by pre-seeding the
      // store with it — the runtime then spawns/boots with `--session-id`.
      const conversationId = parsed.data.sessionId
        ? `legacy-harness-session:${parsed.data.sessionId}`
        : randomUUID();
      session = await runtime.createSession({ tenantId: user.id, conversationId });
      if (parsed.data.sessionId) {
        await harnessSessionStore().saveHarnessSessionId({
          tenantId: user.id,
          conversationId,
          harnessSessionId: parsed.data.sessionId,
        });
      }
    }

    // Session ownership: a harness session belongs to the tenant that created
    // it. The id alone must never grant access (audit finding: resume was
    // unguarded, protected only by UUID entropy).
    if (session.tenantId !== user.id) {
      return Response.json({ ok: false, error: "That session belongs to another workspace." }, { status: 404 });
    }

    // The unified Permission Manager: the caller's workspace mode, role-gated
    // (non-owners under FULL_CONTROL/SYSTEM get CONTROLLED), mapped by the
    // runtime onto DSH_PERMISSION_MODE / --permission-mode.
    const permissionMode = runtimePermissionMode(
      await resolvePermissionMode({ workspaceId: user.id }),
      user.role
    );

    const events = [];
    for await (const event of runtime.executeTurn({
      sessionId: session.id,
      task: parsed.data.task,
      signal: request.signal,
      // The request owner is the tenant key for the CRM tools' scoping.
      workspaceId: user.id,
      permissionMode,
    })) {
      events.push(event);
    }

    // Reported after the turn so it names the runtime that actually served
    // (a native request that fell back to the CLI reports cli + reason).
    const health = await runtime.healthCheck();
    const text = finalTextOf(events);
    if (!text) {
      return Response.json(
        { ok: false, error: "The harness returned no answer.", sessionId: session.id, runtime: health },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      text,
      sessionId: session.id,
      ms: Date.now() - started,
      steps: stepCountOf(events),
      runtime: health,
    });
  } catch (error) {
    const health = await runtime.healthCheck().catch(() => ({ available: false, kind: "none" as const }));
    const message = describeRunError(error);
    return Response.json({ ok: false, error: message, runtime: health }, { status: 502 });
  }
}

function describeRunError(error: unknown): string {
  if (error instanceof HarnessRunError) {
    if (error.details.timedOut) return "The harness took too long and was stopped.";
    return (
      error.details.stderr?.trim().split("\n").slice(-3).join("\n") ||
      error.message ||
      "The harness returned no answer."
    );
  }
  if (isAbortError(error)) return "The turn was cancelled.";
  return error instanceof Error ? error.message : "The harness returned no answer.";
}
