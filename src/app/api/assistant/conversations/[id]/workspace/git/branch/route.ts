import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/validators";
import {
  createBranch,
  GitArgError,
  hasUncommittedChanges,
  switchBranch,
  validateGitBranchName,
} from "@/lib/harness/workspace-git";
import {
  consumeGitApproval,
  gitFriendlyError,
  recordGitAudit,
  requestGitApproval,
  resolveWorkspaceGitContext,
} from "../_lib";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    /** Create and check out a new branch. */
    name: z.string().optional(),
    /** Switch to an existing branch. */
    switch: z.string().optional(),
    /** The approvalId from a prior gated switch response (single-use). */
    approvalId: z.string().optional(),
  })
  .refine(
    (value) => (value.name !== undefined) !== (value.switch !== undefined),
    "Provide either name (create) or switch (switch)"
  );

/**
 * Workspace git: create (`checkout -b`) or switch (`switch`) a branch.
 *
 * createBranch and switchBranch-without-changes are owner-only and audit-logged
 * without an approval gate. switchBranch-WITH-uncommitted-changes is gated: the
 * route mints a broker approval and returns the JSON contract
 * { needsApproval: true, approvalId, summary }; the UI answers
 * /api/harness/approve then retries with { approvalId }.
 */
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const resolved = await resolveWorkspaceGitContext(request, id);
  if (resolved.error) return resolved.error;
  const { user, conversationId, root } = resolved.context as NonNullable<typeof resolved.context>;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError('Expected { "name": string } (create) or { "switch": string } (switch)', 400);
  }
  const { name, switch: switchTo, approvalId } = parsed.data;

  // --- create -----------------------------------------------------------------
  if (name !== undefined) {
    try {
      await createBranch(root, name);
    } catch (error) {
      if (error instanceof GitArgError) return jsonError(error.message, 400);
      console.error("[API:workspace/git/branch] create failed:", error);
      return jsonError(gitFriendlyError(error), 400);
    }
    void recordGitAudit({
      eventType: "GIT_BRANCH",
      userId: user.id,
      conversationId,
      details: { name, action: "create" },
    });
    return NextResponse.json({ success: true, branch: name });
  }

  // --- switch ----------------------------------------------------------------
  const target = switchTo as string;
  try {
    validateGitBranchName(target);
  } catch (error) {
    if (error instanceof GitArgError) return jsonError(error.message, 400);
    throw error;
  }

  let dirty = false;
  try {
    dirty = await hasUncommittedChanges(root);
  } catch (error) {
    console.error("[API:workspace/git/branch] status check failed:", error);
    return jsonError("Failed to read the working tree", 500);
  }

  if (!dirty) {
    try {
      await switchBranch(root, target);
    } catch (error) {
      console.error("[API:workspace/git/branch] switch failed:", error);
      return jsonError(gitFriendlyError(error), 400);
    }
    void recordGitAudit({
      eventType: "GIT_SWITCH",
      userId: user.id,
      conversationId,
      details: { name: target, action: "switch", approved: true },
    });
    return NextResponse.json({ success: true, branch: target });
  }

  // Uncommitted changes: require approval before switching away.
  if (!approvalId) {
    const approval = requestGitApproval(
      "git.switch",
      `Switch to branch "${target}" with uncommitted changes in the working tree`
    );
    return NextResponse.json({
      needsApproval: true,
      approvalId: approval.approvalId,
      summary: approval.summary,
    });
  }

  const state = await consumeGitApproval(approvalId);
  if (state === "unknown") return jsonError("Approval request not found or already used", 404);
  if (state === "pending") return jsonError("Approval has not been decided yet", 400);
  if (state === "denied") return jsonError("Approval was rejected", 403);

  try {
    await switchBranch(root, target);
  } catch (error) {
    console.error("[API:workspace/git/branch] switch failed:", error);
    return jsonError(gitFriendlyError(error), 400);
  }
  void recordGitAudit({
    eventType: "GIT_SWITCH",
    userId: user.id,
    conversationId,
    details: { name: target, action: "switch", approved: true },
  });
  return NextResponse.json({ success: true, branch: target });
}
