import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import { db } from "@/lib/db";
import { ApprovalBroker } from "./approval-broker";
import type { HarnessEvent } from "./client";
import {
  createHarnessApprovalRow,
  estimatedCostFor,
  harnessModelName,
  harnessToolCallRows,
  harnessUsageParams,
  installApprovalDecisionHook,
  maskSensitiveData,
  maskToolOutput,
  persistHarnessToolCalls,
  persistHarnessUsage,
  usageForDonePayload,
} from "./audit";

const call = (callId: string, tool: string, input?: unknown): HarnessEvent => ({
  type: "tool_call",
  callId,
  tool,
  input,
});
const result = (
  callId: string,
  status: string,
  text?: string,
  error?: string
): HarnessEvent => ({
  type: "tool_result",
  callId,
  status,
  result: text,
  ...(error !== undefined ? { error } : {}),
});

describe("masking mirrors the V1 registry", () => {
  test("masks sensitive keys by whole word", () => {
    const masked = maskSensitiveData({
      password: "hunter2",
      apiKey: "sk-123",
      author: "Tanveer",
      nested: { session: "s", name: "ok" },
    }) as Record<string, unknown>;
    assert.equal(masked.password, "***MASKED***");
    assert.equal(masked.apiKey, "***MASKED***");
    assert.equal(masked.author, "Tanveer", "author must not match the substring of 'auth'");
    assert.deepEqual(masked.nested, { session: "***MASKED***", name: "ok" });
  });

  test("maskToolOutput masks JSON results and keeps plain text", () => {
    assert.equal(maskToolOutput("3 tickets"), "3 tickets");
    assert.equal(
      maskToolOutput(JSON.stringify({ token: "x", title: "y" })),
      JSON.stringify({ token: "***MASKED***", title: "y" })
    );
    assert.equal(maskToolOutput(null), null);
  });
});

describe("harnessToolCallRows pairs tool_call with tool_result", () => {
  test("writes one row per pair with masked input, success status and CLASS_A reads", () => {
    const rows = harnessToolCallRows(
      [
        call("c1", "cyraops_list_tickets", { query: "billing", token: "top-secret" }),
        result("c1", "completed", "3 tickets"),
      ],
      "conv-1"
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      conversationId: "conv-1",
      toolId: "cyraops_list_tickets",
      toolName: "cyraops_list_tickets",
      input: JSON.stringify({ query: "billing", token: "***MASKED***" }),
      output: "3 tickets",
      status: "SUCCESS",
      error: null,
      riskClass: "CLASS_A",
      requiresApproval: false,
      executionTimeMs: 0,
    });
  });

  test("an errored result becomes ERROR with the durable error", () => {
    const rows = harnessToolCallRows(
      [call("c1", "cyraops_list_tickets", {}), result("c1", "error", undefined, "db down")],
      "conv-1"
    );
    assert.equal(rows[0]?.status, "ERROR");
    assert.equal(rows[0]?.error, "db down");
  });

  test("the write tool with an approval event is CLASS_B and requiresApproval", () => {
    const rows = harnessToolCallRows(
      [
        call("c9", "cyraops_update_ticket", { id: "t1", priority: "HIGH" }),
        { type: "approval", approvalId: "a1", toolName: "cyraops_update_ticket", callId: "c9", summary: "s" },
        result("c9", "completed", "updated"),
      ],
      "conv-1"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.riskClass, "CLASS_B");
    assert.equal(rows[0]?.requiresApproval, true);
  });

  test("the write tool without an observed approval (CLI runtime, policy never) is still CLASS_B", () => {
    const rows = harnessToolCallRows(
      [call("c9", "cyraops_update_ticket", { id: "t1" }), result("c9", "completed", "ok")],
      "conv-1"
    );
    assert.equal(rows[0]?.riskClass, "CLASS_B");
    assert.equal(rows[0]?.requiresApproval, false);
  });

  test("an unpaired tool_call leaves no row", () => {
    const rows = harnessToolCallRows([call("c1", "cyraops_list_tickets", {})], "conv-1");
    assert.equal(rows.length, 0);
  });

  test("executionTimeMs comes from the observed event timings", () => {
    const timings = new Map<string, { call?: number; result?: number }>([
      ["c1", { call: 1_000, result: 1_500 }],
    ]);
    const rows = harnessToolCallRows(
      [call("c1", "cyraops_list_tickets", {}), result("c1", "completed", "ok")],
      "conv-1",
      { get: (id) => timings.get(id) }
    );
    assert.equal(rows[0]?.executionTimeMs, 500);
  });
});

describe("harnessUsageParams maps step_end usage to the V1 fields", () => {
  test("inputTokens → promptTokens, outputTokens → completionTokens, total carried", () => {
    const usage = harnessUsageParams(
      [
        { type: "status", phase: "step_start" },
        { type: "status", phase: "step_end", usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 } },
      ],
      { HARNESS_MODEL: "" }
    );
    assert.deepEqual(usage, {
      model: "deepseek-v4-flash-vision-exp",
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
    });
  });

  test("falls back to the last step_end and the env override wins for the model", () => {
    const usage = harnessUsageParams(
      [
        { type: "status", phase: "step_end", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        { type: "status", phase: "step_end", usage: { inputTokens: 10, outputTokens: 20 } },
      ],
      { HARNESS_MODEL: "deepseek-reasoner" }
    );
    assert.deepEqual(usage, {
      model: "deepseek-reasoner",
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  test("no step_end usage → null (no usage row)", () => {
    assert.equal(harnessUsageParams([{ type: "final", text: "hi" }]), null);
    assert.equal(harnessModelName({}), "deepseek-v4-flash-vision-exp");
  });

  test("cost estimation matches the V1 mapper's deepseek rates", () => {
    // deepseek-v4-flash-vision-exp contains "deepseek" → $0.14 / $0.28 per 1M.
    const cost = estimatedCostFor({ model: "deepseek-v4-flash-vision-exp", promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 });
    assert.ok(Math.abs(cost - 0.42) < 1e-9, `expected 0.42, got ${cost}`);
  });
});

describe("approval rows mirror the V1 AssistantPendingAction lifecycle", () => {
  const ids = {
    approvalId: "approval-audit-test",
    assistantId: "audit-assistant",
    userId: "audit-user",
    conversationId: "audit-conversation",
  };

  test("PENDING row is created on the approval event and settled APPROVED by the broker", async () => {
    const broker = new ApprovalBroker(5_000);
    installApprovalDecisionHook(broker);
    // The plugin's answerer mints the id via request(); the route keys the row by it.
    const pending = broker.request({ toolName: "cyraops_update_ticket", callId: "call-1", summary: "Update ticket t1: priority → HIGH" });
    const rowId = await createHarnessApprovalRow({
      approvalId: pending.approvalId,
      assistantId: ids.assistantId,
      userId: ids.userId,
      conversationId: ids.conversationId,
      toolName: "cyraops_update_ticket",
      summary: "Update ticket t1: priority → HIGH",
      input: JSON.stringify({ id: "t1", priority: "HIGH" }),
    });
    assert.ok(rowId);
    try {
      const pendingRow = await db.assistantPendingAction.findUnique({ where: { id: rowId } });
      assert.equal(pendingRow?.status, "PENDING");
      assert.equal(pendingRow?.toolName, "cyraops_update_ticket");
      assert.equal(pendingRow?.userId, ids.userId);
      assert.equal(pendingRow?.conversationId, ids.conversationId);
      assert.equal(pendingRow?.input, JSON.stringify({ id: "t1", priority: "HIGH" }));

      broker.decide(pending.approvalId, true);

      // The settle runs fire-and-forget after decide() returns.
      let status = "PENDING";
      for (let i = 0; i < 50 && status === "PENDING"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        status = (await db.assistantPendingAction.findUnique({ where: { id: rowId } }))?.status ?? "PENDING";
      }
      assert.equal(status, "APPROVED");
    } finally {
      await db.assistantPendingAction.deleteMany({ where: { id: rowId } }).catch(() => {});
    }
  });

  test("a rejected (or timed-out) decision settles REJECTED", async () => {
    const broker = new ApprovalBroker(5_000);
    installApprovalDecisionHook(broker);
    const pending = broker.request({ toolName: "cyraops_update_ticket", summary: "Update ticket t2" });
    const rowId = await createHarnessApprovalRow({
      approvalId: pending.approvalId,
      assistantId: ids.assistantId,
      userId: ids.userId,
      conversationId: ids.conversationId,
      toolName: "cyraops_update_ticket",
      summary: "Update ticket t2",
      input: "{}",
    });
    assert.ok(rowId);
    try {
      broker.decide(pending.approvalId, false);
      let status = "PENDING";
      for (let i = 0; i < 50 && status === "PENDING"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        status = (await db.assistantPendingAction.findUnique({ where: { id: rowId } }))?.status ?? "PENDING";
      }
      assert.equal(status, "REJECTED");
    } finally {
      await db.assistantPendingAction.deleteMany({ where: { id: rowId } }).catch(() => {});
    }
  });
});

describe("persistence writes the same shapes the V1 path writes", () => {
  const conversationId = "audit-conv-persist";
  const userId = "audit-user-persist";

  test("persistHarnessToolCalls and persistHarnessUsage create real rows", async () => {
    try {
      await persistHarnessToolCalls(
        harnessToolCallRows(
          [call("c1", "cyraops_list_tickets", { token: "secret" }), result("c1", "completed", "2 tickets")],
          conversationId
        )
      );
      const usage = harnessUsageParams([
        { type: "status", phase: "step_end", usage: { inputTokens: 300, outputTokens: 50, totalTokens: 350 } },
      ])!;
      await persistHarnessUsage({ userId, usage, durationMs: 1234 });

      const toolRow = await db.aiToolCall.findFirst({ where: { conversationId } });
      assert.ok(toolRow, "tool row must exist");
      assert.equal(toolRow?.toolName, "cyraops_list_tickets");
      assert.equal(toolRow?.status, "SUCCESS");
      assert.equal(toolRow?.input, JSON.stringify({ token: "***MASKED***" }));
      assert.equal(toolRow?.output, "2 tickets");
      assert.equal(toolRow?.riskClass, "CLASS_A");
      assert.equal(toolRow?.taskId, null);

      const usageRow = await db.aiUsageLog.findFirst({ where: { userId } });
      assert.ok(usageRow, "usage row must exist");
      assert.equal(usageRow?.source, "harness");
      assert.equal(usageRow?.agentSlug, "harness");
      assert.equal(usageRow?.model, "deepseek-v4-flash-vision-exp");
      assert.equal(usageRow?.promptTokens, 300);
      assert.equal(usageRow?.completionTokens, 50);
      assert.equal(usageRow?.totalTokens, 350);
      assert.equal(usageRow?.durationMs, 1234);
    } finally {
      await db.aiToolCall.deleteMany({ where: { conversationId } }).catch(() => {});
      await db.aiUsageLog.deleteMany({ where: { userId } }).catch(() => {});
    }
  });
});

describe("usageForDonePayload shapes the harness done SSE usage (TASK 2)", () => {
  test("maps the last step_end through the existing cost estimator", () => {
    const events: HarnessEvent[] = [
      { type: "status", phase: "step_start" },
      { type: "status", phase: "step_end", usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 } },
      { type: "status", phase: "step_end", usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 } },
    ];
    const payload = usageForDonePayload(events, { HARNESS_MODEL: "deepseek-v4-flash-vision-exp" });
    assert.ok(payload);
    assert.equal(payload.inputTokens, 1_000_000);
    assert.equal(payload.outputTokens, 1_000_000);
    // deepseek rates: $0.14 + $0.28 per 1M
    assert.ok(Math.abs(payload.costUsd - 0.42) < 1e-9, `expected 0.42, got ${payload.costUsd}`);
  });

  test("returns null when the turn carried no step_end usage (no caption in the UI)", () => {
    assert.equal(
      usageForDonePayload([{ type: "status", phase: "step_start" }, { type: "final", text: "ok" }], {}),
      null
    );
    assert.equal(usageForDonePayload([], {}), null);
  });
});
