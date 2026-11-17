import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { muteLiveKitTrack } from "@/lib/calling/livekit-room";
import { CallEventType, CallStatus } from "@prisma/client";

type Context = { params: Promise<{ id: string }> };

const muteSchema = z.object({
  targetUserId: z.string().min(1).max(64),
  trackSid: z.string().min(1).max(128),
  muted: z.boolean().default(true),
});

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.disabledAt) return jsonError("Account is disabled", 403);

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  const parsed = muteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid mute parameters", 400);
  }

  const call = await db.callSession.findUnique({
    where: { id },
    select: { hostId: true, livekitRoomName: true, status: true },
  });

  if (!call) return jsonError("Call not found", 404);

  if (
    call.status === CallStatus.ENDED ||
    call.status === CallStatus.CANCELLED ||
    call.status === CallStatus.FAILED
  ) {
    return jsonError("Cannot mute participants in an inactive or ended call", 400);
  }

  if (call.hostId !== user.id) {
    return jsonError("Only the call host can mute participants", 403);
  }

  // Verify target is an active participant in this call
  const targetParticipant = await db.callParticipant.findFirst({
    where: { callSessionId: id, userId: parsed.data.targetUserId },
    select: { id: true, status: true },
  });

  if (!targetParticipant) {
    return jsonError("Target participant not found in this call", 404);
  }

  // 1. Enforce mute action on LiveKit SFU
  try {
    await muteLiveKitTrack(
      call.livekitRoomName,
      parsed.data.targetUserId,
      parsed.data.trackSid,
      parsed.data.muted
    );
  } catch (err: any) {
    console.error("[HostMuteAPI] Error muting track on SFU:", err);
    // Never write a success audit event if the LiveKit mute operation failed.
    return jsonError(err?.message || "Failed to mute track on SFU", 500);
  }

  // 2. Write corresponding CallEvent record to company_os_dev only after SFU operation succeeded
  try {
    const eventType = parsed.data.muted
      ? CallEventType.PARTICIPANT_MUTED
      : CallEventType.PARTICIPANT_UNMUTED;

    await db.callEvent.create({
      data: {
        callSessionId: id,
        type: eventType,
        actorId: user.id,
        targetUserId: parsed.data.targetUserId,
        payload: {
          action: parsed.data.muted ? "MUTE" : "UNMUTE",
          muted: parsed.data.muted,
          trackSid: parsed.data.trackSid,
          trackType: "AUDIO",
        },
      },
    });
  } catch (auditErr: any) {
    console.error("[HostMuteAPI] Failed to record CallEvent audit trail:", auditErr);
  }

  return Response.json({ ok: true, muted: parsed.data.muted });
}
