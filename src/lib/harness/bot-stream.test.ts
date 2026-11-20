import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FILE_SHELL_DISABLED_REPLY,
  harnessTaskForTurn,
  isFileShellRequest,
  planDirectiveFor,
  streamHarnessTurn,
  suppressVoiceShaping,
  SYSTEM_FILE_OP_GUIDANCE,
  VOICE_SHAPING_INSTRUCTION,
  type HarnessQuestionRequest,
} from "./bot-stream";
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
  turns: Array<{ sessionId: string; harnessSessionId: string | null; task: string; workspaceId: string | null; workspaceRoot: string | null; permissionMode: unknown; planMode?: "on" | "off" }>;
} {
  const sessions = new Map<string, Session>();
  let nextId = 0;
  const runtime = {
    turns: [] as Array<{ sessionId: string; harnessSessionId: string | null; task: string; workspaceId: string | null; workspaceRoot: string | null; permissionMode: unknown; planMode?: "on" | "off" }>,
    async createSession({ tenantId, conversationId }: { tenantId: string; conversationId: string }) {
      const harnessSessionId = await store.loadHarnessSessionId({ tenantId, conversationId });
      const session: Session = { id: `adapter-${++nextId}`, tenantId, conversationId, harnessSessionId };
      sessions.set(session.id, session);
      return session;
    },
    async *executeTurn({ sessionId, task, workspaceId, workspaceRoot, permissionMode, planMode }: { sessionId: string; task: string; workspaceId?: string | null; workspaceRoot?: string | null; permissionMode?: unknown; planMode?: "on" | "off" }) {
      const session = sessions.get(sessionId);
      assert.ok(session, "fake runtime must receive a known session id");
      runtime.turns.push({ sessionId, harnessSessionId: session.harnessSessionId, task, workspaceId: workspaceId ?? null, workspaceRoot: workspaceRoot ?? null, permissionMode, planMode });
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

test("streamHarnessTurn: forwards the project workspace root on the turn input", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, { events: [{ type: "final", text: "done" }] });

  await streamHarnessTurn({
    runtime,
    conversationId: "conv-1",
    tenantId: "tenant-1",
    task: "say hello",
    workspaceRoot: "/work/project",
    onText: () => {},
    onDone: () => {},
    store,
  });
  assert.equal(runtime.turns[0].workspaceRoot, "/work/project");

  // No root (CRM mode) travels as null, not as the previous turn's value.
  await streamHarnessTurn({
    runtime,
    conversationId: "conv-1",
    tenantId: "tenant-1",
    task: "continue",
    workspaceRoot: null,
    onText: () => {},
    onDone: () => {},
    store,
  });
  assert.equal(runtime.turns[1].workspaceRoot, null);
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

test("harnessTaskForTurn: a SYSTEM turn appends the shell-first file-operation guidance", () => {
  const task = harnessTaskForTurn({ content: "Create a PDF", permissionMode: "SYSTEM" });
  assert.equal(task, `Create a PDF${SYSTEM_FILE_OP_GUIDANCE}`);
  assert.match(task, /You have a shell\. For file operations prefer the shell tool/);
  // Exactly once.
  assert.equal(task.indexOf(SYSTEM_FILE_OP_GUIDANCE), task.lastIndexOf(SYSTEM_FILE_OP_GUIDANCE));
});

test("harnessTaskForTurn: non-SYSTEM turns carry no file-operation guidance", () => {
  assert.equal(harnessTaskForTurn({ content: "Create a PDF", permissionMode: "CONTROLLED" }), "Create a PDF");
  assert.equal(harnessTaskForTurn({ content: "Create a PDF" }), "Create a PDF");
});

test("harnessTaskForTurn: a SYSTEM project voice turn suppresses the spoken-length shaping", () => {
  const task = harnessTaskForTurn({
    content: "Create a PDF named x.pdf on the Desktop",
    voice: true,
    permissionMode: "SYSTEM",
    workspaceRoot: "/Users/tanveersinghsaini/Desktop",
  });
  assert.ok(!task.includes(VOICE_SHAPING_INSTRUCTION), "voice shaping must be suppressed for SYSTEM + root");
  assert.ok(!task.includes("one to three short spoken sentences"));
  assert.ok(task.includes(SYSTEM_FILE_OP_GUIDANCE), "file-operation guidance still applies");
});

test("harnessTaskForTurn: a SYSTEM voice turn without a root keeps the spoken-length shaping", () => {
  const task = harnessTaskForTurn({
    content: "What is due this week?",
    voice: true,
    permissionMode: "SYSTEM",
    workspaceRoot: null,
  });
  assert.ok(task.includes(VOICE_SHAPING_INSTRUCTION));
  assert.ok(task.includes(SYSTEM_FILE_OP_GUIDANCE));
  // Guidance precedes the spoken-length instruction.
  assert.ok(task.indexOf(SYSTEM_FILE_OP_GUIDANCE) < task.indexOf(VOICE_SHAPING_INSTRUCTION));
});

test("harnessTaskForTurn: a plain voice turn (no SYSTEM) still shortens", () => {
  const task = harnessTaskForTurn({ content: "Hi", voice: true, permissionMode: "CONTROLLED" });
  assert.ok(task.includes(VOICE_SHAPING_INSTRUCTION));
  assert.ok(!task.includes(SYSTEM_FILE_OP_GUIDANCE));
});

test("suppressVoiceShaping: only SYSTEM plus a pinned root suppresses", () => {
  assert.equal(suppressVoiceShaping({ permissionMode: "SYSTEM", workspaceRoot: "/x" }), true);
  assert.equal(suppressVoiceShaping({ permissionMode: "SYSTEM", workspaceRoot: null }), false);
  assert.equal(suppressVoiceShaping({ permissionMode: "SYSTEM", workspaceRoot: undefined }), false);
  assert.equal(suppressVoiceShaping({ permissionMode: "CONTROLLED", workspaceRoot: "/x" }), false);
  assert.equal(suppressVoiceShaping({ permissionMode: undefined, workspaceRoot: "/x" }), false);
});

test("isFileShellRequest detects shell/filesystem intent words case-insensitively", () => {
  for (const text of [
    "Create a blank PDF",
    "write a file",
    "save the report to disk",
    "make a pdf named money123.pdf",
    "open a file",
    "run a shell command",
    "install the package",
    "RUN this script",
  ]) {
    assert.equal(isFileShellRequest(text), true, `expected file/shell intent: ${text}`);
  }
});

test("isFileShellRequest is false for non-file/shell requests", () => {
  for (const text of [
    "What tickets are overdue this week?",
    "Summarize my inbox",
    "Draft a reply to the client",
    "Who is my next meeting with?",
    "",
    "planning my day",
    "create a task",
    "run a report",
    "write an email",
    "save the ticket",
  ]) {
    assert.equal(isFileShellRequest(text), false, `expected no file/shell intent: ${text}`);
  }
});

test("isFileShellRequest matches whole words only, not substrings", () => {
  assert.equal(isFileShellRequest("running shoes for the team"), false);
  assert.equal(isFileShellRequest("creative brainstorming"), false);
  assert.equal(isFileShellRequest("my profile settings"), false);
});

test("FILE_SHELL_DISABLED_REPLY is the fixed platform line", () => {
  assert.equal(
    FILE_SHELL_DISABLED_REPLY,
    "Shell and file tools are off in CONTROLLED mode. An admin can switch this workspace to SYSTEM in Settings → Permissions."
  );
});

test("streamHarnessTurn: forwards question batches to onQuestion and decisions to onQuestionDecided", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "tool_call", callId: "call-1", tool: "ask_user_question", input: {} },
      {
        type: "question",
        questionId: "call-1",
        text: "Which ticket should I update?",
        questions: [
          { id: "q1", question: "Which ticket should I update?" },
          { id: "q2", question: "What priority?" },
        ],
        callId: "call-1",
      },
      { type: "question_decided", questionId: "call-1", timedOut: false },
      { type: "final", text: "Updated" },
    ],
  });

  const questions: unknown[] = [];
  const decided: unknown[] = [];
  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-question",
    tenantId: "tenant-1",
    task: "ask me which ticket",
    onText: () => {},
    onDone: () => {},
    onQuestion: (question) => questions.push(question),
    onQuestionDecided: (info) => decided.push(info),
    store,
  });

  assert.deepEqual(questions, [
    {
      questionId: "call-1",
      text: "Which ticket should I update?",
      questions: [
        { id: "q1", question: "Which ticket should I update?" },
        { id: "q2", question: "What priority?" },
      ],
      callId: "call-1",
    },
  ]);
  assert.deepEqual(decided, [{ questionId: "call-1", timedOut: false }]);
  assert.deepEqual(result.toolCallsUsed, ["ask_user_question"]);
});

test("streamHarnessTurn: collects distinct tool names and the last step_end usage in the result", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "session" },
      { type: "tool_call", callId: "c1", tool: "cyraops_list_tickets", input: {} },
      { type: "tool_call", callId: "c2", tool: "cyraops_update_ticket", input: {} },
      { type: "status", phase: "step_end", usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 } },
      { type: "tool_call", callId: "c3", tool: "cyraops_list_tickets", input: {} },
      { type: "status", phase: "step_end", usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 } },
      { type: "final", text: "done" },
    ],
  });

  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-tools",
    tenantId: "tenant-1",
    task: "list tickets",
    onText: () => {},
    onDone: () => {},
    store,
  });

  assert.deepEqual(result.toolCallsUsed, ["cyraops_list_tickets", "cyraops_update_ticket"]);
  assert.deepEqual(result.usage, { inputTokens: 1200, outputTokens: 300 });
});

test("streamHarnessTurn: a turn without usage yields a null usage result", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [{ type: "session" }, { type: "final", text: "plain" }],
  });

  const result = await streamHarnessTurn({
    runtime,
    conversationId: "conv-nousage",
    tenantId: "tenant-1",
    task: "plain",
    onText: () => {},
    onDone: () => {},
    store,
  });

  assert.deepEqual(result.toolCallsUsed, []);
  assert.equal(result.usage, null);
});

// ---------------------------------------------------------------------------
// Tier-2 plan preview.
// ---------------------------------------------------------------------------

test("planDirectiveFor parses the /plan chat surface", () => {
  assert.deepEqual(planDirectiveFor("/plan"), { mode: "on", task: null });
  assert.deepEqual(planDirectiveFor("/plan off"), { mode: "off", task: null });
  assert.deepEqual(planDirectiveFor("  /plan  Plan the ticket update  "), { mode: "on", task: "Plan the ticket update" });
  assert.deepEqual(planDirectiveFor("/plan"), { mode: "on", task: null });
  assert.deepEqual(planDirectiveFor("/planner think"), { mode: null, task: null });
  assert.deepEqual(planDirectiveFor("Plan the steps to update the tickets"), { mode: null, task: null });
  assert.deepEqual(planDirectiveFor(""), { mode: null, task: null });
  assert.deepEqual(planDirectiveFor("not a /plan"), { mode: null, task: null });
});

test("streamHarnessTurn: forwards the plan-mode switch to the runtime", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, { events: [{ type: "session" }, { type: "final", text: "Plan mode is on." }] });
  await streamHarnessTurn({
    runtime,
    conversationId: "conv-plan",
    tenantId: "tenant-1",
    task: "Plan the steps to update the tickets",
    planMode: "on",
    onText: () => {},
    onDone: () => {},
    store,
  });
  assert.equal(runtime.turns.length, 1);
  assert.equal(runtime.turns[0].planMode, "on");
});

test("streamHarnessTurn: a plan-mode switch turn omits planMode entirely", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, { events: [{ type: "session" }, { type: "final", text: "ok" }] });
  await streamHarnessTurn({
    runtime,
    conversationId: "conv-plain",
    tenantId: "tenant-1",
    task: "hello",
    onText: () => {},
    onDone: () => {},
    store,
  });
  assert.equal(runtime.turns[0].planMode, undefined);
});

test("streamHarnessTurn: plan-review questions keep the full review surface", async () => {
  const store = memoryStore();
  const runtime = fakeRuntime(store, {
    events: [
      { type: "tool_call", callId: "call-plan-1", tool: "exit_plan_mode", input: { plan: "# Plan\n\n- step" } },
      {
        type: "question",
        questionId: "broker-q-7",
        text: "Approve this plan and leave plan mode?",
        questions: [
          {
            id: "plan-review",
            question: "Approve this plan and leave plan mode?",
            detail: "# Plan\n\n- step",
            options: [{ label: "Approve" }, { label: "Keep planning" }],
            intent: { kind: "plan-review", approve: "Approve", callId: "call-plan-1" },
          },
        ],
      },
      { type: "question_decided", questionId: "broker-q-7", timedOut: false },
      { type: "final", text: "Plan approved — executing now." },
    ],
  });
  const questions: HarnessQuestionRequest[] = [];
  const decided: Array<{ questionId: string; timedOut: boolean }> = [];
  await streamHarnessTurn({
    runtime,
    conversationId: "conv-plan-review",
    tenantId: "tenant-1",
    task: "/plan Plan the steps",
    onText: () => {},
    onDone: () => {},
    onQuestion: (question) => questions.push(question),
    onQuestionDecided: (info) => decided.push(info),
    store,
  });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].questionId, "broker-q-7");
  assert.deepEqual(questions[0].questions[0], {
    id: "plan-review",
    question: "Approve this plan and leave plan mode?",
    detail: "# Plan\n\n- step",
    options: [{ label: "Approve" }, { label: "Keep planning" }],
    intent: { kind: "plan-review", approve: "Approve", callId: "call-plan-1" },
  });
  assert.deepEqual(decided, [{ questionId: "broker-q-7", timedOut: false }]);
});
