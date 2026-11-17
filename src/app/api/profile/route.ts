import { hash, compare } from "bcryptjs";
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { publicUserSelect, sameOrigin, sha256, userFromRequest, SESSION_COOKIE } from "@/lib/auth";
import { jsonError, nameSchema, passwordSchema } from "@/lib/validators";

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const body = await request.json().catch(() => null);
  if (body?.newPassword !== undefined) {
    if (!user.passwordHash) {
      return jsonError("Individual password is not yet configured for this account", 400);
    }
    const parsed = z.object({
      currentPassword: z.string().min(1, "Current password is required"),
      newPassword: passwordSchema,
    }).safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "New password must be at least 12 characters", 400);
    }
    const matches = await compare(parsed.data.currentPassword, user.passwordHash);
    if (!matches) {
      return jsonError("Current password is incorrect", 403);
    }
    const newPasswordHash = await hash(parsed.data.newPassword, 12);
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
      },
    });
    const rawCookie = request.cookies.get(SESSION_COOKIE)?.value;
    let currentTokenHash = "";
    if (rawCookie) {
      try {
        currentTokenHash = sha256(decodeURIComponent(rawCookie));
      } catch {
        currentTokenHash = sha256(rawCookie);
      }
    }
    await db.session.deleteMany({
      where: {
        userId: user.id,
        tokenHash: { not: currentTokenHash },
      },
    });
    return Response.json({ ok: true });
  }
  const parsed = z.object({ name: nameSchema, title: z.string().trim().max(100).optional().nullable(), timezone: z.string().max(64).optional(), avatarUrl: z.string().url().max(500).refine((value) => new URL(value).protocol === "https:", "Use an HTTPS image URL").nullable().optional() }).safeParse(body);
  if (!parsed.success) return jsonError("Check your profile details", 400);
  const updated = await db.user.update({ where: { id: user.id }, data: parsed.data, select: publicUserSelect });
  return Response.json({ user: updated });
}
