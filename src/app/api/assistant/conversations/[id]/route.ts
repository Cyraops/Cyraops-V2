import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

const titleSchema = z.string().trim().min(1).max(120);

function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** Renames a conversation. Only the conversation's owner may rename it. */
export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const parsed = z
    .object({
      title: titleSchema.optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Nothing to update", 400);
  if (!parsed.data.title && parsed.data.pinned === undefined && parsed.data.archived === undefined) {
    return jsonError("Nothing to update", 400);
  }

  const existing = await db.assistantConversation.findUnique({
    where: { id },
    select: { id: true, title: true, assistant: { select: { userId: true } } },
  });
  if (!existing) return jsonError("Conversation not found", 404);
  if (existing.assistant.userId !== user.id) return jsonError("You can only modify your own conversations", 403);

  const [conversation] = await db.$transaction([
    db.assistantConversation.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
        ...(parsed.data.pinned !== undefined ? { pinnedAt: parsed.data.pinned ? new Date() : null } : {}),
        ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? new Date() : null } : {}),
      },
      select: { id: true, title: true, pinnedAt: true, archivedAt: true },
    }),
    // Log the rename only when the title actually changed, so pin/archive
    // toggles and no-op renames do not pollute the audit trail.
    ...(parsed.data.title && parsed.data.title !== existing.title
      ? [
          db.aiAuditLog.create({
            data: {
              eventType: "CONVERSATION_RENAMED",
              entity: "AssistantConversation",
              entityId: existing.id,
              actorId: user.id,
              actorType: "USER",
              details: JSON.stringify({ from: existing.title, to: parsed.data.title }),
              ipAddress: requestIp(request),
            },
          }),
        ]
      : []),
  ]);
  return NextResponse.json({ conversation });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const existing = await db.assistantConversation.findUnique({
    where: { id },
    select: { id: true, title: true, assistant: { select: { userId: true } } },
  });
  if (!existing) return jsonError("Conversation not found", 404);
  if (existing.assistant.userId !== user.id) return jsonError("You can only delete your own conversations", 403);

  // A pending approval owned by this conversation must stop existing with it;
  // otherwise the card stays confirmable, the tool runs, and the follow-up note
  // then fails with an FK violation — work done, user told it failed.
  //
  // Messages cascade with the conversation row (onDelete: Cascade). The
  // harness's persisted session files are intentionally left alone — only our
  // rows are removed. The audit row is written in the same transaction so a
  // failed delete cannot leave the log claiming a conversation that survived.
  await db.$transaction([
    db.assistantPendingAction.updateMany({
      where: { conversationId: existing.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    }),
    db.aiAuditLog.create({
      data: {
        eventType: "CONVERSATION_DELETED",
        entity: "AssistantConversation",
        entityId: existing.id,
        actorId: user.id,
        actorType: "USER",
        details: JSON.stringify({ title: existing.title }),
        ipAddress: requestIp(request),
      },
    }),
    db.assistantConversation.delete({ where: { id: existing.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
