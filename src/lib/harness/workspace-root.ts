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

import { open as fsOpen, readdir as fsReaddir, realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import { isAbsolute, join as joinPath, sep as pathSeparator } from "node:path";

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

// ---------------------------------------------------------------------------
// Files panel (this phase): path containment for the workspace file APIs.
//
// Every path the file APIs touch is RELATIVE to the workspace root, is
// resolved server-side, and is verified — lexically AND by realpath — to stay
// inside the stored root (which the set-root route already canonicalized).
// The same rules gate both reads, so a symlink that escapes the root, a ".."
// segment, an absolute path, or a file that vanished are all refused before
// any bytes leave the machine.
// ---------------------------------------------------------------------------

/** Longest accepted relative path from the file panel (a PATH_MAX-scale guard). */
export const WORKSPACE_REL_PATH_MAX_LENGTH = 4096;

/** Text files larger than this are previewed truncated (the UI shows a badge). */
export const WORKSPACE_FILE_MAX_BYTES = 256 * 1024;

export type WorkspacePathErrorCode = "INVALID_PATH" | "ESCAPES_ROOT" | "NOT_FOUND" | "NOT_FILE";

/** A file-panel path the server refused, with a machine-readable reason. */
export class WorkspacePathError extends Error {
  readonly code: WorkspacePathErrorCode;

  constructor(code: WorkspacePathErrorCode, message: string) {
    super(message);
    this.name = "WorkspacePathError";
    this.code = code;
  }
}

/**
 * The read surface the file APIs need on top of root validation. Tests inject
 * a fake one; the default is the real filesystem.
 */
export interface WorkspaceIoFs extends WorkspaceRootFs {
  /** Entries of an existing directory; `size` is 0 for directories. */
  readdir(path: string): Promise<Array<{ name: string; kind: "dir" | "file"; size: number }>>;
  /**
   * Up to `maxBytes` from the start of an existing file, plus its true total
   * size (the caller computes `truncated`). Rejects when the file is missing.
   */
  readFile(path: string, maxBytes: number): Promise<{ bytes: Uint8Array; size: number }>;
}

/** Node's real filesystem — the server default for the file APIs. */
export const defaultWorkspaceIoFs: WorkspaceIoFs = {
  ...defaultWorkspaceRootFs,
  readdir: async (dir) => {
    const entries = await fsReaddir(dir, { withFileTypes: true });
    const rows: Array<{ name: string; kind: "dir" | "file"; size: number }> = [];
    for (const entry of entries) {
      let kind: "dir" | "file";
      if (entry.isDirectory()) kind = "dir";
      else if (entry.isFile()) kind = "file";
      else {
        // Symlinks (or anything else): resolve the kind through stat so a link
        // to a directory inside the root renders as a folder. Opening it is
        // still realpath-gated, so an escaping link can never be read.
        try {
          kind = (await fsStat(joinPath(dir, entry.name))).isDirectory() ? "dir" : "file";
        } catch {
          continue; // dangling link — hide it rather than listing a dead row
        }
      }
      const size = kind === "file" ? (await fsStat(joinPath(dir, entry.name))).size : 0;
      rows.push({ name: entry.name, kind, size });
    }
    return rows;
  },
  readFile: async (path, maxBytes) => {
    const handle = await fsOpen(path, "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      let offset = 0;
      while (offset < length) {
        const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      return { bytes: buffer.subarray(0, offset), size };
    } finally {
      await handle.close();
    }
  },
};

/**
 * Resolve a UI-supplied RELATIVE path to an absolute path that is PROVABLY
 * inside `root` (the stored realpath). Rules, enforced in order:
 * - the path must be a relative posix-style path (no NUL, no backslashes, not
 *   absolute, no drive prefix);
 * - no ".." segment is accepted at all (empty/'.' segments are tolerated);
 * - the joined absolute candidate must lexically stay at or under the root;
 * - the candidate's realpath must equal the root or start with `root + sep`,
 *   which is the symlink-escape check (a link pointing outside the root
 *   resolves to an outside realpath and is refused).
 * Throws a typed WorkspacePathError (routes map it onto a 400/404).
 */
export async function resolveWorkspaceRelativePath(input: {
  /** The conversation's stored canonical root (server-resolved realpath). */
  root: string;
  /** The relative path from the file panel; "" (or null/undefined) = the root. */
  rel?: string | null;
  fs?: WorkspaceIoFs;
}): Promise<string> {
  const fs = input.fs ?? defaultWorkspaceIoFs;
  const raw = input.rel ?? "";
  if (raw.includes("\0")) {
    throw new WorkspacePathError("INVALID_PATH", "The path contains an invalid character");
  }
  if (raw.length > WORKSPACE_REL_PATH_MAX_LENGTH) {
    throw new WorkspacePathError("INVALID_PATH", "The path is too long");
  }
  if (raw.includes("\\")) {
    // Defense in depth: panel paths are posix-style; a Windows separator in a
    // relative path is a traversal smell on every platform.
    throw new WorkspacePathError("INVALID_PATH", "The path must use forward slashes");
  }
  if (isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    throw new WorkspacePathError("INVALID_PATH", "The path must be relative to the workspace");
  }
  const segments = raw.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new WorkspacePathError("ESCAPES_ROOT", "The path must stay inside the workspace");
  }
  if (segments.length === 0) {
    // The root itself: it was canonicalized when recorded, so an existence
    // check is the only gate needed (missing → NOT_FOUND).
    const info = await fs.stat(input.root);
    if (!info?.isDirectory()) {
      throw new WorkspacePathError("NOT_FOUND", "The workspace folder does not exist");
    }
    return input.root;
  }
  const candidate = joinPath(input.root, ...segments);
  if (candidate !== input.root && !candidate.startsWith(input.root + pathSeparator)) {
    throw new WorkspacePathError("ESCAPES_ROOT", "The path must stay inside the workspace");
  }
  let canonical: string;
  try {
    canonical = await fs.realpath(candidate);
  } catch {
    throw new WorkspacePathError("NOT_FOUND", "The path does not exist in the workspace");
  }
  if (canonical !== input.root && !canonical.startsWith(input.root + pathSeparator)) {
    // The symlink-escape check: the lexical path stayed inside, but the link
    // resolved outside the root.
    throw new WorkspacePathError("ESCAPES_ROOT", "The path must stay inside the workspace");
  }
  return canonical;
}

/** One row of the file tree, with the posix-style relative path the UI uses. */
export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number;
}

/** A relative path for listing/reading ("" = the root). */
export function workspaceRelPath(rel: string | null | undefined): string {
  return (rel ?? "").trim();
}

/**
 * List one directory level of the workspace, each entry's path verified the
 * same way every read is (defense in depth; readdir names are single
 * components so they cannot traverse). Directories sort before files, then
 * alphabetically. The returned `path` is the normalized relative path the UI
 * should use for child listings.
 */
export async function listWorkspaceDirectory(input: {
  root: string;
  rel?: string | null;
  fs?: WorkspaceIoFs;
}): Promise<{ entries: WorkspaceEntry[]; path: string }> {
  const fs = input.fs ?? defaultWorkspaceIoFs;
  const rel = workspaceRelPath(input.rel);
  const dir = await resolveWorkspaceRelativePath({ root: input.root, rel, fs });
  const rows = await fs.readdir(dir);
  const prefix = rel === "" ? "" : `${rel}/`;
  const entries: WorkspaceEntry[] = rows.map((row) => ({
    name: row.name,
    path: `${prefix}${row.name}`,
    kind: row.kind,
    size: row.size,
  }));
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  return { entries, path: rel };
}

export type WorkspaceFileContent =
  | { binary: false; content: string; truncated: boolean }
  | { binary: true };

/**
 * Read a workspace text file for the preview pane. Binary files are sniffed
 * by a NUL byte (the classic heuristic; UTF-16 text is treated as binary, the
 * safe direction for a preview pane) and text is truncated to
 * WORKSPACE_FILE_MAX_BYTES with `truncated` set when the file is larger.
 */
export async function readWorkspaceTextFile(input: {
  root: string;
  rel: string;
  fs?: WorkspaceIoFs;
}): Promise<WorkspaceFileContent> {
  const fs = input.fs ?? defaultWorkspaceIoFs;
  const rel = workspaceRelPath(input.rel);
  const file = await resolveWorkspaceRelativePath({ root: input.root, rel, fs });
  const info = await fs.stat(file);
  if (!info) throw new WorkspacePathError("NOT_FOUND", "The path does not exist in the workspace");
  if (info.isDirectory()) {
    throw new WorkspacePathError("NOT_FILE", "The path is a directory, not a file");
  }
  const { bytes, size } = await fs.readFile(file, WORKSPACE_FILE_MAX_BYTES);
  if (bytes.subarray(0, 8192).includes(0)) {
    return { binary: true };
  }
  return {
    binary: false,
    content: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
    truncated: size > WORKSPACE_FILE_MAX_BYTES,
  };
}
