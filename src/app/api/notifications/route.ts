import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.floor(requestedLimit))) : 50;
  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: limit }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return Response.json({ notifications, unreadCount });
}
export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const parsed = z.object({ id: z.string().optional(), all: z.boolean().optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.id && !parsed.data.all)) return jsonError("Choose a notification to mark as read", 400);
  const where = parsed.data.all ? { userId: user.id, readAt: null } : { userId: user.id, id: parsed.data.id, readAt: null };
  await db.notification.updateMany({ where, data: { readAt: new Date() } });
  return Response.json({ ok: true });
}
