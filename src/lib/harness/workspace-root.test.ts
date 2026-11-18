import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cliWorkspaceRootArgs,
  describeWorkspaceRoot,
  listWorkspaceDirectory,
  normalizeWorkspaceRoot,
  readWorkspaceTextFile,
  resolveWorkspaceRelativePath,
  WorkspacePathError,
  WorkspaceRootError,
  workspaceRootForTurn,
  WORKSPACE_FILE_MAX_BYTES,
  type WorkspaceIoFs,
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
      // Resolve links component-wise so a link in a PARENT directory applies
      // to deeper paths too (like the real filesystem).
      const parts = path.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current = `${current}/${part}`;
        let hops = 0;
        while (links[current] && hops < 32) {
          current = links[current];
          hops += 1;
        }
      }
      const target = resolveLink(current);
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

// ---------------------------------------------------------------------------
// File-panel helpers (this phase): path containment, listing, text preview.
// ---------------------------------------------------------------------------

/** A fake IO fs over a path map plus symlinks and file contents. */
function fakeIoFs(
  entries: Record<string, "dir" | "file"> = {},
  links: Record<string, string> = {},
  contents: Record<string, Uint8Array | string> = {}
): WorkspaceIoFs {
  const base = fakeFs(entries, links);
  const encode = (value: Uint8Array | string): Uint8Array =>
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return {
    ...base,
    async readdir(dir) {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const children = new Set<string>();
      for (const path of Object.keys(entries)) {
        if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
          children.add(path.slice(prefix.length));
        }
      }
      return [...children].map((name) => ({
        name,
        kind: entries[`${prefix}${name}`],
        size: entries[`${prefix}${name}`] === "file" ? encode(contents[`${prefix}${name}`] ?? "").length : 0,
      }));
    },
    async readFile(path, maxBytes) {
      if (!(path in entries) || entries[path] !== "file") throw new Error("ENOENT");
      const bytes = encode(contents[path] ?? "");
      return { bytes: bytes.subarray(0, maxBytes), size: bytes.length };
    },
  };
}

const PROBE_ENTRIES: Record<string, "dir" | "file"> = {
  "/work/project": "dir",
  "/work/project/hello.txt": "file",
  "/work/project/notes": "dir",
  "/work/project/notes/deep.txt": "file",
  "/work/project/real": "dir",
  "/etc": "dir",
  "/etc/passwd": "file",
};

test("resolveWorkspaceRelativePath returns the root for an empty relative path", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES);
  assert.equal(await resolveWorkspaceRelativePath({ root: "/work/project", rel: "", fs }), "/work/project");
  assert.equal(await resolveWorkspaceRelativePath({ root: "/work/project", rel: null, fs }), "/work/project");
});

test("resolveWorkspaceRelativePath resolves a nested path inside the root", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES);
  assert.equal(
    await resolveWorkspaceRelativePath({ root: "/work/project", rel: "notes/deep.txt", fs }),
    "/work/project/notes/deep.txt"
  );
});

test("resolveWorkspaceRelativePath rejects every .. segment, even ones that stay inside", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES);
  await assert.rejects(
    resolveWorkspaceRelativePath({ root: "/work/project", rel: "notes/../hello.txt", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "ESCAPES_ROOT"
  );
  await assert.rejects(
    resolveWorkspaceRelativePath({ root: "/work/project", rel: "../../etc/passwd", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "ESCAPES_ROOT"
  );
});

test("resolveWorkspaceRelativePath rejects absolute paths and drive prefixes", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES);
  for (const rel of ["/etc/passwd", "C:\\windows", "/work/project/hello.txt"]) {
    await assert.rejects(
      resolveWorkspaceRelativePath({ root: "/work/project", rel, fs }),
      (error: unknown) => error instanceof WorkspacePathError && error.code === "INVALID_PATH",
      `expected ${rel} to be rejected`
    );
  }
});

test("resolveWorkspaceRelativePath rejects backslashes and NUL bytes", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES);
  await assert.rejects(
    resolveWorkspaceRelativePath({ root: "/work/project", rel: "a\\b", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "INVALID_PATH"
  );
  await assert.rejects(
    resolveWorkspaceRelativePath({ root: "/work/project", rel: "a\0b", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "INVALID_PATH"
  );
});

test("resolveWorkspaceRelativePath maps missing paths onto NOT_FOUND", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES);
  await assert.rejects(
    resolveWorkspaceRelativePath({ root: "/work/project", rel: "nope.txt", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "NOT_FOUND"
  );
  await assert.rejects(
    resolveWorkspaceRelativePath({ root: "/work/project", rel: "", fs: fakeIoFs({}) }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "NOT_FOUND"
  );
});

test("resolveWorkspaceRelativePath rejects a symlink that escapes the root", async () => {
  // A link INSIDE the root that resolves OUTSIDE it is refused by realpath.
  const fs = fakeIoFs(PROBE_ENTRIES, { "/work/project/leak": "/etc" });
  await assert.rejects(
    resolveWorkspaceRelativePath({ root: "/work/project", rel: "leak/passwd", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "ESCAPES_ROOT"
  );
});

test("resolveWorkspaceRelativePath allows a symlink that stays inside the root", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES, { "/work/project/alias": "/work/project/real" });
  assert.equal(
    await resolveWorkspaceRelativePath({ root: "/work/project", rel: "alias", fs }),
    "/work/project/real"
  );
});

test("listWorkspaceDirectory lists one level, directories first, with relative paths", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES, {}, {
    "/work/project/hello.txt": "hello",
    "/work/project/notes/deep.txt": "deep",
  });
  const listing = await listWorkspaceDirectory({ root: "/work/project", rel: "", fs });
  assert.equal(listing.path, "");
  assert.deepEqual(
    listing.entries.map((entry) => entry.name),
    ["notes", "real", "hello.txt"]
  );
  const notes = await listWorkspaceDirectory({ root: "/work/project", rel: "notes", fs });
  assert.equal(notes.path, "notes");
  assert.deepEqual(notes.entries, [
    { name: "deep.txt", path: "notes/deep.txt", kind: "file", size: 4 },
  ]);
  const hello = listing.entries.find((entry) => entry.name === "hello.txt");
  assert.deepEqual(hello, { name: "hello.txt", path: "hello.txt", kind: "file", size: 5 });
});

test("listWorkspaceDirectory applies the same containment rules", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES);
  await assert.rejects(
    listWorkspaceDirectory({ root: "/work/project", rel: "../etc", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "ESCAPES_ROOT"
  );
  await assert.rejects(
    listWorkspaceDirectory({ root: "/work/project", rel: "/etc", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "INVALID_PATH"
  );
});

test("readWorkspaceTextFile returns content and the truncated flag", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES, {}, { "/work/project/hello.txt": "hello workspace" });
  const file = await readWorkspaceTextFile({ root: "/work/project", rel: "hello.txt", fs });
  assert.deepEqual(file, { binary: false, content: "hello workspace", truncated: false });
});

test("readWorkspaceTextFile truncates files beyond the 256 KB preview cap", async () => {
  const big = "x".repeat(WORKSPACE_FILE_MAX_BYTES + 100);
  const fs = fakeIoFs(PROBE_ENTRIES, {}, { "/work/project/hello.txt": big });
  const file = await readWorkspaceTextFile({ root: "/work/project", rel: "hello.txt", fs });
  assert.equal(file.binary, false);
  if (file.binary) return; // narrow for the type checker
  assert.equal(file.truncated, true);
  assert.equal(file.content.length, WORKSPACE_FILE_MAX_BYTES);
});

test("readWorkspaceTextFile sniffs binary files by their NUL byte", async () => {
  const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]);
  const fs = fakeIoFs(PROBE_ENTRIES, {}, { "/work/project/hello.txt": bytes });
  const file = await readWorkspaceTextFile({ root: "/work/project", rel: "hello.txt", fs });
  assert.deepEqual(file, { binary: true });
});

test("readWorkspaceTextFile rejects directories and escapes", async () => {
  const fs = fakeIoFs(PROBE_ENTRIES);
  await assert.rejects(
    readWorkspaceTextFile({ root: "/work/project", rel: "notes", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "NOT_FILE"
  );
  await assert.rejects(
    readWorkspaceTextFile({ root: "/work/project", rel: "../etc/passwd", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "ESCAPES_ROOT"
  );
  await assert.rejects(
    readWorkspaceTextFile({ root: "/work/project", rel: "missing.txt", fs }),
    (error: unknown) => error instanceof WorkspacePathError && error.code === "NOT_FOUND"
  );
});
