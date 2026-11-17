/**
 * One helper between the bot-chat SSE route and the harness AgentRuntime.
 *
 * `streamHarnessTurn` is the streaming counterpart of the `/api/harness/run`
 * request/response flow: it creates (or resumes) the conversation's harness
 * session through the runtime, streams the turn, and hands the caller the
 * final text plus the durable harness session id. The chat route maps the
 * callbacks onto its established SSE payloads; this module stays free of
 * Next.js and of the chat persistence layer so it can be unit-tested with a
 * fake AgentRuntime.
 *
 * Text handling mirrors `finalTextOf` in ./events.ts: harness `text` events
 * are cumulative snapshots of the committed assistant message (the terminal
 * `final` event carries the lossless answer). `onText` therefore receives
 * DELTAS — the slice of the snapshot that has not been forwarded yet —
 * because the chat UI appends every token payload it receives. A `final`
 * event's text wins over the accumulated snapshot; a turn with no `final`
 * event falls back to the last snapshot.
 */

import { harnessSessionStore, type AgentRuntime, type RuntimeKind, type Session } from "./runtime";
import type { HarnessSessionStore } from "./store";

export interface StreamHarnessTurnInput {
  runtime: AgentRuntime;
  /** The conversation this turn belongs to (the session store's key). */
  conversationId: string;
  /** Owning tenant (Cyraops user id); every store access is scoped by it. */
  tenantId: string;
  task: string;
  signal?: AbortSignal;
  /** Receives each incremental delta of streamed assistant text. */
  onText: (chunk: string) => void;
  /** Invoked exactly once when the turn's event stream ends, success or failure. */
  onDone: () => void;
  /** Test seam; defaults to the shared harnessSessionStore(). */
  store?: HarnessSessionStore;
}

export interface StreamHarnessTurnResult {
  /** The turn's final answer: the `final` event, else the last text snapshot. */
  text: string;
  /** The harness's durable session id for this conversation (null when unknown). */
  sessionId: string | null;
  /** The runtime kind that actually served the turn (healthCheck may report a fallback). */
  runtimeKind: RuntimeKind;
}

export async function streamHarnessTurn(input: StreamHarnessTurnInput): Promise<StreamHarnessTurnResult> {
  const { runtime, conversationId, tenantId, task, signal, onText, onDone } = input;
  const store = input.store ?? harnessSessionStore();

  // createSession resolves the stored harness session id for this conversation
  // (both runtimes load it from the store), so the next turn resumes instead
  // of starting a fresh harness session.
  const session: Session = await runtime.createSession({ tenantId, conversationId });

  let announcedId: string | null = null;
  let snapshot = ""; // the last cumulative text snapshot seen
  let finalText = "";

  try {
    for await (const event of runtime.executeTurn({ sessionId: session.id, task, signal })) {
      if (event.type === "text" && typeof event.text === "string") {
        const text = event.text;
        const delta = text.startsWith(snapshot) ? text.slice(snapshot.length) : text;
        snapshot = text;
        if (delta) onText(delta);
      } else if (event.type === "final" && typeof event.text === "string") {
        finalText = event.text;
      } else if (event.type === "session" && typeof event.sessionId === "string" && event.sessionId) {
        announcedId = event.sessionId;
      }
    }
  } finally {
    onDone();
  }

  // First-seen harness session id: persist it so the next turn resumes.
  // Skipped when it matches the id createSession already loaded — an earlier
  // turn persisted that value, and re-saving adds nothing.
  if (announcedId && announcedId !== session.harnessSessionId) {
    await store.saveHarnessSessionId({ tenantId, conversationId, harnessSessionId: announcedId });
  }

  const health = await runtime.healthCheck();
  return {
    text: finalText || snapshot,
    sessionId: announcedId ?? session.harnessSessionId,
    runtimeKind: health.kind,
  };
}
