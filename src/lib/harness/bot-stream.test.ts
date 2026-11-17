import assert from "node:assert/strict";
import { test } from "node:test";
import { streamHarnessTurn } from "./bot-stream";
import type { HarnessEvent } from "./client";
import type { AgentRuntime, RuntimeHealth, Session } from "./runtime";
import type { HarnessSessionStore } from "./store";

/** In-memory store with the same contract as the Prisma-backed one. */
function memoryStore(): HarnessSessionStore & { saveCount: number; saved: Array<{ conversationId: string; harnessSessionId: string }> } {
  const map = new Map<string, string>();
  const store = {
    saveCount: 0,
    saved: [] as Array<{ conversationId: string; harnessSessionId: string }>,
    key: (tenantId: string, conversationId: string) => `${tenantId}\u0000${conversationId}`,
    async loadHarnessSessionId({ tenantId, conversationId }: { tenantId: string; conversationId: string }) {
      return map.get(store.key(tenantId, conversationId)) ?? null;
    },
    async saveHarnessSessionId({ tenantId, conversationId, harnessSessionId }: { tenantId: string; conversationId: string; harnessSessionId: string }) {
      store.saveCount += 1;
      store.saved.push({ conversationId, harnessSessionId });
      map.set(store.key(tenantId, conversationId), harnessSessionId);
    },
    async clearHarnessSessionId({ tenantId, conversationId }: { tenantId: string; conversationId: string }) {
      map.delete(store.key(tenantId, conversationId));
    },
  };
  return store;
}

interface FakeRuntimeOptions {
  /** Events to yield; a { type: "session" } entry announces the session's own id. */
  events?: HarnessEvent[];
  /** Throw from executeTurn (after recording the turn) instead of yielding. */
  throwOnTurn?: boolean;
  kind?: RuntimeHealth["kind"];
}

/** Fake AgentRuntime: createSession resolves the stored id, like the real runtimes. */
function fakeRuntime(store: HarnessSessionStore, options: FakeRuntimeOptions = {}): AgentRuntime & {
  turns: Array<{ sessionId: string; harnessSessionId: string | null; task: string }>;
} {
  const sessions = new Map<string, Session>();
  let nextId = 0;
  const runtime = {
    turns: [] as Array<{ sessionId: string; harnessSessionId: string | null; task: string }>,
    async createSession({ tenantId, conversationId }: { tenantId: string; conversationId: string }) {
      const harnessSessionId = await store.loadHarnessSessionId({ tenantId, conversationId });
      const session: Session = { id: `adapter-${++nextId}`, tenantId, conversationId, harnessSessionId };
      sessions.set(session.id, session);
      return session;
    },
    async *executeTurn({ sessionId, task }: { sessionId: string; task: string }) {
      const session = sessions.get(sessionId);
      assert.ok(session, "fake runtime must receive a known session id");
      runtime.turns.push({ sessionId, harnessSessionId: session.harnessSessionId, task });
      if (options.throwOnTurn) throw new Error("engine exploded");
      for (const event of options.events ?? []) {
        if (event.type === "session") {
          // Announce whichever id the session carries: fresh on turn one,
          // the stored id once the store has one — exactly like the harness.
          yield { ...event, sessionId: session.harnessSessionId ?? "hs-fresh" };
        } else {
          yield event;
        }
      }
    },
    async getSession(sessionId: string) {
      return sessions.get(sessionId) ?? null;
    },
    async cancelTurn() {},
    async closeSession(sessionId: string) {
      sessions.delete(sessionId);
    },
    async healthCheck(): Promise<RuntimeHealth> {
      return { available: true, kind: options.kind ?? "cli" };
    },
  };
  return runtime;
}

test("streamHarnessTurn: streams text deltas, captures the final text, persists the announced session id", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" }, // announces "hs-fresh" (no stored id yet)
      { type: "text", text: "Hello" },
      { type: "text", text: "Hello, world" }, // cumulative snapshot: only the delta is forwarded
      { type: "final", text: "Hello, world" },
    ],
  });

  const chunks: string[] = [];
  let doneCount = 0;
  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-1",
    tenantId: "tenant-1",
    task: "say hello",
    onText: (chunk) => chunks.push(chunk),
    onDone: () => {
      doneCount += 1;
    },
    store,
  });

  assert.deepEqual(chunks, ["Hello", ", world"]);
  assert.equal(result.text, "Hello, world");
  assert.equal(result.sessionId, "hs-fresh");
  assert.equal(result.runtimeKind, "cli");
  assert.equal(doneCount, 1, "onDone must fire exactly once on success");
  assert.equal(store.saveCount, 1);
  assert.deepEqual(store.saved, [{ conversationId: "conv-1", harnessSessionId: "hs-fresh" }]);
  // The turn ran against an adapter session created for this conversation.
  assert.equal(runtime.turns.length, 1);
  assert.equal(runtime.turns[0].task, "say hello");
  assert.equal(runtime.turns[0].harnessSessionId, null);
});

test("streamHarnessTurn: the second turn resumes the stored id and never saves twice", async () => {
  const store = memoryStore();
  await store.saveHarnessSessionId({ tenantId: "tenant-1", conversationId: "conv-1", harnessSessionId: "hs-stored" });

  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" }, // announces the resumed id ("hs-stored")
      { type: "text", text: "again" },
      { type: "final", text: "again" },
    ],
  });

  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-1",
    tenantId: "tenant-1",
    task: "once more",
    onText: () => {},
    onDone: () => {},
    store,
  });

  // The turn resumed the id the first turn persisted: no extra save happened.
  assert.equal(runtime.turns[0].harnessSessionId, "hs-stored");
  assert.equal(result.sessionId, "hs-stored");
  assert.equal(store.saveCount, 1, "the pre-seeded save is the only one — no double-save");
  assert.deepEqual(store.saved, [{ conversationId: "conv-1", harnessSessionId: "hs-stored" }]);
});

test("streamHarnessTurn: falls back to the last text snapshot when there is no final event", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "text", text: "partial" },
      { type: "text", text: "partial answer" },
    ],
  });

  const chunks: string[] = [];
  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-2",
    tenantId: "tenant-1",
    task: "go",
    onText: (chunk) => chunks.push(chunk),
    onDone: () => {},
    store,
  });

  assert.deepEqual(chunks, ["partial", " answer"]);
  assert.equal(result.text, "partial answer");
  assert.equal(result.sessionId, "hs-fresh");
});

test("streamHarnessTurn: a throwing runtime propagates the error but still fires onDone once", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, { throwOnTurn: true });

  let doneCount = 0;
  const chunks: string[] = [];
  await assert.rejects(
    () =>
      streamHarnessTurn({
        runtime,
        conversationId: "conv-3",
        tenantId: "tenant-1",
        task: "boom",
        onText: (chunk) => chunks.push(chunk),
        onDone: () => {
          doneCount += 1;
        },
        store,
      }),
    /engine exploded/
  );

  assert.equal(doneCount, 1, "onDone fires exactly once, success or failure");
  assert.deepEqual(chunks, []);
  assert.equal(store.saveCount, 0, "a failed turn persists nothing");
});
