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
  normalizePriority,
  normalizeRequiredQuery,
  normalizeTicketId,
  normalizeTitle,
  queryListSchedule,
  queryListTickets,
  queryOpenTickets,
  querySearchContacts,
  queryUpdateTicket,
} from "./bridge.mjs";

export const name = "cyraops-crm";
export const inject = ["tools", "userQuestions"];

export const TOOL_NAME = "cyraops_open_tickets";
export const TOOL_LIST_TICKETS = "cyraops_list_tickets";
export const TOOL_SEARCH_CONTACTS = "cyraops_search_contacts";
export const TOOL_LIST_SCHEDULE = "cyraops_list_schedule";
export const TOOL_UPDATE_TICKET = "cyraops_update_ticket";
export const TOOL_ASK_USER_QUESTION = "ask_user_question";

/** Key under which the Next-side approval broker is published on globalThis. */
export const APPROVAL_BROKER_KEY = Symbol.for("cyraops.harness.approval-broker");
/** Key under which the Next-side question broker is published on globalThis. */
export const QUESTION_BROKER_KEY = Symbol.for("cyraops.harness.question-broker");

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
 * Require a package from the vendored tree. The anchor is CYRAOPS_ROOT (or
 * the process cwd — the in-process harness runs inside the Next server at the
 * repo root) + vendor/dsh/package.json, so the load lands on the same module
 * instances the registry itself uses.
 */
export function loadVendoredModule(moduleName) {
  const root = cyraopsRoot();
  const anchor = path.join(root, "vendor", "dsh", "package.json");
  if (!existsSync(anchor)) {
    throw new Error(`cyraops-crm: vendored harness tree not found at ${anchor}`);
  }
  const vendoredRequire = createRequire(anchor);
  return vendoredRequire(moduleName);
}

/**
 * Load the registry's own `defineTool` from the vendored tree (see
 * loadVendoredModule for the resolution anchor).
 */
export function loadDefineTool() {
  const defineTool = loadVendoredModule("@deepseek-ai/dsh-tools")?.defineTool;
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
 * stable registration order: the Phase 4 v1 tool first, then the v2 set, then
 * the approval-gated write tool).
 */
let registration = null;
export function toolDefinitions() {
  registration ??= [
    createToolDefinition(),
    createListTicketsDefinition(),
    createSearchContactsDefinition(),
    createListScheduleDefinition(),
    createUpdateTicketDefinition(),
  ];
  return registration;
}

// ---------------------------------------------------------------------------
// cyraops_update_ticket — the ONE write tool (TASK 1: approval mapping).
//
// The harness has no approval field on `defineTool` (dsh-tools README,
// "Enforce policy on calls"): approval is enforced by the `tools/pre-execute`
// waterfall, whose listener returns { kind: "ask", reason } for a tool. The
// tools pipeline then resolves the ask through the approval service
// (`ctx.get("approval").request(...)`), which logs approval/asked, dispatches
// the `approval/request` answerer waterfall, and maps `allowed-once` to the
// only grant. The NDJSON projection never emits approval events (they are
// log-only session events), so the decision travels through the answerer we
// register here, which bridges to the Next-side broker over globalThis (same
// process in the native runtime) and waits for /api/harness/approve.
// ---------------------------------------------------------------------------

const UPDATE_TICKET_DESCRIPTION =
  "Update an existing Cyraops CRM ticket's title and/or priority. Changing real " +
  "CRM data requires the user's approval: an approval prompt is shown before the " +
  "update runs, and rejecting it (or no answerer being available) fails the call. " +
  "Returns the ticket's id, title, status and priority after the update.";

const UPDATE_TICKET_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true, description: "Ticket id." },
    title: { type: "string", required: true, description: "Ticket title after the update." },
    status: { type: "string", required: true, description: "Task status (BACKLOG/TODO/IN_PROGRESS/IN_REVIEW/DONE)." },
    priority: { type: "string", required: true, description: "Task priority after the update (LOW/MEDIUM/HIGH/URGENT)." },
  },
};

export function createUpdateTicketDefinition(deps = {}) {
  const defineTool = deps.defineTool ?? loadDefineTool();
  const runQuery = deps.runQuery ?? queryUpdateTicket;
  return defineTool({
    name: TOOL_UPDATE_TICKET,
    description: UPDATE_TICKET_DESCRIPTION,
    parameters: {
      id: {
        type: "string",
        required: true,
        description: "The ticket id to update (e.g. seed-task-billing).",
      },
      title: {
        type: "string",
        description: "Optional new ticket title.",
      },
      priority: {
        type: "string",
        description: "Optional new priority: LOW, MEDIUM, HIGH or URGENT.",
      },
    },
    output: {
      schema: UPDATE_TICKET_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    timeoutMs: 15_000,
    async execute(args) {
      return runQuery({
        id: normalizeTicketId(args.id),
        title: args.title === undefined || args.title === null ? undefined : normalizeTitle(args.title),
        priority: args.priority === undefined || args.priority === null ? undefined : normalizePriority(args.priority),
      });
    },
  });
}

/** Human-readable summary of the pending update, shown on the approval card. */
export function updateTicketSummary(args) {
  const id = typeof args?.id === "string" && args.id.trim() !== "" ? args.id.trim() : "unknown ticket";
  const changes = [];
  if (typeof args?.title === "string" && args.title.trim() !== "") changes.push(`title → "${args.title.trim()}"`);
  if (typeof args?.priority === "string" && args.priority.trim() !== "") changes.push(`priority → ${args.priority.trim()}`);
  const what = changes.length > 0 ? changes.join(", ") : "update";
  return `Update ticket ${id} in Cyraops CRM: ${what}.`;
}

/**
 * The tools/pre-execute listener: returns the `ask` gate for the write tool
 * and delegates every other tool unchanged. The gate is permission-mode aware
 * through DSH_PERMISSION_MODE (set per turn by the AgentRuntime under its
 * global mutex, or per spawn for the CLI runtime):
 * - "read-only"          → deny the write outright (workspace is READ_ONLY)
 * - "danger-full-access" → no ask (FULL_CONTROL/SYSTEM: the caller already
 *                          role-gated the turn, so the write runs and the
 *                          audit trail records it)
 * - anything else        → the historical ask gate (CONTROLLED)
 * Pure and exported so the unit test exercises the exact decision shape the
 * pipeline consumes.
 */
export function updateTicketAskGate(toolName = TOOL_UPDATE_TICKET) {
  return async function toolsPreExecute(exec, next) {
    if (exec?.name !== toolName) return next();
    const summary = updateTicketSummary(exec.arguments);
    const permissionMode = process.env.DSH_PERMISSION_MODE;
    if (permissionMode === "read-only") {
      const reason = `This workspace is in READ_ONLY permission mode, so ${toolName} cannot run.`;
      return { kind: "deny", reason, displayReason: { en: reason } };
    }
    if (permissionMode === "danger-full-access") {
      // FULL_CONTROL/SYSTEM: the route already downgraded non-owner callers,
      // so a turn that reaches this preset is an owner's auto-approved write.
      return next();
    }
    return { kind: "ask", reason: summary, displayReason: { en: summary } };
  };
}

/**
 * The approval/request answerer: claims approval requests for the write tool
 * and resolves them through the Next-side broker (published on globalThis in
 * the native runtime process). No broker (CLI runtime, plain-node tests) or
 * another tool's request delegates via next() — the service then fails closed
 * ("unavailable"), which the pipeline maps to a denial.
 *
 * `lookupBroker` is a test seam defaulting to the globalThis lookup, so the
 * answerer is unit-testable without a broker installed.
 */
export function createApprovalAnswerer({
  toolName = TOOL_UPDATE_TICKET,
  lookupBroker = () => globalThis?.[APPROVAL_BROKER_KEY],
} = {}) {
  return async function approvalRequest(req, next) {
    if (req?.toolName !== toolName) return next();
    const broker = lookupBroker();
    if (!broker || typeof broker.request !== "function") return next();
    const pending = broker.request({
      toolName: req.toolName,
      callId: typeof req.callId === "string" ? req.callId : undefined,
      reason: typeof req.reason === "string" ? req.reason : undefined,
      summary: typeof req.reason === "string" && req.reason ? req.reason : updateTicketSummary({}),
    });
    const onAbort = () => broker.cancel?.(pending.approvalId);
    req.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await pending.decision;
    } finally {
      req.signal?.removeEventListener("abort", onAbort);
    }
  };
}

// ---------------------------------------------------------------------------
// ask_user_question — the model-facing user-question tool (TASK 1: ask-user).
//
// The vendored tree mounts the `user-questions` service seam
// (dsh-user-questions, see dsh-base/cordis.patch.yml "user-questions"), but
// the official model-facing tool package (@deepseek-ai/dsh-tool-ask-user) is
// declared in vendor/dsh/package.json WITHOUT being installed under
// vendor/dsh/node_modules, and the boot profile bundles only dsh-base,
// dsh-headless and this plugin — so no ask_user_question tool is registered
// by the native boot. This plugin therefore registers the tool itself,
// mirroring the official package's timed variant exactly: the schema declares
// the `timeout` parameter (the vendored projection's TIMED_WAIT_PARAMETER
// marks the call timed), execute asks the userQuestions service (timed wait
// via askTimed; `timeout: -1` falls back to the blocking ask), and the
// answerer below bridges the service's `user-questions/request` waterfall to
// the Next-side question broker, which /api/harness/answer resolves.
// ---------------------------------------------------------------------------

/**
 * The model-facing parameter only the timed schema declares. Loaded from the
 * vendored service module so it can never drift; "timeout" is the fallback.
 */
export function timedWaitParameter() {
  try {
    return loadVendoredModule("@deepseek-ai/dsh-user-questions")?.TIMED_WAIT_PARAMETER ?? "timeout";
  } catch {
    return "timeout";
  }
}

export const ASK_USER_DEFAULT_TIMEOUT = 120; // seconds, same as the official tool
export const ASK_USER_MAX_TIMEOUT = 2_147_483; // platform timer ceiling (seconds)

/** Validate the model-supplied wait; -1 or a positive integer up to the ceiling. */
export function validateAskUserTimeout(timeout) {
  if (timeout !== -1 && (!Number.isInteger(timeout) || timeout < 1 || timeout > ASK_USER_MAX_TIMEOUT)) {
    throw new Error(`timeout must be -1 or a positive integer up to ${ASK_USER_MAX_TIMEOUT} seconds`);
  }
  return timeout;
}

/** Question ids must be unique within one call (same rule as the official tool). */
export function validateQuestionIds(questions) {
  const ids = new Set();
  for (const question of questions) {
    if (ids.has(question.id)) throw new Error(`question id ${JSON.stringify(question.id)} must be unique within this call`);
    ids.add(question.id);
  }
}

/**
 * Translate the model schema into the service request without changing
 * ownership (mirrors the official tool's questionRequest).
 */
export function questionServiceRequest(questions, exec) {
  return {
    questions: questions.map((question) => ({
      id: question.id,
      question: question.question,
      ...(question.header !== undefined ? { header: question.header } : {}),
      ...(question.options !== undefined ? { options: question.options.map((option) => ({ ...option })) } : {}),
      ...(question.multi_select !== undefined ? { multiSelect: question.multi_select } : {}),
    })),
    ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
    signal: exec.signal,
  };
}

/**
 * Copy service-owned answer arrays into the model-facing result (mirrors the
 * official tool's answerResult).
 */
export function answerResultFor(result) {
  return {
    answers: result.answers.map((answer) => ({
      id: answer.id,
      selected: [...answer.selected],
      ...(answer.custom !== undefined ? { custom: answer.custom } : {}),
    })),
  };
}

/**
 * The model-facing ask_user_question tool. Test seams: `defineTool`,
 * `askTimed`, `ask` and `ctx` can all be stubbed, so the definition is
 * exercisable in plain Node without booting a tree.
 */
export function createAskUserQuestionDefinition(deps = {}) {
  const defineTool = deps.defineTool ?? loadDefineTool();
  const defaultTimeout = validateAskUserTimeout(deps.defaultTimeout ?? ASK_USER_DEFAULT_TIMEOUT);
  const timeoutParam = deps.timeoutParam ?? timedWaitParameter();
  const ctx = deps.ctx;
  const askTimed = deps.askTimed ?? ((request, callId, timeoutMs) => {
    if (!ctx || typeof ctx.userQuestions?.askTimed !== "function") {
      throw new Error("ask_user_question requires the userQuestions service (not mounted)");
    }
    return ctx.userQuestions.askTimed(request, callId, timeoutMs);
  });
  const ask = deps.ask ?? ((request) => {
    if (!ctx || typeof ctx.userQuestions?.ask !== "function") {
      throw new Error("ask_user_question requires the userQuestions service (not mounted)");
    }
    return ctx.userQuestions.ask(request);
  });

  return defineTool({
    name: TOOL_ASK_USER_QUESTION,
    description:
      "Ask brief, direct, self-contained questions about missing information, preferences, or decisions. " +
      "Use user-facing terms; assume no knowledge of background work or internal names. Use distinct stable question IDs. " +
      "An answer item with empty selected and no custom means the user skipped that question: continue without it, " +
      "do not ask it again, and do not treat the skip as permission. A pending result instead means no answer batch " +
      "arrived before the timeout and the user can still answer.",
    parameters: {
      questions: {
        type: "array",
        required: true,
        description: "Questions to ask the user.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string", required: true, description: "Stable id for this question; echoed in the answer." },
            question: { type: "string", required: true, description: "The specific question to ask the user." },
            header: { type: "string", description: "Optional short heading for the question, such as \"Confirm\" or \"Choose Mode\"." },
            options: {
              type: "array",
              description: "Optional choices to show the user. If you recommend one, put it first and append \"(Recommended)\" to that label.",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string", required: true, description: "Short user-facing option label." },
                  description: { type: "string", description: "One sentence explaining the tradeoff or impact." },
                },
              },
            },
            multi_select: { type: "boolean", description: "Whether the user may select more than one option. Defaults to false." },
          },
        },
      },
      [timeoutParam]: {
        type: "integer",
        description: `Wait seconds for the entire batch (default ${defaultTimeout}); omit unless the user specifies a duration. Use -1 only when an answer is required before proceeding.`,
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              pending: { type: "boolean", enum: [true], required: true, description: "True when the foreground wait expired before the user submitted an answer batch. The questions remain answerable; this is not a skipped answer." },
              callId: { type: "string", required: true, description: "Tool call whose unanswered questions remain pending." },
              message: { type: "string", required: true, description: "How to continue while the questions stay answerable." },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              answers: {
                type: "array",
                required: true,
                description: "Submitted answer batch with one item per question. A skipped question has empty selected and no custom; unlike pending, the user has completed the batch.",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string", required: true, description: "Stable question id echoed from the request." },
                    selected: { type: "array", required: true, items: { type: "string" }, description: "Selected option labels. Empty with no custom means the user explicitly skipped this question." },
                    custom: { type: "string", description: "Optional free-form answer; omitted for a skipped question." },
                  },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const timeout = validateAskUserTimeout(args[timeoutParam] ?? defaultTimeout);
      validateQuestionIds(args.questions);
      const request = questionServiceRequest(args.questions, exec);
      if (timeout !== -1) {
        if (exec.agent === undefined) throw new Error("timed questions require a live agent");
        const result = await askTimed({ ...request, agent: exec.agent }, exec.callId, timeout * 1e3);
        return "pending" in result
          ? {
              ...result,
              message:
                "No answer batch arrived before the timeout. This is pending, not a skipped answer. " +
                "Continue useful independent work. The user can still answer; their reply will be a user message " +
                "identified as answer_to_pending_question with this callId and the original questions. " +
                "Do not treat this as permission.",
            }
          : answerResultFor(result);
      }
      return answerResultFor(await ask({ ...request, wait: { callId: exec.callId } }));
    },
  });
}

/**
 * The user-questions/request answerer: claims ask_user_question batches and
 * resolves them through the Next-side question broker (published on
 * globalThis in the native runtime process). No broker (CLI runtime,
 * plain-node tests) delegates via next() — the service then fails closed
 * (NO_PROVIDER), which the timed tool maps to a pending result instead of a
 * hang. The returned batch is the exact AskUserQuestionAnswer shape the
 * service returns to the tool.
 *
 * `lookupBroker` is a test seam defaulting to the globalThis lookup.
 */
export function createUserQuestionAnswerer({
  lookupBroker = () => globalThis?.[QUESTION_BROKER_KEY],
} = {}) {
  return async function userQuestionsRequest(req, next) {
    if (!req || !Array.isArray(req.questions) || req.questions.length === 0) return next();
    const broker = lookupBroker();
    if (!broker || typeof broker.request !== "function") return next();
    const pending = broker.request({
      // TASK (Tier-2 plan preview): preserve the full review surface. The
      // harness plan-mode service sends exit_plan_mode reviews through this
      // same waterfall with detail (the plan markdown), options
      // (Approve / Keep planning) and an intent of kind "plan-review"; the
      // plain ask_user_question batches have none of them. Everything is
      // optional, so ordinary questions keep their exact previous shape.
      questions: req.questions.map((question) => ({
        id: question.id,
        question: question.question,
        ...(typeof question.header === "string" ? { header: question.header } : {}),
        ...(typeof question.detail === "string" ? { detail: question.detail } : {}),
        ...(Array.isArray(question.options)
          ? {
              options: question.options
                .filter((option) => option && typeof option === "object")
                .map((option) => ({
                  ...(typeof option.label === "string" ? { label: option.label } : {}),
                  ...(typeof option.description === "string" ? { description: option.description } : {}),
                })),
            }
          : {}),
        ...(question.intent && typeof question.intent === "object" ? { intent: question.intent } : {}),
      })),
      ...(req.wait?.callId !== undefined ? { callId: req.wait.callId } : {}),
      signal: req.signal,
    });
    const onAbort = () => pending.cancel();
    req.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await pending.decision;
    } finally {
      req.signal?.removeEventListener("abort", onAbort);
    }
  };
}

function apply(ctx) {
  for (const definition of toolDefinitions()) {
    ctx.tools.register(definition);
    // One-line boot evidence of the model-facing registry: registered tool
    // names appear on the native host's stderr during tree mount.
    process.stderr.write(`[cyraops-crm] registered tool: ${definition.name}\n`);
  }
  ctx.tools.register(createAskUserQuestionDefinition({ ctx }));
  process.stderr.write(`[cyraops-crm] registered tool: ${TOOL_ASK_USER_QUESTION}\n`);
  // Approval wiring: the ask gate for the write tool (tools/pre-execute) and
  // the answerer that bridges decisions to the Next-side broker
  // (approval/request). Both are no-ops for tools they do not own.
  ctx.on("tools/pre-execute", updateTicketAskGate());
  ctx.on("approval/request", createApprovalAnswerer());
  // Ask-user wiring: the answerer that bridges question batches to the
  // Next-side question broker (user-questions/request), resolved by
  // /api/harness/answer. A missing broker delegates and the service fails
  // closed; with the broker, the user's typed answer becomes the tool result.
  ctx.on("user-questions/request", createUserQuestionAnswerer());
  process.stderr.write("[cyraops-crm] approval + ask-user wiring installed (ask gate + broker answerers)\n");
}

export { apply };
