import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { canWrite, resolvePermissionMode } from "./permissions/mode";
import { resolveWorkspaceForUser } from "./workspace-resolve";

describe("resolveWorkspaceForUser (against cyraops_test)", () => {
  const tenantAEmail = "ws-resolve-a@test.cyraops.com";
  const tenantBEmail = "ws-resolve-b@test.cyraops.com";
  const wsAId = "ws-tenant-a";
  const wsBId = "ws-tenant-b";

  async function seed() {
    const userA = await db.user.create({
      data: { name: "Tenant A Owner", email: tenantAEmail, role: "OWNER", passwordHash: "x" },
    });
    const userB = await db.user.create({
      data: { name: "Tenant B Owner", email: tenantBEmail, role: "OWNER", passwordHash: "x" },
    });
    const wsA = await db.workspace.create({
      data: {
        id: wsAId,
        name: "Tenant A",
        ownerId: userA.id,
        loginEmail: tenantAEmail,
        loginPasswordHash: "x",
        permissionMode: "CONTROLLED",
      },
    });
    const wsB = await db.workspace.create({
      data: {
        id: wsBId,
        name: "Tenant B",
        ownerId: userB.id,
        loginEmail: tenantBEmail,
        loginPasswordHash: "x",
        permissionMode: "READ_ONLY",
      },
    });
    return { userA, userB, wsA, wsB };
  }

  async function cleanup() {
    await db.workspace.deleteMany({ where: { id: { in: [wsAId, wsBId] } } });
    await db.user.deleteMany({ where: { email: { in: [tenantAEmail, tenantBEmail] } } });
  }

  it("resolves each owner's own workspace and never leaks the other tenant's mode", async () => {
    await cleanup();
    const { userA, userB, wsA, wsB } = await seed();
    try {
      // (b) no explicit id → the workspace whose ownerId === userId.
      const a = await resolveWorkspaceForUser({ db, userId: userA.id });
      const b = await resolveWorkspaceForUser({ db, userId: userB.id });
      assert.ok(a);
      assert.ok(b);
      assert.equal(a.id, wsA.id);
      assert.equal(a.permissionMode, "CONTROLLED");
      assert.equal(b.id, wsB.id);
      assert.equal(b.permissionMode, "READ_ONLY");

      // Tenant A's mode never leaks to tenant B, and vice versa.
      assert.equal(await resolvePermissionMode({ workspace: a }), "CONTROLLED");
      assert.equal(await resolvePermissionMode({ workspace: b }), "READ_ONLY");
      // READ_ONLY is the only mode in which nothing may change (B's mode).
      assert.equal(canWrite(b.permissionMode), false);

      // (a) an explicit id the user owns resolves to that workspace.
      const aExplicit = await resolveWorkspaceForUser({ db, userId: userA.id, workspaceId: wsA.id });
      assert.ok(aExplicit);
      assert.equal(aExplicit.id, wsA.id);

      // An explicit id the user does NOT own is rejected (null) — never leaked,
      // and never silently swapped for the caller's own workspace.
      assert.equal(await resolveWorkspaceForUser({ db, userId: userA.id, workspaceId: wsB.id }), null);
      assert.equal(await resolveWorkspaceForUser({ db, userId: userB.id, workspaceId: wsA.id }), null);

      // The rejected lookup resolves to CONTROLLED (the safe default), not
      // tenant B's READ_ONLY — proving the "no leak" property end-to-end.
      const rejected = await resolveWorkspaceForUser({ db, userId: userA.id, workspaceId: wsB.id });
      assert.equal(await resolvePermissionMode({ workspace: rejected }), "CONTROLLED");
    } finally {
      await cleanup();
    }
  });

  it("returns null when a user owns no workspace", async () => {
    await cleanup();
    const user = await db.user.create({
      data: { name: "No Workspace", email: "ws-resolve-none@test.cyraops.com", role: "MEMBER", passwordHash: "x" },
    });
    try {
      assert.equal(await resolveWorkspaceForUser({ db, userId: user.id }), null);
    } finally {
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });
});
