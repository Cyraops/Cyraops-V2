#!/usr/bin/env node
/**
 * tier2-plan-probe/probe-host-plan-mode.mjs — verifies the NEW host plan path
 * (runNativeTask planMode option) end to end in plain node:
 *   turn 1: planMode "on" with a planning task → the model explores, calls
 *           exit_plan_mode, the review bridges to the stubbed question broker
 *           (the channel the real runtime subscribes to), we approve, the
 *           turn completes and the NDJSON stream carries the plan in the
 *           exit_plan_mode tool_call input.
 *   turn 2: planMode "off" on the same session, empty task (a bare switch) →
 *           completes with an empty final and exit code 0.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNativeTask } from "../../vendor/tooling/vendored-boot/native-host.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const QUESTION_BROKER_KEY = Symbol.for("cyraops.harness.question-broker");

const log = (message) => process.stderr.write(`[probe-host-plan] ${message}\n`);
const brokerRequests = [];
globalThis[QUESTION_BROKER_KEY] = {
  request(info) {
    brokerRequests.push(info);
    const first = info.questions?.[0];
    const isPlanReview = first?.id === "plan-review";
    return {
      questionId: info.callId ?? "stub-q",
      cancel: () => {},
      decision: Promise.resolve({ answers: [{ id: first?.id, selected: isPlanReview ? ["Approve"] : [] }] }),
    };
  },
};

async function turn({ task, sessionId, planMode }) {
  const events = [];
  for await (const event of runNativeTask({
    task,
    sessionId,
    planMode,
    projectRoot: REPO_ROOT,
    approvalPolicy: "ask",
    timeoutMs: 420_000,
    log,
  })) {
    events.push(event);
  }
  return events;
}

const results = {};
try {
  results.turn1 = await turn({
    task: "Plan the steps to update the three open tickets' priorities, then tell me the plan.",
    planMode: "on",
  });
  const sessionEvent = results.turn1.find((e) => e.type === "session");
  results.sessionId = sessionEvent?.sessionId ?? null;
  log(`turn1 events: ${results.turn1.length}, session=${results.sessionId}`);
  const planCall = results.turn1.find((e) => e.type === "tool_call" && e.tool === "exit_plan_mode");
  results.planCall = planCall ?? null;
  const planResult = results.turn1.find((e) => e.type === "tool_result" && planCall && e.callId === planCall.callId);
  results.planResult = planResult ?? null;
  log(`exit_plan_mode call present: ${Boolean(planCall)}; result: ${JSON.stringify(planResult?.result)?.slice(0, 120)}`);
  log(`broker requests: ${brokerRequests.length}`);

  results.turn2 = await turn({ task: "", sessionId: results.sessionId ?? undefined, planMode: "off" });
  log(`turn2 events: ${results.turn2.length}`);
} catch (error) {
  results.error = String(error?.message ?? error);
  log(`FAILED: ${results.error}`);
  process.exitCode = 1;
}

const census = (events) => {
  const c = {};
  for (const e of events ?? []) {
    const key = `${e.type}${e.phase ? `/${e.phase}` : ""}`;
    c[key] = (c[key] ?? 0) + 1;
  }
  return c;
};
results.turn1Census = census(results.turn1);
results.turn2Census = census(results.turn2);
results.finalTurn1 = [...(results.turn1 ?? [])].reverse().find((e) => e.type === "final") ?? null;
results.finalTurn2 = [...(results.turn2 ?? [])].reverse().find((e) => e.type === "final") ?? null;
await import("node:fs").then((fs) =>
  fs.writeFileSync(path.join(HERE, "evidence-host-plan-mode.json"), JSON.stringify(results, null, 2))
);
log(`census turn1: ${JSON.stringify(results.turn1Census)}`);
log(`census turn2: ${JSON.stringify(results.turn2Census)}`);
log(`turn1 final text: ${JSON.stringify(results.finalTurn1?.text ?? "").slice(0, 200)}`);
