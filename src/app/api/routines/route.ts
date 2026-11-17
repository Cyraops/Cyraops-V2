import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { createRoutine } from "@/lib/ai/automation/routine-create";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
    const routines = await db.aiRoutine.findMany({
      // Never ship the webhook token to a MEMBER: it is the only credential on
      // the public hook, and members are denied routine control by policy.
      select: {
        id: true,
        name: true,
        description: true,
        cronExpression: true,
        isEnabled: true,
        lastRunAt: true,
        lastStatus: true,
        nextRunAt: true,
        triggerType: true,
        emailSenders: true,
        watchModel: true,
        watchField: true,
        createdAt: true,
        ...(isAdmin ? { webhookToken: true, watchValue: true } : {}),
        skill: { select: { id: true, slug: true, name: true } },
        agent: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ routines });
  } catch (err: any) {
    console.error("[API:routines] Failed:", err);
    return jsonError("Failed to load routines", 500);
  }
}

/**
 * Create a routine.
 *
 * Until now a routine could only come from the seed: the list was read-only and
 * there was no way to add one, from the UI or the bot. This is the write half.
 */
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cron: z.string().trim().min(9).max(60),
  agentSlug: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
  skillId: z.string().trim().min(1).optional(),
  instructions: z.string().max(2000).optional(),
  triggerType: z.enum(["SCHEDULE", "WEBHOOK", "EMAIL", "RECORD_CHANGE"]).optional(),
  emailSenders: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only owners and admins can create routines", 403);

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the routine details", 400);
  if (!parsed.data.agentSlug && !parsed.data.agentId) return jsonError("Choose the agent that runs it", 400);

  const result = await createRoutine({ ...parsed.data, userId: user.id });
  if (!result.ok) return jsonError(result.error, 400);

  return Response.json({ routine: result.routine }, { status: 201 });
}
