/**
 * Single source of truth for bot state (Wave 1a).
 *
 * The "I set SYSTEM but turns ran CONTROLLED" divergence came from two places
 * resolving the mode differently: the Settings card read the singleton
 * `workspace` row (no ownership check) and computed `agent ?? workspace ??
 * CONTROLLED`, while turns resolved through `resolveWorkspaceForUser` +
 * `resolvePermissionMode` + `runtimePermissionMode`. That meant a user who owns
 * no workspace saw SYSTEM in Settings while every turn ran CONTROLLED.
 *
 * `resolveBotStatus` closes that gap: it resolves the mode through the exact
 * ownership-verified path turns use, so it can never disagree with a turn. It
 * also exposes the honest signal for the Settings warning — `workspaceOwnerMatch`
 * — and the conversation root the harness actually maps into the sandbox.
 */

import type { PrismaClient } from "@prisma/client";
import {
  resolvePermissionMode,
  runtimePermissionMode,
  systemToolsEnabled,
  type PermissionMode,
} from "@/lib/permissions/mode";
import { resolveWorkspaceForUser, type ResolvedWorkspace } from "@/lib/workspace-resolve";

export interface ResolvedBotStatus {
  /** The configured mode: agent override ?? workspace ?? CONTROLLED. */
  mode: PermissionMode;
  /**
   * The mode a turn actually runs under: `mode` role-gated exactly like the
   * turn path (a non-owner under FULL_CONTROL/SYSTEM gets CONTROLLED).
   */
  effectiveMode: PermissionMode;
  /** The ownership-verified workspace, or null when the caller owns none. */
  workspace: ResolvedWorkspace | null;
  /** True only when the resolved workspace belongs to this user. */
  workspaceOwnerMatch: boolean;
  /** The conversation's server-resolved workspaceRootRealpath, or null. */
  root: string | null;
  /** The harness shell (tool-bash) is mounted only under SYSTEM. */
  shellEnabled: boolean;
  /** The harness system tools (tool-bash / tool-fs / tool-fs-search) are mounted only under SYSTEM. */
  systemToolsEnabled: boolean;
}

export async function resolveBotStatus(input: {
  db: PrismaClient;
  userId: string;
  workspaceId?: string | null;
  agentSlug?: string | null;
  conversationId?: string | null;
}): Promise<ResolvedBotStatus> {
  const { db, userId, workspaceId, agentSlug, conversationId } = input;

  // 1. The ownership-verified workspace a turn would resolve — never the
  //    singleton row, never another tenant's workspace.
  const workspace = await resolveWorkspaceForUser({ db, userId, workspaceId });

  // 2. The configured mode from that same workspace object (agent override ??
  //    workspace ?? CONTROLLED). This is the pre-role-gate value turns compute.
  const mode = await resolvePermissionMode({ workspace, agentSlug });

  // 3. Role-gate it exactly like the assistant/team/harness turn paths do, so
  //    `effectiveMode` can never disagree with what a turn actually runs under.
  const requester = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const effectiveMode = runtimePermissionMode(mode, requester?.role);

  // 4. The conversation's workspaceRootRealpath, null-safe. Scoped to the
  //    caller's own assistant so an unknown or foreign id yields null (no leak).
  let root: string | null = null;
  if (conversationId) {
    const conversation = await db.assistantConversation.findFirst({
      where: { id: conversationId, assistant: { userId } },
      select: { workspaceRootRealpath: true },
    });
    root = conversation?.workspaceRootRealpath ?? null;
  }

  return {
    mode,
    effectiveMode,
    workspace,
    workspaceOwnerMatch: workspace ? workspace.ownerId === userId : false,
    root,
    shellEnabled: systemToolsEnabled(effectiveMode),
    systemToolsEnabled: systemToolsEnabled(effectiveMode),
  };
}
