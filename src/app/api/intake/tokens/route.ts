import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { createIntakeToken, disableIntakeToken, listIntakeTokens } from "@/lib/intake-token";

/**
 * Managing intake tokens.
 *
 * Only owners and admins may mint one, because a token creates leads attributed
 * to its owner — it is a standing grant, not a personal preference. Members can
 * see and revoke their own, so nobody is stuck holding a token they can no
 * longer use.
 */

const createSchema = z.object({
  label: z.string().trim().min(2).max(80),
  source: z.string().trim().max(40).optional(),
  assignedToId: z.string().trim().min(1).optional().nullable(),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const tokens = await listIntakeTokens(user.id);
  return Response.json({ tokens });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return jsonError("Only owners and admins can create intake tokens", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Send a JSON body", 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Give the token a label", 400);

  // Assigning to someone else is an admin decision; validate the target exists
  // so a typo cannot silently send every new lead to nowhere.
  let assignedToId = parsed.data.assignedToId ?? null;
  if (assignedToId) {
    const assignee = await db.user.findUnique({ where: { id: assignedToId }, select: { id: true, disabledAt: true } });
    if (!assignee || assignee.disabledAt) return jsonError("That assignee does not exist", 400);
  }

  const issued = await createIntakeToken({
    userId: user.id,
    label: parsed.data.label,
    source: parsed.data.source,
    assignedToId,
  });

  // `token` is returned exactly once and never stored in the clear.
  return Response.json({ ...issued, url: `/api/intake/${issued.token}` }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonError("Which token?", 400);

  const revoked = await disableIntakeToken({ id, userId: user.id });
  if (!revoked) return jsonError("Token not found", 404);
  return Response.json({ ok: true });
}
