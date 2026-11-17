import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEventQueue,
  createRuntime,
  HarnessRunError,
  requestedRuntimeKind,
  runtimeFactory,
  vendoredTreePresent,
} from "./runtime";
import type { HarnessSessionStore } from "./store";

/** In-memory store with the same contract as the Prisma-backed one. */
function memoryStore(): HarnessSessionStore {
  const map = new Map<string, string>();
  const key = (tenantId: string, conversationId: string) => `${tenantId}\u0000${conversationId}`;
  return {
    async loadHarnessSessionId({ tenantId, conversationId }) {
      return map.get(key(tenantId, conversationId)) ?? null;
    },
    async saveHarnessSessionId({ tenantId, conversationId, harnessSessionId }) {
      map.set(key(tenantId, conversationId), harnessSessionId);
    },
    async clearHarnessSessionId({ tenantId, conversationId }) {
      map.delete(key(tenantId, conversationId));
    },
  };
}

/** Collect every event an AsyncIterable yields, surfacing failures. */
async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

/** Next's type augmentation requires NODE_ENV on ProcessEnv. */
function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides };
}

test("requestedRuntimeKind: cli is the default, native/none are honoured, unknown values stay safe", () => {
  assert.equal(requestedRuntimeKind(testEnv()), "cli");
  assert.equal(requestedRuntimeKind(testEnv({ HARNESS_RUNTIME: "cli" })), "cli");
  assert.equal(requestedRuntimeKind(testEnv({ HARNESS_RUNTIME: "native" })), "native");
  assert.equal(requestedRuntimeKind(testEnv({ HARNESS_RUNTIME: "  NATIVE " })), "native");
  assert.equal(requestedRuntimeKind(testEnv({ HARNESS_RUNTIME: "none" })), "none");
  assert.equal(requestedRuntimeKind(testEnv({ HARNESS_RUNTIME: "bogus" })), "cli");
});

test("vendoredTreePresent: checks the anchor and the host launcher", () => {
  assert.equal(vendoredTreePresent("/definitely/not/a/checkout"), false);
  // The repo checkout carries the vendored tree; tests run from the repo root.
  assert.equal(vendoredTreePresent(process.cwd()), true);
});

test("runtimeFactory defaults to the CLI runtime", async () => {
  const runtime = runtimeFactory(testEnv());
  const health = await runtime.healthCheck();
  assert.equal(health.kind, "cli");
  assert.equal(health.reason, undefined);
});

test("runtimeFactory selects the native runtime when the vendored tree exists", async () => {
  const runtime = runtimeFactory(testEnv({ HARNESS_RUNTIME: "native" }));
  const health = await runtime.healthCheck();
  assert.equal(health.kind, "native");
  assert.equal(health.available, true);
});

test("native falls back to the CLI runtime when the tree is missing, with the reason in healthCheck", async () => {
  const runtime = createRuntime("native", "/definitely/not/a/checkout", memoryStore());
  const health = await runtime.healthCheck();
  assert.equal(health.kind, "cli");
  assert.match(health.reason ?? "", /falling back to the CLI runtime/);
  // And the fallback runtime still works as a CLI runtime.
  const session = await runtime.createSession({ tenantId: "t", conversationId: "c" });
  assert.equal(session.harnessSessionId, null);
  assert.equal(await runtime.getSession(session.id), session);
});

test("HARNESS_RUNTIME=none reports a disabled runtime and refuses turns", async () => {
  const runtime = createRuntime("none", process.cwd(), memoryStore());
  const health = await runtime.healthCheck();
  assert.deepEqual(health, { available: false, kind: "none" });
  const session = await runtime.createSession({ tenantId: "t", conversationId: "c" });
  await assert.rejects(
    () => collect(runtime.executeTurn({ sessionId: session.id, task: "hello" })),
    /disabled/
  );
});

test("cli runtime: session lifecycle, store resume, unknown session", async () => {
  const store = memoryStore();
  await store.saveHarnessSessionId({ tenantId: "t1", conversationId: "conv-1", harnessSessionId: "hs-9" });

  const runtime = createRuntime("cli", process.cwd(), store);
  const fresh = await runtime.createSession({ tenantId: "t1", conversationId: "conv-2" });
  assert.equal(fresh.harnessSessionId, null); // harness assigns on the first turn
  assert.equal(await runtime.getSession(fresh.id), fresh);

  const resumed = await runtime.createSession({ tenantId: "t1", conversationId: "conv-1" });
  assert.equal(resumed.harnessSessionId, "hs-9"); // persisted id survives across sessions

  await runtime.cancelTurn({ sessionId: fresh.id }); // no-op without an in-flight turn
  await runtime.closeSession(fresh.id);
  assert.equal(await runtime.getSession(fresh.id), null);

  await assert.rejects(
    () => collect(runtime.executeTurn({ sessionId: "missing", task: "hello" })),
    /unknown harness session/
  );
});

test("native runtime: session lifecycle and health without spawning", async () => {
  const runtime = createRuntime("native", process.cwd(), memoryStore());
  const session = await runtime.createSession({ tenantId: "t1", conversationId: "conv-1" });
  assert.equal(session.harnessSessionId, null);
  assert.equal(await runtime.getSession(session.id), session);
  await runtime.cancelTurn({ sessionId: session.id });
  await runtime.closeSession(session.id);
  assert.equal(await runtime.getSession(session.id), null);
  await assert.rejects(
    () => collect(runtime.executeTurn({ sessionId: "missing", task: "hello" })),
    /unknown harness session/
  );
});

test("createEventQueue: streams pushes in order and ends on close", async () => {
  const queue = createEventQueue<number>();
  const received: number[] = [];
  const draining = (async () => {
    for await (const value of queue) received.push(value);
  })();
  queue.push(1);
  queue.push(2);
  await new Promise((resolve) => setTimeout(resolve, 10));
  queue.push(3);
  queue.close();
  queue.push(4); // after close: ignored
  await draining;
  assert.deepEqual(received, [1, 2, 3]);
});

test("HarnessRunError carries engine diagnostics", () => {
  const error = new HarnessRunError("boom", { code: 1, stderr: "dsh: kaboom", timedOut: false });
  assert.equal(error.name, "HarnessRunError");
  assert.equal(error.details.code, 1);
  assert.equal(error.details.stderr, "dsh: kaboom");
  assert.equal(error.details.timedOut, false);
});
