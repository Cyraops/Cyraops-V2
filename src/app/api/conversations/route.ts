import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const conversations = await db.conversation.findMany({ where: { members: { some: { userId: user.id } } }, include: { members: { include: { user: { select: publicUserSelect } } }, messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: publicUserSelect } } } }, orderBy: { updatedAt: "desc" } });
  const data = await Promise.all(conversations.map(async (conversation) => {
    const membership = conversation.members.find((member) => member.userId === user.id)!;
    const unreadCount = await db.message.count({ where: { conversationId: conversation.id, senderId: { not: user.id }, ...(membership.lastReadAt ? { createdAt: { gt: membership.lastReadAt } } : {}) } });
    const other = conversation.members.find((member) => member.userId !== user.id)?.user;
    return { ...conversation, label: conversation.name ?? other?.name ?? "Direct message", unreadCount };
  }));
  return Response.json({ conversations: data });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  // The client always submits the (optional) group-name field, often as "".
  // Treat a blank name as absent instead of rejecting the whole request.
  const parsed = z
    .object({
      type: z.enum(["DIRECT", "GROUP"]),
      name: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().min(1).max(100).optional()),
      memberIds: z.array(z.string()).min(1).max(30),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose at least one teammate to start a conversation", 400);
  const members = [...new Set([user.id, ...parsed.data.memberIds])];
  if (parsed.data.type === "DIRECT" && members.length !== 2) return jsonError("A direct conversation needs exactly two people", 400);
  if (parsed.data.type === "DIRECT") {
    const candidates = await db.conversation.findMany({ where: { type: "DIRECT", members: { some: { userId: user.id } } }, include: { members: true } });
    const existing = candidates.find((item) => item.members.length === 2 && members.every((id) => item.members.some((member) => member.userId === id)));
    if (existing) return Response.json({ conversation: existing }, { status: 200 });
  }
  const validMembers = await db.user.findMany({ where: { id: { in: members }, disabledAt: null }, select: { id: true } });
  if (validMembers.length !== members.length) return jsonError("One or more teammates could not be found", 404);
  const conversation = await db.conversation.create({ data: { type: parsed.data.type, name: parsed.data.type === "GROUP" ? parsed.data.name ?? "New group" : null, createdById: user.id, members: { create: members.map((userId) => ({ userId, ...(userId === user.id ? { lastReadAt: new Date() } : {}) })) } }, include: { members: { include: { user: { select: publicUserSelect } } } } });
  await logActivity({ action: "created", entity: "conversation", entityId: conversation.id, summary: `started ${parsed.data.type === "GROUP" ? `group ${conversation.name}` : "a direct conversation"}`, userId: user.id });
  return Response.json({ conversation }, { status: 201 });
}
