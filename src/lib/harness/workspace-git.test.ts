import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectWorkspaceGitStatus,
  GIT_ARG_VECTORS,
  GIT_TIMEOUT_MS,
  GIT_MAX_BUFFER,
  type GitExec,
} from "./workspace-git";

/** A recording fake exec whose outputs the test controls, keyed by the vector key. */
function fakeGitExec(
  outputs: Partial<Record<"branch" | "status" | "log" | "diffStat", string>> = {},
  failing: Array<"branch" | "status" | "log" | "diffStat"> = []
) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const keyOf = (args: string[]): "branch" | "status" | "log" | "diffStat" => {
    if (args.includes("--show-current")) return "branch";
    if (args.includes("--porcelain")) return "status";
    if (args.includes("--oneline")) return "log";
    return "diffStat";
  };
  const exec: GitExec = {
    async execFile(file, args) {
      calls.push({ file, args });
      const key = keyOf(args);
      if (failing.includes(key)) throw new Error(`git failed: ${key}`);
      return { stdout: outputs[key] ?? "", stderr: "" };
    },
  };
  return { exec, calls };
}

test("GIT_ARG_VECTORS contains exactly the four documented read-only vectors", () => {
  const vectors = GIT_ARG_VECTORS.map((vector) => ({
    key: vector.key,
    args: vector.args("/work/project"),
  }));
  assert.deepEqual(vectors, [
    { key: "branch", args: ["-C", "/work/project", "branch", "--show-current"] },
    { key: "status", args: ["-C", "/work/project", "status", "--porcelain"] },
    { key: "log", args: ["-C", "/work/project", "log", "-5", "--oneline"] },
    { key: "diffStat", args: ["-C", "/work/project", "diff", "--stat"] },
  ]);
});

test("collectWorkspaceGitStatus executes exactly the fixed vectors, never anything else", async () => {
  const { exec, calls } = fakeGitExec({
    branch: "main",
    status: " M hello.txt",
    log: "abc123 init",
    diffStat: " hello.txt | 2 +-",
  });
  const status = await collectWorkspaceGitStatus("/work/project", exec);
  assert.deepEqual(status, {
    branch: "main",
    status: " M hello.txt",
    log: "abc123 init",
    diffStat: " hello.txt | 2 +-",
    available: true,
  });
  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(call.file, "git");
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ["-C", "/work/project", "branch", "--show-current"],
      ["-C", "/work/project", "status", "--porcelain"],
      ["-C", "/work/project", "log", "-5", "--oneline"],
      ["-C", "/work/project", "diff", "--stat"],
    ]
  );
});

test("collectWorkspaceGitStatus never interpolates a workspace path into a command string", async () => {
  // A root that would be catastrophic inside a shell string must still only
  // ever appear as a separate argv element (execFile, no shell).
  const evilRoot = "/work/evil; rm -rf / #";
  const { exec, calls } = fakeGitExec({ branch: "main" });
  const status = await collectWorkspaceGitStatus(evilRoot, exec);
  assert.equal(status.available, true);
  for (const call of calls) {
    assert.equal(call.args[0], "-C");
    assert.equal(call.args[1], evilRoot);
    assert.ok(call.args.length <= 5);
  }
});

test("collectWorkspaceGitStatus marks unavailable when any vector fails", async () => {
  const { exec } = fakeGitExec({ branch: "main" }, ["diffStat"]);
  const status = await collectWorkspaceGitStatus("/work/project", exec);
  assert.equal(status.available, false);
  assert.equal(status.branch, "main");
  assert.equal(status.diffStat, "");
});

test("collectWorkspaceGitStatus passes a bounded timeout and buffer to exec", async () => {
  let seen: { timeout: number; maxBuffer: number } | null = null;
  const exec: GitExec = {
    async execFile(_file, _args, options) {
      seen = options;
      return { stdout: "", stderr: "" };
    },
  };
  await collectWorkspaceGitStatus("/work/project", exec);
  assert.deepEqual(seen, { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
});
