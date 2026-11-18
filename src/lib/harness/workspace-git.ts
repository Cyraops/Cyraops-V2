/**
 * Read-only git status for the Workspace panel.
 *
 * SECURITY CONTRACT — the git API is read-only by construction:
 * - `collectWorkspaceGitStatus` executes ONLY the fixed arg vectors declared
 *   in GIT_ARG_VECTORS below. No user input (not even the workspace path) is
 *   ever interpolated into a command string: the root is passed as the value
 *   of `-C`, and execFile spawns git directly with no shell, so shell
 *   metacharacters in a directory name cannot reach a parser.
 * - Every declared vector is a read: status/branch/log/diff. Nothing here
 *   mutates the repository, and nothing else is ever executed — new vectors
 *   require editing this module and its tests.
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
 * The ONLY arg vectors the git API executes. `args(root)` receives the
 * server-resolved workspace realpath (never user input beyond that recorded,
 * validated path); everything else in each vector is a constant.
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
