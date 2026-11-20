import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { resolveBotStatus } from "./bot-status";
import type { PermissionMode } from "./permissions/mode";

const EMAIL_A = "bot-status-a@test.cyraops.com";
const EMAIL_B = "bot-status-b@test.cyraops.com";
const EMAIL_NONE = "bot-status-none@test.cyraops.com";
const EMAIL_MEMBER = "bot-status-member@test.cyraops.com";

const WS_A = "bot-status-ws-a";
const WS_B = "bot-status-ws-b";
const WS_D = "bot-status-ws-d";

const AGENT_SLUG = "bot-status-agent";

const ASSISTANT_A = "bot-status-assistant-a";
const ASSISTANT_B = "bot-status-assistant-b";
const CONV_ROOT = "bot-status-conv-root";
const CONV_NONE = "bot-status-conv-none";
const CONV_B = "bot-status-conv-b";

const REALPATH = "/tmp/bot-status-root";

async function seed() {
  const userA = await db.user.create({
    data: { name: "Bot Status A", email: EMAIL_A, role: "OWNER", passwordHash: "x" },
  });
  const userB = await db.user.create({
    data: { name: "Bot Status B", email: EMAIL_B, role: "OWNER", passwordHash: "x" },
  });
  const userNone = await db.user.create({
    data: { name: "Bot Status None", email: EMAIL_NONE, role: "MEMBER", passwordHash: "x" },
  });
  const userMember = await db.user.create({
    data: { name: "Bot Status Member", email: EMAIL_MEMBER, role: "MEMBER", passwordHash: "x" },
  });

  const wsA = await db.workspace.create({
    data: {
      id: WS_A,
      name: "Bot Status A",
      ownerId: userA.id,
      loginEmail: EMAIL_A,
      loginPasswordHash: "x",
      permissionMode: "SYSTEM",
    },
  });
  const wsB = await db.workspace.create({
    data: {
      id: WS_B,
      name: "Bot Status B",
      ownerId: userB.id,
      loginEmail: EMAIL_B,
      loginPasswordHash: "x",
      permissionMode: "READ_ONLY",
    },
  });
  // A MEMBER who nonetheless owns a workspace: mode and effectiveMode differ,
  // proving the role-gate matches the turn path instead of trusting ownerId.
  const wsD = await db.workspace.create({
    data: {
      id: WS_D,
      name: "Bot Status Member",
      ownerId: userMember.id,
      loginEmail: EMAIL_MEMBER,
      loginPasswordHash: "x",
      permissionMode: "FULL_CONTROL",
    },
  });

  const agent = await db.aiAgent.create({
    data: { slug: AGENT_SLUG, name: "Bot Status Agent", role: "agent", description: "t", systemPrompt: "t" },
  });

  const assistantA = await db.assistant.create({ data: { id: ASSISTANT_A, userId: userA.id } });
  const assistantB = await db.assistant.create({ data: { id: ASSISTANT_B, userId: userB.id } });

  const convRoot = await db.assistantConversation.create({
    data: { id: CONV_ROOT, assistantId: assistantA.id, workspaceRootRealpath: REALPATH },
  });
  const convNone = await db.assistantConversation.create({
    data: { id: CONV_NONE, assistantId: assistantA.id, workspaceRootRealpath: null },
  });
  const convB = await db.assistantConversation.create({
    data: { id: CONV_B, assistantId: assistantB.id, workspaceRootRealpath: "/tmp/foreign-root" },
  });

  return { userA, userB, userNone, userMember, wsA, wsB, wsD, agent, assistantA, assistantB, convRoot, convNone, convB };
}

async function cleanup() {
  await db.assistantConversation.deleteMany({ where: { id: { in: [CONV_ROOT, CONV_NONE, CONV_B] } } });
  await db.assistant.deleteMany({ where: { id: { in: [ASSISTANT_A, ASSISTANT_B] } } });
  await db.aiAgent.deleteMany({ where: { slug: AGENT_SLUG } });
  await db.workspace.deleteMany({ where: { id: { in: [WS_A, WS_B, WS_D] } } });
  await db.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B, EMAIL_NONE, EMAIL_MEMBER] } } });
}

describe("resolveBotStatus (against cyraops_test)", () => {
  it("two-workspace: resolves each owner's own workspace and never leaks the other tenant's mode", async () => {
    await cleanup();
    const { userA, userB, wsA, wsB } = await seed();
    try {
      const a = await resolveBotStatus({ db, userId: userA.id });
      assert.equal(a.workspace?.id, wsA.id);
      assert.equal(a.mode, "SYSTEM");
      assert.equal(a.effectiveMode, "SYSTEM"); // role OWNER keeps SYSTEM
      assert.equal(a.workspaceOwnerMatch, true);
      assert.equal(a.shellEnabled, true);
      assert.equal(a.systemToolsEnabled, true);

      const b = await resolveBotStatus({ db, userId: userB.id });
      assert.equal(b.workspace?.id, wsB.id);
      assert.equal(b.mode, "READ_ONLY");
      assert.equal(b.effectiveMode, "READ_ONLY");
      assert.equal(b.workspaceOwnerMatch, true);
      assert.equal(b.shellEnabled, false);

      // An explicit id the user does NOT own is rejected (null) — never leaked,
      // and the effective mode falls back to CONTROLLED, exactly like a turn.
      const rejected = await resolveBotStatus({ db, userId: userA.id, workspaceId: wsB.id });
      assert.equal(rejected.workspace, null);
      assert.equal(rejected.workspaceOwnerMatch, false);
      assert.equal(rejected.mode, "CONTROLLED");
      assert.equal(rejected.effectiveMode, "CONTROLLED");
    } finally {
      await cleanup();
    }
  });

  it("owner-match is false when the user owns no workspace (the honest tanveer case)", async () => {
    await cleanup();
    const { userNone } = await seed();
    try {
      const status = await resolveBotStatus({ db, userId: userNone.id });
      assert.equal(status.workspace, null);
      assert.equal(status.workspaceOwnerMatch, false);
      assert.equal(status.mode, "CONTROLLED");
      assert.equal(status.effectiveMode, "CONTROLLED");
      assert.equal(status.root, null);
      assert.equal(status.shellEnabled, false);
      assert.equal(status.systemToolsEnabled, false);
    } finally {
      await cleanup();
    }
  });

  it("a non-owner whose workspace is FULL_CONTROL still resolves effectiveMode CONTROLLED", async () => {
    await cleanup();
    const { userMember, wsD } = await seed();
    try {
      const status = await resolveBotStatus({ db, userId: userMember.id });
      assert.equal(status.workspace?.id, wsD.id);
      // They DO own the workspace, but their role is MEMBER, so the turn path
      // downgrades FULL_CONTROL to CONTROLLED.
      assert.equal(status.workspaceOwnerMatch, true);
      assert.equal(status.mode, "FULL_CONTROL");
      assert.equal(status.effectiveMode, "CONTROLLED");
      assert.equal(status.shellEnabled, false);
    } finally {
      await cleanup();
    }
  });

  it("agent override wins over the workspace mode (per-agent effective mode)", async () => {
    await cleanup();
    const { userA, agent } = await seed();
    try {
      // Override the agent to READ_ONLY: it beats the workspace's SYSTEM.
      await db.aiAgent.update({ where: { id: agent.id }, data: { permissionMode: "READ_ONLY" } });
      const overridden = await resolveBotStatus({ db, userId: userA.id, agentSlug: AGENT_SLUG });
      assert.equal(overridden.mode, "READ_ONLY");
      assert.equal(overridden.effectiveMode, "READ_ONLY");
      assert.equal(overridden.shellEnabled, false);

      // A null override inherits the workspace's SYSTEM.
      await db.aiAgent.update({ where: { id: agent.id }, data: { permissionMode: null } });
      const inherited = await resolveBotStatus({ db, userId: userA.id, agentSlug: AGENT_SLUG });
      assert.equal(inherited.mode, "SYSTEM");
      assert.equal(inherited.effectiveMode, "SYSTEM");
      assert.equal(inherited.shellEnabled, true);
    } finally {
      await cleanup();
    }
  });

  it("root lookup returns the realpath, null for a null root, and null for unknown/foreign ids", async () => {
    await cleanup();
    const { userA } = await seed();
    try {
      const withRoot = await resolveBotStatus({ db, userId: userA.id, conversationId: CONV_ROOT });
      assert.equal(withRoot.root, REALPATH);

      const noRoot = await resolveBotStatus({ db, userId: userA.id, conversationId: CONV_NONE });
      assert.equal(noRoot.root, null);

      const unknown = await resolveBotStatus({ db, userId: userA.id, conversationId: "does-not-exist" });
      assert.equal(unknown.root, null);

      // A conversation owned by another user's assistant must not leak its root.
      const foreign = await resolveBotStatus({ db, userId: userA.id, conversationId: CONV_B });
      assert.equal(foreign.root, null);
    } finally {
      await cleanup();
    }
  });

  it("shellEnabled and systemToolsEnabled are true only under SYSTEM", async () => {
    await cleanup();
    const { userA, wsA } = await seed();
    try {
      const modes: PermissionMode[] = ["READ_ONLY", "CONTROLLED", "FULL_CONTROL", "SYSTEM"];
      for (const mode of modes) {
        await db.workspace.update({ where: { id: wsA.id }, data: { permissionMode: mode } });
        const status = await resolveBotStatus({ db, userId: userA.id });
        assert.equal(status.mode, mode, `mode ${mode}`);
        assert.equal(status.effectiveMode, mode, `effectiveMode ${mode}`); // role OWNER keeps it
        assert.equal(status.shellEnabled, mode === "SYSTEM", `shellEnabled ${mode}`);
        assert.equal(status.systemToolsEnabled, mode === "SYSTEM", `systemToolsEnabled ${mode}`);
      }
    } finally {
      await cleanup();
    }
  });
});
