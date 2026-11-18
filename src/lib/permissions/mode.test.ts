import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import {
  canAutoApprove,
  canWrite,
  allowsSystemTools,
  cliPermissionArgs,
  effectivePermissionMode,
  harnessPermissionPreset,
  normalizePermissionMode,
  resolvePermissionMode,
  runtimePermissionMode,
  systemToolsEnabled,
  type PermissionMode,
} from "./mode";

const MODES: PermissionMode[] = ["READ_ONLY", "CONTROLLED", "FULL_CONTROL", "SYSTEM"];

describe("permission mode helpers", () => {
  it("normalizes unknown and missing values to the safe default", () => {
    assert.equal(normalizePermissionMode(undefined), "CONTROLLED");
    assert.equal(normalizePermissionMode(null), "CONTROLLED");
    assert.equal(normalizePermissionMode("nonsense"), "CONTROLLED");
    assert.equal(normalizePermissionMode("SYSTEM"), "SYSTEM");
  });

  it("the agent override wins over the workspace value, which wins over the default", () => {
    assert.equal(effectivePermissionMode("FULL_CONTROL", "READ_ONLY"), "FULL_CONTROL");
    assert.equal(effectivePermissionMode(null, "READ_ONLY"), "READ_ONLY");
    assert.equal(effectivePermissionMode(null, null), "CONTROLLED");
    assert.equal(effectivePermissionMode(undefined, undefined), "CONTROLLED");
  });

  it("canWrite is false only under READ_ONLY", () => {
    assert.equal(canWrite("READ_ONLY"), false);
    assert.equal(canWrite("CONTROLLED"), true);
    assert.equal(canWrite("FULL_CONTROL"), true);
    assert.equal(canWrite("SYSTEM"), true);
  });

  it("canAutoApprove admits only the OWNER under FULL_CONTROL/SYSTEM", () => {
    assert.equal(canAutoApprove("FULL_CONTROL", "OWNER"), true);
    assert.equal(canAutoApprove("SYSTEM", "OWNER"), true);
    assert.equal(canAutoApprove("FULL_CONTROL", "ADMIN"), false);
    assert.equal(canAutoApprove("FULL_CONTROL", "MEMBER"), false);
    assert.equal(canAutoApprove("FULL_CONTROL", null), false);
    assert.equal(canAutoApprove("SYSTEM", "MEMBER"), false);
    assert.equal(canAutoApprove("CONTROLLED", "OWNER"), false);
    assert.equal(canAutoApprove("READ_ONLY", "OWNER"), false);
    // Role comparison is case-insensitive.
    assert.equal(canAutoApprove("FULL_CONTROL", "owner"), true);
  });

  it("allowsSystemTools is true only for SYSTEM", () => {
    for (const mode of MODES) {
      assert.equal(allowsSystemTools(mode), mode === "SYSTEM", `mode ${mode}`);
      assert.equal(systemToolsEnabled(mode), mode === "SYSTEM", `mode ${mode}`);
    }
  });

  it("runtimePermissionMode downgrades non-owner FULL_CONTROL/SYSTEM turns to CONTROLLED", () => {
    assert.equal(runtimePermissionMode("FULL_CONTROL", "OWNER"), "FULL_CONTROL");
    assert.equal(runtimePermissionMode("SYSTEM", "OWNER"), "SYSTEM");
    assert.equal(runtimePermissionMode("FULL_CONTROL", "ADMIN"), "CONTROLLED");
    assert.equal(runtimePermissionMode("SYSTEM", "MEMBER"), "CONTROLLED");
    assert.equal(runtimePermissionMode("FULL_CONTROL", null), "CONTROLLED");
    // READ_ONLY and CONTROLLED pass through untouched for any role.
    assert.equal(runtimePermissionMode("READ_ONLY", "OWNER"), "READ_ONLY");
    assert.equal(runtimePermissionMode("CONTROLLED", "OWNER"), "CONTROLLED");
  });

  it("maps every mode onto the harness sandbox preset", () => {
    assert.equal(harnessPermissionPreset("READ_ONLY"), "read-only");
    assert.equal(harnessPermissionPreset("CONTROLLED"), "workspace-write");
    assert.equal(harnessPermissionPreset("FULL_CONTROL"), "danger-full-access");
    assert.equal(harnessPermissionPreset("SYSTEM"), "danger-full-access");
  });

  it("CLI args name the preset for every non-controlled mode", () => {
    assert.deepEqual(cliPermissionArgs("CONTROLLED"), []);
    assert.deepEqual(cliPermissionArgs("READ_ONLY"), ["--permission-mode", "read-only"]);
    assert.deepEqual(cliPermissionArgs("FULL_CONTROL"), ["--permission-mode", "danger-full-access"]);
    assert.deepEqual(cliPermissionArgs("SYSTEM"), ["--permission-mode", "danger-full-access"]);
  });
});

describe("resolvePermissionMode (against cyraops_test)", () => {
  const userEmail = "perm-mode-owner@test.cyraops.com";
  const agentSlug = "perm-mode-agent";

  async function seed() {
    const owner = await db.user.create({
      data: { name: "Perm Mode Owner", email: userEmail, role: "OWNER", passwordHash: "x" },
    });
    await db.workspace.create({
      data: {
        id: "main",
        name: "Perm Mode Test Workspace",
        ownerId: owner.id,
        loginEmail: userEmail,
        loginPasswordHash: "x",
        permissionMode: "READ_ONLY",
      },
    });
    const agent = await db.aiAgent.create({
      data: { slug: agentSlug, name: "Perm Mode Agent", role: "agent", description: "t", systemPrompt: "t" },
    });
    return { owner, agent };
  }

  async function cleanup() {
    await db.workspace.deleteMany({ where: { id: "main" } });
    await db.aiAgent.deleteMany({ where: { slug: agentSlug } });
    await db.user.deleteMany({ where: { email: userEmail } });
  }

  it("resolves workspace → agent override → default, with the singleton fallback", async () => {
    await cleanup();
    const { owner, agent } = await seed();
    try {
      // Workspace mode only.
      assert.equal(await resolvePermissionMode({ workspaceId: "main" }), "READ_ONLY");
      // The owner user id identifies the same workspace (tenant convention).
      assert.equal(await resolvePermissionMode({ workspaceId: owner.id }), "READ_ONLY");
      // A key matching neither still resolves the singleton "main" workspace
      // (single-workspace deployment; the routes pass arbitrary tenant keys).
      assert.equal(await resolvePermissionMode({ workspaceId: "someone-else" }), "READ_ONLY");
      // Agent override beats the workspace value.
      await db.aiAgent.update({ where: { id: agent.id }, data: { permissionMode: "SYSTEM" } });
      assert.equal(await resolvePermissionMode({ workspaceId: "main", agentSlug }), "SYSTEM");
      // A null agent override inherits the workspace.
      await db.aiAgent.update({ where: { id: agent.id }, data: { permissionMode: null } });
      assert.equal(await resolvePermissionMode({ workspaceId: "main", agentSlug }), "READ_ONLY");
      // No workspace row at all falls back to the CONTROLLED default.
      await db.workspace.deleteMany({ where: { id: "main" } });
      assert.equal(await resolvePermissionMode({ workspaceId: "missing" }), "CONTROLLED");
      assert.equal(await resolvePermissionMode({}), "CONTROLLED");
    } finally {
      await cleanup();
    }
  });
});
