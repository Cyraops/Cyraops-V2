import { NextRequest } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/validators";
import { getLiveKitConfig, isLiveKitConfigured } from "@/lib/calling/config";
import { removeLiveKitParticipant } from "@/lib/calling/livekit-room";
import {
  recordAuthoritativeMediaConnectionState,
  leaveCall,
  ejectUserFromActiveCalls,
} from "@/lib/calling/state-machine";
import { triggerImmediateSfuEjection } from "@/lib/calling/outbox";
import { publishCallStateChange } from "@/lib/realtime";
import { CallStatus, CallTerminationReason } from "@prisma/client";

const TERMINAL_CALL_STATUSES = new Set<CallStatus>([
  CallStatus.ENDED,
  CallStatus.CANCELLED,
  CallStatus.FAILED,
]);

export async function POST(request: NextRequest) {
  if (!isLiveKitConfigured()) {
    return jsonError("LiveKit service not configured", 503);
  }

  const { apiKey, apiSecret } = getLiveKitConfig();
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");

  if (!authHeader) {
    return jsonError("Missing authorization header", 401);
  }

  const rawBody = await request.text();

  let event: any;
  try {
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    event = await receiver.receive(rawBody, authHeader);
  } catch (err: any) {
    console.warn("[LiveKitWebhook] Signature verification failed:", err?.message || err);
    return jsonError("Invalid webhook signature", 401);
  }

  const roomName = event.room?.name;
  if (!roomName) {
    return Response.json({ status: "ignored", reason: "Missing room name in webhook event" }, { status: 200 });
  }

  // 1. Map room name to stored CallSession
  const call = await db.callSession.findUnique({
    where: { livekitRoomName: roomName },
    include: {
      participants: true,
      conversation: { select: { type: true } },
    },
  });

  if (!call) {
    // Unknown room: safely acknowledge without crashing
    return Response.json({ status: "ignored", reason: "Unknown call room" }, { status: 200 });
  }

  // 2. Prevent delayed webhook events from resurrecting ended calls
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return Response.json({ status: "ignored", reason: "Call already terminated" }, { status: 200 });
  }

  const participantIdentity = event.participant?.identity;

  // 3. Process authoritative event types
  switch (event.event) {
    case "participant_joined": {
      if (!participantIdentity) {
        return Response.json({ status: "ignored", reason: "Missing participant identity" }, { status: 200 });
      }

      const participant = call.participants.find((p) => p.userId === participantIdentity);
      if (!participant) {
        return Response.json({ status: "ignored", reason: "Unknown participant in call" }, { status: 200 });
      }

      // Check if user account was disabled or participant was already ejected
      const user = await db.user.findUnique({
        where: { id: participantIdentity },
        select: { disabledAt: true },
      });
      if (user?.disabledAt || participant.status === "EJECTED") {
        const ejection = await ejectUserFromActiveCalls(db, participantIdentity, "livekit_webhook");
        if (ejection.queuedJobIds && ejection.queuedJobIds.length > 0) {
          await triggerImmediateSfuEjection(ejection.queuedJobIds);
        }
        try {
          await removeLiveKitParticipant(call.livekitRoomName, participantIdentity);
        } catch (e) {
          console.warn("[LiveKitWebhook] removeLiveKitParticipant error:", e);
        }
        return Response.json({ status: "ejected", reason: "User account disabled or participant ejected" }, { status: 200 });
      }

      // Authoritative media state change
      const result = await db.$transaction(async (tx) => {
        return recordAuthoritativeMediaConnectionState(tx, {
          callId: call.id,
          userId: participantIdentity,
          status: "CONNECTED",
          verifiedByLiveKit: true,
        });
      });

      if (result.success && result.call) {
        publishCallStateChange(call.conversationId, {
          callId: call.id,
          status: result.call.status,
          participantId: participant.id,
          participantStatus: "CONNECTED",
          actorId: participantIdentity,
        });
      }

      return Response.json({ status: "processed", event: "participant_joined", success: result.success });
    }

    case "participant_left": {
      if (!participantIdentity) {
        return Response.json({ status: "ignored", reason: "Missing participant identity" }, { status: 200 });
      }

      const participant = call.participants.find((p) => p.userId === participantIdentity);
      if (!participant) {
        return Response.json({ status: "ignored", reason: "Unknown participant in call" }, { status: 200 });
      }

      // Safe transactional leaveCall handling host reassignment or call termination.
      // Pass isUnload=true to treat SFU disconnection as a recoverable DISCONNECTED state
      // rather than permanent departure, enabling page refresh recovery (Stage B).
      const result = await db.$transaction(async (tx) => {
        return leaveCall(tx, call.id, participantIdentity, true);
      });

      if (result.success && result.call) {
        publishCallStateChange(call.conversationId, {
          callId: call.id,
          status: result.call.status,
          participantId: participant.id,
          participantStatus: result.call.status === "ENDED" ? "LEFT" : "DISCONNECTED",
          terminationReason: result.call.terminationReason,
          actorId: participantIdentity,
        });
      }

      return Response.json({ status: "processed", event: "participant_left", success: result.success });
    }

    case "room_finished": {
      const now = new Date();
      await db.callSession.updateMany({
        where: {
          id: call.id,
          status: { notIn: [CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED] },
        },
        data: {
          status: CallStatus.ENDED,
          endedAt: now,
          terminationReason: CallTerminationReason.NORMAL,
          terminationDetail: "LiveKit room finished",
        },
      });

      publishCallStateChange(call.conversationId, {
        callId: call.id,
        status: CallStatus.ENDED,
        terminationReason: CallTerminationReason.NORMAL,
      });

      return Response.json({ status: "processed", event: "room_finished" });
    }

    default:
      return Response.json({ status: "acknowledged", event: event.event }, { status: 200 });
  }
}
