import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { leaveCall } from "@/lib/calling/state-machine";
import { publishCallStateChange } from "@/lib/realtime";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await context.params;
  const url = new URL(request.url);
  const body = await request.json().catch(() => null);
  const isUnload = url.searchParams.get("reason") === "unload" || body?.reason === "unload";

  const result = await db.$transaction(async (tx) => {
    return leaveCall(tx, id, user.id, isUnload);
  });

  if (!result.success) {
    return jsonError(result.error ?? "Could not leave call", result.code ?? 400);
  }

  if (result.call) {
    publishCallStateChange(result.call.conversationId, {
      callId: result.call.id,
      status: result.call.status,
      participantStatus: isUnload ? "DISCONNECTED" : "LEFT",
      terminationReason: result.call.terminationReason,
      actorId: user.id,
    });
  }

  return Response.json({ ok: true, call: result.call });
}

