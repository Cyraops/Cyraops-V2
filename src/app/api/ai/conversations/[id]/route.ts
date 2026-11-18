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

/** Renames an AI conversation. Only the conversation's owner may rename it. */
export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const parsed = z.object({ title: titleSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Enter a title between 1 and 120 characters", 400);

  const existing = await db.aiConversation.findUnique({
    where: { id },
    select: { id: true, userId: true, title: true },
  });
  if (!existing) return jsonError("Conversation not found", 404);
  if (existing.userId !== user.id) return jsonError("You can only rename your own conversations", 403);

  const [conversation] = await db.$transaction([
    db.aiConversation.update({
      where: { id: existing.id },
      data: { title: parsed.data.title },
      select: { id: true, title: true, updatedAt: true },
    }),
    // Log the rename only when the title actually changed.
    ...(parsed.data.title !== existing.title
      ? [
          db.aiAuditLog.create({
            data: {
              eventType: "CONVERSATION_RENAMED",
              entity: "AiConversation",
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

  const existing = await db.aiConversation.findUnique({
    where: { id },
    select: { id: true, userId: true, title: true, harnessSessionId: true },
  });
  if (!existing) return jsonError("Conversation not found", 404);
  if (existing.userId !== user.id) return jsonError("You can only delete your own conversations", 403);

  // Messages cascade with the conversation row (onDelete: Cascade), and
  // harnessSessionId is a column on that row, so deleting it removes our
  // record of the harness session. The harness's persisted session files are
  // intentionally left alone — only our rows are removed. The audit row is
  // written in the same transaction so a failed delete cannot leave the log
  // claiming a conversation that survived.
  await db.$transaction([
    db.aiAuditLog.create({
      data: {
        eventType: "CONVERSATION_DELETED",
        entity: "AiConversation",
        entityId: existing.id,
        actorId: user.id,
        actorType: "USER",
        details: JSON.stringify({ title: existing.title, harnessSessionId: existing.harnessSessionId }),
        ipAddress: requestIp(request),
      },
    }),
    db.aiConversation.delete({ where: { id: existing.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
