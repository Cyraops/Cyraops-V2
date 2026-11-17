import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logActivity, newToken, publicUserSelect, sameOrigin, sha256, userFromRequest } from "@/lib/auth";
import { emailSchema, jsonError, nameSchema } from "@/lib/validators";
import { buildSetupUrl } from "@/lib/urls";
import { sendInvitationEmail } from "@/lib/email/invite-mail";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const rawMembers = await db.user.findMany({
    where: { disabledAt: null },
    select: {
      ...publicUserSelect,
      createdAt: true,
      passwordHash: true,
      setupTokens: {
        where: { usedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const now = new Date();
  const members = rawMembers.map((m) => {
    const hasPassword = Boolean(m.passwordHash);
    const latestToken = m.setupTokens[0];
    let invitationStatus: "PASSWORD_SET" | "INVITATION_PENDING" | "INVITATION_EXPIRED" | "NOT_INVITED";
    if (hasPassword) {
      invitationStatus = "PASSWORD_SET";
    } else if (latestToken && latestToken.expiresAt > now) {
      invitationStatus = "INVITATION_PENDING";
    } else if (latestToken && latestToken.expiresAt <= now) {
      invitationStatus = "INVITATION_EXPIRED";
    } else {
      invitationStatus = "NOT_INVITED";
    }
    const { passwordHash: _hash, setupTokens: _tokens, ...safeUser } = m;
    return {
      ...safeUser,
      hasPassword,
      invitationStatus,
      invitationExpiresAt: (!hasPassword && latestToken) ? latestToken.expiresAt.toISOString() : null,
    };
  });

  return Response.json({ members });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const actor = await userFromRequest(request);
  if (!actor) return jsonError("Unauthorized", 401);
  if (actor.role === "MEMBER") return jsonError("Only an owner or admin can add team members", 403);

  const schema = z.object({
    name: nameSchema,
    email: emailSchema,
    role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Enter a name, email, and role", 400);

  if (parsed.data.role === "ADMIN" && actor.role !== "OWNER") {
    return jsonError("Only the owner can create admin profiles", 403);
  }

  const normalizedEmail = parsed.data.email.toLowerCase().trim();
  const existing = await db.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
  });
  if (existing) {
    return jsonError("A teammate with this email address already exists", 409);
  }

  const rawToken = newToken();
  const setupUrl = buildSetupUrl(rawToken);
  if (!setupUrl) {
    return jsonError("Server configuration error", 500);
  }

  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  const member = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: parsed.data.name,
        email: normalizedEmail,
        role: parsed.data.role,
        mustChangePassword: true,
      },
      select: { ...publicUserSelect, createdAt: true },
    });

    await tx.passwordSetupToken.create({
      data: {
        tokenHash,
        userId: created.id,
        expiresAt,
      },
    });

    return created;
  });

  await logActivity({
    action: "added",
    entity: "member",
    entityId: member.id,
    summary: `added ${member.name} (${member.email}) to the workspace`,
    userId: actor.id,
  });

  // Transactional invitation email. A failure here must not fail the invite:
  // the link is still valid and the owner can share it manually.
  const mail = await sendInvitationEmail({
    to: member.email,
    recipientName: member.name,
    setupUrl,
    invitedByName: actor.name,
    inviterId: actor.id,
    idempotencyKey: `invite-${member.id}-${tokenHash.slice(0, 16)}`,
  });

  return Response.json({
    member: {
      ...member,
      hasPassword: false,
      invitationStatus: "INVITATION_PENDING",
      invitationExpiresAt: expiresAt.toISOString(),
    },
    setupToken: rawToken,
    setupUrl,
    expiresAt: expiresAt.toISOString(),
    emailSent: mail.sent,
    emailReason: mail.reason,
  }, { status: 201 });
}
