import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  composeSystemPrompt,
  ConversationNotFoundError,
  createConversation,
  deriveConversationTitle,
  getOrCreateAssistant,
  resolveConversation,
} from "./ai/assistant/runtime";
import { db } from "./db";
import { toolRegistry } from "./ai/tools/registry";
import "./ai/tools/crm-tools";

describe("Assistant system prompt composition", () => {
  it("returns the base prompt unchanged when there is no memory", () => {
    const base = "You are an assistant.";
    assert.equal(composeSystemPrompt(base, []), base);
  });

  it("lists remembered facts under a dedicated section", () => {
    const base = "You are an assistant.";
    const prompt = composeSystemPrompt(base, ["User prefers Hindi", "Client Acme pays net-30"]);
    assert.ok(prompt.includes("Things you remember about the user:"));
    assert.ok(prompt.includes("- User prefers Hindi"));
    assert.ok(prompt.includes("- Client Acme pays net-30"));
  });

  it("caps recalled memories at twelve", () => {
    const base = "You are an assistant.";
    const memories = Array.from({ length: 30 }, (_, i) => `fact ${i}`);
    const prompt = composeSystemPrompt(base, memories);
    const listed = (prompt.match(/- fact /g) || []).length;
    assert.equal(listed, 12);
  });
});

describe("Assistant tool allowlist", () => {
  it("only references tools that exist in the registry", async () => {
    const { assistantToolsJson } = await import("./ai/assistant/runtime");
    const ids = JSON.parse(assistantToolsJson()) as string[];
    assert.ok(ids.length >= 10);
    for (const id of ids) {
      assert.ok(toolRegistry.getTool(id), `unregistered assistant tool: ${id}`);
    }
  });
});


describe("Conversation titles", () => {
  it("keeps a short first message as the title", () => {
    assert.equal(deriveConversationTitle("how many leads do we have"), "how many leads do we have");
  });

  it("truncates long messages with an ellipsis", () => {
    const long = "a".repeat(200);
    const title = deriveConversationTitle(long, 60);
    assert.equal(title.length, 61);
    assert.ok(title.endsWith("…"));
  });

  it("falls back to New chat for empty input", () => {
    assert.equal(deriveConversationTitle("   "), "New chat");
  });
});

describe("Strict conversation resolution (harness chat path)", () => {
  let ownerId: string;
  let otherId: string;
  let assistantId: string;
  let otherAssistantId: string;
  let conversationId: string;

  before(async () => {
    const owner = await db.user.create({
      data: { name: "Strict Convo Owner", email: "strict-convo-owner@test.cyraops.com", role: "OWNER", passwordHash: "x" },
    });
    ownerId = owner.id;
    assistantId = (await getOrCreateAssistant(owner.id)).id;

    const other = await db.user.create({
      data: { name: "Strict Convo Other", email: "strict-convo-other@test.cyraops.com", role: "MEMBER", passwordHash: "x" },
    });
    otherId = other.id;
    otherAssistantId = (await getOrCreateAssistant(other.id)).id;

    conversationId = (await createConversation(assistantId, "First chat")).id;
  });

  after(async () => {
    await db.assistantConversation.deleteMany({ where: { assistantId: { in: [assistantId, otherAssistantId] } } });
    await db.assistant.deleteMany({ where: { id: { in: [assistantId, otherAssistantId] } } });
    await db.session.deleteMany({ where: { userId: { in: [ownerId, otherId] } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  });

  it("strict mode returns the conversation when the id exists in scope", async () => {
    const conversation = await resolveConversation(assistantId, conversationId, null, { strict: true });
    assert.equal(conversation.id, conversationId);
  });

  it("strict mode throws a typed error for unknown ids instead of falling back", async () => {
    await assert.rejects(
      resolveConversation(assistantId, "does-not-exist", null, { strict: true }),
      (error: unknown) =>
        error instanceof ConversationNotFoundError && error.conversationId === "does-not-exist"
    );
  });

  it("strict mode rejects a conversation that belongs to another assistant", async () => {
    const foreign = await createConversation(otherAssistantId, "Foreign chat");
    await assert.rejects(
      resolveConversation(assistantId, foreign.id, null, { strict: true }),
      ConversationNotFoundError
    );
  });

  it("strict mode with no id creates a fresh thread instead of reusing the latest", async () => {
    const fresh = await resolveConversation(assistantId, undefined, null, { strict: true });
    assert.notEqual(fresh.id, conversationId);
    assert.equal(fresh.title, "New chat");
  });

  it("legacy mode keeps the original fallback behaviour for unknown ids", async () => {
    // Make the original conversation the most recently updated one, no matter
    // what other probes left behind: age every OTHER conversation out first.
    await db.assistantConversation.updateMany({
      where: { id: { not: conversationId } },
      data: { updatedAt: new Date(0) },
    });
    await db.assistantConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    const conversation = await resolveConversation(assistantId, "does-not-exist", null);
    assert.equal(conversation.id, conversationId);
  });
});
