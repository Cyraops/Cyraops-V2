import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";
import {
  listWorkspaceDirectory,
  WorkspacePathError,
  workspaceRelPath,
} from "@/lib/harness/workspace-root";

type Context = { params: Promise<{ id: string }> };

/**
 * Project-work harness (this phase): one level of the conversation's
 * workspace file tree. Owner-only like the sibling workspace routes (the
 * conversation resolves only under the caller's own assistant). Every path is
 * relative to the stored root and is verified — lexically and by realpath —
 * to stay inside it; `..`, absolute paths and symlink escapes are refused
 * with a 400 before any filesystem read happens.
 *
 * GET ?path=<rel> → { entries: [{ name, path, kind, size }], path }
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
    const listing = await listWorkspaceDirectory({ root: conversation.workspaceRootRealpath, rel });
    return NextResponse.json({ entries: listing.entries, path: listing.path });
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return jsonError(error.message, error.code === "NOT_FOUND" ? 404 : 400);
    }
    console.error("[API:workspace/files] Failed:", error);
    return jsonError("Failed to list the workspace", 500);
  }
}
