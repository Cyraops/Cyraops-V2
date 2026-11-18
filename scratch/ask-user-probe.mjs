/**
 * scratch/ask-user-probe.mjs — TASK 1 experiment: prove the ask_user_question
 * tool, the user-questions/request answerer, and the question broker chain
 * work end-to-end in the real vendored native host.
 *
 * Usage (from the repo root):
 *   node scratch/ask-user-probe.mjs
 *
 * The probe installs a PROBE broker on the globalThis symbol the
 * cyraops-crm plugin's question answerer reads, boots the real vendored
 * native host in-process, and runs the acceptance prompt. The probe broker
 * auto-answers after a few seconds (as if /api/harness/answer resolved it),
 * so the turn must continue and the final text must reflect the answer.
 *
 * Evidence printed:
 *   - every NDJSON event the host projection emits,
 *   - every question batch the plugin's answerer forwarded to the broker,
 *   - the tool_result status and the final text.
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

const BROKER_KEY = Symbol.for("cyraops.harness.question-broker");
const REPO = process.cwd();
const HOST_URL = pathToFileURL(path.join(REPO, "vendor", "tooling", "vendored-boot", "native-host.mjs")).href;

const brokerRequests = [];
const broker = {
  request(info) {
    brokerRequests.push(info);
    console.log(
      `[probe-broker] QUESTION REQUEST: callId=${info.callId ?? "-"} questions=${JSON.stringify(info.questions)}`
    );
    const batch = {
      answers: info.questions.map((question, index) =>
        index === 0
          ? { id: question.id, selected: [], custom: "seed-task-billing" }
          : { id: question.id, selected: [] }
      ),
    };
    const decision = new Promise((resolve) => setTimeout(() => resolve(batch), 3000));
    return {
      questionId: info.callId ?? `probe-${brokerRequests.length}`,
      decision,
      cancel: () => {},
    };
  },
};
globalThis[BROKER_KEY] = broker;

const { runNativeTask } = await import(HOST_URL);
console.log(`[probe] booting native host (approvalPolicy=ask)`);

const events = [];
try {
  for await (const event of runNativeTask({
    task: "Use the ask_user tool to ask me which ticket to update, then report my answer.",
    approvalPolicy: "ask",
    timeoutMs: 240_000,
    projectRoot: REPO,
    tee: "diagnostics",
  })) {
    events.push(event);
    const compact = { ...event };
    if (compact.type === "text" && typeof compact.text === "string" && compact.text.length > 240) {
      compact.text = `${compact.text.slice(0, 240)}…(truncated)`;
    }
    if (compact.type === "tool_result" && typeof compact.result === "string" && compact.result.length > 300) {
      compact.result = `${compact.result.slice(0, 300)}…(truncated)`;
    }
    console.log(`[stream] ${JSON.stringify(compact)}`);
  }
} catch (error) {
  console.error(`[probe] run failed: ${error?.message}`);
}

const toolCalls = events.filter((event) => event.type === "tool_call");
const toolResults = events.filter((event) => event.type === "tool_result");
const final = events.find((event) => event.type === "final");
console.log(`[probe] SUMMARY: broker requests=${brokerRequests.length}, tool calls=${toolCalls.map((e) => e.tool).join(",")}, ` +
  `results=${toolResults.map((e) => `${e.callId}:${e.status}`).join(",")}`);
console.log(`[probe] FINAL: ${final?.text ?? "(none)"}`);
