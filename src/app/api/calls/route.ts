import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { createCallSession } from "@/lib/calling/state-machine";
import { publishCallIncoming, publishCallStateChange } from "@/lib/realtime";
import {
  checkIdempotency,
  saveIdempotencyResponse,
  releaseIdempotencyReservation,
} from "@/lib/calling/idempotency";
import { CallType } from "@prisma/client";
import { isLiveKitConfigured } from "@/lib/calling/config";

const createCallSchema = z.object({
  conversationId: z.string().min(1).max(64),
  type: z.enum(["AUDIO", "VIDEO"]).default("AUDIO"),
  inviteeIds: z.array(z.string().min(1).max(64)).optional(),
  ringAll: z.boolean().optional(),
  screenShareEnabled: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  const cursor = url.searchParams.get("cursor");
  const limitParam = Number(url.searchParams.get("limit") ?? "30");
  const limit = Math.min(Math.max(isNaN(limitParam) ? 30 : limitParam, 1), 50);

  // Determine conversations accessible by user
  const userMemberships = await db.conversationMember.findMany({
    where: { userId: user.id },
    select: { conversationId: true },
  });
  const allowedConvIds = new Set(userMemberships.map((m) => m.conversationId));

  if (conversationId && !allowedConvIds.has(conversationId)) {
    return jsonError("You are not a member of this conversation", 403);
  }

  const whereClause: any = {
    conversationId: conversationId ? conversationId : { in: Array.from(allowedConvIds) },
  };

  const calls = await db.callSession.findMany({
    where: whereClause,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      initiator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      host: { select: { id: true, name: true, email: true, avatarUrl: true } },
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
        },
      },
      conversation: { select: { id: true, name: true, type: true } },
    },
  });

  const hasMore = calls.length > limit;
  const returnedCalls = hasMore ? calls.slice(0, limit) : calls;
  const nextCursor = hasMore ? returnedCalls[returnedCalls.length - 1]?.id ?? null : null;

  return Response.json({
    calls: returnedCalls,
    nextCursor,
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.disabledAt) return jsonError("Account is disabled", 403);

  // Without LiveKit credentials a call session would be created and every
  // participant would be rung, yet nobody could ever connect. Fail fast instead.
  if (!isLiveKitConfigured()) {
    return jsonError(
      "Calling is not configured on this server. LiveKit credentials are required before calls can be placed.",
      503
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key") || request.headers.get("x-idempotency-key");
  const body = await request.json().catch(() => null);

  // Check idempotency if client supplied key
  if (idempotencyKey) {
    const check = await checkIdempotency(db, {
      key: idempotencyKey,
      userId: user.id,
      endpoint: "/api/calls",
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

  const parsed = createCallSchema.safeParse(body);
  if (!parsed.success) {
    if (idempotencyKey) {
      await releaseIdempotencyReservation(db, { key: idempotencyKey, userId: user.id, endpoint: "/api/calls" });
    }
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid call parameters", 400);
  }

  const result = await db.$transaction(async (tx) => {
    return createCallSession(tx, {
      conversationId: parsed.data.conversationId,
      initiatorId: user.id, // Strictly server-derived identity
      type: parsed.data.type as CallType,
      inviteeIds: parsed.data.inviteeIds,
      ringAll: parsed.data.ringAll,
      screenShareEnabled: parsed.data.screenShareEnabled ?? false,
    });
  });

  if (!result.success) {
    if (idempotencyKey) {
      await releaseIdempotencyReservation(db, { key: idempotencyKey, userId: user.id, endpoint: "/api/calls" });
    }
    return jsonError(result.error ?? "Failed to create call", result.code ?? 400);
  }

  const responseBody = { call: result.call };

  if (result.call) {
    const conv = await db.conversation.findUnique({
      where: { id: result.call.conversationId },
      select: { name: true, type: true },
    });
    const isGroup = conv?.type === "GROUP";

    const invitees = (result.call.participants || [])
      .filter((p: any) => p.userId !== user.id && p.status === "RINGING")
      .map((p: any) => p.userId);

    for (const inviteeId of invitees) {
      publishCallIncoming(inviteeId, {
        callId: result.call.id,
        conversationId: result.call.conversationId,
        type: result.call.type,
        initiator: {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
        ringTimeoutAt: result.call.ringTimeoutAt ? new Date(result.call.ringTimeoutAt).toISOString() : null,
        conversationName: conv?.name ?? null,
        isGroup,
        participantCount: result.call.participants?.length ?? 1,
      });
    }

    publishCallStateChange(result.call.conversationId, {
      callId: result.call.id,
      conversationId: result.call.conversationId,
      status: result.call.status,
      actorId: user.id,
      hostName: user.name,
      targets: invitees,
      type: result.call.type,
      isGroup,
      conversationName: conv?.name ?? null,
      activeParticipantsCount: (result.call.participants || []).filter((p: any) => p.status === "CONNECTED" || p.status === "CONNECTING").length || 1,
      hostId: result.call.hostId,
    });
  }

  if (idempotencyKey) {
    await saveIdempotencyResponse(db, {
      key: idempotencyKey,
      userId: user.id,
      endpoint: "/api/calls",
      payload: body,
      responseBody,
      statusCode: 201,
      callSessionId: result.call?.id,
    });
  }

  return Response.json(responseBody, { status: 201 });
}
