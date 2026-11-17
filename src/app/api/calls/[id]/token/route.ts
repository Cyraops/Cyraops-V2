import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { generateParticipantToken } from "@/lib/calling/livekit-token";
import { isLiveKitConfigured } from "@/lib/calling/config";

type Context = { params: Promise<{ id: string }> };

const JOINABLE_CALL_STATUSES = new Set(["CREATED", "RINGING", "CONNECTING", "ACTIVE"]);
const INELIGIBLE_PARTICIPANT_STATUSES = new Set(["LEFT", "DECLINED", "EJECTED", "CANCELLED", "FAILED"]);

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);

  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.disabledAt) return jsonError("Account is disabled", 403);

  if (!isLiveKitConfigured()) {
    return jsonError("LiveKit calling service is not configured on this server", 503);
  }

  const { id } = await context.params;

  const call = await db.callSession.findUnique({
    where: { id },
    include: {
      participants: true,
    },
  });

  if (!call) {
    return jsonError("Call not found", 404);
  }

  if (!JOINABLE_CALL_STATUSES.has(call.status)) {
    return jsonError("Call is no longer active", 410);
  }

  // 1. Fresh conversation membership verification
  const isMember = await db.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId: call.conversationId,
        userId: user.id,
      },
    },
  });

  if (!isMember) {
    return jsonError("You are not a member of this conversation", 403);
  }

  // 2. Participant record verification
  const participant = call.participants.find((p) => p.userId === user.id);
  if (!participant) {
    return jsonError("You are not a participant in this call", 403);
  }

  if (INELIGIBLE_PARTICIPANT_STATUSES.has(participant.status)) {
    return jsonError(`Participant is in an ineligible state (${participant.status.toLowerCase()})`, 403);
  }

  // 3. Issue cryptographically signed token bound strictly to session identity
  try {
    const { token, url } = await generateParticipantToken({
      roomName: call.livekitRoomName,
      userId: user.id,
      userName: user.name,
      canPublish: participant.canPublish,
      canSubscribe: participant.canSubscribe,
      ttlSeconds: 60, // Enforce short 60s TTL
    });

    const conv = await db.conversation.findUnique({
      where: { id: call.conversationId },
      select: { type: true, name: true },
    });

    return Response.json({
      token,
      url,
      roomName: call.livekitRoomName,
      isGroup: conv?.type === "GROUP",
      conversationName: conv?.name ?? null,
      hostId: call.hostId,
      participant: {
        id: participant.id,
        status: participant.status,
        isHost: participant.isHost,
      },
    });
  } catch (err: any) {
    console.error("[LiveKitToken] Token generation error:", err);
    return jsonError("Failed to issue calling token", 500);
  }
}

