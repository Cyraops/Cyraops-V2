/**
 * Git helpers for the Workspace panel's branch/diff UI.
 *
 * SECURITY CONTRACT — the git API is argv-vector only:
 * - Every helper executes fixed arg vectors through execFile (no shell), and
 *   the workspace root is passed as the value of `-C` — never interpolated
 *   into a command string, so shell metacharacters in a directory name cannot
 *   reach a parser.
 * - User-supplied values (branch names, workspace-relative file paths, commit
 *   messages) are validated BEFORE they become argv elements: no leading `-`,
 *   no `..`, length ≤ 200, restricted charset. They are passed as single argv
 *   elements, never spliced into a command line.
 * - `git diff/restore/checkout` paths are preceded by `--` so a path can never
 *   be read as a git option even if validation ever regressed (defense in
 *   depth; validation is the primary control).
 *
 * The mutating helpers here (createBranch/switchBranch/commitChanges/
 * discardChanges) do NOT decide policy — the HTTP routes own the approval gate
 * and audit logging. This module stays pure exec + validation so it is fully
 * unit-testable with a recording fake.
 */

import { execFile as cpExecFile } from "node:child_process";

/** The exec surface the git helpers need; tests inject a recording fake. */
export interface GitExec {
  execFile(
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number }
  ): Promise<{ stdout: string; stderr: string }>;
}

/** Node's execFile, promisified — the server default. */
export const defaultGitExec: GitExec = {
  execFile: (file, args, options) =>
    new Promise((resolve, reject) => {
      cpExecFile(file, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    }),
};

export const GIT_TIMEOUT_MS = 10_000;
export const GIT_MAX_BUFFER = 1 << 20; // 1 MB — plenty for log/diff --stat

/**
 * The ONLY arg vectors the read-only status helper executes. `args(root)`
 * receives the server-resolved workspace realpath (never user input beyond
 * that recorded, validated path); everything else in each vector is a
 * constant.
 */
export const GIT_ARG_VECTORS: ReadonlyArray<{
  /** The status field the stdout lands in. */
  key: keyof Omit<WorkspaceGitStatus, "available">;
  /** Human-readable label for reports/logs. */
  label: string;
  args: (root: string) => string[];
}> = [
  { key: "branch", label: "git branch --show-current", args: (root) => ["-C", root, "branch", "--show-current"] },
  { key: "status", label: "git status --porcelain", args: (root) => ["-C", root, "status", "--porcelain"] },
  { key: "log", label: "git log -5 --oneline", args: (root) => ["-C", root, "log", "-5", "--oneline"] },
  { key: "diffStat", label: "git diff --stat", args: (root) => ["-C", root, "diff", "--stat"] },
];

export interface WorkspaceGitStatus {
  /** The checked-out branch ("" when detached or unavailable). */
  branch: string;
  /** Raw `git status --porcelain` output (one line per changed file). */
  status: string;
  /** The last five commits, one line each (`git log -5 --oneline`). */
  log: string;
  /** `git diff --stat` summary of unstaged changes. */
  diffStat: string;
  /** False when git is missing or the directory is not a git repository. */
  available: boolean;
}

/**
 * Collect the read-only git facts the panel shows. Each fixed vector runs
 * independently with a timeout and a bounded buffer; a failed vector yields
 * an empty string for its field, and `available` is true only when every
 * vector succeeded. No mutation is possible: the vectors are the constants
 * above, nothing else.
 */
export async function collectWorkspaceGitStatus(
  root: string,
  exec: GitExec = defaultGitExec
): Promise<WorkspaceGitStatus> {
  const result: WorkspaceGitStatus = { branch: "", status: "", log: "", diffStat: "", available: false };
  let succeeded = 0;
  for (const vector of GIT_ARG_VECTORS) {
    try {
      const { stdout } = await exec.execFile("git", vector.args(root), {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
      });
      result[vector.key] = stdout.replace(/\s+$/, "");
      succeeded += 1;
    } catch {
      // git missing, not a repository, or output beyond the buffer: the field
      // stays "" and the panel shows the muted "not a repository" line.
    }
  }
  result.available = succeeded === GIT_ARG_VECTORS.length;
  return result;
}

// ---------------------------------------------------------------------------
// Validation (this phase): branch names, workspace-relative file paths, and
// commit messages are checked BEFORE becoming argv elements.
// ---------------------------------------------------------------------------

/** Longest accepted branch name / workspace-relative file path. */
export const GIT_ARG_MAX_LENGTH = 200;

/** Longest accepted commit message (a whole line, not a filename). */
export const GIT_COMMIT_MESSAGE_MAX_LENGTH = 4000;

export type GitArgErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "LEADING_DASH"
  | "TRAVERSAL"
  | "INVALID_CHARSET"
  | "ABSOLUTE";

/** A user-supplied git argument the module refused, with a machine-readable reason. */
export class GitArgError extends Error {
  readonly code: GitArgErrorCode;

  constructor(code: GitArgErrorCode, message: string) {
    super(message);
    this.name = "GitArgError";
    this.code = code;
  }
}

/** git check-ref-format rules, conservatively approximated for branch names. */
const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;

/**
 * Validate a branch name and return its trimmed form. Rejected: empty, longer
 * than 200 chars, leading `-` (would be read as an option), `..`, leading or
 * trailing `/`, `//`, whitespace/control chars, the git-refname metacharacters
 * (`~^:?*[\`), trailing `.`/`.lock`, and `@{`. The name is returned as a
 * single argv element by the caller.
 */
export function validateGitBranchName(name: string): string {
  const value = String(name ?? "").trim();
  if (!value) throw new GitArgError("EMPTY", "A branch name is required");
  if (value.length > GIT_ARG_MAX_LENGTH) {
    throw new GitArgError("TOO_LONG", `The branch name is too long (max ${GIT_ARG_MAX_LENGTH} characters)`);
  }
  if (value.startsWith("-")) throw new GitArgError("LEADING_DASH", "The branch name must not start with '-'");
  if (value.includes("..")) throw new GitArgError("TRAVERSAL", "The branch name must not contain '..'");
  if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) {
    throw new GitArgError("INVALID_CHARSET", "Invalid branch name");
  }
  if (CONTROL_CHARS_RE.test(value) || /\s/.test(value)) {
    throw new GitArgError("INVALID_CHARSET", "The branch name must not contain whitespace or control characters");
  }
  if (/[~^:?*[\]\\]/.test(value)) {
    throw new GitArgError("INVALID_CHARSET", "The branch name contains unsupported characters");
  }
  if (value.endsWith(".") || value.endsWith(".lock")) {
    throw new GitArgError("INVALID_CHARSET", "Invalid branch name");
  }
  if (value.includes("@{")) throw new GitArgError("INVALID_CHARSET", "Invalid branch name");
  if (!BRANCH_NAME_RE.test(value)) {
    throw new GitArgError("INVALID_CHARSET", "The branch name contains unsupported characters");
  }
  return value;
}

/**
 * Validate a workspace-relative file path (posix-style) and return its trimmed
 * form. Rejected: empty, longer than 200 chars, leading `-`, NUL/backslash,
 * absolute paths / drive prefixes, and any `..` segment. The path is returned
 * as a single argv element and always follows `--` in the argv vector.
 */
export function validateGitFilePath(rel: string): string {
  const value = String(rel ?? "").trim();
  if (!value) throw new GitArgError("EMPTY", "A file path is required");
  if (value.length > GIT_ARG_MAX_LENGTH) {
    throw new GitArgError("TOO_LONG", `The path is too long (max ${GIT_ARG_MAX_LENGTH} characters)`);
  }
  if (value.includes("\0") || value.includes("\\")) {
    throw new GitArgError("INVALID_CHARSET", "The path contains invalid characters");
  }
  if (value.startsWith("-")) throw new GitArgError("LEADING_DASH", "The path must not start with '-'");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new GitArgError("ABSOLUTE", "The path must be relative to the workspace");
  }
  const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) throw new GitArgError("TRAVERSAL", "The path must stay inside the workspace");
  return value;
}

/**
 * Validate a commit message and return its trimmed form. Empty is rejected and
 * NUL is rejected (it cannot survive an argv boundary); the message is passed
 * as the value of `-m`, so a leading `-` is harmless, but length is still
 * bounded for hygiene.
 */
export function validateGitCommitMessage(message: string): string {
  const value = String(message ?? "").trim();
  if (!value) throw new GitArgError("EMPTY", "A commit message is required");
  if (value.length > GIT_COMMIT_MESSAGE_MAX_LENGTH) {
    throw new GitArgError("TOO_LONG", `The commit message is too long (max ${GIT_COMMIT_MESSAGE_MAX_LENGTH} characters)`);
  }
  if (value.includes("\0")) throw new GitArgError("INVALID_CHARSET", "The commit message contains an invalid character");
  return value;
}

// ---------------------------------------------------------------------------
// Git operations (this phase): one fixed argv vector per helper, all via
// execFile with no shell and a bounded timeout/buffer.
// ---------------------------------------------------------------------------

/** A git invocation that failed (non-zero exit or spawn error), with stderr for the route. */
export class GitCommandError extends Error {
  readonly command: string[];
  readonly stderr: string;

  constructor(command: string[], stderr: string) {
    const firstLine = stderr.trim().split("\n")[0] ?? "";
    super(`git ${command.join(" ")} failed${firstLine ? `: ${firstLine}` : ""}`);
    this.name = "GitCommandError";
    this.command = command;
    this.stderr = stderr;
  }
}

/** Run one git argv vector under `-C <root>` and return its stdout. */
async function runGit(exec: GitExec, root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec.execFile("git", ["-C", root, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout;
  } catch (error) {
    const stderr = String(
      (error as { stderr?: unknown } | null)?.stderr ??
        (error as { message?: unknown } | null)?.message ??
        ""
    );
    throw new GitCommandError(["git", "-C", root, ...args], stderr);
  }
}

export interface GitBranchList {
  /** The checked-out branch ("" when detached). */
  current: string;
  /** Every local and remote branch (`git branch -a --no-color`), de-duplicated in order. */
  branches: string[];
}

/**
 * List branches (`git branch -a --no-color`). The `* ` marker names the
 * current branch; `remotes/…` entries are kept so the switch menu can show
 * them (switching to a remote branch would need a local tracking branch, so
 * the UI filters those out).
 */
export async function listBranches(root: string, exec: GitExec = defaultGitExec): Promise<GitBranchList> {
  const out = await runGit(exec, root, ["branch", "-a", "--no-color"]);
  const branches: string[] = [];
  let current = "";
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("*")) {
      current = trimmed.slice(1).trim();
      if (current) branches.push(current);
    } else {
      branches.push(trimmed);
    }
  }
  return { current, branches };
}

/** True when `git status --porcelain` reports any change (staged, unstaged or untracked). */
export async function hasUncommittedChanges(root: string, exec: GitExec = defaultGitExec): Promise<boolean> {
  const out = await runGit(exec, root, ["status", "--porcelain"]);
  return out.trim().length > 0;
}

/** The unstaged diff for one workspace-relative path (`git diff --unified=3 -- <path>`). */
export async function getDiff(
  root: string,
  relpath: string,
  exec: GitExec = defaultGitExec
): Promise<{ path: string; rawText: string }> {
  const rel = validateGitFilePath(relpath);
  const rawText = await runGit(exec, root, ["diff", "--unified=3", "--", rel]);
  return { path: rel, rawText };
}

/** The working-tree summary (`git diff --stat`). */
export async function getDiffStat(root: string, exec: GitExec = defaultGitExec): Promise<{ stat: string }> {
  const stat = await runGit(exec, root, ["diff", "--stat"]);
  return { stat };
}

/** Create and check out a new branch (`git checkout -b <name>`). */
export async function createBranch(root: string, name: string, exec: GitExec = defaultGitExec): Promise<void> {
  const branch = validateGitBranchName(name);
  await runGit(exec, root, ["checkout", "-b", branch]);
}

/** Switch to an existing branch (`git switch <name>`). */
export async function switchBranch(root: string, name: string, exec: GitExec = defaultGitExec): Promise<void> {
  const branch = validateGitBranchName(name);
  await runGit(exec, root, ["switch", branch]);
}

/** Stage everything and commit (`git add -A` then `git commit -m <message>`). */
export async function commitChanges(root: string, message: string, exec: GitExec = defaultGitExec): Promise<void> {
  const msg = validateGitCommitMessage(message);
  await runGit(exec, root, ["add", "-A"]);
  await runGit(exec, root, ["commit", "-m", msg]);
}

/** Unstage then discard one path (`git restore --staged -- <path>` then `git checkout -- <path>`). */
export async function discardChanges(root: string, relpath: string, exec: GitExec = defaultGitExec): Promise<void> {
  const rel = validateGitFilePath(relpath);
  await runGit(exec, root, ["restore", "--staged", "--", rel]);
  await runGit(exec, root, ["checkout", "--", rel]);
}
