/**
 * Unit tests for the in-process approval broker (TASK 1): the channel between
 * the harness plugin's approval answerer and /api/harness/approve.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalBroker } from "./approval-broker";

test("broker: decide(true) resolves the decision to allowed-once and notifies listeners", async () => {
  const broker = new ApprovalBroker(60_000);
  const requests: string[] = [];
  const decided: Array<{ approvalId: string; outcome: string }> = [];
  broker.onRequest((request) => requests.push(request.approvalId));
  broker.onDecided((info) => decided.push({ approvalId: info.approvalId, outcome: info.outcome }));

  const pending = broker.request({ toolName: "cyraops_update_ticket", summary: "update X" });
  assert.equal(requests.length, 1);
  assert.equal(broker.pendingCount(), 1);
  assert.equal(pending.toolName, "cyraops_update_ticket");
  assert.equal(pending.summary, "update X");

  const outcome = broker.decide(pending.approvalId, true);
  assert.equal(outcome, "allowed-once");
  assert.equal(await pending.decision, "allowed-once");
  assert.equal(broker.pendingCount(), 0);
  assert.deepEqual(decided, [{ approvalId: pending.approvalId, outcome: "allowed-once" }]);
});

test("broker: decide(false) resolves the decision to rejected", async () => {
  const broker = new ApprovalBroker(60_000);
  const pending = broker.request({ toolName: "cyraops_update_ticket", summary: "update Y" });
  assert.equal(broker.decide(pending.approvalId, false), "rejected");
  assert.equal(await pending.decision, "rejected");
});

test("broker: decide on an unknown or already-decided id throws", async () => {
  const broker = new ApprovalBroker(60_000);
  const pending = broker.request({ toolName: "t", summary: "s" });
  broker.decide(pending.approvalId, true);
  assert.throws(() => broker.decide(pending.approvalId, true), /not found or already decided/);
  assert.throws(() => broker.decide("never-existed", true), /not found or already decided/);
});

test("broker: cancel resolves cancelled and cleans the pending entry", async () => {
  const broker = new ApprovalBroker(60_000);
  const decided: string[] = [];
  broker.onDecided((info) => decided.push(info.outcome));
  const pending = broker.request({ toolName: "t", summary: "s" });
  pending.cancel();
  assert.equal(await pending.decision, "cancelled");
  assert.equal(broker.pendingCount(), 0);
  assert.deepEqual(decided, ["cancelled"]);
});

test("broker: an unanswered request auto-rejects after the timeout", async () => {
  const broker = new ApprovalBroker(30);
  const decided: Array<{ outcome: string; timedOut: boolean }> = [];
  broker.onDecided((info) => decided.push({ outcome: info.outcome, timedOut: info.timedOut }));
  const pending = broker.request({ toolName: "t", summary: "s" });
  assert.equal(await pending.decision, "rejected");
  assert.deepEqual(decided, [{ outcome: "rejected", timedOut: true }]);
  assert.equal(broker.pendingCount(), 0);
});

test("broker: peek returns the request metadata while pending and null afterwards", () => {
  const broker = new ApprovalBroker(60_000);
  const pending = broker.request({ toolName: "cyraops_update_ticket", callId: "call-1", reason: "r", summary: "s" });
  const view = broker.peek(pending.approvalId);
  assert.ok(view);
  assert.equal(view?.toolName, "cyraops_update_ticket");
  assert.equal(view?.callId, "call-1");
  assert.equal(view?.reason, "r");
  broker.decide(pending.approvalId, false);
  assert.equal(broker.peek(pending.approvalId), null);
});

test("broker: requests are independent and each gets its own id", async () => {
  const broker = new ApprovalBroker(60_000);
  const first = broker.request({ toolName: "t", summary: "1" });
  const second = broker.request({ toolName: "t", summary: "2" });
  assert.notEqual(first.approvalId, second.approvalId);
  assert.equal(broker.pendingCount(), 2);
  broker.decide(second.approvalId, true);
  assert.equal(await second.decision, "allowed-once");
  assert.equal(broker.pendingCount(), 1);
  broker.decide(first.approvalId, false);
  assert.equal(await first.decision, "rejected");
  assert.equal(broker.pendingCount(), 0);
});

test("broker: requests carry the auto-reject deadline (timeoutMs out from now)", () => {
  const broker = new ApprovalBroker(60_000);
  const before = Date.now();
  const pending = broker.request({ toolName: "t", summary: "s" });
  const after = Date.now();
  // Generous bounds: the deadline is "now + timeoutMs", computed inside request().
  assert.ok(pending.deadline >= before + 59_500, `deadline too early: ${pending.deadline}`);
  assert.ok(pending.deadline <= after + 60_500, `deadline too late: ${pending.deadline}`);
});

test("broker: a custom timeout moves the deadline accordingly", () => {
  const broker = new ApprovalBroker(5_000);
  const now = Date.now();
  const pending = broker.request({ toolName: "t", summary: "s" });
  assert.ok(pending.deadline >= now + 4_500, `deadline too early: ${pending.deadline}`);
  assert.ok(pending.deadline <= now + 5_500, `deadline too late: ${pending.deadline}`);
});

test("broker: peek exposes the same deadline while pending", () => {
  const broker = new ApprovalBroker(60_000);
  const pending = broker.request({ toolName: "t", summary: "s" });
  const view = broker.peek(pending.approvalId);
  assert.ok(view);
  assert.equal(view?.deadline, pending.deadline);
  broker.decide(pending.approvalId, false);
  assert.equal(broker.peek(pending.approvalId), null);
});

test("broker: install/uninstall publishes the instance under the global symbol", () => {
  const key = Symbol.for("cyraops.harness.approval-broker");
  const broker = new ApprovalBroker(60_000).install();
  assert.equal((globalThis as Record<symbol, unknown>)[key], broker);
  broker.uninstall();
  assert.equal((globalThis as Record<symbol, unknown>)[key], undefined);
  assert.equal(broker.pendingCount(), 0);
});
