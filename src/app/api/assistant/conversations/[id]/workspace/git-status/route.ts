import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";
import { collectWorkspaceGitStatus } from "@/lib/harness/workspace-git";

type Context = { params: Promise<{ id: string }> };

/**
 * Project-work harness (this phase): the read-only git line for the Workspace
 * panel. Owner-only like the sibling workspace routes.
 *
 * SECURITY: only the fixed, read-only arg vectors in
 * src/lib/harness/workspace-git.ts are ever executed (status --porcelain,
 * branch --show-current, log -5 --oneline, diff --stat), via execFile with no
 * shell and a bounded timeout/buffer; no user-supplied args reach git. The
 * directory is the conversation's server-resolved workspace realpath.
 *
 * GET → { branch, status, log, diffStat, available }
 */
export async function GET(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const assistant = await getOrCreateAssistant(user.id);
  const conversation = await db.assistantConversation.findFirst({
    where: { id, assistantId: assistant.id },
    select: { id: true, workspaceRootRealpath: true },
  });
  if (!conversation) return jsonError("Conversation not found", 404);
  if (!conversation.workspaceRootRealpath) {
    return jsonError("This conversation has no workspace root", 404);
  }

  try {
    const status = await collectWorkspaceGitStatus(conversation.workspaceRootRealpath);
    return NextResponse.json(status);
  } catch (error) {
    console.error("[API:workspace/git-status] Failed:", error);
    return jsonError("Failed to read git status", 500);
  }
}
