import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { joinCall } from "@/lib/calling/state-machine";
import { publishCallStateChange } from "@/lib/realtime";
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
      endpoint: `/api/calls/${id}/join`,
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

  const result = await db.$transaction(async (tx) => {
    return joinCall(tx, id, user.id);
  });

  if (!result.success) {
    if (idempotencyKey) {
      await releaseIdempotencyReservation(db, { key: idempotencyKey, userId: user.id, endpoint: `/api/calls/${id}/join` });
    }
    return jsonError(result.error ?? "Could not join call", result.code ?? 400);
  }

  const responseBody = { ok: true, participant: result.participant, call: result.call };

  if (result.call) {
    publishCallStateChange(result.call.conversationId, {
      callId: result.call.id,
      status: result.call.status,
      participantId: result.participant?.id,
      participantStatus: result.participant?.status,
      actorId: user.id,
      isGroup: true,
      activeParticipantsCount: (result.call.participants || []).filter((p: any) => p.status === "CONNECTED" || p.status === "CONNECTING").length,
      hostId: result.call.hostId,
    });
  }

  if (idempotencyKey) {
    await saveIdempotencyResponse(db, {
      key: idempotencyKey,
      userId: user.id,
      endpoint: `/api/calls/${id}/join`,
      payload: body,
      responseBody,
      statusCode: 200,
      callSessionId: id,
    });
  }

  return Response.json(responseBody);
}

