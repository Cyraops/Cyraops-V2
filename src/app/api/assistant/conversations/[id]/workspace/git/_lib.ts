import { NextRequest } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";
import { approvalBroker, type PendingApproval } from "@/lib/harness/approval-broker";
import { GitCommandError } from "@/lib/harness/workspace-git";

/**
 * Shared plumbing for the workspace git JSON routes (branches/diff/branch/
 * commit/discard). This is NOT a route: it exports no HTTP handlers.
 *
 * The routes are owner-only and same-origin, exactly like the sibling
 * workspace routes: the conversation resolves only under the caller's own
 * assistant, so no other user can reach it. The root used for every git call
 * is the conversation's server-resolved workspaceRootRealpath.
 */

export interface WorkspaceGitContext {
  user: { id: string };
  conversationId: string;
  root: string;
}

/** Resolve the authenticated owner and their conversation's git root, or an error response. */
export async function resolveWorkspaceGitContext(
  request: NextRequest,
  id: string
): Promise<{ error?: Response; context?: WorkspaceGitContext }> {
  if (!sameOrigin(request)) return { error: jsonError("Invalid request origin", 403) };
  const user = await userFromRequest(request);
  if (!user) return { error: jsonError("Unauthorized", 401) };
  const assistant = await getOrCreateAssistant(user.id);
  const conversation = await db.assistantConversation.findFirst({
    where: { id, assistantId: assistant.id },
    select: { id: true, workspaceRootRealpath: true },
  });
  if (!conversation) return { error: jsonError("Conversation not found", 404) };
  if (!conversation.workspaceRootRealpath) {
    return { error: jsonError("This conversation has no workspace root", 404) };
  }
  return { context: { user, conversationId: conversation.id, root: conversation.workspaceRootRealpath } };
}

// ---------------------------------------------------------------------------
// Approval gate: a JSON (non-SSE) two-phase contract.
//
//  1. A gated route without an approvalId mints a broker approval and returns
//     { needsApproval: true, approvalId, summary }.
//  2. The UI calls /api/harness/approve with that id, then retries the SAME
//     route with { approvalId } in the body. The retry consumes the decision
//     (single-use) and either proceeds or fails closed.
// ---------------------------------------------------------------------------

const pendingGitApprovals = new Map<string, PendingApproval>();

/** Mint an approval request for a gated git operation and register it for a later retry. */
export function requestGitApproval(
  toolName: string,
  summary: string
): { approvalId: string; summary: string } {
  const pending = approvalBroker().request({ toolName, summary });
  pendingGitApprovals.set(pending.approvalId, pending);
  // Bound the entry: the broker auto-rejects at `deadline`; keep a short grace
  // window after a decision so the UI can retry, then forget it.
  const ttl = Math.max(60_000, pending.deadline - Date.now() + 30_000);
  const timer = setTimeout(() => pendingGitApprovals.delete(pending.approvalId), ttl);
  timer.unref?.();
  return { approvalId: pending.approvalId, summary: pending.summary };
}

export type GitApprovalState = "allowed" | "denied" | "pending" | "unknown";

/** Consume a decision for a previously minted git approval (single-use). */
export async function consumeGitApproval(approvalId: string): Promise<GitApprovalState> {
  const pending = pendingGitApprovals.get(approvalId);
  if (!pending) return "unknown";
  if (!pending.settled) return "pending";
  pendingGitApprovals.delete(approvalId);
  const outcome = await pending.outcome;
  return outcome === "allowed-once" ? "allowed" : "denied";
}

// ---------------------------------------------------------------------------
// Audit: one AiAuditLog row per git mutation, mirroring the command box's
// SHELL_COMMAND rows. Best-effort — a log failure never fails the operation.
// ---------------------------------------------------------------------------

export type GitAuditEventType = "GIT_BRANCH" | "GIT_SWITCH" | "GIT_COMMIT" | "GIT_DISCARD";

export async function recordGitAudit(params: {
  eventType: GitAuditEventType;
  userId: string;
  conversationId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.aiAuditLog.create({
      data: {
        eventType: params.eventType,
        entity: "AssistantConversation",
        entityId: params.conversationId,
        actorId: params.userId,
        actorType: "USER",
        details: JSON.stringify(params.details),
      },
    });
  } catch (error) {
    console.warn("[WorkspaceGit] Failed to log git audit:", error);
  }
}

/** A readable message for a failed git command, mapped from stderr's first line. */
export function gitFriendlyError(error: unknown): string {
  if (error instanceof GitCommandError) {
    const line = error.stderr.trim().split("\n")[0] ?? "";
    if (/nothing to commit/i.test(line)) return "Nothing to commit — the working tree is clean.";
    if (/already exists/i.test(line)) return "That branch already exists.";
    if (/not found|does not exist|unknown revision/i.test(line)) return "That branch or path was not found.";
    if (/would be overwritten/i.test(line)) return "Your local changes would be overwritten by that switch.";
    return line || "The git command failed.";
  }
  return "The git command failed.";
}
