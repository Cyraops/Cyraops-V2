/**
 * Unit tests for @cyraops/harness-crm (Phase 4 v1 + v2).
 *
 * The tools' `execute` is exercised with a STUBBED db bridge: the exported
 * `createToolDefinition({ runQuery })` / `createListTicketsDefinition({ runQuery })`
 * / `createSearchContactsDefinition({ runQuery })` /
 * `createListScheduleDefinition({ runQuery })` seams replace the real Prisma
 * queries with an in-memory fake, so these tests never touch a database.
 * `defineTool` is the real one, loaded lazily from the vendored tree via the
 * plugin's own createRequire anchor (vendor/dsh/package.json) — the same lazy
 * load the harness uses, which is why this module is testable in plain Node
 * without the harness loader.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cyraopsRoot,
  normalizeLimit,
  normalizeBoundedLimit,
  normalizeDays,
  normalizeOptionalQuery,
  normalizeRequiredQuery,
  openTickets,
  listTickets,
  searchContacts,
  scheduleEvents,
  OPEN_STATUSES,
  OPEN_WHERE,
  ALL_STATUSES,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  SCHEDULE_DAYS_DEFAULT,
  SCHEDULE_DAYS_MAX,
  createRootRequire,
  loadPrismaClient,
} from "./bridge.mjs";
import {
  createToolDefinition,
  createListTicketsDefinition,
  createSearchContactsDefinition,
  createListScheduleDefinition,
  toolDefinitions,
  TOOL_NAME,
  TOOL_LIST_TICKETS,
  TOOL_SEARCH_CONTACTS,
  TOOL_LIST_SCHEDULE,
} from "./index.js";

/** A findMany-capable stub with the shape the bridge uses. */
function stubPrisma(rows: Array<{ status: string }>) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    task: {
      async findMany(args: Record<string, unknown>) {
        calls.push(args);
        const take = typeof args.take === "number" ? args.take : rows.length;
        return rows.slice(0, take);
      },
    },
  };
}

test("bridge: OPEN_STATUSES is the four non-DONE task statuses", () => {
  assert.deepEqual([...OPEN_STATUSES], ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"]);
});

test("bridge: OPEN_WHERE filters archivedAt null and the open statuses", () => {
  assert.deepEqual(OPEN_WHERE, {
    archivedAt: null,
    status: { in: ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"] },
  });
});

test("bridge: openTickets aggregates count and per-status breakdown", async () => {
  const prisma = stubPrisma([
    { status: "TODO" },
    { status: "IN_PROGRESS" },
    { status: "TODO" },
    { status: "IN_REVIEW" },
  ]);
  const result = await openTickets(prisma, {});
  assert.deepEqual(result, { count: 4, statuses: { TODO: 2, IN_PROGRESS: 1, IN_REVIEW: 1 } });
  assert.deepEqual(prisma.calls[0]?.where, OPEN_WHERE);
  assert.equal(prisma.calls[0]?.take, undefined);
});

test("bridge: openTickets with limit caps count and breakdown", async () => {
  const prisma = stubPrisma([{ status: "TODO" }, { status: "IN_PROGRESS" }, { status: "TODO" }]);
  const result = await openTickets(prisma, { limit: 2 });
  assert.deepEqual(result, { count: 2, statuses: { TODO: 1, IN_PROGRESS: 1 } });
  assert.equal(prisma.calls[0]?.take, 2);
});

test("bridge: openTickets on an empty table returns zero with empty statuses", async () => {
  const prisma = stubPrisma([]);
  const result = await openTickets(prisma, {});
  assert.deepEqual(result, { count: 0, statuses: {} });
});

test("bridge: normalizeLimit accepts positive integers and omits undefined", () => {
  assert.equal(normalizeLimit(undefined), undefined);
  assert.equal(normalizeLimit(null), undefined);
  assert.equal(normalizeLimit(1), 1);
  assert.equal(normalizeLimit(250), 250);
  for (const bad of [0, -1, 1.5, "3", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => normalizeLimit(bad), /limit must be a positive integer/);
  }
});

test("bridge: cyraopsRoot falls back to the process cwd", () => {
  assert.equal(cyraopsRoot(process.cwd(), {}), process.cwd());
});

test("bridge: cyraopsRoot prefers CYRAOPS_ROOT and rejects roots without package.json", () => {
  assert.equal(cyraopsRoot("/somewhere/else", { CYRAOPS_ROOT: process.cwd() }), process.cwd());
  assert.throws(
    () => cyraopsRoot("/definitely/not/a/real/root", {}),
    /cannot locate the Cyraops application root/
  );
});

test("bridge: the root require resolves @prisma/client from the V2 root node_modules", () => {
  const rootRequire = createRootRequire(process.cwd());
  const PrismaClient = loadPrismaClient(rootRequire);
  assert.equal(typeof PrismaClient, "function");
});

test("tool: definition declares the exact name, description and parameter schema", () => {
  const definition = createToolDefinition({ runQuery: async () => ({ count: 0, statuses: {} }) });
  assert.equal(definition.name, TOOL_NAME);
  assert.match(definition.description, /Count the open tickets in the Cyraops CRM database/);
  // defineTool compiles `parameters` to an implicit object-rooted JSON Schema.
  assert.equal(definition.parameters.type, "object");
  assert.equal(definition.parameters.properties.limit.type, "integer");
  assert.ok(!definition.parameters.required?.includes("limit"));
  // and `output.schema` to raw JSON Schema with a `required` list.
  assert.equal(definition.output.schema.type, "object");
  assert.equal(definition.output.schema.properties.count.type, "integer");
  assert.equal(definition.output.schema.properties.statuses.type, "object");
  assert.deepEqual(definition.output.schema.required, ["count", "statuses"]);
});

test("tool: execute returns the stubbed bridge value unchanged", async () => {
  const expected = { count: 7, statuses: { TODO: 4, IN_PROGRESS: 3 } };
  const received: Array<{ limit?: number }> = [];
  const definition = createToolDefinition({
    runQuery: async (args: { limit?: number }) => {
      received.push(args);
      return expected;
    },
  });
  const result = await definition.execute({ limit: 5 }, {} as never);
  assert.deepEqual(result, expected);
  assert.deepEqual(received, [{ limit: 5 }]);
});

test("tool: execute with no arguments queries without a limit", async () => {
  const received: Array<{ limit?: number }> = [];
  const definition = createToolDefinition({
    runQuery: async (args: { limit?: number }) => {
      received.push(args);
      return { count: 0, statuses: {} };
    },
  });
  const result = await definition.execute({}, {} as never);
  assert.deepEqual(result, { count: 0, statuses: {} });
  assert.deepEqual(received, [{ limit: undefined }]);
});

test("tool: execute rejects an invalid limit before touching the bridge", async () => {
  const definition = createToolDefinition({
    runQuery: async () => {
      throw new Error("bridge must not be reached");
    },
  });
  await assert.rejects(() => definition.execute({ limit: 0 }, {} as never), /limit must be a positive integer/);
});

test("tool: output render turns the canonical value into JSON text content", () => {
  const definition = createToolDefinition({ runQuery: async () => ({ count: 0, statuses: {} }) });
  const rendered = definition.output.render({}, { count: 2, statuses: { TODO: 2 } });
  assert.deepEqual(rendered, [{ type: "text", text: '{"count":2,"statuses":{"TODO":2}}' }]);
});

// ---------------------------------------------------------------------------
// Phase 4 v2: the three additional read-only tools.
// ---------------------------------------------------------------------------

/** A task-capable client stub returning pre-shaped findMany rows. */
function stubTaskClient(rows: Array<Record<string, unknown>>) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    task: {
      async findMany(args: Record<string, unknown>) {
        calls.push(args);
        const take = typeof args.take === "number" ? args.take : rows.length;
        return rows.slice(0, take);
      },
    },
  };
}

/** A contact-capable client stub returning pre-shaped findMany rows. */
function stubContactClient(rows: Array<Record<string, unknown>>) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    contact: {
      async findMany(args: Record<string, unknown>) {
        calls.push(args);
        const take = typeof args.take === "number" ? args.take : rows.length;
        return rows.slice(0, take);
      },
    },
  };
}

/** A calendar-capable client stub returning pre-shaped findMany rows. */
function stubCalendarClient(rows: Array<Record<string, unknown>>) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    calendarEvent: {
      async findMany(args: Record<string, unknown>) {
        calls.push(args);
        const take = typeof args.take === "number" ? args.take : rows.length;
        return rows.slice(0, take);
      },
    },
  };
}

test("bridge: ALL_STATUSES is the five task statuses", () => {
  assert.deepEqual([...ALL_STATUSES], ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
});

test("bridge: listTickets returns count and shaped tickets with the default open filter", async () => {
  const prisma = stubTaskClient([
    { id: "t1", title: "Fix login", status: "TODO", priority: "HIGH", assignee: { name: "Tanveer Saini" } },
    { id: "t2", title: "Backfill invoices", status: "DONE", priority: "LOW", assignee: null },
  ]);
  const result = await listTickets(prisma, {});
  assert.deepEqual(result, {
    count: 2,
    tickets: [
      { id: "t1", title: "Fix login", status: "TODO", priority: "HIGH", assignee: "Tanveer Saini" },
      { id: "t2", title: "Backfill invoices", status: "DONE", priority: "LOW", assignee: null },
    ],
  });
  const where = prisma.calls[0]?.where as Record<string, unknown>;
  assert.equal(where.archivedAt, null);
  assert.deepEqual(where.AND, [{ status: { in: [...OPEN_STATUSES] } }]);
  assert.equal(prisma.calls[0]?.take, LIST_LIMIT_DEFAULT);
  assert.equal(prisma.calls[0]?.select !== undefined, true);
});

test("bridge: listTickets applies a single-status filter and a query search", async () => {
  const prisma = stubTaskClient([]);
  await listTickets(prisma, { status: "DONE", query: "  Billing  " });
  const where = prisma.calls[0]?.where as Record<string, unknown>;
  assert.deepEqual(where.AND, [
    { status: "DONE" },
    {
      OR: [
        { title: { contains: "Billing", mode: "insensitive" } },
        { description: { contains: "Billing", mode: "insensitive" } },
      ],
    },
  ]);
});

test("bridge: listTickets rejects an unknown status before querying", async () => {
  const prisma = stubTaskClient([]);
  await assert.rejects(() => listTickets(prisma, { status: "NOPE" }), /status must be one of/);
  assert.equal(prisma.calls.length, 0);
});

test("bridge: listTickets enforces the bounded limit", async () => {
  const prisma = stubTaskClient([]);
  await assert.rejects(() => listTickets(prisma, { limit: 26 }), /limit must be an integer between 1 and 25/);
  await assert.rejects(() => listTickets(prisma, { limit: 0 }), /limit must be an integer between 1 and 25/);
  await listTickets(prisma, { limit: LIST_LIMIT_MAX });
  assert.equal(prisma.calls[0]?.take, LIST_LIMIT_MAX);
});

test("bridge: searchContacts requires a non-empty query", async () => {
  const prisma = stubContactClient([]);
  await assert.rejects(() => searchContacts(prisma, {}), /query must be a non-empty string/);
  await assert.rejects(() => searchContacts(prisma, { query: "   " }), /query must be a non-empty string/);
  assert.equal(prisma.calls.length, 0);
});

test("bridge: searchContacts maps name/email/company and searches all three fields", async () => {
  const prisma = stubContactClient([
    { id: "c1", firstName: "Priya", lastName: "Sharma", email: "priya@northwind.example", company: { name: "Northwind Labs" } },
    { id: "c2", firstName: "Marco", lastName: "Rossi", email: null, company: null },
  ]);
  const result = await searchContacts(prisma, { query: "  priya  " });
  assert.deepEqual(result, {
    count: 2,
    contacts: [
      { id: "c1", name: "Priya Sharma", email: "priya@northwind.example", company: "Northwind Labs" },
      { id: "c2", name: "Marco Rossi", email: null, company: null },
    ],
  });
  const where = prisma.calls[0]?.where as Record<string, unknown>;
  assert.equal(where.archivedAt, null);
  assert.deepEqual(where.AND, [
    {
      OR: [
        { firstName: { contains: "priya", mode: "insensitive" } },
        { lastName: { contains: "priya", mode: "insensitive" } },
        { email: { contains: "priya", mode: "insensitive" } },
      ],
    },
  ]);
  assert.equal(prisma.calls[0]?.take, LIST_LIMIT_DEFAULT);
});

test("bridge: searchContacts matches a multi-word query across name fields", async () => {
  const prisma = stubContactClient([]);
  await searchContacts(prisma, { query: "Priya Sharma" });
  const where = prisma.calls[0]?.where as Record<string, unknown>;
  const and = where.AND as Array<{ OR: Array<Record<string, unknown>> }>;
  assert.equal(and.length, 2);
  assert.deepEqual(and[0]?.OR[0], { firstName: { contains: "Priya", mode: "insensitive" } });
  assert.deepEqual(and[1]?.OR[1], { lastName: { contains: "Sharma", mode: "insensitive" } });
});

test("bridge: searchContacts enforces the bounded limit", async () => {
  const prisma = stubContactClient([]);
  await assert.rejects(() => searchContacts(prisma, { query: "x", limit: 26 }), /limit must be an integer between 1 and 25/);
  await searchContacts(prisma, { query: "x", limit: LIST_LIMIT_MAX });
  assert.equal(prisma.calls[0]?.take, LIST_LIMIT_MAX);
});

test("bridge: scheduleEvents lists upcoming events inside a days window", async () => {
  const prisma = stubCalendarClient([
    { id: "e1", title: "Kickoff", startsAt: new Date("2026-11-19T09:00:00Z"), endsAt: new Date("2026-11-19T10:00:00Z") },
  ]);
  const result = await scheduleEvents(prisma, { days: 2 });
  assert.deepEqual(result, {
    count: 1,
    events: [{ id: "e1", title: "Kickoff", start: "2026-11-19T09:00:00.000Z", end: "2026-11-19T10:00:00.000Z" }],
  });
  const where = prisma.calls[0]?.where as Record<string, unknown>;
  assert.equal(where.archivedAt, null);
  const startsAt = where.startsAt as { gte: Date; lte: Date };
  const windowMs = startsAt.lte.getTime() - startsAt.gte.getTime();
  assert.ok(Math.abs(windowMs - 2 * 86_400_000) < 2_000, `window ${windowMs}ms is not ~2 days`);
});

test("bridge: scheduleEvents defaults to 7 days and validates the range", async () => {
  const prisma = stubCalendarClient([]);
  await scheduleEvents(prisma, {});
  const where = prisma.calls[0]?.where as Record<string, unknown>;
  const startsAt = where.startsAt as { gte: Date; lte: Date };
  const windowMs = startsAt.lte.getTime() - startsAt.gte.getTime();
  assert.ok(Math.abs(windowMs - 7 * 86_400_000) < 2_000, `window ${windowMs}ms is not ~7 days`);
  await assert.rejects(() => scheduleEvents(prisma, { days: 0 }), /days must be an integer between 1 and 30/);
  await assert.rejects(() => scheduleEvents(prisma, { days: 31 }), /days must be an integer between 1 and 30/);
});

test("bridge: normalizeBoundedLimit accepts 1..max and rejects everything else", () => {
  assert.equal(normalizeBoundedLimit(1, 25), 1);
  assert.equal(normalizeBoundedLimit(25, 25), 25);
  for (const bad of [0, 26, 1.5, "3", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => normalizeBoundedLimit(bad, 25), /limit must be an integer between 1 and 25/);
  }
});

test("bridge: normalizeDays defaults to 7 and enforces the 1..30 range", () => {
  assert.equal(normalizeDays(undefined), SCHEDULE_DAYS_DEFAULT);
  assert.equal(normalizeDays(null), SCHEDULE_DAYS_DEFAULT);
  assert.equal(normalizeDays(1), 1);
  assert.equal(normalizeDays(30), SCHEDULE_DAYS_MAX);
  for (const bad of [0, 31, 1.5, "7", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => normalizeDays(bad), /days must be an integer between 1 and 30/);
  }
});

test("bridge: query normalizers trim and validate free text", () => {
  assert.equal(normalizeOptionalQuery(undefined), undefined);
  assert.equal(normalizeOptionalQuery(null), undefined);
  assert.equal(normalizeOptionalQuery("  Billing  "), "Billing");
  assert.throws(() => normalizeOptionalQuery("   "), /query must be a non-empty string when provided/);
  assert.equal(normalizeRequiredQuery("  priya "), "priya");
  assert.throws(() => normalizeRequiredQuery(undefined), /query must be a non-empty string/);
  assert.throws(() => normalizeRequiredQuery(""), /query must be a non-empty string/);
});

test("tool: list_tickets definition declares the exact name, description and schemas", () => {
  const definition = createListTicketsDefinition({ runQuery: async () => ({ count: 0, tickets: [] }) });
  assert.equal(definition.name, TOOL_LIST_TICKETS);
  assert.match(definition.description, /List tickets in the Cyraops CRM database/);
  assert.equal(definition.timeoutMs, 15_000);
  assert.equal(definition.parameters.type, "object");
  assert.equal(definition.parameters.properties.status.type, "string");
  assert.equal(definition.parameters.properties.limit.type, "integer");
  assert.equal(definition.parameters.properties.query.type, "string");
  assert.ok(!definition.parameters.required?.includes("status"));
  assert.deepEqual(definition.output.schema.required, ["count", "tickets"]);
  const tickets = definition.output.schema.properties.tickets;
  assert.equal(tickets.type, "array");
  assert.equal(tickets.items.type, "object");
  assert.equal(tickets.items.properties.id.type, "string");
  assert.equal(tickets.items.properties.assignee.oneOf.length, 2);
  assert.deepEqual(tickets.items.required, ["id", "title", "status", "priority", "assignee"]);
});

test("tool: list_tickets execute passes normalized args and returns the bridge value", async () => {
  const expected = { count: 3, tickets: [] };
  const received: Array<Record<string, unknown>> = [];
  const definition = createListTicketsDefinition({
    runQuery: async (args: Record<string, unknown>) => {
      received.push(args);
      return expected;
    },
  });
  const result = await definition.execute({ status: "TODO", limit: 5, query: "  Billing " }, {} as never);
  assert.deepEqual(result, expected);
  assert.deepEqual(received, [{ status: "TODO", limit: 5, query: "Billing" }]);
});

test("tool: list_tickets execute defaults limit to 10 and rejects invalid args before the bridge", async () => {
  const received: Array<Record<string, unknown>> = [];
  const definition = createListTicketsDefinition({
    runQuery: async (args: Record<string, unknown>) => {
      received.push(args);
      return { count: 0, tickets: [] };
    },
  });
  await definition.execute({}, {} as never);
  assert.deepEqual(received, [{ status: undefined, limit: 10, query: undefined }]);
  await assert.rejects(
    () => definition.execute({ limit: 26 }, {} as never),
    /limit must be an integer between 1 and 25/
  );
  await assert.rejects(
    () => definition.execute({ query: "  " }, {} as never),
    /query must be a non-empty string when provided/
  );
});

test("tool: search_contacts definition declares the exact name, description and schemas", () => {
  const definition = createSearchContactsDefinition({ runQuery: async () => ({ count: 0, contacts: [] }) });
  assert.equal(definition.name, TOOL_SEARCH_CONTACTS);
  assert.match(definition.description, /Search contacts in the Cyraops CRM database/);
  assert.equal(definition.timeoutMs, 15_000);
  assert.deepEqual(definition.parameters.required, ["query"]);
  assert.equal(definition.parameters.properties.query.type, "string");
  assert.equal(definition.parameters.properties.limit.type, "integer");
  assert.deepEqual(definition.output.schema.required, ["count", "contacts"]);
  const contacts = definition.output.schema.properties.contacts;
  assert.equal(contacts.type, "array");
  assert.equal(contacts.items.properties.email.oneOf.length, 2);
  assert.equal(contacts.items.properties.company.oneOf.length, 2);
  assert.deepEqual(contacts.items.required, ["id", "name", "email", "company"]);
});

test("tool: search_contacts execute trims the query, defaults limit and rejects a missing query", async () => {
  const received: Array<Record<string, unknown>> = [];
  const definition = createSearchContactsDefinition({
    runQuery: async (args: Record<string, unknown>) => {
      received.push(args);
      return { count: 0, contacts: [] };
    },
  });
  await definition.execute({ query: "  Rossi " }, {} as never);
  assert.deepEqual(received, [{ query: "Rossi", limit: 10 }]);
  // A missing query is rejected by defineTool's argument validation before
  // the body runs; an empty/blank query is rejected by the body's normalizer.
  await assert.rejects(
    () => definition.execute({}, {} as never),
    /query must be a non-empty string|missing required property "query"/
  );
  await assert.rejects(
    () => definition.execute({ query: "   " }, {} as never),
    /query must be a non-empty string/
  );
});

test("tool: list_schedule definition declares the exact name, description and schemas", () => {
  const definition = createListScheduleDefinition({ runQuery: async () => ({ count: 0, events: [] }) });
  assert.equal(definition.name, TOOL_LIST_SCHEDULE);
  assert.match(definition.description, /List upcoming calendar events in Cyraops/);
  assert.equal(definition.timeoutMs, 15_000);
  assert.equal(definition.parameters.type, "object");
  assert.equal(definition.parameters.properties.days.type, "integer");
  assert.ok(!definition.parameters.required?.includes("days"));
  assert.deepEqual(definition.output.schema.required, ["count", "events"]);
  const events = definition.output.schema.properties.events;
  assert.equal(events.type, "array");
  assert.equal(events.items.properties.start.type, "string");
  assert.deepEqual(events.items.required, ["id", "title", "start", "end"]);
});

test("tool: list_schedule execute defaults days to 7 and rejects out-of-range days", async () => {
  const received: Array<Record<string, unknown>> = [];
  const definition = createListScheduleDefinition({
    runQuery: async (args: Record<string, unknown>) => {
      received.push(args);
      return { count: 0, events: [] };
    },
  });
  await definition.execute({}, {} as never);
  assert.deepEqual(received, [{ days: 7 }]);
  await definition.execute({ days: 30 }, {} as never);
  assert.deepEqual(received, [{ days: 7 }, { days: 30 }]);
  await assert.rejects(() => definition.execute({ days: 31 }, {} as never), /days must be an integer between 1 and 30/);
});

test("tool: output render turns the new canonical values into JSON text", () => {
  const definition = createListTicketsDefinition({ runQuery: async () => ({ count: 0, tickets: [] }) });
  const rendered = definition.output.render(
    {},
    { count: 1, tickets: [{ id: "t1", title: "A", status: "TODO", priority: "LOW", assignee: null }] }
  );
  assert.deepEqual(rendered, [
    { type: "text", text: '{"count":1,"tickets":[{"id":"t1","title":"A","status":"TODO","priority":"LOW","assignee":null}]}' },
  ]);
});

test("tool: toolDefinitions returns the four tools in stable registration order", () => {
  const definitions = toolDefinitions();
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    [TOOL_NAME, TOOL_LIST_TICKETS, TOOL_SEARCH_CONTACTS, TOOL_LIST_SCHEDULE]
  );
});
