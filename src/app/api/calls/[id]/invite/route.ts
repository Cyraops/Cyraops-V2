import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { inviteParticipants } from "@/lib/calling/state-machine";
import { publishCallIncoming, publishCallStateChange } from "@/lib/realtime";
import {
  checkIdempotency,
  saveIdempotencyResponse,
  releaseIdempotencyReservation,
} from "@/lib/calling/idempotency";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.disabledAt) return jsonError("Account is disabled", 403);

  const { id } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") || request.headers.get("x-idempotency-key");
  const body = await request.json().catch(() => null);

  if (idempotencyKey) {
    const check = await checkIdempotency(db, {
      key: idempotencyKey,
      userId: user.id,
      endpoint: `/api/calls/${id}/invite`,
      payload: body,
    });
    if (check.isDuplicate) {
      if (check.mismatch) {
        return jsonError("Idempotency key reused with different request payload", 422);
      }
      if (check.inFlight) {
        return jsonError("A request with this idempotency key is currently in progress", 409);
      }
      if (check.cachedResponse) {
        return Response.json(check.cachedResponse, { status: check.cachedStatus ?? 200 });
      }
    }
  }

  const parsed = z.object({
    inviteeIds: z.array(z.string().min(1).max(64)).min(1),
  }).safeParse(body);

  if (!parsed.success) {
    if (idempotencyKey) {
      await releaseIdempotencyReservation(db, { key: idempotencyKey, userId: user.id, endpoint: `/api/calls/${id}/invite` });
    }
    return jsonError("Specify at least one teammate to invite", 400);
  }

  const result = await db.$transaction(async (tx) => {
    return inviteParticipants(tx, id, user.id, parsed.data.inviteeIds);
  });

  if (!result.success) {
    if (idempotencyKey) {
      await releaseIdempotencyReservation(db, { key: idempotencyKey, userId: user.id, endpoint: `/api/calls/${id}/invite` });
    }
    return jsonError(result.error ?? "Could not invite participants", result.code ?? 400);
  }

  const responseBody = { ok: true, data: result.data };

  // Dispatch incoming notifications to newly invited users
  const call = await db.callSession.findUnique({
    where: { id },
    include: {
      initiator: { select: { id: true, name: true, avatarUrl: true } },
      conversation: { select: { name: true, type: true } },
      participants: true,
    },
  });

  if (call) {
    const isGroup = call.conversation.type === "GROUP";
    for (const inviteeId of parsed.data.inviteeIds) {
      publishCallIncoming(inviteeId, {
        callId: call.id,
        conversationId: call.conversationId,
        type: call.type,
        initiator: {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
        ringTimeoutAt: call.ringTimeoutAt ? new Date(call.ringTimeoutAt).toISOString() : null,
        conversationName: call.conversation.name ?? null,
        isGroup,
        participantCount: call.participants.length,
      });
    }

    publishCallStateChange(call.conversationId, {
      callId: call.id,
      status: call.status,
      actorId: user.id,
      targets: parsed.data.inviteeIds,
      type: call.type,
      isGroup,
      conversationName: call.conversation.name ?? null,
      activeParticipantsCount: call.participants.filter((p) => p.status === "CONNECTED" || p.status === "CONNECTING").length,
      hostId: call.hostId,
    });
  }

  if (idempotencyKey) {
    await saveIdempotencyResponse(db, {
      key: idempotencyKey,
      userId: user.id,
      endpoint: `/api/calls/${id}/invite`,
      payload: body,
      responseBody,
      statusCode: 200,
      callSessionId: id,
    });
  }

  return Response.json(responseBody);
}
