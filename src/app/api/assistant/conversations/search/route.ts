import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";
import { db } from "@/lib/db";

const MIN_QUERY = 2;
const MAX_QUERY = 80;
const MAX_RESULTS = 25;
const SNIPPET_RADIUS = 48;

/**
 * A short excerpt of `content` centred on the first case-insensitive match of
 * `needle`, so a match found inside a message body can be shown even when the
 * conversation title does not contain the query. Returns null when there is no
 * match (the caller only calls this for message matches).
 */
function buildSnippet(content: string, needle: string): string | null {
  const index = content.toLowerCase().indexOf(needle);
  if (index < 0) return null;
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(content.length, index + needle.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

/**
 * Session search: the user's AssistantConversation titles AND each
 * conversation's latest-message text, case-insensitive contains, newest first,
 * capped at 25. Owner-only (scoped to the caller's own assistant) and
 * same-origin.
 *
 * The latest message is joined through the `messages` relation ordered
 * `createdAt desc` with `take: 1`; if no message exists the row is still
 * searchable by title alone.
 */
export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) {
    return jsonError(`Query must be between ${MIN_QUERY} and ${MAX_QUERY} characters`, 400);
  }
  // Same scoping as the conversation list route: null = the personal assistant,
  // a slug = that AI teammate's own threads.
  const agentSlug = request.nextUrl.searchParams.get("agent") || null;

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const needle = q.toLowerCase();

    const conversations = await db.assistantConversation.findMany({
      where: { assistantId: assistant.id, agentSlug },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        pinnedAt: true,
        archivedAt: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true } },
      },
    });

    const results = conversations
      .filter((conversation) => {
        if (conversation.title.toLowerCase().includes(needle)) return true;
        const latest = conversation.messages[0]?.content ?? "";
        return latest.toLowerCase().includes(needle);
      })
      .slice(0, MAX_RESULTS)
      .map((conversation) => {
        const titleMatched = conversation.title.toLowerCase().includes(needle);
        const latest = conversation.messages[0]?.content ?? "";
        return {
          id: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
          pinnedAt: conversation.pinnedAt,
          archivedAt: conversation.archivedAt,
          matchedIn: titleMatched ? "title" : "message",
          snippet: titleMatched ? null : buildSnippet(latest, needle),
        };
      });

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("[API:assistant/conversations/search] Failed:", err);
    return jsonError("Failed to search conversations", 500);
  }
}
