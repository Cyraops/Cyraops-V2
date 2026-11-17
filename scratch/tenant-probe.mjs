/**
 * scratch/tenant-probe.mjs — TASK 2 evidence: raw tool output per tenant key
 * against the LIVE dev DB, using the plugin's own bridge (same code path the
 * harness tools run), with CYRAOPS_WORKSPACE_ID set to different tenants.
 */

import { createRequire } from "node:module";
import path from "node:path";

const root = process.cwd();
const requireBridge = createRequire(path.join(root, "src", "lib", "harness", "plugins", "cyraops-crm", "lib", "bridge.mjs"));
const bridge = await import(path.join(root, "src", "lib", "harness", "plugins", "cyraops-crm", "lib", "bridge.mjs"));

async function run(tenant) {
  if (tenant) process.env.CYRAOPS_WORKSPACE_ID = tenant;
  else delete process.env.CYRAOPS_WORKSPACE_ID;
  const listed = await bridge.queryListTickets({ limit: 25 });
  const open = await bridge.queryOpenTickets({});
  return { tenant, listedIds: listed.tickets.map((t) => t.id), listedCount: listed.count, openCount: open.count };
}

console.log("=== workspace 1 tenant (tanveer) ===");
console.log(JSON.stringify(await run("cmwjedybr0000xtc516kh4t6d"), null, 2));
console.log("=== workspace 2 tenant (tenant-two-owner) ===");
console.log(JSON.stringify(await run("tenant-two-owner"), null, 2));
console.log("=== no tenant set (legacy whole-DB behaviour — documented limitation) ===");
console.log(JSON.stringify(await run(undefined), null, 2));
