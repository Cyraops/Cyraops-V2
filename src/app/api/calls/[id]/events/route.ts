import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { recordClientParticipantEvent } from "@/lib/calling/state-machine";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  // TRUST BOUNDARY ENFORCEMENT:
  // Reject any client attempt to assert authoritative media states (CONNECTED or ACTIVE)
  if (body?.status === "CONNECTED" || body?.status === "ACTIVE") {
    return jsonError(
      "Client cannot assert authoritative CONNECTED state. Media connectivity requires verified server webhook.",
      400
    );
  }

  const parsed = z.object({
    status: z.enum(["DISCONNECTED", "FAILED"]),
    failureReason: z.string().max(250).optional(),
  }).safeParse(body);

  if (!parsed.success) {
    return jsonError("Valid client participant status required (DISCONNECTED or FAILED)", 400);
  }

  const result = await db.$transaction(async (tx) => {
    return recordClientParticipantEvent(
      tx,
      id,
      user.id,
      parsed.data.status,
      parsed.data.failureReason
    );
  });

  if (!result.success) {
    return jsonError(result.error ?? "Could not record participant event", result.code ?? 400);
  }

  return Response.json({ ok: true, participant: result.participant, call: result.call });
}
