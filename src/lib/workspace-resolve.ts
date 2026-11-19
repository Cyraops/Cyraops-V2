/**
 * Multi-tenant workspace resolution (CYRAOPS_PERMISSION_AUDIT.md §8 follow-up).
 *
 * The Permission Manager used to fall back to a singleton Workspace row when
 * the caller's key matched neither the workspace id nor its owner. That breaks
 * the moment a second tenant exists: tenant A's mode would silently apply to
 * tenant B. This module replaces that fallback with an explicit, membership-
 * checked resolution whose failure mode is "no workspace" (the caller falls
 * back to CONTROLLED), never "someone else's workspace".
 */

import type { PrismaClient, Workspace } from "@prisma/client";

/** The subset of a Workspace the rest of the permission pipeline needs. */
export type ResolvedWorkspace = Pick<Workspace, "id" | "ownerId" | "permissionMode">;

/**
 * Resolve the Workspace a user belongs to, in priority order:
 *
 *  1. An explicit `workspaceId`, but only when the user owns it. A client-
 *     supplied id is never trusted on its own: if it does not name a workspace
 *     the user owns, the result is `null` (rejected) — it never falls through
 *     to the user's own workspace, and never leaks another tenant's mode.
 *  2. The workspace whose `ownerId === userId`.
 *  3. A WorkspaceMembership row — none exists in prisma/schema.prisma today
 *     (investigated; only ProjectMember / ConversationMember are modelled), so
 *     `ownerId` is the sole tenant key, consistent with the harness tools'
 *     CYRAOPS_WORKSPACE_ID = userId convention.
 *  4. `null` — the caller must fall back to CONTROLLED, not a singleton row.
 */
export async function resolveWorkspaceForUser(input: {
  db: PrismaClient;
  userId: string;
  workspaceId?: string | null;
}): Promise<ResolvedWorkspace | null> {
  const { db, userId, workspaceId } = input;

  if (workspaceId) {
    // (1) Explicit id, ownership-checked. Never trust the id by itself: the
    // `ownerId` filter is what proves the caller belongs to this workspace.
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId, ownerId: userId },
      select: { id: true, ownerId: true, permissionMode: true },
    });
    // Reject rather than fall through: a supplied id the user does not own must
    // not resolve to the user's own workspace (let alone another tenant's).
    return workspace ?? null;
  }

  // (2) The workspace this user owns. `Workspace.ownerId` is unique, so there
  // is at most one row.
  const owned = await db.workspace.findFirst({
    where: { ownerId: userId },
    select: { id: true, ownerId: true, permissionMode: true },
  });
  return owned ?? null;
}
