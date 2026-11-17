import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logActivity, newToken, sameOrigin, sha256, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { canManageMember } from "@/lib/permissions";
import { buildSetupUrl } from "@/lib/urls";
import { sendInvitationEmail } from "@/lib/email/invite-mail";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const actor = await userFromRequest(request);
  if (!actor) return jsonError("Unauthorized", 401);
  if (actor.role === "MEMBER") return jsonError("Only an owner or admin can generate setup links", 403);

  const { id } = await context.params;
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return jsonError("Teammate not found", 404);

  if (target.disabledAt) {
    return jsonError("Cannot generate setup link for a deactivated teammate", 400);
  }

  if (target.passwordHash) {
    return jsonError("This employee already has an account password and can sign in directly", 400);
  }

  if (!canManageMember(actor.role, target.role)) {
    return jsonError("You do not have permission to generate a setup link for this teammate", 403);
  }

  const rawToken = newToken();
  const setupUrl = buildSetupUrl(rawToken);
  if (!setupUrl) {
    return jsonError("Server configuration error", 500);
  }

  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  await db.$transaction(async (tx) => {
    await tx.passwordSetupToken.deleteMany({
      where: { userId: target.id, usedAt: null },
    });

    await tx.passwordSetupToken.create({
      data: {
        tokenHash,
        userId: target.id,
        expiresAt,
      },
    });

    await tx.user.update({
      where: { id: target.id },
      data: { mustChangePassword: true },
    });
  });

  await logActivity({
    action: "invited",
    entity: "member",
    entityId: target.id,
    summary: `generated setup link for ${target.name} (${target.email ?? target.id})`,
    userId: actor.id,
  });

  const mail = await sendInvitationEmail({
    to: target.email,
    recipientName: target.name,
    setupUrl,
    invitedByName: actor.name,
    inviterId: actor.id,
    idempotencyKey: `invite-${target.id}-${tokenHash.slice(0, 16)}`,
  });

  return Response.json({
    ok: true,
    setupToken: rawToken,
    setupUrl,
    expiresAt: expiresAt.toISOString(),
    emailSent: mail.sent,
    emailReason: mail.reason,
  });
}

