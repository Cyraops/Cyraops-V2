/**
 * @cyraops/harness-crm — Phase 4 v1: one read-only Cyraops CRM tool
 * (`cyraops_open_tickets`) registered inside the native harness runtime so
 * the bot can answer CRM questions with real data from the Cyraops database.
 *
 * Cordis plugin shape (same dialect as the shipped tool packages, e.g.
 * @deepseek-ai/dsh-tool-goal): module-level `name`/`inject` exports and an
 * `apply(ctx)` that registers into the shared tool registry. Registered tools
 * feed the model-facing system prompt automatically (dsh-tools README,
 * "Register a tool"), so the bundle patch only inserts the plugin row.
 *
 * Module loading: this file statically imports NOTHING but node builtins and
 * ./bridge.mjs. `defineTool` is loaded lazily through a createRequire
 * anchored at vendor/dsh/package.json. That anchor is not in an interception
 * layer, so the vendored loader leaves the require to Node's native
 * resolution: it lands on the same @deepseek-ai/dsh-tools module instance the
 * registry itself uses (the tree is served from vendor/dsh). The same lazy
 * load also lets the unit test import this module in plain Node. The Prisma
 * bridge (./bridge.mjs) is equally createRequire-based and anchored at the
 * Cyraops V2 root, because @prisma/client does not exist under
 * vendor/dsh/node_modules.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cyraopsRoot, normalizeLimit, queryOpenTickets } from "./bridge.mjs";

export const name = "cyraops-crm";
export const inject = ["tools"];

export const TOOL_NAME = "cyraops_open_tickets";

const TOOL_DESCRIPTION =
  "Count the open tickets in the Cyraops CRM database. An open ticket is a task " +
  "that is not archived and whose status is BACKLOG, TODO, IN_PROGRESS or IN_REVIEW " +
  "(so DONE tickets are excluded). Returns the total count and a per-status breakdown. " +
  "Read-only: it never changes data.";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    count: {
      type: "integer",
      required: true,
      description: "Number of open tickets in the returned set.",
    },
    statuses: {
      type: "object",
      additionalProperties: true,
      required: true,
      description:
        "Open-ticket counts keyed by task status (BACKLOG/TODO/IN_PROGRESS/IN_REVIEW); only statuses present in the result appear.",
    },
  },
};

/**
 * Load the registry's own `defineTool` from the vendored tree. The anchor is
 * CYRAOPS_ROOT (or the process cwd — the in-process harness runs inside the
 * Next server at the repo root) + vendor/dsh/package.json.
 */
export function loadDefineTool() {
  const root = cyraopsRoot();
  const anchor = path.join(root, "vendor", "dsh", "package.json");
  if (!existsSync(anchor)) {
    throw new Error(`cyraops-crm: vendored harness tree not found at ${anchor}`);
  }
  const vendoredRequire = createRequire(anchor);
  const defineTool = vendoredRequire("@deepseek-ai/dsh-tools")?.defineTool;
  if (typeof defineTool !== "function") {
    throw new Error("cyraops-crm: @deepseek-ai/dsh-tools did not export defineTool");
  }
  return defineTool;
}

/**
 * Build the tool definition. `deps.defineTool` and `deps.runQuery` are test
 * seams: the unit test stubs the db bridge (runQuery) and can supply a real
 * or shape-compatible defineTool.
 */
export function createToolDefinition(deps = {}) {
  const defineTool = deps.defineTool ?? loadDefineTool();
  const runQuery = deps.runQuery ?? queryOpenTickets;
  return defineTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      limit: {
        type: "integer",
        description:
          "Optional maximum number of open tickets to include in the count and the status breakdown. Omit it to count every open ticket.",
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    timeoutMs: 15_000,
    async execute(args) {
      return runQuery({ limit: normalizeLimit(args.limit) });
    },
  });
}

/** The registry-ready definition used by the harness (lazily built once). */
let registration = null;
export function toolDefinition() {
  registration ??= createToolDefinition();
  return registration;
}

function apply(ctx) {
  ctx.tools.register(toolDefinition());
  // One-line boot evidence of the model-facing registry: registered tool
  // names appear on the native host's stderr during tree mount.
  process.stderr.write(`[cyraops-crm] registered tool: ${TOOL_NAME}\n`);
}

export { apply };
