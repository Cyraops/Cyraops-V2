import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { createConversation, getOrCreateAssistant, listConversations } from "@/lib/ai/assistant/runtime";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const agentSlug = request.nextUrl.searchParams.get("agent");
    const conversations = await listConversations(assistant.id, agentSlug || null);
    return NextResponse.json({ assistantId: assistant.id, conversations });
  } catch (err: any) {
    console.error("[API:assistant/conversations] Failed:", err);
    return jsonError("Failed to load conversations", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const body = await request.json().catch(() => null);
    const agentSlug = typeof body?.agentSlug === "string" ? body.agentSlug : null;
    const conversation = await createConversation(assistant.id, "New chat", agentSlug);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err: any) {
    console.error("[API:assistant/conversations] Create failed:", err);
    return jsonError("Failed to start a new chat", 500);
  }
}
