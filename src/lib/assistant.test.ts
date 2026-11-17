import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeSystemPrompt, deriveConversationTitle } from "./ai/assistant/runtime";
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
