import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { publishAgentMessage, publishAssistantMessage, publishMessage } from "@/lib/realtime";
import { listActiveAgents, matchAgentMentions, runAgentChatTurn } from "@/lib/ai/orchestrator/agent-turn";
import { runAssistantInThread } from "@/lib/ai/assistant/runtime";
import { jsonError } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  if (!await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId: user.id } } })) return jsonError("Conversation not found", 404);
  const before = request.nextUrl.searchParams.get("before");
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : 50;
  const messages = await db.message.findMany({ where: { conversationId: id, ...(before && !Number.isNaN(Date.parse(before)) ? { createdAt: { lt: new Date(before) } } : {}) }, include: { sender: { select: publicUserSelect }, agent: { select: { id: true, slug: true, name: true } }, assistant: { select: { id: true, name: true } }, reads: { select: { userId: true, readAt: true } }, attachments: { select: { id: true, name: true, mimeType: true, size: true } } }, orderBy: { createdAt: "desc" }, take: limit });
  return Response.json({ messages: messages.reverse() });
}

/**
 * After a human message, any @mentioned agent answers in-thread as a
 * participant. Runs in the background so the sender's request returns first.
 */
async function handleAgentMentions(
  conversationId: string,
  body: string,
  actor: { id: string; name: string; avatarUrl: string | null; role: string }
): Promise<void> {
  try {
    const recent = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        sender: { select: { name: true } },
        agent: { select: { name: true } },
        assistant: { select: { name: true } },
      },
    });

    const history = recent.reverse().map((m) => ({
      role: (m.senderId ? "user" : "assistant") as "user" | "assistant",
      content: m.body,
      senderName: m.sender?.name ?? m.agent?.name ?? m.assistant?.name ?? undefined,
    }));

    // The sender's personal assistant answers when addressed in the thread.
    if (/@assistant\b|@cyraops[\s_-]?bot\b/i.test(body)) {
      const turn = await runAssistantInThread({
        userId: actor.id,
        userRole: actor.role,
        history,
      });
      if (turn.reply.trim()) {
        const message = await db.message.create({
          data: { body: turn.reply, conversationId, assistantId: turn.assistantId, senderId: null },
        });
        await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        publishAssistantMessage({
          id: message.id,
          body: message.body,
          conversationId,
          assistantId: turn.assistantId,
          createdAt: message.createdAt.toISOString(),
          sender: null,
          assistant: { id: turn.assistantId, name: turn.assistantName },
        });
      }
    }

    const agents = await listActiveAgents();
    const mentioned = matchAgentMentions(body, agents);
    if (mentioned.length === 0) return;

    const fullAgents = await db.aiAgent.findMany({
      where: { slug: { in: mentioned.map((a) => a.slug) }, status: "ACTIVE" },
    });

    for (const agent of fullAgents) {
      const turn = await runAgentChatTurn({
        agent,
        history,
        actorUserId: actor.id,
        actorUserRole: actor.role,
      });

      const message = await db.message.create({
        data: { body: turn.reply, conversationId, agentId: agent.id, senderId: null },
      });
      await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

      publishAgentMessage({
        id: message.id,
        body: message.body,
        conversationId,
        agentId: agent.id,
        createdAt: message.createdAt.toISOString(),
        sender: null,
        agent: { id: agent.id, slug: agent.slug, name: agent.name },
      });
    }
  } catch (err) {
    console.error("[ChatAgent] Failed to handle agent mention:", err);
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  const membership = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId: user.id } } });
  if (!membership) return jsonError("Conversation not found", 404);
  const parsed = z.object({ body: z.string().trim().max(5000).optional(), clientId: z.string().max(80).optional(), attachmentIds: z.array(z.string().min(1)).max(5).optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Message cannot be empty", 400);
  const body = parsed.data.body ?? "";
  const attachmentIds = [...new Set(parsed.data.attachmentIds ?? [])];
  if (!body && attachmentIds.length === 0) return jsonError("Message cannot be empty", 400);
  // Only files this teammate uploaded and has not already sent, so an id from
  // another conversation cannot be attached here.
  if (attachmentIds.length) {
    const owned = await db.messageAttachment.findMany({ where: { id: { in: attachmentIds }, uploadedById: user.id, messageId: null }, select: { id: true } });
    if (owned.length !== attachmentIds.length) return jsonError("One or more attachments are missing or were already sent", 400);
  }
  const include = { sender: { select: publicUserSelect }, reads: { select: { userId: true, readAt: true } }, attachments: { select: { id: true, name: true, mimeType: true, size: true } } } as const;
  let message = parsed.data.clientId ? await db.message.findFirst({ where: { senderId: user.id, clientId: parsed.data.clientId }, include }) : null;
  if (message && message.conversationId !== id) return jsonError("This message retry key was already used elsewhere", 409);
  let alreadyCreated = Boolean(message);
  if (!message) {
    try {
      message = await db.message.create({ data: { body, conversationId: id, senderId: user.id, clientId: parsed.data.clientId, reads: { create: { userId: user.id } }, ...(attachmentIds.length ? { attachments: { connect: attachmentIds.map((attachmentId) => ({ id: attachmentId })) } } : {}) }, include });
    } catch (error) {
      if (!parsed.data.clientId || !(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
      message = await db.message.findFirstOrThrow({ where: { senderId: user.id, clientId: parsed.data.clientId }, include });
      if (message.conversationId !== id) return jsonError("This message retry key was already used elsewhere", 409);
      alreadyCreated = true;
    }
  }
  if (!alreadyCreated) {
    await db.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
    publishMessage({ ...message, sender: { id: user.id, name: user.name, avatarUrl: user.avatarUrl } });
    const recipients = await db.conversationMember.findMany({ where: { conversationId: id, userId: { not: user.id } }, select: { userId: true } });
    if (recipients.length) await db.notification.createMany({ data: recipients.map(({ userId }) => ({ userId, type: "MESSAGE" as const, title: `New message from ${user.name}`, body: message!.body.slice(0, 180) || (message!.attachments.length ? `${message!.attachments.length} attachment${message!.attachments.length > 1 ? "s" : ""}` : "New message"), href: `/chat?conversation=${id}` })) });
    await logActivity({ action: "sent", entity: "message", entityId: message.id, summary: `sent a message in ${id}`, userId: user.id });

    // Agents are chat participants: @mentioning one makes it answer in-thread.
    void handleAgentMentions(id, body, { id: user.id, name: user.name, avatarUrl: user.avatarUrl, role: user.role });
  }
  return Response.json({ message, clientId: parsed.data.clientId }, { status: alreadyCreated ? 200 : 201 });
}
