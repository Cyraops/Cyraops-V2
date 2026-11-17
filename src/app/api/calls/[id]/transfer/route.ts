import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { transferHost } from "@/lib/calling/state-machine";
import { publishCallStateChange } from "@/lib/realtime";

type Context = { params: Promise<{ id: string }> };

const transferSchema = z.object({
  newHostUserId: z.string().min(1).max(64),
});

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.disabledAt) return jsonError("Account is disabled", 403);

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid target user ID for host transfer", 400);
  }

  const result = await db.$transaction(async (tx) => {
    return transferHost(tx, id, user.id, parsed.data.newHostUserId);
  });

  if (!result.success) {
    return jsonError(result.error ?? "Could not transfer host privileges", result.code ?? 400);
  }

  if (result.call) {
    publishCallStateChange(result.call.conversationId, {
      callId: result.call.id,
      status: result.call.status,
      actorId: user.id,
      hostId: parsed.data.newHostUserId,
      isGroup: true,
      activeParticipantsCount: (result.call.participants || []).filter((p: any) => p.status === "CONNECTED" || p.status === "CONNECTING").length,
    });
  }

  return Response.json({ ok: true, call: result.call });
}

