import assert from "node:assert/strict";
import { test } from "node:test";
import { harnessTaskForTurn, streamHarnessTurn, VOICE_SHAPING_INSTRUCTION } from "./bot-stream";
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
  turns: Array<{ sessionId: string; harnessSessionId: string | null; task: string; workspaceId: string | null; permissionMode: unknown }>;
} {
  const sessions = new Map<string, Session>();
  let nextId = 0;
  const runtime = {
    turns: [] as Array<{ sessionId: string; harnessSessionId: string | null; task: string; workspaceId: string | null; permissionMode: unknown }>,
    async createSession({ tenantId, conversationId }: { tenantId: string; conversationId: string }) {
      const harnessSessionId = await store.loadHarnessSessionId({ tenantId, conversationId });
      const session: Session = { id: `adapter-${++nextId}`, tenantId, conversationId, harnessSessionId };
      sessions.set(session.id, session);
      return session;
    },
    async *executeTurn({ sessionId, task, workspaceId, permissionMode }: { sessionId: string; task: string; workspaceId?: string | null; permissionMode?: unknown }) {
      const session = sessions.get(sessionId);
      assert.ok(session, "fake runtime must receive a known session id");
      runtime.turns.push({ sessionId, harnessSessionId: session.harnessSessionId, task, workspaceId: workspaceId ?? null, permissionMode });
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

test("streamHarnessTurn: forwards approval requests to onApproval and mirrors an allow decision in the result", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "text", text: "before" },
      { type: "approval", approvalId: "approval-1", toolName: "cyraops_update_ticket", summary: "Update ticket X: priority → HIGH", reason: "Update ticket X: priority → HIGH", callId: "call-1" },
      { type: "approval_decided", approvalId: "approval-1", outcome: "allowed-once", timedOut: false },
      { type: "text", text: "before Updated" },
      { type: "final", text: "Updated" },
    ],
  });

  const approvals: unknown[] = [];
  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-approval",
    tenantId: "tenant-1",
    task: "update ticket",
    onText: () => {},
    onDone: () => {},
    onApproval: (approval) => approvals.push(approval),
    store,
  });

  assert.deepEqual(approvals, [
    {
      approvalId: "approval-1",
      toolName: "cyraops_update_ticket",
      summary: "Update ticket X: priority → HIGH",
      reason: "Update ticket X: priority → HIGH",
      callId: "call-1",
    },
  ]);
  // The result mirrors the V1 pendingAction card shape exactly.
  assert.deepEqual(result.approval, {
    id: "approval-1",
    toolName: "cyraops_update_ticket",
    summary: "Update ticket X: priority → HIGH",
    answered: "allow",
    canAlwaysAllow: false,
  });
});

test("streamHarnessTurn: a rejected decision yields answered deny in the result", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "approval", approvalId: "approval-2", toolName: "cyraops_update_ticket", summary: "Update ticket Y" },
      { type: "approval_decided", approvalId: "approval-2", outcome: "rejected", timedOut: false },
      { type: "final", text: "denied" },
    ],
  });

  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-reject",
    tenantId: "tenant-1",
    task: "update ticket",
    onText: () => {},
    onDone: () => {},
    store,
  });

  assert.deepEqual(result.approval, {
    id: "approval-2",
    toolName: "cyraops_update_ticket",
    summary: "Update ticket Y",
    answered: "deny",
    canAlwaysAllow: false,
  });
});

test("streamHarnessTurn: no approval events yields a null approval result", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "text", text: "plain" },
      { type: "final", text: "plain" },
    ],
  });

  const approvals: unknown[] = [];
  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-plain",
    tenantId: "tenant-1",
    task: "plain",
    onText: () => {},
    onDone: () => {},
    onApproval: (approval) => approvals.push(approval),
    store,
  });

  assert.deepEqual(approvals, []);
  assert.equal(result.approval, null);
});

test("streamHarnessTurn: passes the workspace/tenant key through to the runtime", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "final", text: "ok" },
    ],
  });

  await streamHarnessTurn({
    runtime,
    conversationId: "conv-tenant",
    tenantId: "tenant-1",
    task: "list tickets",
    workspaceId: "workspace-owner-user-1",
    onText: () => {},
    onDone: () => {},
    store,
  });

  assert.equal(runtime.turns[0].workspaceId, "workspace-owner-user-1");
});

test("streamHarnessTurn: carries the caller's permission mode to the runtime", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "final", text: "ok" },
    ],
  });

  await streamHarnessTurn({
    runtime,
    conversationId: "conv-mode",
    tenantId: "tenant-1",
    task: "update ticket",
    permissionMode: "SYSTEM",
    onText: () => {},
    onDone: () => {},
    store,
  });

  assert.equal(runtime.turns[0].permissionMode, "SYSTEM");

  // No permission mode provided keeps the historical undefined for the runtime.
  await streamHarnessTurn({
    runtime,
    conversationId: "conv-mode-2",
    tenantId: "tenant-1",
    task: "plain",
    onText: () => {},
    onDone: () => {},
    store,
  });
  assert.equal(runtime.turns[1].permissionMode, undefined);
});

test("streamHarnessTurn: forwards every raw event to onEvent in stream order", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "tool_call", callId: "c1", tool: "cyraops_list_tickets", input: {} },
      { type: "tool_result", callId: "c1", status: "completed", result: "ok" },
      { type: "status", phase: "step_end", usage: { inputTokens: 1, outputTokens: 1 } },
      { type: "final", text: "done" },
    ],
  });

  const seen: string[] = [];
  await streamHarnessTurn({
    runtime,
    conversationId: "conv-events",
    tenantId: "tenant-1",
    task: "list tickets",
    onText: () => {},
    onDone: () => {},
    onEvent: (event) => seen.push(`${event.type}:${String(event.callId ?? event.phase ?? "")}`),
    store,
  });

  assert.deepEqual(seen, [
    "session:",
    "tool_call:c1",
    "tool_result:c1",
    "status:step_end",
    "final:",
  ]);
});

test("streamHarnessTurn: a missing workspace key arrives at the runtime as null", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "final", text: "ok" },
    ],
  });

  await streamHarnessTurn({
    runtime,
    conversationId: "conv-no-tenant",
    tenantId: "tenant-1",
    task: "list tickets",
    onText: () => {},
    onDone: () => {},
    store,
  });

  assert.equal(runtime.turns[0].workspaceId, null);
});

test("harnessTaskForTurn: a voice turn appends the spoken-length instruction", () => {
  const task = harnessTaskForTurn({ content: "What is due this week?", voice: true });
  assert.equal(task, `What is due this week?${VOICE_SHAPING_INSTRUCTION}`);
  assert.match(task, /Answer in one to three short spoken sentences/);
  // The instruction rides the task, after the user's words, exactly once.
  assert.equal(task.indexOf(VOICE_SHAPING_INSTRUCTION), task.lastIndexOf(VOICE_SHAPING_INSTRUCTION));
});

test("harnessTaskForTurn: a typed turn carries no voice instruction", () => {
  assert.equal(harnessTaskForTurn({ content: "What is due this week?" }), "What is due this week?");
  assert.equal(harnessTaskForTurn({ content: "What is due?", voice: false }), "What is due?");
});

test("harnessTaskForTurn: attachment context sits between the words and the instruction", () => {
  const task = harnessTaskForTurn({
    content: "Summarise the file",
    attachmentContext: "\n\n[Attached files]\n--- notes.txt ---\nhello",
    voice: true,
  });
  assert.equal(
    task,
    "Summarise the file\n\n[Attached files]\n--- notes.txt ---\nhello" + VOICE_SHAPING_INSTRUCTION
  );
});
