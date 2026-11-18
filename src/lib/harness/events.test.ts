import assert from "node:assert/strict";
import { test } from "node:test";
import { finalTextOf, parseHarnessLine, sessionIdOf, stepCountOf, toolCallsUsedOf, usageOf } from "./events";

const session = `{"type":"session","sessionId":"session-abc","cwd":"/tmp"}`;
const stepStart = `{"type":"status","phase":"step_start","turn":1,"step":1}`;
const thinking = `{"type":"thinking","text":""}`;
const text = `{"type":"text","text":"banana"}`;
const stepEnd = `{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":5800,"outputTokens":2,"totalTokens":5802}}`;
const final = `{"type":"final","sessionId":"session-abc","reason":{"kind":"completed"},"text":"banana"}`;

test("parses NDJSON events and skips diagnostics", () => {
  assert.equal(parseHarnessLine(session)?.type, "session");
  assert.equal(parseHarnessLine("  "), null);
  assert.equal(parseHarnessLine("[llm-deepseek-api-key] model listing"), null);
  assert.equal(parseHarnessLine("{not json"), null);
  assert.equal(parseHarnessLine('{"no":"type"}'), null);
});

test("finds the session id", () => {
  assert.equal(sessionIdOf([{ type: "status" }, { type: "session", sessionId: "session-abc" }]), "session-abc");
  assert.equal(sessionIdOf([{ type: "status" }]), null);
});

test("final wins over the last text event", () => {
  assert.equal(finalTextOf([{ type: "text", text: "early" }, { type: "text", text: "late" }]), "late");
  assert.equal(finalTextOf([{ type: "text", text: "late" }, { type: "final", text: "final answer" }]), "final answer");
  assert.equal(finalTextOf([]), "");
});

test("usage comes from the last step_end that carries it", () => {
  assert.equal(usageOf([{ type: "status", phase: "step_end", usage: { totalTokens: 1 } }])?.totalTokens, 1);
  assert.equal(usageOf([{ type: "status" }]), undefined);
});

test("step count counts completed steps", () => {
  assert.equal(stepCountOf([{ type: "status", phase: "step_end" }, { type: "status", phase: "step_start" }, { type: "status", phase: "step_end" }]), 2);
});

test("toolCallsUsedOf lists distinct tool names in first-call order", () => {
  assert.deepEqual(
    toolCallsUsedOf([
      { type: "tool_call", callId: "c1", tool: "cyraops_list_tickets", input: {} },
      { type: "tool_call", callId: "c2", tool: "cyraops_list_tickets", input: {} },
      { type: "tool_call", callId: "c3", tool: "cyraops_update_ticket", input: {} },
      { type: "tool_result", callId: "c1", status: "completed" },
    ]),
    ["cyraops_list_tickets", "cyraops_update_ticket"]
  );
});

test("toolCallsUsedOf ignores malformed tool_call events", () => {
  assert.deepEqual(toolCallsUsedOf([{ type: "tool_call", callId: "c1" }, { type: "tool_call", tool: "" }]), []);
  assert.deepEqual(toolCallsUsedOf([{ type: "status" }]), []);
});
