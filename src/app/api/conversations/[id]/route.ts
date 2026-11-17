import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { publishMemberRemoval } from "@/lib/realtime";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  const membership = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId: user.id } }, include: { conversation: true } });
  if (!membership) return jsonError("Conversation not found", 404);
  const body = await request.json().catch(() => null);
  if (body?.read === true) {
    const now = new Date();
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: user.id } }, data: { lastReadAt: now } });
    await db.notification.updateMany({ where: { userId: user.id, type: "MESSAGE", href: `/chat?conversation=${id}`, readAt: null }, data: { readAt: now } });
    await db.messageRead.createMany({ data: (await db.message.findMany({ where: { conversationId: id, senderId: { not: user.id }, reads: { none: { userId: user.id } } }, select: { id: true } })).map(({ id: messageId }) => ({ messageId, userId: user.id })), skipDuplicates: true });
    return Response.json({ ok: true });
  }
  if (membership.conversation.type !== "GROUP" || (membership.conversation.createdById !== user.id && user.role === "MEMBER")) return jsonError("Only the group creator or an admin can manage members", 403);
  const parsed = z
    .object({
      name: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().min(1).max(100).optional()),
      addMemberIds: z.array(z.string()).max(30).optional(),
      removeMemberIds: z.array(z.string()).max(30).optional(),
    })
    .safeParse(body);
  if (!parsed.success) return jsonError("Check the group details", 400);
  // A body with none of the editable fields used to run a no-op transaction
  // and return 200 as if something had happened.
  if (!parsed.data.name && !parsed.data.addMemberIds?.length && !parsed.data.removeMemberIds?.length) {
    return jsonError("Nothing to update", 400);
  }
  const validIds = parsed.data.addMemberIds?.length ? await db.user.findMany({ where: { id: { in: parsed.data.addMemberIds }, disabledAt: null }, select: { id: true } }) : [];
  if (parsed.data.addMemberIds && validIds.length !== new Set(parsed.data.addMemberIds).size) return jsonError("One or more teammates could not be found", 404);
  const removedMemberIds = parsed.data.removeMemberIds?.filter((userId) => userId !== membership.conversation.createdById) ?? [];
  const conversation = await db.$transaction(async (tx) => {
    if (parsed.data.addMemberIds?.length) await tx.conversationMember.createMany({ data: parsed.data.addMemberIds.map((userId) => ({ conversationId: id, userId })), skipDuplicates: true });
    if (parsed.data.removeMemberIds?.length) await tx.conversationMember.deleteMany({ where: { conversationId: id, userId: { in: parsed.data.removeMemberIds, not: membership.conversation.createdById ?? "" } } });
    return tx.conversation.update({ where: { id }, data: parsed.data.name ? { name: parsed.data.name } : {} });
  });
  for (const userId of removedMemberIds) publishMemberRemoval(id, userId);
  return Response.json({ conversation });
}
