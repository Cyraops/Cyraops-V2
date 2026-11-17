import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { kickParticipant } from "@/lib/calling/state-machine";
import { triggerImmediateSfuEjection } from "@/lib/calling/outbox";
import { removeLiveKitParticipant } from "@/lib/calling/livekit-room";
import { publishCallStateChange } from "@/lib/realtime";

type Context = { params: Promise<{ id: string }> };

const kickSchema = z.object({
  targetUserId: z.string().min(1).max(64),
  reason: z.string().max(250).optional(),
});

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.disabledAt) return jsonError("Account is disabled", 403);

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  const parsed = kickSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid target user", 400);
  }

  const result = await db.$transaction(async (tx) => {
    return kickParticipant(tx, id, user.id, parsed.data.targetUserId, parsed.data.reason);
  });

  if (!result.success) {
    return jsonError(result.error ?? "Could not remove participant", result.code ?? 400);
  }

  // Post-commit: Execute immediate SFU ejection outside database transaction
  if (result.data?.queuedJobId) {
    await triggerImmediateSfuEjection([result.data.queuedJobId]);
  }
  if (result.call?.livekitRoomName) {
    try {
      await removeLiveKitParticipant(result.call.livekitRoomName, parsed.data.targetUserId);
    } catch (err) {
      console.warn("[KickAPI] removeLiveKitParticipant notice:", err);
    }
  }

  if (result.call) {
    publishCallStateChange(result.call.conversationId, {
      callId: result.call.id,
      status: result.call.status,
      participantId: result.participant?.id,
      participantStatus: "EJECTED",
      actorId: user.id,
      isGroup: true,
      activeParticipantsCount: (result.call.participants || []).filter((p: any) => p.status === "CONNECTED" || p.status === "CONNECTING").length,
      hostId: result.call.hostId,
    });
  }

  return Response.json({ ok: true, participant: result.participant, call: result.call });
}

