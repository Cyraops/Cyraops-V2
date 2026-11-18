import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";
import { readWorkspaceTextFile, WorkspacePathError, workspaceRelPath } from "@/lib/harness/workspace-root";

type Context = { params: Promise<{ id: string }> };

/**
 * Project-work harness (this phase): the preview pane's file read. Owner-only
 * like the sibling workspace routes, and the same realpath-verified
 * containment as the listing (a `..` or a symlink escape is a 400). Text
 * files come back as { content, truncated } (truncated at 256 KB); binary
 * files (sniffed by a NUL byte) come back as { binary: true } and their bytes
 * never leave the machine.
 *
 * GET ?path=<rel> → { content, truncated } | { binary: true }
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

  const rel = workspaceRelPath(new URL(request.url).searchParams.get("path"));
  try {
    const file = await readWorkspaceTextFile({ root: conversation.workspaceRootRealpath, rel });
    return NextResponse.json(file);
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return jsonError(error.message, error.code === "NOT_FOUND" ? 404 : 400);
    }
    console.error("[API:workspace/file] Failed:", error);
    return jsonError("Failed to read the file", 500);
  }
}
