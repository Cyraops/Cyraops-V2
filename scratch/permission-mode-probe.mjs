/**
 * scratch/permission-mode-probe.mjs — unified Permission Manager e2e probe.
 *
 * Proves the backend enforcement end-to-end against the LIVE dev DB
 * (cyraops_v2), using the real in-process native harness host through the
 * same AgentRuntime the routes use (HARNESS_RUNTIME=native code path):
 *
 *   1. READ_ONLY     — the owner asks a native harness turn to set
 *                      seed-task-billing priority to HIGH. The write is
 *                      DENIED and psql shows the row unchanged.
 *   2. FULL_CONTROL  — the same turn auto-executes (the write runs without an
 *                      approval ask); psql shows HIGH, then the probe reverts.
 *   3. SYSTEM        — the harness system tools are re-enabled: a turn runs
 *                      `echo system-mode-ok` and its output appears verbatim.
 *                      No file writes.
 *
 * Every turn resolves the mode exactly like the routes do:
 * resolvePermissionMode({ workspaceId }) + runtimePermissionMode(mode, "OWNER").
 * The workspace mode is flipped through the dev DB between steps and restored
 * to its original value at the end, and the ticket priority is reverted.
 *
 * Usage (from the repo root):
 *   node --import tsx scratch/permission-mode-probe.mjs
 */

import { config } from "dotenv";
config();
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createNativeRuntime } from "../src/lib/harness/native-runtime";
import { harnessSessionStore } from "../src/lib/harness/runtime";
import { resolvePermissionMode, runtimePermissionMode } from "../src/lib/permissions/mode";

const prisma = new PrismaClient();
const OWNER_EMAIL = "tanveer@cyraops.com";
const TICKET_ID = "seed-task-billing";
const WORKSPACE_ID = "main"; // the Workspace row id (mode is stored here)

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[probe] ${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

function compact(event) {
  const copy = { ...event };
  for (const key of ["text", "result"]) {
    if (typeof copy[key] === "string" && copy[key].length > 400) {
      copy[key] = `${copy[key].slice(0, 400)}…(truncated)`;
    }
  }
  return copy;
}

/** One native harness turn through the real AgentRuntime, like the routes. */
async function runNativeTurn({ tenantKey, task }) {
  const mode = runtimePermissionMode(await resolvePermissionMode({ workspaceId: tenantKey }), "OWNER");
  console.log(`[probe] resolved permission mode: ${mode}`);
  const runtime = createNativeRuntime(harnessSessionStore());
  const session = await runtime.createSession({
    tenantId: tenantKey,
    conversationId: `perm-mode-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const events = [];
  try {
    for await (const event of runtime.executeTurn({
      sessionId: session.id,
      task,
      // Exactly the route convention: the owner user id is the tenant key
      // published as CYRAOPS_WORKSPACE_ID for the CRM bridge.
      workspaceId: tenantKey,
      permissionMode: mode,
    })) {
      events.push(event);
      const line = JSON.stringify(compact(event));
      console.log(`[stream] ${line.length > 420 ? `${line.slice(0, 420)}…` : line}`);
    }
  } catch (error) {
    console.error(`[probe] turn threw: ${error?.message}`);
  } finally {
    await runtime.closeSession(session.id);
  }
  const final = [...events].reverse().find((event) => event.type === "final");
  const toolResults = events.filter((event) => event.type === "tool_result");
  return { events, finalText: final?.text ?? "", toolResults };
}

async function ticketPriority() {
  const row = await prisma.task.findUnique({ where: { id: TICKET_ID }, select: { priority: true } });
  return row?.priority ?? null;
}

async function setWorkspaceMode(mode) {
  await prisma.workspace.update({ where: { id: WORKSPACE_ID }, data: { permissionMode: mode } });
  console.log(`[probe] workspace ${WORKSPACE_ID} permissionMode → ${mode}`);
}

const WRITE_TASK =
  "Use the cyraops_update_ticket tool to set the priority of the ticket with id seed-task-billing to HIGH. Then report the ticket's new priority.";

const originalMode = (await prisma.workspace.findUnique({ where: { id: WORKSPACE_ID } })).permissionMode;
const baselinePriority = await ticketPriority();
const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
assert.ok(owner, `owner ${OWNER_EMAIL} must exist`);
const TENANT_KEY = owner.id; // route convention: workspaceId = owner user id
console.log(`[probe] baseline: workspaceMode=${originalMode}, ${TICKET_ID}.priority=${baselinePriority}, tenant=${TENANT_KEY}`);

try {
  // 1. READ_ONLY: the write must be DENIED and the row must not change.
  await setWorkspaceMode("READ_ONLY");
  const readOnly = await runNativeTurn({ tenantKey: TENANT_KEY, task: WRITE_TASK });
  const afterReadOnly = await ticketPriority();
  const denialEvidence = readOnly.toolResults.some((result) => {
    const text = `${String(result.status)} ${String(result.result)}`;
    return /denied|READ_ONLY|read-only/.test(text);
  });
  record("READ_ONLY denies the native write", denialEvidence && afterReadOnly === baselinePriority,
    `denialEvidence=${denialEvidence}, priority before=${baselinePriority} after=${afterReadOnly}`);
  record("READ_ONLY reply names the mode", /read-only|READ_ONLY|denied|blocked/i.test(readOnly.finalText),
    `final: ${readOnly.finalText.slice(0, 200)}`);

  // 2. FULL_CONTROL: the owner's write auto-executes (no approval ask).
  await setWorkspaceMode("FULL_CONTROL");
  const fullControl = await runNativeTurn({ tenantKey: TENANT_KEY, task: WRITE_TASK });
  const afterFullControl = await ticketPriority();
  const approvalsSeen = fullControl.events.filter((event) => event.type === "approval").length;
  record("FULL_CONTROL auto-executes the write", afterFullControl === "HIGH",
    `priority=${afterFullControl}, approvalEvents=${approvalsSeen}`);
  record("FULL_CONTROL runs with no approval ask", approvalsSeen === 0,
    `approval events in stream: ${approvalsSeen}`);

  // Revert the ticket immediately (probe policy: no lasting DB changes).
  if (afterFullControl === "HIGH" && baselinePriority && baselinePriority !== "HIGH") {
    await prisma.task.update({ where: { id: TICKET_ID }, data: { priority: baselinePriority } });
    console.log(`[probe] reverted ${TICKET_ID}.priority → ${baselinePriority}`);
  }

  // 3. SYSTEM: system tools are re-enabled; echo runs and its output surfaces.
  await setWorkspaceMode("SYSTEM");
  const system = await runNativeTurn({
    tenantKey: TENANT_KEY,
    task: 'Run the shell command `echo system-mode-ok` and reply with its exact output.',
  });
  const echoResults = system.events
    .filter((event) => event.type === "tool_result")
    .map((event) => String(event.result));
  const echoed = echoResults.some((result) => result.includes("system-mode-ok"));
  record("SYSTEM re-enables the shell and echo output surfaces", echoed,
    `tool_results=${echoResults.map((r) => r.slice(0, 120)).join(" | ")}`);

  console.log("[probe] final ticket priority:", await ticketPriority());
} finally {
  // Restore the workspace mode whatever happened.
  await prisma.workspace.update({ where: { id: WORKSPACE_ID }, data: { permissionMode: originalMode } });
  console.log(`[probe] restored workspaceMode=${originalMode}`);
  await prisma.$disconnect();
}

const failed = results.filter((result) => !result.ok);
console.log(`[probe] summary: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.error("[probe] FAILED CHECKS:", failed.map((result) => result.name).join("; "));
  process.exit(1);
}
