import { NextRequest } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { runHarnessTask } from "@/lib/harness/client";

/**
 * One bot turn, answered by the DeepSeek Harness.
 *
 * This is the seam between our UI and the harness engine: the CRM posts a task
 * and renders the answer it gets back, so nothing above this line knows where
 * the intelligence comes from. No key or credential crosses it.
 */

const bodySchema = z.object({
  task: z.string().min(1).max(20_000),
  sessionId: z.string().min(1).max(200).optional(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("A task is required", 400);

  const started = Date.now();
  const result = await runHarnessTask({ task: parsed.data.task, sessionId: parsed.data.sessionId });

  if (!result.text) {
    return Response.json(
      {
        ok: false,
        error: result.timedOut
          ? "The harness took too long and was stopped."
          : result.stderr.trim().split("\n").slice(-3).join("\n") || "The harness returned no answer.",
        sessionId: result.sessionId,
      },
      { status: 502 }
    );
  }

  return Response.json({
    ok: true,
    text: result.text,
    sessionId: result.sessionId,
    ms: Date.now() - started,
    steps: result.events.filter((event) => event.phase === "step_end").length,
  });
}
