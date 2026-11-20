/**
 * Workspace auto-provisioning (Wave 1b).
 *
 * Two facts drove the old failure mode: a member who owned no Workspace row
 * fell back to CONTROLLED with no way to act (resolveWorkspaceForUser returns
 * null, and the Permission Manager treats null as CONTROLLED), and a harness
 * turn with no pinned workspace root had nowhere to write. This module gives
 * every member their own workspace and a stable per-member default project
 * root, so "no workspace → silently CONTROLLED" and "no root → can't write"
 * never happen.
 *
 * `ensureWorkspaceForUser` is idempotent: it reuses the workspace a user
 * already owns (including the seeded "main" workspace once its ownerId points
 * at a real member), and only creates one when none exists. It is safe to call
 * from every session-establishment hook (login / setup / me) — the second and
 * later calls are a single indexed `ownerId` lookup.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

/** The subset of a provisioned Workspace callers need. */
export interface ProvisionedWorkspace {
  id: string;
  ownerId: string;
  permissionMode: string;
  name: string;
  /** True only when this call created the row (false on a reuse). */
  created: boolean;
}

const WORKSPACE_SELECT = {
  id: true,
  ownerId: true,
  permissionMode: true,
  name: true,
} as const;

/** Prisma's unique-constraint violation (P2002), which a racing caller raises. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Ensure the user owns exactly one Workspace, creating it when none exists.
 *
 * The schema requires `loginEmail` (unique) and `loginPasswordHash` on every
 * Workspace row (legacy owner credentials). For a provisioned member workspace
 * these are filled with deliberately inert values:
 *   - `loginEmail` uses a reserved-domain address (`user-<id>@cyraops.local`)
 *     so it is unique and never collides with a real inbox;
 *   - `loginPasswordHash` is the empty string, which can never match a bcrypt
 *     comparison, and `resolveLoginCredential` rejects an empty hash — so this
 *     row can never authenticate anyone through the legacy workspace path.
 *
 * The explicit `id` avoids the `@default("main")` collision with the seeded
 * company workspace.
 */
export async function ensureWorkspaceForUser(input: {
  db: PrismaClient;
  userId: string;
}): Promise<ProvisionedWorkspace> {
  const { db, userId } = input;

  const existing = await db.workspace.findFirst({
    where: { ownerId: userId },
    select: WORKSPACE_SELECT,
  });
  if (existing) {
    return { ...existing, created: false };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const name = user?.name?.trim() ? `${user.name.trim()}'s Workspace` : "My Workspace";
  const id = `user-${userId}`;

  const create = () =>
    db.workspace.create({
      data: {
        id,
        name,
        permissionMode: "CONTROLLED",
        ownerId: userId,
        loginEmail: `${id}@cyraops.local`,
        loginPasswordHash: "",
      },
      select: WORKSPACE_SELECT,
    });

  try {
    const created = await create();
    return { ...created, created: true };
  } catch (error) {
    // Two session-establishment hooks (e.g. login and the app-load "me") can
    // race on first provision. The loser re-reads the winner's row instead of
    // failing the request.
    if (isUniqueViolation(error)) {
      const raced = await db.workspace.findFirst({
        where: { ownerId: userId },
        select: WORKSPACE_SELECT,
      });
      if (raced) return { ...raced, created: false };
    }
    throw error;
  }
}

/**
 * The per-member default project root: `~/Cyraops/<userId>`.
 *
 * This returns the path only — it deliberately does NOT create the directory
 * on disk. Callers decide when (or whether) to materialize it; the harness
 * SYSTEM turn's sandbox is pinned to it and the model's shell can create it.
 */
export function defaultWorkspaceRootForUser(input: { userId: string }): string {
  return join(homedir(), "Cyraops", input.userId);
}
