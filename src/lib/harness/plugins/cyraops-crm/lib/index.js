/**
 * @cyraops/harness-crm — Phase 4 v2: a small read-only Cyraops CRM tool set
 * (`cyraops_open_tickets`, `cyraops_list_tickets`, `cyraops_search_contacts`,
 * `cyraops_list_schedule`) registered inside the native harness runtime so
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
import {
  cyraopsRoot,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  normalizeBoundedLimit,
  normalizeDays,
  normalizeLimit,
  normalizeOptionalQuery,
  normalizeRequiredQuery,
  queryListSchedule,
  queryListTickets,
  queryOpenTickets,
  querySearchContacts,
} from "./bridge.mjs";

export const name = "cyraops-crm";
export const inject = ["tools"];

export const TOOL_NAME = "cyraops_open_tickets";
export const TOOL_LIST_TICKETS = "cyraops_list_tickets";
export const TOOL_SEARCH_CONTACTS = "cyraops_search_contacts";
export const TOOL_LIST_SCHEDULE = "cyraops_list_schedule";

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
let openTicketsRegistration = null;
export function toolDefinition() {
  openTicketsRegistration ??= createToolDefinition();
  return openTicketsRegistration;
}

// ---------------------------------------------------------------------------
// Phase 4 v2: the three additional read-only tools, built with the exact
// defineTool field usage proven above (name/description/parameters/output
// schema/render/timeoutMs/execute) and the same runQuery test seam.
// ---------------------------------------------------------------------------

const LIST_TICKETS_DESCRIPTION =
  "List tickets in the Cyraops CRM database. By default lists open tickets " +
  "(not archived, status BACKLOG/TODO/IN_PROGRESS/IN_REVIEW; DONE is excluded). " +
  "Optionally filter to a single status (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW or DONE), " +
  "search ticket titles and descriptions with `query` (case-insensitive), and cap the " +
  "result with `limit` (default 10, maximum 25). Returns the count and each ticket's " +
  "id, title, status, priority and assignee name. Read-only: it never changes data.";

const LIST_TICKETS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    count: {
      type: "integer",
      required: true,
      description: "Number of tickets in the returned set.",
    },
    tickets: {
      type: "array",
      required: true,
      description: "Tickets, newest first.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "Ticket id." },
          title: { type: "string", required: true, description: "Ticket title." },
          status: { type: "string", required: true, description: "Task status (BACKLOG/TODO/IN_PROGRESS/IN_REVIEW/DONE)." },
          priority: { type: "string", required: true, description: "Task priority (LOW/MEDIUM/HIGH/URGENT)." },
          assignee: {
            oneOf: [{ type: "string" }, { type: "null" }],
            required: true,
            description: "Assignee display name, or null when unassigned.",
          },
        },
      },
    },
  },
};

export function createListTicketsDefinition(deps = {}) {
  const defineTool = deps.defineTool ?? loadDefineTool();
  const runQuery = deps.runQuery ?? queryListTickets;
  return defineTool({
    name: TOOL_LIST_TICKETS,
    description: LIST_TICKETS_DESCRIPTION,
    parameters: {
      status: {
        type: "string",
        description:
          "Optional single task status to filter by: BACKLOG, TODO, IN_PROGRESS, IN_REVIEW or DONE. Omit it to list open tickets only (DONE excluded).",
      },
      limit: {
        type: "integer",
        description: "Optional maximum number of tickets to return, between 1 and 25 (default 10).",
      },
      query: {
        type: "string",
        description: "Optional case-insensitive search over ticket title and description.",
      },
    },
    output: {
      schema: LIST_TICKETS_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    timeoutMs: 15_000,
    async execute(args) {
      return runQuery({
        status: args.status,
        limit:
          args.limit === undefined || args.limit === null
            ? LIST_LIMIT_DEFAULT
            : normalizeBoundedLimit(args.limit, LIST_LIMIT_MAX),
        query: normalizeOptionalQuery(args.query),
      });
    },
  });
}

const SEARCH_CONTACTS_DESCRIPTION =
  "Search contacts in the Cyraops CRM database by name or email " +
  "(case-insensitive contains match on first name, last name or email; every " +
  "word of a multi-word query must match somewhere). " +
  "Returns the count and each match's id, full name, email and company name. " +
  "Read-only: it never changes data.";

const SEARCH_CONTACTS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    count: {
      type: "integer",
      required: true,
      description: "Number of matching contacts in the returned set.",
    },
    contacts: {
      type: "array",
      required: true,
      description: "Matching contacts, newest first.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "Contact id." },
          name: { type: "string", required: true, description: "Full contact name." },
          email: {
            oneOf: [{ type: "string" }, { type: "null" }],
            required: true,
            description: "Contact email, or null when absent.",
          },
          company: {
            oneOf: [{ type: "string" }, { type: "null" }],
            required: true,
            description: "Company name, or null when the contact has no company.",
          },
        },
      },
    },
  },
};

export function createSearchContactsDefinition(deps = {}) {
  const defineTool = deps.defineTool ?? loadDefineTool();
  const runQuery = deps.runQuery ?? querySearchContacts;
  return defineTool({
    name: TOOL_SEARCH_CONTACTS,
    description: SEARCH_CONTACTS_DESCRIPTION,
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "Name or email text to search for (case-insensitive contains match).",
      },
      limit: {
        type: "integer",
        description: "Optional maximum number of contacts to return, between 1 and 25 (default 10).",
      },
    },
    output: {
      schema: SEARCH_CONTACTS_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    timeoutMs: 15_000,
    async execute(args) {
      return runQuery({
        query: normalizeRequiredQuery(args.query),
        limit:
          args.limit === undefined || args.limit === null
            ? LIST_LIMIT_DEFAULT
            : normalizeBoundedLimit(args.limit, LIST_LIMIT_MAX),
      });
    },
  });
}

const LIST_SCHEDULE_DESCRIPTION =
  "List upcoming calendar events in Cyraops that start within the next N days " +
  "(default 7, allowed range 1-30). Returns the count and each event's id, title, " +
  "start and end times (ISO-8601). Read-only: it never changes data.";

const LIST_SCHEDULE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    count: {
      type: "integer",
      required: true,
      description: "Number of upcoming events in the returned set.",
    },
    events: {
      type: "array",
      required: true,
      description: "Upcoming events, soonest first.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "Event id." },
          title: { type: "string", required: true, description: "Event title." },
          start: { type: "string", required: true, description: "Event start time (ISO-8601)." },
          end: { type: "string", required: true, description: "Event end time (ISO-8601)." },
        },
      },
    },
  },
};

export function createListScheduleDefinition(deps = {}) {
  const defineTool = deps.defineTool ?? loadDefineTool();
  const runQuery = deps.runQuery ?? queryListSchedule;
  return defineTool({
    name: TOOL_LIST_SCHEDULE,
    description: LIST_SCHEDULE_DESCRIPTION,
    parameters: {
      days: {
        type: "integer",
        description: "Optional number of days ahead to list events for, between 1 and 30 (default 7).",
      },
    },
    output: {
      schema: LIST_SCHEDULE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    timeoutMs: 15_000,
    async execute(args) {
      return runQuery({ days: normalizeDays(args.days) });
    },
  });
}

/**
 * The registry-ready definitions used by the harness (lazily built once, in
 * stable registration order: the Phase 4 v1 tool first, then the v2 set).
 */
let registration = null;
export function toolDefinitions() {
  registration ??= [
    createToolDefinition(),
    createListTicketsDefinition(),
    createSearchContactsDefinition(),
    createListScheduleDefinition(),
  ];
  return registration;
}

function apply(ctx) {
  for (const definition of toolDefinitions()) {
    ctx.tools.register(definition);
    // One-line boot evidence of the model-facing registry: registered tool
    // names appear on the native host's stderr during tree mount.
    process.stderr.write(`[cyraops-crm] registered tool: ${definition.name}\n`);
  }
}

export { apply };
