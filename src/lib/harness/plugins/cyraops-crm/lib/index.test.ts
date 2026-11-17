/**
 * Unit tests for @cyraops/harness-crm (Phase 4 v1).
 *
 * The tool's `execute` is exercised with a STUBBED db bridge: the exported
 * `createToolDefinition({ runQuery })` seam replaces the real Prisma query
 * (`queryOpenTickets`) with an in-memory fake, so these tests never touch a
 * database. `defineTool` is the real one, loaded lazily from the vendored
 * tree via the plugin's own createRequire anchor (vendor/dsh/package.json) —
 * the same lazy load the harness uses, which is why this module is testable
 * in plain Node without the harness loader.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cyraopsRoot,
  normalizeLimit,
  openTickets,
  OPEN_STATUSES,
  OPEN_WHERE,
  createRootRequire,
  loadPrismaClient,
} from "./bridge.mjs";
import { createToolDefinition, TOOL_NAME } from "./index.js";

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
