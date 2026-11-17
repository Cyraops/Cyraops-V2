import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { declineCallInvitation } from "@/lib/calling/state-machine";
import { publishCallStateChange } from "@/lib/realtime";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = z.object({
    reason: z.string().max(250).optional(),
  }).safeParse(body);

  const result = await db.$transaction(async (tx) => {
    return declineCallInvitation(tx, id, user.id, parsed.data?.reason);
  });

  if (!result.success) {
    return jsonError(result.error ?? "Could not decline invitation", result.code ?? 400);
  }

  if (result.call) {
    publishCallStateChange(result.call.conversationId, {
      callId: result.call.id,
      status: result.call.status,
      participantId: result.participant?.id,
      participantStatus: result.participant?.status,
      terminationReason: result.call.terminationReason,
      actorId: user.id,
    });
  }

  return Response.json({ ok: true, participant: result.participant, call: result.call });
}

