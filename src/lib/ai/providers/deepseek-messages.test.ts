import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDeepSeekMessages } from "./deepseek";

describe("DeepSeek request serialization", () => {
  it("keeps tool_call_id on tool results", () => {
    // The streaming path used to drop this, and DeepSeek answered 422 with
    // "missing field tool_call_id" for every turn that had used a tool.
    const [message] = toDeepSeekMessages([
      { role: "tool", content: "{}", toolCallId: "call_abc123", name: "search_leads" },
    ]);
    assert.equal(message.tool_call_id, "call_abc123");
    assert.equal(message.name, "search_leads");
    assert.equal(message.role, "tool");
  });

  it("keeps tool_calls on the assistant turn that requested them", () => {
    const [message] = toDeepSeekMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "search_deals", arguments: { stage: "OPEN" } }],
      },
    ]);
    assert.equal(message.tool_calls.length, 1);
    assert.equal(message.tool_calls[0].id, "call_1");
    assert.equal(message.tool_calls[0].type, "function");
    assert.equal(message.tool_calls[0].function.name, "search_deals");
    assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), { stage: "OPEN" });
  });

  it("leaves plain messages as role and content", () => {
    const [message] = toDeepSeekMessages([{ role: "user", content: "hello" }]);
    assert.deepEqual(message, { role: "user", content: "hello" });
  });

  it("tolerates a tool call with no arguments", () => {
    const [message] = toDeepSeekMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "noop" } as any] },
    ]);
    assert.equal(message.tool_calls[0].function.arguments, "{}");
  });
});
