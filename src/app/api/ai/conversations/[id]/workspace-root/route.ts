import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { canViewAiConversation } from "@/lib/ai/access";
import { normalizeWorkspaceRoot, WorkspaceRootError } from "@/lib/harness/workspace-root";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** The project root to run this conversation's harness turns under; null clears it (CRM mode). */
  path: z.string().trim().max(4096).nullable(),
});

/**
 * Project-work harness (Phase A): set or clear an AI conversation's workspace
 * root. Owner-only (AiConversation.userId is the creator); non-owners get 404
 * so the endpoint cannot enumerate conversations. The server validates that
 * the path is absolute, exists and is a directory, then records BOTH the
 * user-supplied spelling and the resolved realpath.
 */
export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const conversation = await db.aiConversation.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!conversation || !canViewAiConversation(user, conversation)) {
    return jsonError("Conversation not found", 404);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Expected a JSON body of the shape { "path": string | null }', 400);

  let workspaceRoot: string | null = null;
  let workspaceRootRealpath: string | null = null;
  if (parsed.data.path !== null) {
    try {
      workspaceRootRealpath = await normalizeWorkspaceRoot(parsed.data.path);
      workspaceRoot = parsed.data.path;
    } catch (error) {
      if (error instanceof WorkspaceRootError) return jsonError(error.message, 400);
      throw error;
    }
  }

  const updated = await db.aiConversation.update({
    where: { id },
    data: { workspaceRoot, workspaceRootRealpath },
    select: { id: true, workspaceRoot: true, workspaceRootRealpath: true },
  });
  return NextResponse.json({ conversation: updated });
}
