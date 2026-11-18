/**
 * Per-conversation workspace roots (Phase A): the project-work harness's
 * server-side security model, kept pure so every rule unit-tests without a
 * database or a real filesystem.
 *
 * Rules (all enforced server-side, never trusted from the client):
 * - The root must be an absolute path that exists and is a directory; the
 *   server resolves its realpath and records BOTH the user-supplied spelling
 *   (workspaceRoot) and the canonical one (workspaceRootRealpath). The
 *   sandbox mapping always uses the realpath.
 * - Only the conversation's OWNER may set or change the root, and only the
 *   owner's turns run under it. `workspaceRootForTurn` is the single gate the
 *   turn path uses, so a non-owner turn can never inherit a root even if a
 *   future feature lets other users turn in the same conversation.
 */

import { realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import { isAbsolute } from "node:path";

/** The minimal fs surface root validation needs; tests inject a fake one. */
export interface WorkspaceRootFs {
  /** Resolve symlinks to the canonical absolute path; rejects when missing. */
  realpath(path: string): Promise<string>;
  /** Metadata for an existing path, or null when it does not exist. */
  stat(path: string): Promise<{ isDirectory(): boolean } | null>;
}

/** Node's real filesystem — the server default. */
export const defaultWorkspaceRootFs: WorkspaceRootFs = {
  realpath: (path) => fsRealpath(path),
  stat: async (path) => {
    try {
      return await fsStat(path);
    } catch {
      return null;
    }
  },
};

export type WorkspaceRootErrorCode = "NOT_ABSOLUTE" | "NOT_FOUND" | "NOT_DIRECTORY";

/** A user-supplied root the server refused, with a machine-readable reason. */
export class WorkspaceRootError extends Error {
  readonly code: WorkspaceRootErrorCode;

  constructor(code: WorkspaceRootErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceRootError";
    this.code = code;
  }
}

/** Largest accepted spelling of a project root (a PATH_MAX-scale guard). */
export const WORKSPACE_ROOT_MAX_LENGTH = 4096;

/**
 * Validate a user-supplied project root and return its canonical realpath.
 * Throws a typed WorkspaceRootError the route maps onto a 400.
 */
export async function normalizeWorkspaceRoot(
  path: string,
  fs: WorkspaceRootFs = defaultWorkspaceRootFs
): Promise<string> {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new WorkspaceRootError("NOT_ABSOLUTE", "A project root path is required");
  }
  if (trimmed.length > WORKSPACE_ROOT_MAX_LENGTH) {
    throw new WorkspaceRootError("NOT_ABSOLUTE", "The project root path is too long");
  }
  if (!isAbsolute(trimmed)) {
    throw new WorkspaceRootError(
      "NOT_ABSOLUTE",
      "The project root must be an absolute path on this machine"
    );
  }
  let canonical: string;
  try {
    canonical = await fs.realpath(trimmed);
  } catch {
    throw new WorkspaceRootError("NOT_FOUND", `The project root does not exist: ${trimmed}`);
  }
  const info = await fs.stat(canonical);
  if (!info?.isDirectory()) {
    throw new WorkspaceRootError("NOT_DIRECTORY", `The project root is not a directory: ${trimmed}`);
  }
  return canonical;
}

/**
 * The turn-level owner gate. The conversation's OWNER's turns run under the
 * recorded root; every other caller's turn runs WITHOUT any project root
 * (CRM mode), regardless of what the conversation stores.
 */
export function workspaceRootForTurn(input: {
  /** The user whose turn is being served. */
  actorId: string;
  /** The conversation's owner (the user who created it). */
  conversationOwnerId: string;
  /** The stored canonical root (server-resolved realpath). */
  workspaceRootRealpath?: string | null;
}): string | null {
  if (input.actorId !== input.conversationOwnerId) return null;
  return input.workspaceRootRealpath ?? null;
}

/**
 * CLI runtime mapping: the harness CLI's `--add-dir` grants the root as an
 * additional physical directory writable under the workspace-write sandbox
 * preset (per spawn, so per turn). No root, no argument.
 */
export function cliWorkspaceRootArgs(workspaceRootRealpath?: string | null): string[] {
  return workspaceRootRealpath ? ["--add-dir", workspaceRootRealpath] : [];
}

/**
 * The read-only workspace listing the UI's file panel will consume:
 * the stored spellings plus whether the directory still exists right now.
 */
export interface WorkspaceRootListing {
  /** The user-supplied spelling (may be null when no root is set). */
  workspaceRoot: string | null;
  /** The server-resolved realpath recorded at set time. */
  workspaceRootRealpath: string | null;
  /** Whether the stored root still exists and is a directory. */
  exists: boolean;
  /** The canonical root to show; the recorded realpath (stale roots keep it). */
  realpath: string | null;
}

export async function describeWorkspaceRoot(
  root: { workspaceRoot: string | null; workspaceRootRealpath: string | null },
  fs: WorkspaceRootFs = defaultWorkspaceRootFs
): Promise<WorkspaceRootListing> {
  const { workspaceRoot, workspaceRootRealpath } = root;
  if (!workspaceRootRealpath && !workspaceRoot) {
    return { workspaceRoot: null, workspaceRootRealpath: null, exists: false, realpath: null };
  }
  const probe = workspaceRootRealpath ?? (workspaceRoot as string);
  let exists = false;
  try {
    exists = (await fs.stat(probe))?.isDirectory() === true;
  } catch {
    exists = false;
  }
  return { workspaceRoot, workspaceRootRealpath, exists, realpath: workspaceRootRealpath };
}
