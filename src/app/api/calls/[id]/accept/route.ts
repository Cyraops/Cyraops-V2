import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { acceptCallInvitation } from "@/lib/calling/state-machine";
import { publishCallStateChange } from "@/lib/realtime";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.disabledAt) return jsonError("Account is disabled", 403);

  const { id } = await context.params;

  const result = await db.$transaction(async (tx) => {
    const res = await acceptCallInvitation(tx, id, user.id);
    if (!res.success) return res;
    const freshCall = await tx.callSession.findUnique({
      where: { id },
      include: {
        participants: { include: { user: true } },
        conversation: true,
      },
    });
    return { ...res, call: freshCall };
  });

  if (!result.success) {
    return jsonError(result.error ?? "Could not accept invitation", result.code ?? 400);
  }

  if (result.call) {
    publishCallStateChange(result.call.conversationId, {
      callId: result.call.id,
      status: result.call.status,
      participantId: result.participant?.id,
      participantStatus: result.participant?.status,
      actorId: user.id,
    });
  }

  return Response.json({ ok: true, participant: result.participant, call: result.call });
}

