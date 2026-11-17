import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";

type Context = { params: Promise<{ id: string }> };

/** Renames a conversation. Ownership is checked through the assistant. */
export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const parsed = z
    .object({
      title: z.string().trim().min(1).max(120).optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Nothing to update", 400);
  if (!parsed.data.title && parsed.data.pinned === undefined && parsed.data.archived === undefined) {
    return jsonError("Nothing to update", 400);
  }

  const assistant = await getOrCreateAssistant(user.id);
  const existing = await db.assistantConversation.findFirst({
    where: { id, assistantId: assistant.id },
    select: { id: true },
  });
  if (!existing) return jsonError("Conversation not found", 404);

  const conversation = await db.assistantConversation.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
      ...(parsed.data.pinned !== undefined ? { pinnedAt: parsed.data.pinned ? new Date() : null } : {}),
      ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? new Date() : null } : {}),
    },
    select: { id: true, title: true, pinnedAt: true, archivedAt: true },
  });
  return NextResponse.json({ conversation });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const assistant = await getOrCreateAssistant(user.id);
  const existing = await db.assistantConversation.findFirst({
    where: { id, assistantId: assistant.id },
    select: { id: true },
  });
  if (!existing) return jsonError("Conversation not found", 404);

  // A pending approval owned by this conversation must stop existing with it;
  // otherwise the card stays confirmable, the tool runs, and the follow-up note
  // then fails with an FK violation — work done, user told it failed.
  await db.assistantPendingAction.updateMany({
    where: { conversationId: existing.id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  await db.assistantConversation.deleteMany({ where: { id: existing.id, assistantId: assistant.id } });
  return NextResponse.json({ ok: true });
}
