/**
 * Unit tests for the in-process question broker (TASK 1): the channel between
 * the harness plugin's user-question answerer and /api/harness/answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QuestionBroker,
  QuestionAbortedError,
  answerBatchForText,
  questionTextOf,
} from "./question-broker";

test("broker: answer() resolves the decision with the typed text as the first question's custom answer", async () => {
  const broker = new QuestionBroker(60_000);
  const requests: string[] = [];
  const decided: Array<{ questionId: string; timedOut: boolean }> = [];
  broker.onRequest((request) => requests.push(request.questionId));
  broker.onDecided((info) => decided.push(info));

  const pending = broker.request({
    questions: [{ id: "which-ticket", question: "Which ticket should I update?" }],
  });
  assert.equal(requests.length, 1);
  assert.equal(broker.pendingCount(), 1);
  assert.equal(pending.text, "Which ticket should I update?");

  const result = broker.answer(pending.questionId, "seed-task-billing");
  assert.equal(result.timedOut, false);
  assert.deepEqual(await pending.decision, {
    answers: [{ id: "which-ticket", selected: [], custom: "seed-task-billing" }],
  });
  assert.equal(broker.pendingCount(), 0);
  assert.deepEqual(decided, [{ questionId: pending.questionId, timedOut: false }]);
});

test("broker: a multi-question batch answers the first and skips the rest", async () => {
  const broker = new QuestionBroker(60_000);
  const pending = broker.request({
    questions: [
      { id: "q1", question: "Which ticket?" },
      { id: "q2", question: "What priority?" },
    ],
  });
  broker.answer(pending.questionId, "HIGH");
  assert.deepEqual(await pending.decision, {
    answers: [
      { id: "q1", selected: [], custom: "HIGH" },
      { id: "q2", selected: [] },
    ],
  });
});

test("broker: the request carries the tool call id as its wire key", () => {
  const broker = new QuestionBroker(60_000);
  const pending = broker.request({
    questions: [{ id: "q", question: "Which ticket?" }],
    callId: "call-42",
  });
  assert.equal(pending.questionId, "call-42");
  assert.equal(pending.callId, "call-42");
});

test("broker: answer on an unknown or already-answered id throws", async () => {
  const broker = new QuestionBroker(60_000);
  const pending = broker.request({ questions: [{ id: "q", question: "q?" }] });
  broker.answer(pending.questionId, "a");
  assert.throws(() => broker.answer(pending.questionId, "b"), /not found or already answered/);
  assert.throws(() => broker.answer("never-existed", "x"), /not found or already answered/);
});

test("broker: an unattended question settles as skipped after the timeout", async () => {
  const broker = new QuestionBroker(25);
  const decided: Array<{ questionId: string; timedOut: boolean }> = [];
  broker.onDecided((info) => decided.push(info));
  const pending = broker.request({ questions: [{ id: "q", question: "q?" }] });
  assert.deepEqual(await pending.decision, { answers: [{ id: "q", selected: [] }] });
  assert.equal(pending.timedOut, true);
  assert.deepEqual(decided, [{ questionId: pending.questionId, timedOut: true }]);
  assert.equal(broker.pendingCount(), 0);
});

test("broker: cancel rejects the decision so the service records an abort, not a skip", async () => {
  const broker = new QuestionBroker(60_000);
  const decided: string[] = [];
  broker.onDecided((info) => decided.push(info.questionId));
  const pending = broker.request({ questions: [{ id: "q", question: "q?" }] });
  pending.cancel();
  await assert.rejects(() => pending.decision, QuestionAbortedError);
  assert.equal(pending.settled, true);
  assert.deepEqual(decided, [pending.questionId]);
  assert.equal(broker.pendingCount(), 0);
});

test("broker: peek returns the question while pending and null afterwards", () => {
  const broker = new QuestionBroker(60_000);
  const pending = broker.request({
    questions: [{ id: "q", question: "Which ticket?" }],
    callId: "call-1",
  });
  const view = broker.peek(pending.questionId);
  assert.ok(view);
  assert.equal(view?.callId, "call-1");
  assert.equal(view?.text, "Which ticket?");
  broker.answer(pending.questionId, "x");
  assert.equal(broker.peek(pending.questionId), null);
});

test("broker: requests are independent and each gets its own id", async () => {
  const broker = new QuestionBroker(60_000);
  const first = broker.request({ questions: [{ id: "q1", question: "one?" }] });
  const second = broker.request({ questions: [{ id: "q2", question: "two?" }] });
  assert.notEqual(first.questionId, second.questionId);
  assert.equal(broker.pendingCount(), 2);
  broker.answer(second.questionId, "b");
  assert.deepEqual(await second.decision, { answers: [{ id: "q2", selected: [], custom: "b" }] });
  assert.equal(broker.pendingCount(), 1);
  broker.answer(first.questionId, "a");
  assert.equal(broker.pendingCount(), 0);
});

test("broker: install/uninstall publishes the instance under the global symbol", () => {
  const key = Symbol.for("cyraops.harness.question-broker");
  const broker = new QuestionBroker(60_000).install();
  assert.equal((globalThis as Record<symbol, unknown>)[key], broker);
  broker.uninstall();
  assert.equal((globalThis as Record<symbol, unknown>)[key], undefined);
  assert.equal(broker.pendingCount(), 0);
});

test("answerBatchForText: an empty answer is the documented skip (no custom)", () => {
  assert.deepEqual(answerBatchForText([{ id: "q", question: "q?" }], ""), {
    answers: [{ id: "q", selected: [] }],
  });
  assert.deepEqual(answerBatchForText([{ id: "q", question: "q?" }], "  "), {
    answers: [{ id: "q", selected: [] }],
  });
});

test("questionTextOf: the batch's first question is the primary text, with a fallback", () => {
  assert.equal(questionTextOf([{ id: "a", question: "Which ticket?" }, { id: "b", question: "Why?" }]), "Which ticket?");
  assert.equal(questionTextOf([]), "The assistant needs your input.");
});
