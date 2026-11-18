import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cliWorkspaceRootArgs,
  describeWorkspaceRoot,
  normalizeWorkspaceRoot,
  WorkspaceRootError,
  workspaceRootForTurn,
  type WorkspaceRootFs,
} from "./workspace-root";

/** A fake fs the tests fully control: a path -> "physical" map plus symlinks. */
function fakeFs(entries: Record<string, "dir" | "file"> = {}, links: Record<string, string> = {}): WorkspaceRootFs {
  const resolveLink = (path: string): string => {
    let current = path;
    const seen = new Set<string>();
    while (links[current]) {
      if (seen.has(current)) throw new Error("symlink loop");
      seen.add(current);
      current = links[current];
    }
    return current;
  };
  return {
    async realpath(path: string) {
      const target = resolveLink(path);
      if (!(target in entries)) throw new Error("ENOENT");
      return target;
    },
    async stat(path: string) {
      const target = resolveLink(path);
      if (!(target in entries)) return null;
      return { isDirectory: () => entries[target] === "dir" };
    },
  };
}

test("normalizeWorkspaceRoot returns the realpath of an existing directory", async () => {
  const fs = fakeFs({ "/work/project": "dir" });
  const canonical = await normalizeWorkspaceRoot("/work/project", fs);
  assert.equal(canonical, "/work/project");
});

test("normalizeWorkspaceRoot resolves symlinks to the canonical realpath", async () => {
  const fs = fakeFs({ "/real/root": "dir" }, { "/home/user/alias": "/real/root" });
  const canonical = await normalizeWorkspaceRoot("/home/user/alias", fs);
  assert.equal(canonical, "/real/root");
});

test("normalizeWorkspaceRoot trims surrounding whitespace", async () => {
  const fs = fakeFs({ "/work/project": "dir" });
  const canonical = await normalizeWorkspaceRoot("  /work/project  ", fs);
  assert.equal(canonical, "/work/project");
});

test("normalizeWorkspaceRoot rejects empty input", async () => {
  await assert.rejects(
    normalizeWorkspaceRoot("   ", fakeFs()),
    (error: unknown) => error instanceof WorkspaceRootError && error.code === "NOT_ABSOLUTE"
  );
});

test("normalizeWorkspaceRoot rejects relative paths", async () => {
  const fs = fakeFs({ "/cwd/project": "dir" });
  await assert.rejects(
    normalizeWorkspaceRoot("project", fs),
    (error: unknown) => error instanceof WorkspaceRootError && error.code === "NOT_ABSOLUTE"
  );
  await assert.rejects(
    normalizeWorkspaceRoot("./project", fs),
    (error: unknown) => error instanceof WorkspaceRootError && error.code === "NOT_ABSOLUTE"
  );
});

test("normalizeWorkspaceRoot rejects paths that do not exist", async () => {
  await assert.rejects(
    normalizeWorkspaceRoot("/no/such/dir", fakeFs()),
    (error: unknown) => error instanceof WorkspaceRootError && error.code === "NOT_FOUND"
  );
});

test("normalizeWorkspaceRoot rejects files (only directories are roots)", async () => {
  const fs = fakeFs({ "/work/file.txt": "file" });
  await assert.rejects(
    normalizeWorkspaceRoot("/work/file.txt", fs),
    (error: unknown) => error instanceof WorkspaceRootError && error.code === "NOT_DIRECTORY"
  );
});

test("normalizeWorkspaceRoot rejects a dangling symlink as NOT_FOUND", async () => {
  const fs = fakeFs({}, { "/work/dangling": "/gone" });
  await assert.rejects(
    normalizeWorkspaceRoot("/work/dangling", fs),
    (error: unknown) => error instanceof WorkspaceRootError && error.code === "NOT_FOUND"
  );
});

test("workspaceRootForTurn grants the root only to the conversation owner", () => {
  const owner = "user-owner";
  const member = "user-member";
  const realpath = "/work/project";

  assert.equal(
    workspaceRootForTurn({ actorId: owner, conversationOwnerId: owner, workspaceRootRealpath: realpath }),
    realpath
  );
  // A non-owner turn in the same conversation runs WITHOUT any project root.
  assert.equal(
    workspaceRootForTurn({ actorId: member, conversationOwnerId: owner, workspaceRootRealpath: realpath }),
    null
  );
  // An unset root stays null even for the owner (CRM mode).
  assert.equal(
    workspaceRootForTurn({ actorId: owner, conversationOwnerId: owner, workspaceRootRealpath: null }),
    null
  );
  assert.equal(
    workspaceRootForTurn({ actorId: member, conversationOwnerId: owner, workspaceRootRealpath: undefined }),
    null
  );
});

test("cliWorkspaceRootArgs appends --add-dir with the realpath only when set", () => {
  assert.deepEqual(cliWorkspaceRootArgs("/work/project"), ["--add-dir", "/work/project"]);
  assert.deepEqual(cliWorkspaceRootArgs(null), []);
  assert.deepEqual(cliWorkspaceRootArgs(undefined), []);
  assert.deepEqual(cliWorkspaceRootArgs(""), []);
});

test("describeWorkspaceRoot reports existence without touching the stored spellings", async () => {
  const fs = fakeFs({ "/work/project": "dir" });
  const listing = await describeWorkspaceRoot(
    { workspaceRoot: "/home/user/alias", workspaceRootRealpath: "/work/project" },
    fs
  );
  assert.deepEqual(listing, {
    workspaceRoot: "/home/user/alias",
    workspaceRootRealpath: "/work/project",
    exists: true,
    realpath: "/work/project",
  });

  const stale = await describeWorkspaceRoot(
    { workspaceRoot: "/work/project", workspaceRootRealpath: "/work/project" },
    fakeFs()
  );
  assert.equal(stale.exists, false);
  // The recorded realpath is still reported so the panel can show where the
  // root pointed before it disappeared.
  assert.equal(stale.realpath, "/work/project");

  const unset = await describeWorkspaceRoot({ workspaceRoot: null, workspaceRootRealpath: null }, fs);
  assert.deepEqual(unset, {
    workspaceRoot: null,
    workspaceRootRealpath: null,
    exists: false,
    realpath: null,
  });
});
