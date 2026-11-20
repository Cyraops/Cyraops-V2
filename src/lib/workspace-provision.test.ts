import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { db } from "@/lib/db";
import { defaultWorkspaceRootForUser, ensureWorkspaceForUser } from "./workspace-provision";

describe("workspace-provision (against cyraops_test)", () => {
  const email = "provision-owner@test.cyraops.com";

  async function cleanup(userIds: string[]) {
    if (userIds.length === 0) return;
    await db.workspace.deleteMany({ where: { ownerId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }

  it("creates an owned CONTROLLED workspace when the user owns none, and is idempotent", async () => {
    const user = await db.user.create({
      data: { name: "Priya (Provision)", email, role: "MEMBER", passwordHash: "x" },
    });
    try {
      const first = await ensureWorkspaceForUser({ db, userId: user.id });
      assert.equal(first.created, true);
      assert.equal(first.ownerId, user.id);
      assert.equal(first.permissionMode, "CONTROLLED");
      assert.equal(first.name, "Priya (Provision)'s Workspace");
      assert.equal(first.id, `user-${user.id}`);
      // id is NOT the seeded "main" default — members get their own row.
      assert.notEqual(first.id, "main");

      // Idempotent: the second call reuses the row, never creates another.
      const second = await ensureWorkspaceForUser({ db, userId: user.id });
      assert.equal(second.created, false);
      assert.equal(second.id, first.id);
      assert.equal(second.permissionMode, "CONTROLLED");

      const count = await db.workspace.count({ where: { ownerId: user.id } });
      assert.equal(count, 1, "exactly one owned workspace after repeated calls");
    } finally {
      await cleanup([user.id]);
    }
  });

  it("reuses an existing owned workspace instead of creating a duplicate", async () => {
    const user = await db.user.create({
      data: { name: "Tanveer (Provision)", email, role: "OWNER", passwordHash: "x" },
    });
    await db.workspace.create({
      data: {
        id: "provision-existing-1",
        name: "Cyraops",
        ownerId: user.id,
        loginEmail: email,
        loginPasswordHash: "x",
        permissionMode: "SYSTEM",
      },
    });
    try {
      const result = await ensureWorkspaceForUser({ db, userId: user.id });
      assert.equal(result.created, false);
      assert.equal(result.id, "provision-existing-1");
      assert.equal(result.permissionMode, "SYSTEM", "the pre-existing mode is preserved, not reset");

      const count = await db.workspace.count({ where: { ownerId: user.id } });
      assert.equal(count, 1);
    } finally {
      await cleanup([user.id]);
    }
  });

  it("defaultWorkspaceRootForUser returns an absolute per-member path under ~/Cyraops", () => {
    const root = defaultWorkspaceRootForUser({ userId: "abc123" });
    assert.ok(root.startsWith("/"), `expected an absolute path, got ${root}`);
    assert.ok(root.includes(`${join("Cyraops", "abc123")}`), `expected a Cyraops/abc123 tail, got ${root}`);
    assert.ok(root.endsWith("abc123"));
    // Two members never share a root.
    assert.notEqual(defaultWorkspaceRootForUser({ userId: "abc123" }), defaultWorkspaceRootForUser({ userId: "other" }));
  });
});
