import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/validators";
import { discardChanges, GitArgError, validateGitFilePath } from "@/lib/harness/workspace-git";
import { resolveWorkspaceRelativePath, WorkspacePathError, workspaceRelPath } from "@/lib/harness/workspace-root";
import {
  consumeGitApproval,
  gitFriendlyError,
  recordGitAudit,
  requestGitApproval,
  resolveWorkspaceGitContext,
} from "../_lib";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** The workspace-relative path to discard. */
  path: z.string().min(1),
  /** The approvalId from a prior gated discard response (single-use). */
  approvalId: z.string().optional(),
});

/**
 * Workspace git: discard one path (`git restore --staged -- <path>` then
 * `git checkout -- <path>`). ALWAYS approval-gated: the route mints a broker
 * approval and returns { needsApproval: true, approvalId, summary }; the UI
 * answers /api/harness/approve then retries with { approvalId }. The path is
 * validated lexically and by realpath containment before any git process runs.
 */
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const resolved = await resolveWorkspaceGitContext(request, id);
  if (resolved.error) return resolved.error;
  const { user, conversationId, root } = resolved.context as NonNullable<typeof resolved.context>;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Expected { "path": string }', 400);
  const rel = workspaceRelPath(parsed.data.path);

  try {
    validateGitFilePath(rel);
  } catch (error) {
    if (error instanceof GitArgError) return jsonError(error.message, 400);
    throw error;
  }

  // Realpath containment. A deleted file cannot be realpath-resolved but is
  // still legitimately discardable (the checkout restores it), so NOT_FOUND is
  // tolerated after the lexical gate already ruled out traversal.
  try {
    await resolveWorkspaceRelativePath({ root, rel });
  } catch (error) {
    if (error instanceof WorkspacePathError && error.code === "NOT_FOUND") {
      // deleted path — lexical containment passed; proceed to restore it.
    } else if (error instanceof WorkspacePathError) {
      return jsonError(error.message, error.code === "NOT_FOUND" ? 404 : 400);
    } else {
      throw error;
    }
  }

  if (!parsed.data.approvalId) {
    const approval = requestGitApproval("git.discard", `Discard changes to "${rel}"`);
    return NextResponse.json({
      needsApproval: true,
      approvalId: approval.approvalId,
      summary: approval.summary,
    });
  }

  const state = await consumeGitApproval(parsed.data.approvalId);
  if (state === "unknown") return jsonError("Approval request not found or already used", 404);
  if (state === "pending") return jsonError("Approval has not been decided yet", 400);
  if (state === "denied") return jsonError("Approval was rejected", 403);

  try {
    await discardChanges(root, rel);
  } catch (error) {
    console.error("[API:workspace/git/discard] Failed:", error);
    return jsonError(gitFriendlyError(error), 400);
  }

  void recordGitAudit({
    eventType: "GIT_DISCARD",
    userId: user.id,
    conversationId,
    details: { path: rel, approved: true },
  });
  return NextResponse.json({ success: true, path: rel });
}
