import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const memories = await db.assistantMemory.findMany({
      where: { assistantId: assistant.id, archivedAt: null },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: { id: true, content: true, updatedAt: true, pinned: true, revision: true },
      take: 60,
    });
    return NextResponse.json({ memories });
  } catch (err: any) {
    console.error("[API:assistant/memories] Failed:", err);
    return jsonError("Failed to load memories", 500);
  }
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  // Capped: an accepted memory is injected into every future system prompt, so
  // an unbounded one is both a cost and a prompt-injection surface.
  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 2000) : "";
  const pinned = typeof body?.pinned === "boolean" ? body.pinned : undefined;
  if (!id) return jsonError("Memory id is required", 400);
  if (!content && pinned === undefined) return jsonError("Nothing to change", 400);

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const existing = await db.assistantMemory.findFirst({
      where: { id, assistantId: assistant.id, archivedAt: null },
      select: { id: true, revision: true },
    });
    if (!existing) return jsonError("Memory not found", 404);

    const memory = await db.assistantMemory.update({
      where: { id: existing.id },
      data: {
        ...(content ? { content, revision: existing.revision + 1 } : {}),
        ...(pinned !== undefined ? { pinned } : {}),
        // A hand-written fact is the user's, so it is never auto-pruned.
        ...(content ? { pinned: true } : {}),
      },
      select: { id: true, content: true, pinned: true, revision: true, updatedAt: true },
    });
    return NextResponse.json({ memory });
  } catch (err: any) {
    console.error("[API:assistant/memories] Edit failed:", err);
    return jsonError("Failed to update memory", 500);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("Memory id is required", 400);

  try {
    const assistant = await getOrCreateAssistant(user.id);
    // Archive rather than delete: the user can change their mind, and an
    // assistant memory is evidence of why it behaved as it did.
    const result = await db.assistantMemory.updateMany({
      where: { id, assistantId: assistant.id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) return jsonError("Memory not found", 404);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[API:assistant/memories] Delete failed:", err);
    return jsonError("Failed to delete memory", 500);
  }
}
