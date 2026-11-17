import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { getConversationMessages, getOrCreateAssistant, resolveConversation } from "@/lib/ai/assistant/runtime";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversationId");

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const conversation = await resolveConversation(assistant.id, conversationId || undefined);
    const result = await getConversationMessages(assistant.id, conversation.id);

    if (!result) return jsonError("Conversation not found", 404);

    return NextResponse.json({
      assistantId: assistant.id,
      assistantName: assistant.name,
      conversation: { id: result.conversation.id, title: result.conversation.title },
      messages: result.messages,
    });
  } catch (err: any) {
    console.error("[API:assistant/messages] Failed:", err);
    return jsonError("Failed to load your assistant conversation", 500);
  }
}
