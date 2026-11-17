import { db } from "@/lib/db";
import { providerManager } from "@/lib/ai/provider-manager";
import { shouldSummarize } from "./budget";

/** How many not-yet-summarised messages to fold in per pass. */
const BATCH = 40;
/** One rolling summary, so it can never grow without bound. */
const MAX_SUMMARY_CHARS = 6000;

/**
 * Folds old turns into a rolling summary for the conversation.
 *
 * Before this the assistant simply read the last 20 messages and forgot
 * everything before that. A long thread therefore lost its thread of meaning —
 * and anything older was unreachable. Summarising keeps continuity; the
 * `search_history` tool keeps the details addressable.
 */
export async function summarizeConversation(params: {
  assistantId: string;
  conversationId: string;
  userId: string;
}): Promise<void> {
  try {
    const conversation = await db.assistantConversation.findFirst({
      where: { id: params.conversationId, assistantId: params.assistantId },
      select: { id: true, summary: true, summarizedCount: true },
    });
    if (!conversation) return;

    const total = await db.assistantMessage.count({
      where: { assistantId: params.assistantId, conversationId: params.conversationId },
    });
    if (!shouldSummarize(total, conversation.summarizedCount)) return;

    // Everything except the live window being summarised.
    const batch = await db.assistantMessage.findMany({
      where: { assistantId: params.assistantId, conversationId: params.conversationId },
      orderBy: { createdAt: "asc" },
      skip: conversation.summarizedCount,
      take: BATCH,
      select: { role: true, content: true, createdAt: true },
    });
    if (batch.length < 10) return;

    const transcript = batch
      .map((message) => {
        const who = message.role === "user" ? "User" : "Assistant";
        return `${who}: ${message.content.replace(/\s+/g, " ").slice(0, 600)}`;
      })
      .join("\n");

    const provider = providerManager.getProvider();
    const result = await provider.generateStructuredOutput<{ summary: string }>(
      [
        {
          role: "system",
          content:
            "You maintain a running summary of an assistant conversation inside a business CRM. Merge the previous summary with the new turns into one compact brief. Keep: what the user is working on, decisions made, named clients/people/numbers, open questions, and what was already tried. Drop pleasantries. Write plain prose, no headings, at most 180 words. Return JSON: {\"summary\": \"...\"}.",
        },
        {
          role: "user",
          content: `${conversation.summary ? `Previous summary:\n${conversation.summary}\n\n` : ""}New turns:\n${transcript}`,
        },
      ],
      "JSON object with a summary string.",
      {
        profile: "fast",
        temperature: 0,
        maxTokens: 700,
        responseFormat: "json_object",
        userId: params.userId,
        source: "agent",
        agentSlug: "assistant_summary",
      }
    );

    // Strictly typed: `String(obj)` used to store "[object Object]" as the
    // conversation's memory, and the assistant then opened every reply with it.
    const raw = (result as any)?.summary;
    const summary = typeof raw === "string" ? raw.trim().slice(0, MAX_SUMMARY_CHARS) : "";

    if (!summary) {
      // Advance anyway. Returning early left summarizedCount unchanged, so the
      // same 40 messages were re-summarised on every single turn forever.
      await db.assistantConversation.update({
        where: { id: conversation.id },
        data: { summarizedCount: conversation.summarizedCount + batch.length },
      });
      return;
    }

    await db.assistantConversation.update({
      where: { id: conversation.id },
      data: {
        summary,
        summaryUpTo: batch[batch.length - 1]?.createdAt ?? new Date(),
        summarizedCount: conversation.summarizedCount + batch.length,
      },
    });
  } catch (err) {
    // Best effort: a failed summary must never fail the reply.
    console.warn("[Assistant] Conversation summary failed:", err);
  }
}
