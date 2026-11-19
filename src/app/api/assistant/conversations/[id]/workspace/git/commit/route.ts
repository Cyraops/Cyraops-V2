import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/validators";
import { commitChanges, GitArgError, GIT_COMMIT_MESSAGE_MAX_LENGTH } from "@/lib/harness/workspace-git";
import { gitFriendlyError, recordGitAudit, resolveWorkspaceGitContext } from "../_lib";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ message: z.string().min(1) });

/**
 * Workspace git: stage everything and commit (`git add -A` && `git commit -m`).
 * Owner-only and audit-logged (AiAuditLog eventType GIT_COMMIT); no approval
 * gate — the command box's destructive gate covers the risky shell spellings,
 * and a plain commit is reversible.
 */
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const resolved = await resolveWorkspaceGitContext(request, id);
  if (resolved.error) return resolved.error;
  const { user, conversationId, root } = resolved.context as NonNullable<typeof resolved.context>;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Expected { "message": string }', 400);
  const message = parsed.data.message.trim();
  if (message.length > GIT_COMMIT_MESSAGE_MAX_LENGTH) {
    return jsonError(`The commit message is too long (max ${GIT_COMMIT_MESSAGE_MAX_LENGTH} characters)`, 400);
  }

  try {
    await commitChanges(root, message);
  } catch (error) {
    if (error instanceof GitArgError) return jsonError(error.message, 400);
    console.error("[API:workspace/git/commit] Failed:", error);
    return jsonError(gitFriendlyError(error), 400);
  }

  void recordGitAudit({
    eventType: "GIT_COMMIT",
    userId: user.id,
    conversationId,
    details: { message },
  });
  return NextResponse.json({ success: true, message });
}
