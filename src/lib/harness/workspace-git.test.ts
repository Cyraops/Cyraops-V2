import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectWorkspaceGitStatus,
  commitChanges,
  createBranch,
  discardChanges,
  getDiff,
  getDiffStat,
  GIT_ARG_MAX_LENGTH,
  GIT_ARG_VECTORS,
  GitArgError,
  GitCommandError,
  GIT_MAX_BUFFER,
  GIT_TIMEOUT_MS,
  hasUncommittedChanges,
  isNotAGitRepository,
  listBranches,
  NOT_A_GIT_REPOSITORY,
  switchBranch,
  validateGitBranchName,
  validateGitCommitMessage,
  validateGitFilePath,
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

/** A recording fake for the operation helpers, keyed by the argv after `-C <root>`. */
function opRecordingGitExec(outputs: Record<string, string> = {}, failing: string[] = []) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const opOf = (args: string[]): string => args.slice(2).join(" ");
  const exec: GitExec = {
    async execFile(file, args) {
      calls.push({ file, args });
      const op = opOf(args);
      if (failing.includes(op)) throw new Error(`git failed: ${op}`);
      return { stdout: outputs[op] ?? "", stderr: "" };
    },
  };
  return { exec, calls, opOf };
}

/** A git exit-128 "not a git repository" failure, shaped like node's execFile error. */
function notAGitRepoError(): Error {
  const error = new Error("git exited 128");
  (error as { code?: unknown }).code = 128;
  (error as { stderr?: unknown }).stderr =
    "fatal: not a git repository (or any of the parent directories): .git";
  return error;
}

/** A recording fake whose every git call fails with the non-repo exit-128 error. */
function nonRepoGitExec() {
  const calls: Array<{ file: string; args: string[] }> = [];
  const exec: GitExec = {
    async execFile(file, args) {
      calls.push({ file, args });
      throw notAGitRepoError();
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

// ---------------------------------------------------------------------------
// Non-git root detection (exit 128 / "not a git repository")
// ---------------------------------------------------------------------------

test("isNotAGitRepository is true only for exit 128 with the non-repo stderr", () => {
  assert.equal(isNotAGitRepository(notAGitRepoError()), true);

  const otherCode = notAGitRepoError();
  (otherCode as { code?: unknown }).code = 1;
  assert.equal(isNotAGitRepository(otherCode), false);

  const otherStderr = notAGitRepoError();
  (otherStderr as { stderr?: unknown }).stderr = "fatal: bad object";
  assert.equal(isNotAGitRepository(otherStderr), false);

  assert.equal(isNotAGitRepository(new Error("boom")), false);
});

test("collectWorkspaceGitStatus detects a non-git root, reports the reason, and stops polling", async () => {
  const { exec, calls } = nonRepoGitExec();
  const status = await collectWorkspaceGitStatus("/work/project", exec);
  assert.deepEqual(status, {
    branch: "",
    status: "",
    log: "",
    diffStat: "",
    available: false,
    reason: NOT_A_GIT_REPOSITORY,
  });
  // The first fatal vector decides it: the other three are never attempted.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["-C", "/work/project", "branch", "--show-current"]);
});

test("listBranches returns available:false for a non-git root instead of throwing", async () => {
  const { exec } = nonRepoGitExec();
  const list = await listBranches("/work/project", exec);
  assert.deepEqual(list, { current: "", branches: [], available: false, reason: NOT_A_GIT_REPOSITORY });
});

test("listBranches still throws GitCommandError for a genuine git failure", async () => {
  const { exec } = opRecordingGitExec({}, ["branch -a --no-color"]);
  await assert.rejects(() => listBranches("/work/project", exec), GitCommandError);
});

test("getDiff returns available:false for a non-git root instead of throwing", async () => {
  const { exec } = nonRepoGitExec();
  const diff = await getDiff("/work/project", "src/a.ts", exec);
  assert.deepEqual(diff, { path: "src/a.ts", rawText: "", available: false, reason: NOT_A_GIT_REPOSITORY });
});

test("getDiff still throws GitCommandError for a genuine git failure", async () => {
  const { exec } = opRecordingGitExec({}, ["diff --unified=3 -- src/a.ts"]);
  await assert.rejects(() => getDiff("/work/project", "src/a.ts", exec), GitCommandError);
});

// ---------------------------------------------------------------------------
// listBranches / getDiff / getDiffStat / hasUncommittedChanges
// ---------------------------------------------------------------------------

test("listBranches parses the current branch and all branches", async () => {
  const { exec, calls } = opRecordingGitExec({
    "branch -a --no-color": "* main\n  feature/x\n  remotes/origin/main\n",
  });
  const list = await listBranches("/work/project", exec);
  assert.deepEqual(list, { current: "main", branches: ["main", "feature/x", "remotes/origin/main"], available: true });
  assert.deepEqual(calls.map((call) => call.args), [
    ["-C", "/work/project", "branch", "-a", "--no-color"],
  ]);
});

test("getDiff runs git diff --unified=3 -- <path> and returns the raw text", async () => {
  const { exec, calls } = opRecordingGitExec({ "diff --unified=3 -- src/a.ts": "diff text" });
  const diff = await getDiff("/work/project", "src/a.ts", exec);
  assert.deepEqual(diff, { path: "src/a.ts", rawText: "diff text", available: true });
  assert.deepEqual(calls.map((call) => call.args), [
    ["-C", "/work/project", "diff", "--unified=3", "--", "src/a.ts"],
  ]);
});

test("getDiffStat runs git diff --stat", async () => {
  const { exec, calls } = opRecordingGitExec({ "diff --stat": " a.ts | 2 +-" });
  const result = await getDiffStat("/work/project", exec);
  assert.deepEqual(result, { stat: " a.ts | 2 +-" });
  assert.deepEqual(calls.map((call) => call.args), [["-C", "/work/project", "diff", "--stat"]]);
});

test("hasUncommittedChanges is true only when status --porcelain is non-empty", async () => {
  const { exec } = opRecordingGitExec({ "status --porcelain": "" });
  assert.equal(await hasUncommittedChanges("/work/project", exec), false);
  const { exec: dirtyExec } = opRecordingGitExec({ "status --porcelain": " M a.ts\n" });
  assert.equal(await hasUncommittedChanges("/work/project", dirtyExec), true);
});

// ---------------------------------------------------------------------------
// Mutations: fixed argv vectors, values as single argv elements
// ---------------------------------------------------------------------------

test("createBranch runs git checkout -b <name>", async () => {
  const { exec, calls } = opRecordingGitExec();
  await createBranch("/work/project", "feature/x", exec);
  assert.deepEqual(calls.map((call) => call.args), [
    ["-C", "/work/project", "checkout", "-b", "feature/x"],
  ]);
});

test("switchBranch runs git switch <name>", async () => {
  const { exec, calls } = opRecordingGitExec();
  await switchBranch("/work/project", "main", exec);
  assert.deepEqual(calls.map((call) => call.args), [["-C", "/work/project", "switch", "main"]]);
});

test("commitChanges stages everything then commits with the message", async () => {
  const { exec, calls } = opRecordingGitExec();
  await commitChanges("/work/project", "feat: ship it", exec);
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ["-C", "/work/project", "add", "-A"],
      ["-C", "/work/project", "commit", "-m", "feat: ship it"],
    ]
  );
});

test("discardChanges unstages then discards the path, as one argv element each", async () => {
  const { exec, calls } = opRecordingGitExec();
  await discardChanges("/work/project", "src/my file.txt", exec);
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ["-C", "/work/project", "restore", "--staged", "--", "src/my file.txt"],
      ["-C", "/work/project", "checkout", "--", "src/my file.txt"],
    ]
  );
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("validateGitBranchName accepts conventional names", () => {
  assert.equal(validateGitBranchName("main"), "main");
  assert.equal(validateGitBranchName("feature/foo-bar"), "feature/foo-bar");
  assert.equal(validateGitBranchName("  fix_x.1  "), "fix_x.1");
});

test("validateGitBranchName rejects dangerous names before any exec", () => {
  for (const bad of ["", "  ", "-f", "--force", "a..b", "a b", "a@{b", "a.", "a.lock", "/lead", "trail/", "a//b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b"]) {
    assert.throws(() => validateGitBranchName(bad), GitArgError, `expected rejection of ${JSON.stringify(bad)}`);
  }
  assert.throws(() => validateGitBranchName("x".repeat(GIT_ARG_MAX_LENGTH + 1)), GitArgError);
});

test("validateGitFilePath accepts workspace-relative paths", () => {
  assert.equal(validateGitFilePath("src/a.ts"), "src/a.ts");
  assert.equal(validateGitFilePath("  hello.txt  "), "hello.txt");
  assert.equal(validateGitFilePath("src/my file.txt"), "src/my file.txt");
});

test("validateGitFilePath rejects traversal, absolute, option-like and invalid paths", () => {
  for (const bad of ["", "  ", "-f", "--foo", "..", "../etc/passwd", "a/../b", "/etc/passwd", "C:/x", "a\\b", "a\0b"]) {
    assert.throws(() => validateGitFilePath(bad), GitArgError, `expected rejection of ${JSON.stringify(bad)}`);
  }
  assert.throws(() => validateGitFilePath("x".repeat(GIT_ARG_MAX_LENGTH + 1)), GitArgError);
});

test("validateGitCommitMessage rejects empty, NUL and over-long messages", () => {
  assert.equal(validateGitCommitMessage("  ship it  "), "ship it");
  assert.throws(() => validateGitCommitMessage(""), GitArgError);
  assert.throws(() => validateGitCommitMessage("  "), GitArgError);
  assert.throws(() => validateGitCommitMessage("a\0b"), GitArgError);
  assert.throws(() => validateGitCommitMessage("x".repeat(4001)), GitArgError);
});

test("a traversal path is rejected before git runs", async () => {
  const { exec, calls } = opRecordingGitExec();
  await assert.rejects(
    () => getDiff("/work/project", "../etc/passwd", exec),
    (error: unknown) => error instanceof GitArgError && error.code === "TRAVERSAL"
  );
  assert.equal(calls.length, 0);
});

test("a leading-dash branch name is rejected before git runs", async () => {
  const { exec, calls } = opRecordingGitExec();
  await assert.rejects(
    () => createBranch("/work/project", "--force", exec),
    (error: unknown) => error instanceof GitArgError && error.code === "LEADING_DASH"
  );
  assert.equal(calls.length, 0);
});
