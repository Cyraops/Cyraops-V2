/**
 * scratch/approval-probe.mjs — TASK 1 experiment: prove how the harness's
 * approval `ask` surfaces for a headless host, and what the NDJSON stream
 * does (and does not) contain.
 *
 * Usage (from the repo root):
 *   node scratch/approval-probe.mjs never    # baseline: default policy, ask auto-rejected
 *   node scratch/approval-probe.mjs ask reject
 *   node scratch/approval-probe.mjs ask allow
 *
 * The probe installs a PROBE broker on the globalThis symbol the
 * cyraops-crm plugin's answerer reads, boots the real vendored native host
 * in-process, and runs a task that instructs the model to update ticket
 * seed-task-billing with the approval-gated write tool.
 *
 * Evidence printed:
 *   - every NDJSON event the host projection emits,
 *   - every approval request the plugin's answerer forwarded to the broker,
 *   - the decision/outcome, and the tool_result status.
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

const BROKER_KEY = Symbol.for("cyraops.harness.approval-broker");
const REPO = process.cwd();
const HOST_URL = pathToFileURL(path.join(REPO, "vendor", "tooling", "vendored-boot", "native-host.mjs")).href;

const [mode = "never", decision = "reject"] = process.argv.slice(2);
if (!["never", "ask"].includes(mode)) {
  console.error("mode must be 'never' or 'ask'");
  process.exit(2);
}

// Tenant scoping: the probe acts as tanveer (owner of the seed task's project).
process.env.CYRAOPS_WORKSPACE_ID ??= "cmwjedybr0000xtc516kh4t6d";

const brokerRequests = [];
const broker = {
  request(info) {
    brokerRequests.push(info);
    console.log(`[probe-broker] APPROVAL REQUEST: tool=${info.toolName} callId=${info.callId ?? "-"} summary=${info.summary}`);
    let resolveDecision;
    const decisionPromise = new Promise((resolve) => {
      resolveDecision = resolve;
    });
    const outcome = decision === "allow" ? "allowed-once" : "rejected";
    // Answer on the next tick so the answerer's await path is exercised.
    setTimeout(() => resolveDecision(outcome), 250);
    return { approvalId: `probe-${brokerRequests.length}`, decision: decisionPromise, cancel: () => {} };
  },
  cancel() {},
};
globalThis[BROKER_KEY] = broker;

const { runNativeTask } = await import(HOST_URL);
console.log(`[probe] booting native host (approvalPolicy=${mode === "ask" ? "ask" : "never (default)"}, decision=${decision})`);

const events = [];
try {
  for await (const event of runNativeTask({
    task: "Use the cyraops_update_ticket tool to set the priority of the ticket with id seed-task-billing to HIGH. Then report the ticket's new priority.",
    approvalPolicy: mode === "ask" ? "ask" : "never",
    timeoutMs: 240_000,
    projectRoot: REPO,
    tee: "diagnostics",
  })) {
    events.push(event);
    const compact = { ...event };
    if (compact.type === "text" && typeof compact.text === "string" && compact.text.length > 200) {
      compact.text = `${compact.text.slice(0, 200)}…(truncated)`;
    }
    if (compact.type === "tool_result" && typeof compact.result === "string" && compact.result.length > 300) {
      compact.result = `${compact.result.slice(0, 300)}…(truncated)`;
    }
    console.log(`[stream] ${JSON.stringify(compact)}`);
  }
} catch (error) {
  console.error(`[probe] run failed: ${error?.message}`);
}

console.log("----------------------------------------");
console.log(`[probe] broker saw ${brokerRequests.length} approval request(s)`);
console.log(`[probe] stream event types: ${events.map((e) => e.type).join(", ")}`);
const approvalStreamEvents = events.filter((e) => e.type === "approval" || e.type === "approval_decided");
console.log(`[probe] approval-typed NDJSON events in stream: ${approvalStreamEvents.length} (the projection never emits them — approvals travel through the answerer channel)`);
const toolResults = events.filter((e) => e.type === "tool_result");
for (const result of toolResults) {
  console.log(`[probe] tool_result: tool-call status=${result.status} result=${String(result.result).slice(0, 200)}`);
}
const final = [...events].reverse().find((e) => e.type === "final");
console.log(`[probe] final text: ${final?.text?.slice(0, 400) ?? "(none)"}`);
