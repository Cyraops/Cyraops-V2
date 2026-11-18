import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finalTextOf,
  parseHarnessLine,
  planApproveLabelOf,
  planOfToolCall,
  planReviewOfQuestion,
  sessionIdOf,
  stepCountOf,
  toolCallsUsedOf,
  usageOf,
} from "./events";

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

// ---------------------------------------------------------------------------
// Tier-2 plan preview helpers.
// ---------------------------------------------------------------------------

const exitPlanCall = {
  type: "tool_call",
  callId: "call-plan-1",
  tool: "exit_plan_mode",
  input: { plan: "# Plan: update priorities\n\n- read tickets\n- update each" },
};

test("planOfToolCall shapes an exit_plan_mode tool call", () => {
  assert.deepEqual(planOfToolCall(exitPlanCall), {
    planId: "call-plan-1",
    text: "# Plan: update priorities\n\n- read tickets\n- update each",
    review: false,
  });
});

test("planOfToolCall tolerates string-encoded arguments (raw session events)", () => {
  const event = { ...exitPlanCall, input: JSON.stringify(exitPlanCall.input) };
  assert.equal(planOfToolCall(event)?.text, exitPlanCall.input.plan);
});

test("planOfToolCall ignores other tools and empty plans", () => {
  assert.equal(planOfToolCall({ type: "tool_call", callId: "c1", tool: "cyraops_list_tickets", input: {} }), null);
  assert.equal(planOfToolCall({ type: "tool_call", callId: "c1", tool: "exit_plan_mode", input: { plan: "   " } }), null);
  assert.equal(planOfToolCall({ type: "tool_call", callId: "c1", tool: "exit_plan_mode" }), null);
  assert.equal(planOfToolCall({ type: "tool_result", callId: "c1", status: "completed", result: "x" }), null);
});

test("planReviewOfQuestion finds the plan-review intent and carries the plan detail", () => {
  const review = planReviewOfQuestion(
    [
      {
        id: "plan-review",
        question: "Approve this plan and leave plan mode?",
        detail: "# Plan: update priorities\n\n- read tickets",
        options: [{ label: "Approve" }, { label: "Keep planning" }],
        intent: { kind: "plan-review", approve: "Approve", callId: "call-plan-1" },
      },
    ],
    "broker-q-7"
  );
  assert.deepEqual(review, {
    planId: "call-plan-1",
    text: "# Plan: update priorities\n\n- read tickets",
    questionId: "broker-q-7",
    review: true,
  });
});

test("planReviewOfQuestion falls back to the question text and null for ordinary batches", () => {
  const withoutDetail = planReviewOfQuestion(
    [{ id: "plan-review", question: "Approve this plan and leave plan mode?", intent: { kind: "plan-review", callId: "call-9" } }],
    "broker-q-8"
  );
  assert.equal(withoutDetail?.planId, "call-9");
  assert.equal(withoutDetail?.text, "Approve this plan and leave plan mode?");
  assert.equal(
    planReviewOfQuestion(
      [{ id: "which-ticket", question: "Which ticket?" }, { id: "why", question: "Why?" }],
      "broker-q-9"
    ),
    null
  );
});

test("planApproveLabelOf reads the intent's label with the harness default", () => {
  assert.equal(
    planApproveLabelOf([{ id: "plan-review", question: "q", intent: { kind: "plan-review", approve: "Approve" } }]),
    "Approve"
  );
  assert.equal(planApproveLabelOf([{ id: "plan-review", question: "q", intent: { kind: "plan-review" } }]), "Approve");
  assert.equal(planApproveLabelOf([{ id: "other", question: "q" }]), "Approve");
});
