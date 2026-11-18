import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { canViewAiConversation } from "@/lib/ai/access";
import { describeWorkspaceRoot } from "@/lib/harness/workspace-root";

type Context = { params: Promise<{ id: string }> };

/**
 * Project-work harness (Phase A): the read-only workspace listing the UI's
 * file panel consumes — the stored spellings plus whether the root still
 * exists right now. Owner-only: non-owners get 404 so the endpoint cannot
 * enumerate conversations.
 */
export async function GET(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const conversation = await db.aiConversation.findUnique({
    where: { id },
    select: { id: true, userId: true, workspaceRoot: true, workspaceRootRealpath: true },
  });
  if (!conversation || !canViewAiConversation(user, conversation)) {
    return jsonError("Conversation not found", 404);
  }

  const listing = await describeWorkspaceRoot(conversation);
  return NextResponse.json({ workspace: listing });
}
