#!/usr/bin/env node
/**
 * tier2-plan-probe/probe-plan-task.mjs — PART 1 evidence probe (default run).
 *
 * Runs the vendored in-process native host (exactly what the chat route's
 * native AgentRuntime executes) on a multi-step planning task and captures
 * EVERY NDJSON event the headless projection emits, plus an event-type census
 * and any event whose type mentions "plan".
 *
 * Question under test: do plan/status/thinking events carrying plan text
 * surface in a normal (plan-mode-inactive) turn? Does anything resembling
 * plan approval appear?
 *
 * Usage: node scratch/tier2-plan-probe/probe-plan-task.mjs
 * (run from the repo root; projectRoot defaults to the repo root so the
 *  .env layer resolves the DeepSeek credential — never printed).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNativeTask } from "../../vendor/tooling/vendored-boot/native-host.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "evidence-plan-task.json");

const TASK = process.argv[2] ?? "Plan the steps to update the three open tickets' priorities, then tell me the plan";

const events = [];
const log = (message) => process.stderr.write(`[probe-plan-task] ${message}\n`);

const t0 = Date.now();
try {
  for await (const event of runNativeTask({
    task: TASK,
    projectRoot: REPO_ROOT,
    approvalPolicy: "ask", // mirror native-runtime.ts
    timeoutMs: 420_000,
    log: (message) => process.stderr.write(`[host] ${message}\n`),
  })) {
    events.push(event);
    log(`event: ${event.type}${event.phase ? `/${event.phase}` : ""}${event.tool ? ` tool=${event.tool}` : ""}`);
  }
} catch (error) {
  log(`run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}

const census = {};
for (const event of events) {
  const key = `${event.type}${event.phase ? `/${event.phase}` : ""}`;
  census[key] = (census[key] ?? 0) + 1;
}

const planish = events.filter((event) =>
  JSON.stringify(event.type).toLowerCase().includes("plan") ||
  (typeof event.text === "string" && /plan/i.test(event.text) && event.type !== "text")
);

const summary = {
  task: TASK,
  wallMs: Date.now() - t0,
  eventCount: events.length,
  census,
  finalText: [...events].reverse().find((e) => e.type === "final")?.text ?? "",
  planishEvents: planish,
  allEvents: events,
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
log(`wrote ${OUT} (${events.length} events)`);
log(`census: ${JSON.stringify(census)}`);
log(`plan-ish non-text events: ${planish.length}`);
