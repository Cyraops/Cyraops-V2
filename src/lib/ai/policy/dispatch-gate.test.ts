import test from "node:test";
import assert from "node:assert/strict";
import { gateDispatchStep } from "./dispatch-gate";
import type { PolicyRule, PolicyTool } from "./resolve-action";

function tool(overrides: Partial<PolicyTool> & { id: string }): PolicyTool {
  return {
    riskClass: "CLASS_A",
    requiresApproval: false,
    readOnly: true,
    ...overrides,
  };
}

const webRead = tool({ id: "browser_extract", riskClass: "CLASS_A", externalRead: true, taintsRun: true });
const saveMemory = tool({ id: "remember", riskClass: "CLASS_A", readOnly: false, persistsContent: true });
const writeLead = tool({ id: "create_lead", riskClass: "CLASS_B", readOnly: false });
const plainRead = tool({ id: "list_leads", riskClass: "CLASS_A" });

const gate = (input: {
  tool: PolicyTool;
  runTainted: boolean;
  mode?: "ASK" | "AUTO" | "NEVER";
  rules?: PolicyRule[];
}) =>
  gateDispatchStep({
    tool: input.tool,
    rules: input.rules ?? [],
    mode: input.mode ?? "ASK",
    runTainted: input.runTainted,
    unattended: true,
  });

test("an untrusted read is free while the task is still clean", () => {
  assert.equal(gate({ tool: webRead, runTainted: false }).gate, "run");
  assert.equal(gate({ tool: plainRead, runTainted: false }).gate, "run");
  // Saving in-progress work is not itself suspicious before anything tainted it.
  assert.equal(gate({ tool: saveMemory, runTainted: false }).gate, "run");
});

test("after a tainted read, fetching anything outside the CRM parks", () => {
  const result = gate({ tool: webRead, runTainted: true });
  assert.equal(result.gate, "park");
  assert.match(result.reason, /untrusted content/i);
});

test("after a tainted read, saving content parks instead of persisting an injection", () => {
  assert.equal(gate({ tool: saveMemory, runTainted: true }).gate, "park");
});

test("after a tainted read, a consequential write parks for a person", () => {
  const result = gate({ tool: writeLead, runTainted: true });
  assert.equal(result.gate, "park");
});

test("a clean run is not held back by the barrier", () => {
  // The gate must not add friction: a CLASS_B write the planner did not flag
  // keeps behaving exactly as it did before the barrier existed.
  assert.equal(gate({ tool: writeLead, runTainted: false, mode: "AUTO" }).gate, "run");
});

test("an explicit DENY rule blocks a clean run too", () => {
  const result = gate({
    tool: plainRead,
    runTainted: false,
    rules: [{ toolName: "list_leads", effect: "DENY" }],
  });
  assert.equal(result.gate, "block");
});

test("a DENY rule blocks rather than parking, so no card offers a workaround", () => {
  const result = gate({
    tool: writeLead,
    runTainted: true,
    rules: [{ toolName: "create_lead", effect: "DENY" }],
  });
  assert.equal(result.gate, "block");
});

test('"never ask" does not mean "never check" for tainted work', () => {
  const result = gate({ tool: writeLead, runTainted: true, mode: "NEVER" });
  assert.equal(result.gate, "block");
  assert.match(result.reason, /never asks/i);
});

test("a standing allow cannot disarm the barrier", () => {
  const result = gate({
    tool: writeLead,
    runTainted: true,
    mode: "AUTO",
    rules: [{ toolName: "create_lead", effect: "ALLOW" }],
  });
  assert.equal(result.gate, "park");
});

test("a plain in-CRM read stays free even when the task is tainted", () => {
  // Reading our own data is not worth interrupting; only reads that reach
  // outside can be steered into fetching something else.
  assert.equal(gate({ tool: plainRead, runTainted: true, mode: "AUTO" }).gate, "run");
});
