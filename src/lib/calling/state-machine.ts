import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  CallStatus,
  ParticipantStatus,
  CallType,
  CallTerminationReason,
  CallEventType,
} from "@prisma/client";
import { sweepExpiredIdempotencyKeys } from "./idempotency";
import { queueSfuEjection } from "./outbox";
import { publishCallStateChange } from "../realtime";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export const RING_TIMEOUT_SECONDS = 45;
export const STALE_CONNECTING_TIMEOUT_SECONDS = 60;
export const EMPTY_ROOM_TIMEOUT_SECONDS = 30;

export const TERMINAL_CALL_STATUSES = new Set<string>([
  CallStatus.ENDED,
  CallStatus.CANCELLED,
  CallStatus.FAILED,
]);

export const INACTIVE_PARTICIPANT_STATUSES = new Set<string>([
  ParticipantStatus.DECLINED,
  ParticipantStatus.LEFT,
  ParticipantStatus.EJECTED,
  ParticipantStatus.MISSED,
  ParticipantStatus.FAILED,
  ParticipantStatus.CANCELLED,
]);

export const ACTIVE_OR_RINGING_PARTICIPANT_STATUSES = new Set<string>([
  ParticipantStatus.INVITED,
  ParticipantStatus.RINGING,
  ParticipantStatus.ACCEPTED,
  ParticipantStatus.CONNECTING,
  ParticipantStatus.CONNECTED,
]);

export const ACCEPTED_OR_CONNECTING_PARTICIPANT_STATUSES = new Set<string>([
  ParticipantStatus.ACCEPTED,
  ParticipantStatus.CONNECTING,
  ParticipantStatus.CONNECTED,
]);

export interface CreateCallOptions {
  conversationId: string;
  initiatorId: string;
  type?: CallType;
  inviteeIds?: string[];
  ringAll?: boolean;
  screenShareEnabled?: boolean;
}

export interface TransitionResult<T = any> {
  success: boolean;
  call?: any;
  participant?: any;
  error?: string;
  code?: number;
  data?: T;
}

/**
 * Inserts a CallEvent with optional deduplication key.
 * Uses atomic ON CONFLICT DO NOTHING to safely ignore duplicate key violations under concurrency
 * without aborting the surrounding PostgreSQL transaction block.
 */
async function emitCallEvent(
  client: DbClient,
  data: {
    callSessionId: string;
    type: CallEventType;
    actorId?: string;
    targetUserId?: string;
    payload?: any;
    dedupeKey?: string;
  }
) {
  if (data.dedupeKey) {
    const existing = await client.callEvent.findUnique({
      where: { dedupeKey: data.dedupeKey },
    });
    if (existing) return existing;

    const eventId = randomUUID();
    const payloadJson = data.payload ? JSON.stringify(data.payload) : null;
    try {
      await (client as any).$executeRaw`
        INSERT INTO "CallEvent" ("id", "callSessionId", "type", "actorId", "targetUserId", "payload", "dedupeKey", "createdAt")
        VALUES (${eventId}, ${data.callSessionId}, ${data.type}::"CallEventType", ${data.actorId ?? null}, ${data.targetUserId ?? null}, ${payloadJson}::jsonb, ${data.dedupeKey}, NOW())
        ON CONFLICT ("dedupeKey") DO NOTHING
      `;
      return await client.callEvent.findUnique({ where: { dedupeKey: data.dedupeKey } });
    } catch {
      return await client.callEvent.findUnique({ where: { dedupeKey: data.dedupeKey } });
    }
  }
  return client.callEvent.create({ data });
}

/**
 * Creates a new CallSession with initiator as host and auto-invites conversation members.
 * Concurrency protected: Database partial unique index idx_call_session_unique_active_per_conv
 * guarantees at most one active call per conversation, returning consistent 409 conflict.
 */
export async function createCallSession(
  client: DbClient,
  options: CreateCallOptions
): Promise<TransitionResult> {
  const { conversationId, initiatorId, type = CallType.AUDIO, inviteeIds = [], ringAll = false, screenShareEnabled = false } = options;

  // 1. Verify initiator is a member of the conversation
  const initiatorMembership = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: initiatorId } },
  });
  if (!initiatorMembership) {
    return { success: false, error: "Initiator is not a member of this conversation", code: 403 };
  }

  // 1b. Fetch conversation to verify type (DIRECT vs GROUP)
  const conversation = await client.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true, name: true },
  });
  if (!conversation) {
    return { success: false, error: "Conversation not found", code: 404 };
  }

  // 2. Fetch all valid, non-disabled conversation members
  const convMembers = await client.conversationMember.findMany({
    where: { conversationId, user: { disabledAt: null } },
    select: { userId: true },
  });
  const validMemberIds = new Set(convMembers.map((m) => m.userId));

  const isDirect = conversation.type === "DIRECT";

  // Determine target invitees
  let targets: string[] = [];
  if (isDirect) {
    targets = Array.from(validMemberIds).filter((id) => id !== initiatorId);
    if (targets.length === 0) {
      return { success: false, error: "At least one other teammate must be in the conversation to start a call", code: 400 };
    }
  } else {
    // GROUP CONVERSATION:
    if (inviteeIds && inviteeIds.length > 0) {
      for (const id of inviteeIds) {
        if (!validMemberIds.has(id)) {
          return { success: false, error: `User ${id} is not an active member of this conversation`, code: 400 };
        }
        if (id !== initiatorId) {
          targets.push(id);
        }
      }
      targets = Array.from(new Set(targets));
    } else if (ringAll) {
      targets = Array.from(validMemberIds).filter((id) => id !== initiatorId);
    } else {
      // Open Group Meeting mode: no participants rung automatically; join via banner
      targets = [];
    }
  }

  // CONCURRENCY & DEADLOCK PROTECTION:
  // Deterministically sort and lock all involved User rows (initiator + invitees).
  // This guarantees serialization of concurrent call creation attempts across conversations,
  // preventing race conditions where two simultaneous calls reserve the same participant.
  const allInvolvedUserIds = Array.from(new Set([initiatorId, ...targets])).sort();
  await (client as any).$queryRawUnsafe(
    `SELECT id FROM "User" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    allInvolvedUserIds
  );

  // 1. Cross-Conversation Busy Check: Initiator
  const initiatorBusy = await client.callParticipant.findFirst({
    where: {
      userId: initiatorId,
      status: { in: [ParticipantStatus.RINGING, ParticipantStatus.CONNECTING, ParticipantStatus.CONNECTED] },
      callSession: {
        status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] },
      },
    },
    include: {
      callSession: { select: { id: true, conversationId: true } },
    },
  });
  if (initiatorBusy) {
    return {
      success: false,
      error: "You are already participating in an active call",
      code: 409,
    };
  }

  // 2. Cross-Conversation Busy Check: Target Invitees
  if (targets.length > 0) {
    if (isDirect) {
      const recipientBusy = await client.callParticipant.findFirst({
        where: {
          userId: { in: targets },
          status: { in: [ParticipantStatus.RINGING, ParticipantStatus.CONNECTING, ParticipantStatus.CONNECTED] },
          callSession: {
            status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] },
          },
        },
        include: {
          user: { select: { id: true, name: true } },
          callSession: { select: { id: true, conversationId: true } },
        },
      });
      if (recipientBusy) {
        const busyName = recipientBusy.user?.name || "Recipient";
        return {
          success: false,
          error: `${busyName} is currently on another call`,
          code: 409,
        };
      }
    } else {
      // In a group call, if some targets are busy, filter them out so available members can call
      const busyRecipients = await client.callParticipant.findMany({
        where: {
          userId: { in: targets },
          status: { in: [ParticipantStatus.RINGING, ParticipantStatus.CONNECTING, ParticipantStatus.CONNECTED] },
          callSession: {
            status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] },
          },
        },
        select: { userId: true, user: { select: { name: true } } },
      });
      const busyUserIds = new Set(busyRecipients.map((b) => b.userId));
      if (busyUserIds.size === targets.length) {
        return {
          success: false,
          error: "All invited teammates are currently on another call",
          code: 409,
        };
      }
      targets = targets.filter((id) => !busyUserIds.has(id));
    }
  }

  // 3. Check for any currently active/ringing call in this conversation
  const existingActive = await client.callSession.findFirst({
    where: {
      conversationId,
      status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] },
    },
    include: {
      participants: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } } },
      initiator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      host: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });
  if (existingActive) {
    return { success: false, error: "A call is already in progress in this conversation", code: 409, call: existingActive };
  }

  const now = new Date();
  const ringTimeoutAt = targets.length > 0 ? new Date(now.getTime() + RING_TIMEOUT_SECONDS * 1000) : null;
  // Cryptographically secure, unguessable room identifier using crypto.randomUUID()
  const roomUuid = randomUUID();
  const livekitRoomName = `call_${conversationId.slice(0, 16)}_${roomUuid}`;
  const initialCallStatus = targets.length > 0 ? CallStatus.RINGING : CallStatus.CONNECTING;

  try {
    const callEventsCreate: any[] = [
      {
        type: CallEventType.CALL_CREATED,
        actorId: initiatorId,
        payload: { type, targetsCount: targets.length, mode: targets.length > 0 ? "RING" : "OPEN_MEETING" },
      },
    ];
    if (ringTimeoutAt) {
      callEventsCreate.push({
        type: CallEventType.RINGING_STARTED,
        actorId: initiatorId,
        payload: { ringTimeoutAt },
      });
    }

    const call = await client.callSession.create({
      data: {
        conversationId,
        type,
        status: initialCallStatus,
        initiatorId,
        hostId: initiatorId,
        livekitRoomName,
        screenShareEnabled,
        ringTimeoutAt,
        participants: {
          create: [
            {
              userId: initiatorId,
              status: ParticipantStatus.CONNECTING,
              isHost: true,
              answeredAt: now,
            },
            ...targets.map((userId) => ({
              userId,
              status: ParticipantStatus.RINGING,
              isHost: false,
              ringingAt: now,
            })),
          ],
        },
        events: {
          create: callEventsCreate,
        },
      },
      include: {
        participants: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } } },
        initiator: { select: { id: true, name: true, email: true, avatarUrl: true } },
        host: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    return { success: true, call };
  } catch (err: any) {
    // Intercept PostgreSQL unique constraint violation (P2002) from partial unique index.
    // Note: NEVER query the transactional client `client` here, because PostgreSQL marks the
    // transaction as aborted upon a constraint violation, which would trigger SQLSTATE 25P02.
    if (
      err?.code === "P2002" ||
      String(err?.message).includes("unique constraint") ||
      String(err?.message).includes("idx_call_session_unique_active_per_conv") ||
      String(err?.message).includes("23505")
    ) {
      return {
        success: false,
        error: "A call is already in progress in this conversation",
        code: 409,
      };
    }
    throw err;
  }
}

/**
 * Invites additional conversation members to an active or ringing call.
 * Uses atomic upsert and duplicate prevention to ensure complete concurrency safety.
 */
export async function inviteParticipants(
  client: DbClient,
  callId: string,
  actorId: string,
  inviteeIds: string[]
): Promise<TransitionResult> {
  // Acquire row-level lock on CallSession to serialize concurrent invitations
  await client.$executeRaw`SELECT id FROM "CallSession" WHERE id = ${callId} FOR UPDATE`;

  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: false, error: "Cannot invite members to an ended or cancelled call", code: 400 };
  }

  // Verify actor is still an active conversation member
  const actorMember = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: call.conversationId, userId: actorId } },
  });
  if (!actorMember) {
    return { success: false, error: "Actor is no longer a member of this conversation", code: 403 };
  }

  const actorPart = call.participants.find((p) => p.userId === actorId);
  if (!actorPart || INACTIVE_PARTICIPANT_STATUSES.has(actorPart.status)) {
    return { success: false, error: "Only active call participants can invite teammates", code: 403 };
  }

  const convMembers = await client.conversationMember.findMany({
    where: { conversationId: call.conversationId, userId: { in: inviteeIds }, user: { disabledAt: null } },
  });
  const validMemberIds = new Set(convMembers.map((m) => m.userId));

  const now = new Date();
  const added: any[] = [];

  for (const userId of inviteeIds) {
    if (!validMemberIds.has(userId)) {
      return { success: false, error: `User ${userId} is not an active member of this conversation`, code: 400 };
    }

    const existingPart = call.participants.find((p) => p.userId === userId);
    if (existingPart && ACTIVE_OR_RINGING_PARTICIPANT_STATUSES.has(existingPart.status)) {
      // Already enrolled and active/ringing: idempotent skip without duplicate event
      continue;
    }

    // Atomic upsert guarantees zero P2002 race conditions
    const updated = await client.callParticipant.upsert({
      where: { callSessionId_userId: { callSessionId: call.id, userId } },
      create: {
        callSessionId: call.id,
        userId,
        status: ParticipantStatus.RINGING,
        ringingAt: now,
        invitedAt: now,
      },
      update: {
        status: ParticipantStatus.RINGING,
        ringingAt: now,
        invitedAt: now,
        leftAt: null,
        failureReason: null,
      },
    });
    added.push(updated);

    await emitCallEvent(client, {
      callSessionId: call.id,
      type: CallEventType.PARTICIPANT_INVITED,
      actorId,
      targetUserId: userId,
      dedupeKey: `${call.id}:PARTICIPANT_INVITED:${userId}`,
    });
  }

  return { success: true, data: { addedCount: added.length } };
}

/**
 * Handles participant accepting an invitation.
 * Checks current conversation membership; transitions call to CONNECTING (not ACTIVE).
 */
export async function acceptCallInvitation(
  client: DbClient,
  callId: string,
  userId: string
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  // Strict fresh membership check must precede lifecycle state checks
  const membership = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: call.conversationId, userId } },
  });
  if (!membership) {
    return { success: false, error: "User is no longer a member of this conversation", code: 403 };
  }

  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: false, error: "Call has already ended", code: 400 };
  }

  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    return { success: false, error: "Participant not found in call invitation list", code: 404 };
  }

  if (ACCEPTED_OR_CONNECTING_PARTICIPANT_STATUSES.has(participant.status)) {
    return { success: true, participant, call };
  }

  if (participant.status === ParticipantStatus.DECLINED || participant.status === ParticipantStatus.EJECTED) {
    return { success: false, error: "Cannot accept a declined or ejected call invitation", code: 400 };
  }

  const now = new Date();
  const updatedPart = await client.callParticipant.update({
    where: { id: participant.id },
    data: {
      status: ParticipantStatus.CONNECTING,
      answeredAt: now,
    },
  });

  let newCallStatus = call.status;
  if (call.status === CallStatus.CREATED || call.status === CallStatus.RINGING) {
    newCallStatus = CallStatus.CONNECTING;
    const staleConnectingTimeoutAt = new Date(now.getTime() + STALE_CONNECTING_TIMEOUT_SECONDS * 1000);
    await client.callSession.updateMany({
      where: {
        id: call.id,
        status: { in: [CallStatus.CREATED, CallStatus.RINGING] },
      },
      data: {
        status: newCallStatus,
        staleConnectingTimeoutAt,
      },
    });
  }

  await emitCallEvent(client, {
    callSessionId: call.id,
    type: CallEventType.PARTICIPANT_ACCEPTED,
    actorId: userId,
    dedupeKey: `${call.id}:PARTICIPANT_ACCEPTED:${userId}`,
  });

  return { success: true, participant: updatedPart, call: { ...call, status: newCallStatus } };
}

/**
 * Handles participant declining an invitation.
 * In a 1:1 call, declining terminates the call.
 * In a group call, declining marks this participant as DECLINED.
 */
export async function declineCallInvitation(
  client: DbClient,
  callId: string,
  userId: string,
  reason?: string
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: {
      participants: true,
      conversation: { select: { type: true } },
    },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: true, call };
  }

  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    return { success: false, error: "Participant not found", code: 404 };
  }

  if (participant.status === ParticipantStatus.DECLINED) {
    return { success: true, participant, call };
  }

  const now = new Date();
  const updatedPart = await client.callParticipant.update({
    where: { id: participant.id },
    data: {
      status: ParticipantStatus.DECLINED,
      failureReason: reason ?? "DECLINED",
      leftAt: now,
    },
  });

  await emitCallEvent(client, {
    callSessionId: call.id,
    type: CallEventType.PARTICIPANT_DECLINED,
    actorId: userId,
    payload: { reason },
    dedupeKey: `${call.id}:PARTICIPANT_DECLINED:${userId}`,
  });

  const isDirect = call.conversation.type === "DIRECT";

  if (isDirect) {
    const updatedCalls = await client.callSession.updateMany({
      where: {
        id: call.id,
        status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
      },
      data: {
        status: CallStatus.ENDED,
        endedAt: now,
        terminationReason: CallTerminationReason.DECLINED,
        terminationDetail: `Declined by ${userId}`,
      },
    });

    if (updatedCalls.count > 0) {
      await emitCallEvent(client, {
        callSessionId: call.id,
        type: CallEventType.CALL_ENDED,
        actorId: userId,
        payload: { reason: "DECLINED_1ON1" },
        dedupeKey: `${call.id}:CALL_ENDED`,
      });
    }

    const updatedCall = await client.callSession.findUnique({ where: { id: call.id } });
    return { success: true, participant: updatedPart, call: updatedCall };
  }

  const remainingActiveOrInvited = call.participants.filter(
    (p) => p.userId !== userId && !INACTIVE_PARTICIPANT_STATUSES.has(p.status)
  );

  if (remainingActiveOrInvited.length <= 1 && call.status !== CallStatus.ACTIVE) {
    const updatedCalls = await client.callSession.updateMany({
      where: {
        id: call.id,
        status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
      },
      data: {
        status: CallStatus.ENDED,
        endedAt: now,
        terminationReason: CallTerminationReason.DECLINED,
        terminationDetail: "All invitees declined",
      },
    });

    if (updatedCalls.count > 0) {
      await emitCallEvent(client, {
        callSessionId: call.id,
        type: CallEventType.CALL_ENDED,
        actorId: userId,
        payload: { reason: "ALL_INVITEES_DECLINED" },
        dedupeKey: `${call.id}:CALL_ENDED`,
      });
    }

    const updatedCall = await client.callSession.findUnique({ where: { id: call.id } });
    return { success: true, participant: updatedPart, call: updatedCall };
  }

  return { success: true, participant: updatedPart, call };
}

/**
 * Initiator cancels an outgoing call before it becomes active.
 */
export async function cancelCall(
  client: DbClient,
  callId: string,
  userId: string,
  reason?: string
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: true, call };
  }

  if (call.initiatorId !== userId && call.hostId !== userId) {
    return { success: false, error: "Only the call initiator or host can cancel the call", code: 403 };
  }

  if (call.status === CallStatus.ACTIVE) {
    return { success: false, error: "Cannot cancel an active call. Use end call instead.", code: 400 };
  }

  const now = new Date();

  await client.callParticipant.updateMany({
    where: {
      callSessionId: call.id,
      status: { in: [ParticipantStatus.INVITED, ParticipantStatus.RINGING, ParticipantStatus.ACCEPTED, ParticipantStatus.CONNECTING] },
    },
    data: {
      status: ParticipantStatus.CANCELLED,
      leftAt: now,
    },
  });

  const updatedCalls = await client.callSession.updateMany({
    where: {
      id: call.id,
      status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
    },
    data: {
      status: CallStatus.CANCELLED,
      endedAt: now,
      terminationReason: CallTerminationReason.CANCELLED_BY_CALLER,
      terminationDetail: reason ?? "Cancelled by initiator",
    },
  });

  if (updatedCalls.count > 0) {
    await emitCallEvent(client, {
      callSessionId: call.id,
      type: CallEventType.CALL_CANCELLED,
      actorId: userId,
      payload: { reason },
      dedupeKey: `${call.id}:CALL_CANCELLED`,
    });
  }

  const updatedCall = await client.callSession.findUnique({ where: { id: call.id } });
  return { success: true, call: updatedCall };
}

/**
 * Participant leaves an ongoing call.
 * Sets departing participant isHost to false.
 * Correctly reassigns host if the host departs, ensuring no more than one host exists.
 */
export async function leaveCall(
  client: DbClient,
  callId: string,
  userId: string,
  isUnload: boolean = false
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: {
      participants: { orderBy: { joinedAt: "asc" } },
      conversation: { select: { type: true } },
    },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: true, call };
  }

  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    return { success: false, error: "Participant not found", code: 404 };
  }

  if (participant.status === ParticipantStatus.LEFT || participant.status === ParticipantStatus.DECLINED || participant.status === ParticipantStatus.EJECTED) {
    return { success: true, participant, call };
  }

  const now = new Date();

  // If this leave is triggered by browser unload (sendBeacon), mark as DISCONNECTED rather
  // than permanently LEFT to allow call recovery across page refresh (Stage B).
  if (isUnload) {
    await client.callParticipant.update({
      where: { id: participant.id },
      data: {
        status: ParticipantStatus.DISCONNECTED,
        disconnectedAt: now,
      },
    });

    await client.callEvent.create({
      data: {
        callSessionId: call.id,
        type: CallEventType.PARTICIPANT_DISCONNECTED,
        actorId: userId,
        payload: { reason: "browser_unload" },
      },
    });

    const activeParticipants = call.participants.filter(
      (p) => p.userId !== userId && (p.status === ParticipantStatus.CONNECTED || p.status === ParticipantStatus.CONNECTING)
    );

    if (activeParticipants.length === 0) {
      const emptyRoomTimeoutAt = new Date(now.getTime() + EMPTY_ROOM_TIMEOUT_SECONDS * 1000);
      await client.callSession.updateMany({
        where: { id: call.id, status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] } },
        data: { emptyRoomTimeoutAt },
      });
    }

    const updatedCall = await client.callSession.findUnique({ where: { id: call.id } });
    return { success: true, participant: { ...participant, status: ParticipantStatus.DISCONNECTED }, call: updatedCall };
  }

  // Departing participant's isHost flag MUST be reset to false
  await client.callParticipant.update({
    where: { id: participant.id },
    data: {
      status: ParticipantStatus.LEFT,
      leftAt: now,
      isHost: false,
    },
  });

  await client.callEvent.create({
    data: {
      callSessionId: call.id,
      type: CallEventType.PARTICIPANT_LEFT,
      actorId: userId,
    },
  });

  const remainingParticipants = call.participants.filter(
    (p) => p.userId !== userId && ACCEPTED_OR_CONNECTING_PARTICIPANT_STATUSES.has(p.status)
  );

  const isDirect = call.conversation.type === "DIRECT";
  const shouldEnd = isDirect || remainingParticipants.length === 0;

  if (shouldEnd) {
    const updatedCalls = await client.callSession.updateMany({
      where: {
        id: call.id,
        status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
      },
      data: {
        status: CallStatus.ENDED,
        endedAt: now,
        terminationReason: CallTerminationReason.NORMAL,
        terminationDetail: isDirect ? `Participant ${userId} left 1-on-1 call` : "All participants left",
      },
    });

    if (updatedCalls.count > 0) {
      await client.callEvent.create({
        data: {
          callSessionId: call.id,
          type: CallEventType.CALL_ENDED,
          actorId: userId,
        },
      });
    }

    const endedCall = await client.callSession.findUnique({ where: { id: call.id } });
    return { success: true, call: endedCall };
  }

  let currentHostId = call.hostId;
  if (call.hostId === userId) {
    // Select new host from active, non-disabled conversation members only
    const activeMembers = await client.conversationMember.findMany({
      where: { conversationId: call.conversationId, user: { disabledAt: null } },
      select: { userId: true },
    });
    const activeMemberSet = new Set(activeMembers.map((m) => m.userId));

    const eligible = remainingParticipants.filter((p) => activeMemberSet.has(p.userId));
    const nextHost = eligible.find((p) => p.status === ParticipantStatus.CONNECTED) || eligible[0];

    if (nextHost) {
      currentHostId = nextHost.userId;
      // Guarantee exactly one participant is host
      await client.callParticipant.updateMany({
        where: { callSessionId: call.id, isHost: true },
        data: { isHost: false },
      });
      await client.callParticipant.update({
        where: { id: nextHost.id },
        data: { isHost: true },
      });
      await client.callSession.update({
        where: { id: call.id },
        data: { hostId: currentHostId },
      });
      await client.callEvent.create({
        data: {
          callSessionId: call.id,
          type: CallEventType.HOST_REASSIGNED,
          actorId: userId,
          targetUserId: currentHostId,
        },
      });
    }
  }

  return { success: true, call: { ...call, hostId: currentHostId } };
}

/**
 * Host ends call for everyone.
 * Only the authorized host is permitted to execute this action.
 */
export async function endCallForEveryone(
  client: DbClient,
  callId: string,
  actorId: string,
  reason?: string
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: true, call };
  }

  if (call.hostId !== actorId) {
    return { success: false, error: "Only the authorized call host can end the call for everyone", code: 403 };
  }

  // Verify host is still an active member of the conversation
  const hostMember = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: call.conversationId, userId: actorId } },
  });
  if (!hostMember) {
    return { success: false, error: "Host is no longer a member of this conversation", code: 403 };
  }

  const now = new Date();

  await client.callParticipant.updateMany({
    where: {
      callSessionId: call.id,
      status: { in: [ParticipantStatus.INVITED, ParticipantStatus.RINGING, ParticipantStatus.ACCEPTED, ParticipantStatus.CONNECTING, ParticipantStatus.CONNECTED] },
    },
    data: {
      status: ParticipantStatus.LEFT,
      leftAt: now,
      isHost: false,
    },
  });

  const updatedCalls = await client.callSession.updateMany({
    where: {
      id: call.id,
      status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
    },
    data: {
      status: CallStatus.ENDED,
      endedAt: now,
      terminationReason: CallTerminationReason.HOST_ENDED,
      terminationDetail: reason ?? `Ended by host ${actorId}`,
    },
  });

  if (updatedCalls.count > 0) {
    await emitCallEvent(client, {
      callSessionId: call.id,
      type: CallEventType.CALL_ENDED,
      actorId,
      payload: { reason: "HOST_ENDED" },
      dedupeKey: `${call.id}:CALL_ENDED`,
    });
  }

  const endedCall = await client.callSession.findUnique({ where: { id: call.id } });
  return { success: true, call: endedCall };
}

/**
 * Uninvited or late conversation member joins an ongoing call (Self-Join).
 */
export async function joinCall(
  client: DbClient,
  callId: string,
  userId: string
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: {
      participants: true,
      conversation: { select: { type: true } },
    },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: false, error: "Call has already ended", code: 400 };
  }

  // Strict fresh membership check
  const member = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: call.conversationId, userId } },
    include: { user: { select: { disabledAt: true } } },
  });
  if (!member || member.user.disabledAt) {
    return { success: false, error: "You are not an active member of this conversation", code: 403 };
  }

  // Cross-conversation busy check: User cannot already be in another call
  const userBusy = await client.callParticipant.findFirst({
    where: {
      userId,
      callSessionId: { not: call.id },
      status: { in: [ParticipantStatus.RINGING, ParticipantStatus.CONNECTING, ParticipantStatus.CONNECTED] },
      callSession: {
        status: { in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] },
      },
    },
  });
  if (userBusy) {
    return {
      success: false,
      error: "You are already participating in another active call",
      code: 409,
    };
  }

  // Conservative participant cap: default 10 participants
  const maxParticipants = 10;
  const activeCount = call.participants.filter(
    (p) => p.userId !== userId && ACCEPTED_OR_CONNECTING_PARTICIPANT_STATUSES.has(p.status)
  ).length;

  if (activeCount >= maxParticipants) {
    return { success: false, error: `Call has reached the maximum capacity of ${maxParticipants} participants`, code: 403 };
  }

  const existingPart = call.participants.find((p) => p.userId === userId);
  const now = new Date();

  let participantRecord: any;
  if (existingPart) {
    participantRecord = await client.callParticipant.update({
      where: { id: existingPart.id },
      data: {
        status: ParticipantStatus.CONNECTING,
        answeredAt: now,
        leftAt: null,
        failureReason: null,
      },
    });
  } else {
    participantRecord = await client.callParticipant.create({
      data: {
        callSessionId: call.id,
        userId,
        status: ParticipantStatus.CONNECTING,
        isHost: false,
        answeredAt: now,
        invitedAt: now,
      },
    });
  }

  let newCallStatus = call.status;
  if (call.status === CallStatus.CREATED || call.status === CallStatus.RINGING) {
    newCallStatus = CallStatus.CONNECTING;
    await client.callSession.updateMany({
      where: { id: call.id, status: { in: [CallStatus.CREATED, CallStatus.RINGING] } },
      data: { status: newCallStatus },
    });
  }

  await emitCallEvent(client, {
    callSessionId: call.id,
    type: CallEventType.PARTICIPANT_ACCEPTED,
    actorId: userId,
    dedupeKey: `${call.id}:PARTICIPANT_ACCEPTED:${userId}`,
  });

  const updatedCall = await client.callSession.findUnique({
    where: { id: call.id },
    include: {
      participants: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } } },
      initiator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      host: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  return { success: true, participant: participantRecord, call: updatedCall };
}

/**
 * Host removes an unruly or misbehaving participant from the call (Host Kick).
 * Updates participant status to EJECTED, queues SFU ejection outbox job, and reassigns host if needed.
 */
export async function kickParticipant(
  client: DbClient,
  callId: string,
  hostUserId: string,
  targetUserId: string,
  reason?: string
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: {
      participants: true,
      conversation: { select: { type: true } },
    },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: false, error: "Call has already ended", code: 400 };
  }

  if (call.hostId !== hostUserId) {
    return { success: false, error: "Only the call host can remove participants", code: 403 };
  }

  if (hostUserId === targetUserId) {
    return { success: false, error: "Host cannot remove themselves; use leave instead", code: 400 };
  }

  const targetPart = call.participants.find((p) => p.userId === targetUserId);
  if (!targetPart) {
    return { success: false, error: "Participant not found in call", code: 404 };
  }

  if (targetPart.status === ParticipantStatus.EJECTED || targetPart.status === ParticipantStatus.LEFT) {
    return { success: true, participant: targetPart, call };
  }

  const now = new Date();

  // 1. Update participant status to EJECTED
  const updatedPart = await client.callParticipant.update({
    where: { id: targetPart.id },
    data: {
      status: ParticipantStatus.EJECTED,
      failureReason: reason ?? "KICKED_BY_HOST",
      leftAt: now,
      isHost: false,
    },
  });

  // 2. Emit event
  await emitCallEvent(client, {
    callSessionId: call.id,
    type: CallEventType.PARTICIPANT_EJECTED,
    actorId: hostUserId,
    targetUserId,
    payload: { reason: reason ?? "KICKED_BY_HOST" },
    dedupeKey: `${call.id}:PARTICIPANT_EJECTED:${targetUserId}`,
  });

  // 3. Queue SFU ejection job into transactional outbox
  const job = await queueSfuEjection(client, {
    callSessionId: call.id,
    roomName: call.livekitRoomName,
    userId: targetUserId,
  });

  // 4. Check remaining participants
  const remainingParticipants = call.participants.filter(
    (p) => p.userId !== targetUserId && ACCEPTED_OR_CONNECTING_PARTICIPANT_STATUSES.has(p.status)
  );

  const isDirect = call.conversation.type === "DIRECT";
  if (isDirect || remainingParticipants.length === 0) {
    await client.callSession.updateMany({
      where: {
        id: call.id,
        status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
      },
      data: {
        status: CallStatus.ENDED,
        endedAt: now,
        terminationReason: CallTerminationReason.NORMAL,
        terminationDetail: isDirect ? "1-on-1 participant removed" : "All participants removed or left",
      },
    });
  }

  const updatedCall = await client.callSession.findUnique({
    where: { id: call.id },
    include: {
      participants: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } } },
      initiator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      host: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  return { success: true, participant: updatedPart, call: updatedCall, data: { queuedJobId: job.id } };
}

/**
 * Host transfers host privileges to another connected participant.
 */
export async function transferHost(
  client: DbClient,
  callId: string,
  currentHostUserId: string,
  newHostUserId: string
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: {
      participants: true,
      conversation: { select: { type: true } },
    },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: false, error: "Call has already ended", code: 400 };
  }

  if (call.hostId !== currentHostUserId) {
    return { success: false, error: "Only the current call host can transfer host privileges", code: 403 };
  }

  if (currentHostUserId === newHostUserId) {
    return { success: true, call };
  }

  // Verify new host is an active member of conversation
  const newHostMember = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: call.conversationId, userId: newHostUserId } },
    include: { user: { select: { disabledAt: true } } },
  });
  if (!newHostMember || newHostMember.user.disabledAt) {
    return { success: false, error: "Target user is not an active member of this conversation", code: 400 };
  }

  const targetPart = call.participants.find((p) => p.userId === newHostUserId);
  if (!targetPart || INACTIVE_PARTICIPANT_STATUSES.has(targetPart.status)) {
    return { success: false, error: "Target user is not an active participant in this call", code: 400 };
  }

  // Atomically swap isHost flags
  await client.callParticipant.updateMany({
    where: { callSessionId: call.id, isHost: true },
    data: { isHost: false },
  });

  await client.callParticipant.update({
    where: { id: targetPart.id },
    data: { isHost: true },
  });

  await client.callSession.update({
    where: { id: call.id },
    data: { hostId: newHostUserId },
  });

  await emitCallEvent(client, {
    callSessionId: call.id,
    type: CallEventType.HOST_REASSIGNED,
    actorId: currentHostUserId,
    targetUserId: newHostUserId,
    dedupeKey: `${call.id}:HOST_REASSIGNED:${newHostUserId}`,
  });

  const updatedCall = await client.callSession.findUnique({
    where: { id: call.id },
    include: {
      participants: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } } } },
      initiator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      host: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  return { success: true, call: updatedCall };
}

/**
 * Proactively ejects a user from all currently active calls they are participating in.
 * Invoked during administrative account disablement.
 * Atomically marks participants EJECTED, reassigns host if needed, and terminates calls
 * if no active participants remain.
 */
export async function ejectUserFromActiveCalls(
  client: DbClient,
  userId: string,
  actorId?: string
): Promise<{ ejectedCount: number; endedCallIds: string[]; reassignedCallIds: string[]; queuedJobIds: string[] }> {
  const activeParticipations = await client.callParticipant.findMany({
    where: {
      userId,
      status: {
        in: [
          ParticipantStatus.INVITED,
          ParticipantStatus.RINGING,
          ParticipantStatus.ACCEPTED,
          ParticipantStatus.CONNECTING,
          ParticipantStatus.CONNECTED,
        ],
      },
      callSession: {
        status: {
          in: [CallStatus.CREATED, CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE],
        },
      },
    },
    include: {
      callSession: {
        include: {
          participants: { orderBy: { joinedAt: "asc" } },
          conversation: { select: { type: true } },
        },
      },
    },
  });

  let ejectedCount = 0;
  const endedCallIds: string[] = [];
  const reassignedCallIds: string[] = [];
  const queuedJobIds: string[] = [];
  const now = new Date();

  for (const part of activeParticipations) {
    const call = part.callSession;
    if (TERMINAL_CALL_STATUSES.has(call.status)) continue;

    // 1. Mark participant as EJECTED
    await client.callParticipant.update({
      where: { id: part.id },
      data: {
        status: ParticipantStatus.EJECTED,
        leftAt: now,
        isHost: false,
        failureReason: "User account disabled by administrator",
      },
    });
    ejectedCount++;

    // 1b. Atomically queue SFU ejection job into transactional outbox (no network call held)
    const outboxJob = await queueSfuEjection(client, {
      callSessionId: call.id,
      roomName: call.livekitRoomName,
      userId,
    });
    queuedJobIds.push(outboxJob.id);

    // 2. Emit PARTICIPANT_EJECTED event
    await emitCallEvent(client, {
      callSessionId: call.id,
      type: CallEventType.PARTICIPANT_EJECTED,
      actorId: actorId || userId,
      targetUserId: userId,
      payload: { reason: "ACCOUNT_DISABLED" },
      dedupeKey: `${call.id}:PARTICIPANT_EJECTED:${userId}:${now.getTime()}`,
    });

    // 3. Determine remaining active participants
    const remainingParticipants = call.participants.filter(
      (p) =>
        p.userId !== userId &&
        (p.status === ParticipantStatus.RINGING ||
          p.status === ParticipantStatus.ACCEPTED ||
          p.status === ParticipantStatus.CONNECTING ||
          p.status === ParticipantStatus.CONNECTED)
    );

    const isDirect = call.conversation.type === "DIRECT";
    const shouldEnd = isDirect || remainingParticipants.length === 0;

    if (shouldEnd) {
      // Terminate call
      const updated = await client.callSession.updateMany({
        where: {
          id: call.id,
          status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
        },
        data: {
          status: CallStatus.ENDED,
          endedAt: now,
          terminationReason: CallTerminationReason.NORMAL,
          terminationDetail: isDirect ? "1-on-1 participant ejected" : "All active participants left or ejected",
        },
      });

      if (updated.count > 0) {
        await emitCallEvent(client, {
          callSessionId: call.id,
          type: CallEventType.CALL_ENDED,
          actorId: actorId || userId,
          payload: { reason: "ALL_PARTICIPANTS_EJECTED" },
          dedupeKey: `${call.id}:CALL_ENDED:ejection_${userId}`,
        });
        endedCallIds.push(call.id);
      }
    } else if (call.hostId === userId) {
      // Reassign host if disabled user was host
      const activeMembers = await client.conversationMember.findMany({
        where: {
          conversationId: call.conversationId,
          user: { disabledAt: null, id: { not: userId } },
        },
        select: { userId: true },
      });
      const activeMemberSet = new Set(activeMembers.map((m) => m.userId));
      const eligible = remainingParticipants.filter((p) => activeMemberSet.has(p.userId));
      const nextHost = eligible.find((p) => p.status === ParticipantStatus.CONNECTED) || eligible[0];

      if (nextHost) {
        await client.callParticipant.updateMany({
          where: { callSessionId: call.id, isHost: true },
          data: { isHost: false },
        });
        await client.callParticipant.update({
          where: { id: nextHost.id },
          data: { isHost: true },
        });
        await client.callSession.update({
          where: { id: call.id },
          data: { hostId: nextHost.userId },
        });
        await emitCallEvent(client, {
          callSessionId: call.id,
          type: CallEventType.HOST_REASSIGNED,
          actorId: actorId || userId,
          targetUserId: nextHost.userId,
          dedupeKey: `${call.id}:HOST_REASSIGNED:${nextHost.userId}:${now.getTime()}`,
        });
        reassignedCallIds.push(call.id);
      } else {
        // No eligible host remaining -> end call
        await client.callSession.updateMany({
          where: {
            id: call.id,
            status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
          },
          data: {
            status: CallStatus.ENDED,
            endedAt: now,
            terminationReason: CallTerminationReason.NORMAL,
            terminationDetail: "Host disabled and no eligible host remaining",
          },
        });
        await emitCallEvent(client, {
          callSessionId: call.id,
          type: CallEventType.CALL_ENDED,
          actorId: actorId || userId,
          payload: { reason: "HOST_EJECTED_NO_SUCCESSOR" },
          dedupeKey: `${call.id}:CALL_ENDED:no_host_${userId}`,
        });
        endedCallIds.push(call.id);
      }
    }
  }

  return { ejectedCount, endedCallIds, reassignedCallIds, queuedJobIds };
}

/**
 * Handles client-level connection telemetry or disconnection reporting.
 * TRUST BOUNDARY ENFORCEMENT: Normal authenticated clients CANNOT assert CONNECTED or ACTIVE.
 * Any client attempting to assert CONNECTED is rejected with 400 Bad Request.
 */
export async function recordClientParticipantEvent(
  client: DbClient,
  callId: string,
  userId: string,
  status: "DISCONNECTED" | "FAILED",
  failureReason?: string
): Promise<TransitionResult> {
  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: false, error: "Call is already ended", code: 400 };
  }

  // Verify conversation membership
  const membership = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: call.conversationId, userId } },
  });

  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    return { success: false, error: "Participant not found", code: 404 };
  }

  const now = new Date();

  // If user was removed from the conversation while in the call, eject them immediately
  if (!membership) {
    await client.callParticipant.update({
      where: { id: participant.id },
      data: {
        status: ParticipantStatus.EJECTED,
        failureReason: "REMOVED_FROM_CONVERSATION",
        leftAt: now,
        isHost: false,
      },
    });
    return { success: false, error: "User is no longer a member of this conversation", code: 403 };
  }

  const updateData: any = { status: status as ParticipantStatus };
  if (status === "DISCONNECTED") {
    updateData.disconnectedAt = now;
  } else if (status === "FAILED") {
    updateData.failureReason = failureReason || "CLIENT_REPORTED_FAILURE";
  }

  const updatedPart = await client.callParticipant.update({
    where: { id: participant.id },
    data: updateData,
  });

  await client.callEvent.create({
    data: {
      callSessionId: call.id,
      type: CallEventType.PARTICIPANT_DISCONNECTED,
      actorId: userId,
      payload: { failureReason },
    },
  });

  return { success: true, participant: updatedPart, call };
}

/**
 * Server-only interface for future LiveKit webhook receiver.
 * MUST NOT be callable by ordinary browser clients.
 * Requires verifiedByLiveKit: true flag from verified webhook receiver.
 */
export interface AuthoritativeMediaOptions {
  callId: string;
  userId: string;
  status: "CONNECTED" | "DISCONNECTED" | "FAILED";
  failureReason?: string;
  verifiedByLiveKit: boolean;
}

export async function recordAuthoritativeMediaConnectionState(
  client: DbClient,
  options: AuthoritativeMediaOptions
): Promise<TransitionResult> {
  const { callId, userId, status, failureReason, verifiedByLiveKit } = options;

  if (!verifiedByLiveKit) {
    return {
      success: false,
      error: "Authoritative media transitions require verified server-to-server webhook",
      code: 403,
    };
  }

  const call = await client.callSession.findUnique({
    where: { id: callId },
    include: { participants: true },
  });

  if (!call) return { success: false, error: "Call not found", code: 404 };
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return { success: false, error: "Call is already ended", code: 400 };
  }

  // Verify conversation membership
  const membership = await client.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: call.conversationId, userId } },
  });

  const participant = call.participants.find((p) => p.userId === userId);
  if (!participant) {
    return { success: false, error: "Participant not found", code: 404 };
  }

  // Idempotency: If participant is already in the requested connection state, no-op safely
  if (status === "CONNECTED" && participant.status === ParticipantStatus.CONNECTED) {
    return { success: true, participant, call };
  }

  const now = new Date();

  if (!membership) {
    await client.callParticipant.update({
      where: { id: participant.id },
      data: {
        status: ParticipantStatus.EJECTED,
        failureReason: "REMOVED_FROM_CONVERSATION",
        leftAt: now,
        isHost: false,
      },
    });
    return { success: false, error: "User is no longer a member of this conversation", code: 403 };
  }

  const updateData: any = { status: status as ParticipantStatus };
  if (status === "CONNECTED") {
    updateData.joinedAt = participant.joinedAt || now;
  } else if (status === "DISCONNECTED") {
    updateData.disconnectedAt = now;
  } else if (status === "FAILED") {
    updateData.failureReason = failureReason || "MEDIA_FAILURE";
  }

  const updatedPart = await client.callParticipant.update({
    where: { id: participant.id },
    data: updateData,
  });

  await emitCallEvent(client, {
    callSessionId: call.id,
    type: status === "CONNECTED" ? CallEventType.PARTICIPANT_CONNECTED : CallEventType.PARTICIPANT_DISCONNECTED,
    actorId: userId,
    payload: { failureReason },
    dedupeKey: `${call.id}:${status === "CONNECTED" ? "PARTICIPANT_CONNECTED" : "PARTICIPANT_DISCONNECTED"}:${userId}`,
  });

  const allParts = await client.callParticipant.findMany({
    where: { callSessionId: call.id },
  });

  const connectedCount = allParts.filter((p) => p.status === ParticipantStatus.CONNECTED).length;

  if (connectedCount >= 2 && call.status !== CallStatus.ACTIVE) {
    await client.callSession.updateMany({
      where: { id: call.id, status: { not: CallStatus.ACTIVE } },
      data: {
        status: CallStatus.ACTIVE,
        startedAt: call.startedAt || now,
        ringTimeoutAt: null,
        staleConnectingTimeoutAt: null,
        emptyRoomTimeoutAt: null,
      },
    });

    await emitCallEvent(client, {
      callSessionId: call.id,
      type: CallEventType.CALL_ACTIVE,
      payload: { connectedCount },
      dedupeKey: `${call.id}:CALL_ACTIVE`,
    });

    const updatedCall = await client.callSession.findUnique({ where: { id: call.id } });
    return { success: true, participant: updatedPart, call: updatedCall };
  }

  if (call.status === CallStatus.ACTIVE && connectedCount === 0) {
    const emptyRoomTimeoutAt = new Date(now.getTime() + EMPTY_ROOM_TIMEOUT_SECONDS * 1000);
    await client.callSession.updateMany({
      where: { id: call.id, status: CallStatus.ACTIVE },
      data: { emptyRoomTimeoutAt },
    });
    const updatedCall = await client.callSession.findUnique({ where: { id: call.id } });
    return { success: true, participant: updatedPart, call: updatedCall };
  }

  return { success: true, participant: updatedPart, call };
}

/**
 * Backward-compatible facade for connection state recording.
 * Rejects client attempts to assert CONNECTED without verified server credentials.
 */
export async function recordParticipantConnectionState(
  client: DbClient,
  callId: string,
  userId: string,
  newStatus: "CONNECTED" | "DISCONNECTED" | "FAILED",
  failureReason?: string,
  isServerVerified: boolean = false
): Promise<TransitionResult> {
  if (newStatus === "CONNECTED" && !isServerVerified) {
    return {
      success: false,
      error: "Client cannot assert authoritative CONNECTED state. Media connectivity requires verified server webhook.",
      code: 400,
    };
  }

  if (isServerVerified) {
    return recordAuthoritativeMediaConnectionState(client, {
      callId,
      userId,
      status: newStatus,
      failureReason,
      verifiedByLiveKit: true,
    });
  }

  return recordClientParticipantEvent(client, callId, userId, newStatus as "DISCONNECTED" | "FAILED", failureReason);
}

/**
 * Sweep function for background recovery of expired calls:
 * - ringTimeout: unanswered calls transition to ENDED/MISSED.
 * - staleConnectingTimeout: connecting calls with < 2 connected participants fail safely.
 * - emptyRoomTimeout: active calls with 0 participants end.
 * Uses atomic conditional updates (updateMany) to ensure complete concurrency safety
 * across multiple workers and prevent duplicate lifecycle events.
 */
export async function sweepCallTimeouts(
  client: DbClient
): Promise<{ expiredRings: number; staleConnecting: number; emptyRooms: number }> {
  const now = new Date();
  let expiredRings = 0;
  let staleConnecting = 0;
  let emptyRooms = 0;

  // 1. Ring timeout sweep: atomic conditional update
  const ringingCalls = await client.callSession.findMany({
    where: {
      status: { in: [CallStatus.CREATED, CallStatus.RINGING] },
      ringTimeoutAt: { lte: now },
    },
    select: { id: true, conversationId: true },
  });

  for (const item of ringingCalls) {
    const updated = await client.callSession.updateMany({
      where: {
        id: item.id,
        status: { in: [CallStatus.CREATED, CallStatus.RINGING] },
        ringTimeoutAt: { lte: now },
      },
      data: {
        status: CallStatus.ENDED,
        endedAt: now,
        terminationReason: CallTerminationReason.TIMEOUT,
        terminationDetail: "Call unanswered within ring timeout",
      },
    });

    if (updated.count > 0) {
      publishCallStateChange(item.conversationId, {
        callId: item.id,
        status: CallStatus.ENDED,
        terminationReason: CallTerminationReason.TIMEOUT,
      });

      await client.callParticipant.updateMany({
        where: {
          callSessionId: item.id,
          status: { in: [ParticipantStatus.INVITED, ParticipantStatus.RINGING] },
        },
        data: {
          status: ParticipantStatus.MISSED,
          failureReason: "RING_TIMEOUT",
          leftAt: now,
        },
      });

      await emitCallEvent(client, {
        callSessionId: item.id,
        type: CallEventType.TIMEOUT_TRIGGERED,
        payload: { type: "RING_TIMEOUT" },
        dedupeKey: `${item.id}:TIMEOUT:RING_TIMEOUT`,
      });
      expiredRings++;
    }
  }

  // 2. Stale connecting timeout sweep: atomic conditional update
  const connectingCalls = await client.callSession.findMany({
    where: {
      status: CallStatus.CONNECTING,
      staleConnectingTimeoutAt: { lte: now },
    },
    include: { participants: true },
  });

  for (const call of connectingCalls) {
    const connectedCount = call.participants.filter((p) => p.status === ParticipantStatus.CONNECTED).length;
    if (connectedCount < 2) {
      const updated = await client.callSession.updateMany({
        where: {
          id: call.id,
          status: CallStatus.CONNECTING,
          staleConnectingTimeoutAt: { lte: now },
        },
        data: {
          status: CallStatus.FAILED,
          endedAt: now,
          terminationReason: CallTerminationReason.TIMEOUT,
          terminationDetail: "Failed to establish media connection between 2 participants within timeout",
        },
      });

      if (updated.count > 0) {
        await emitCallEvent(client, {
          callSessionId: call.id,
          type: CallEventType.TIMEOUT_TRIGGERED,
          payload: { type: "STALE_CONNECTING_TIMEOUT" },
          dedupeKey: `${call.id}:TIMEOUT:STALE_CONNECTING_TIMEOUT`,
        });
        staleConnecting++;
      }
    }
  }

  // 3. Empty room timeout sweep: atomic conditional update
  const emptyCalls = await client.callSession.findMany({
    where: {
      status: CallStatus.ACTIVE,
      emptyRoomTimeoutAt: { lte: now },
    },
    include: { participants: true },
  });

  for (const call of emptyCalls) {
    const connectedCount = call.participants.filter((p) => p.status === ParticipantStatus.CONNECTED).length;
    if (connectedCount === 0) {
      const updated = await client.callSession.updateMany({
        where: {
          id: call.id,
          status: CallStatus.ACTIVE,
          emptyRoomTimeoutAt: { lte: now },
        },
        data: {
          status: CallStatus.ENDED,
          endedAt: now,
          terminationReason: CallTerminationReason.EMPTY_ROOM,
          terminationDetail: "All participants left the room",
        },
      });

      if (updated.count > 0) {
        await emitCallEvent(client, {
          callSessionId: call.id,
          type: CallEventType.TIMEOUT_TRIGGERED,
          payload: { type: "EMPTY_ROOM_TIMEOUT" },
          dedupeKey: `${call.id}:TIMEOUT:EMPTY_ROOM_TIMEOUT`,
        });
        emptyRooms++;
      }
    }
  }

  // 4. Sweep expired idempotency keys
  await sweepExpiredIdempotencyKeys(client).catch(() => {});

  return { expiredRings, staleConnecting, emptyRooms };
}
