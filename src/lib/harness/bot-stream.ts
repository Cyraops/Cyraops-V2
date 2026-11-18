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
 *
 * Approvals: when a tool requires the user's approval, the runtime emits a
 * synthetic `approval` event (type "approval": approvalId/toolName/summary/
 * reason/callId) and later an `approval_decided` event. This module forwards
 * the request to `onApproval` (the route maps it onto the SSE) and mirrors
 * the decision into the result's `approval` field with the exact
 * `pendingAction` shape the V1 approval card renders (id/toolName/summary/
 * answered/canAlwaysAllow), so the SAME UI card displays without UI changes.
 */

import { harnessSessionStore, type AgentRuntime, type RuntimeKind, type Session } from "./runtime";
import type { HarnessSessionStore } from "./store";
import type { HarnessEvent } from "./client";
import type { PermissionMode } from "@/lib/permissions/mode";

/**
 * Instruction appended to a harness turn's task when the reply will be read
 * aloud (the voice screen posts `voice: true`). Same spirit as the V1 voice
 * flag: the harness must answer in spoken length, not paragraph length.
 */
export const VOICE_SHAPING_INSTRUCTION =
  "\n\nYou are speaking aloud right now through a voice interface. Answer in one to three short spoken sentences, no lists, no headings, no markdown, no URLs. If there is a lot to say, offer to continue rather than reciting it all.";

/** The task handed to the harness for one turn, with voice shaping when spoken. */
export function harnessTaskForTurn(input: { content: string; attachmentContext?: string; voice?: boolean }): string {
  const { content, attachmentContext = "", voice = false } = input;
  return `${content}${attachmentContext}${voice ? VOICE_SHAPING_INSTRUCTION : ""}`;
}

export interface StreamHarnessTurnInput {
  runtime: AgentRuntime;
  /** The conversation this turn belongs to (the session store's key). */
  conversationId: string;
  /** Owning tenant (Cyraops user id); every store access is scoped by it. */
  tenantId: string;
  task: string;
  signal?: AbortSignal;
  /** The turn's workspace/tenant key (conversation owner id); scopes the CRM tools. */
  workspaceId?: string | null;
  /**
   * The caller's resolved, role-gated permission mode; the runtime maps it
   * onto DSH_PERMISSION_MODE / --permission-mode and the system-tools mount.
   */
  permissionMode?: PermissionMode;
  /** Receives each incremental delta of streamed assistant text. */
  onText: (chunk: string) => void;
  /** Invoked exactly once when the turn's event stream ends, success or failure. */
  onDone: () => void;
  /** Receives each approval request the turn surfaces (route → SSE payload). */
  onApproval?: (approval: HarnessApprovalRequest) => void;
  /**
   * Receives every raw harness event, in stream order. The chat route uses it
   * to collect the turn's audit evidence (tool_call/tool_result pairs, step_end
   * usage, event timestamps) without this module touching the database.
   */
  onEvent?: (event: HarnessEvent) => void;
  /** Test seam; defaults to the shared harnessSessionStore(). */
  store?: HarnessSessionStore;
}

/** An approval request surfaced mid-turn, in the UI-compatible card shape. */
export interface HarnessApprovalRequest {
  approvalId: string;
  toolName: string;
  summary: string;
  reason?: string;
  callId?: string;
}

/** The V1-compatible pendingAction shape for the terminal SSE payload. */
export interface HarnessApprovalResult {
  id: string;
  toolName: string;
  summary: string;
  /** Mirrors the card's answered state: allow/deny after the decision. */
  answered: "allow" | "deny";
  canAlwaysAllow: false;
}

export interface StreamHarnessTurnResult {
  /** The turn's final answer: the `final` event, else the last text snapshot. */
  text: string;
  /** The harness's durable session id for this conversation (null when unknown). */
  sessionId: string | null;
  /** The runtime kind that actually served the turn (healthCheck may report a fallback). */
  runtimeKind: RuntimeKind;
  /** The first approval the turn asked for, with its decision; null when none. */
  approval: HarnessApprovalResult | null;
}

export async function streamHarnessTurn(input: StreamHarnessTurnInput): Promise<StreamHarnessTurnResult> {
  const { runtime, conversationId, tenantId, task, signal, onText, onDone, onApproval, onEvent } = input;
  const store = input.store ?? harnessSessionStore();
  // createSession resolves the stored harness session id for this conversation
  // (both runtimes load it from the store), so the next turn resumes instead
  // of starting a fresh harness session.
  const session: Session = await runtime.createSession({ tenantId, conversationId });

  let announcedId: string | null = null;
  let snapshot = ""; // the last cumulative text snapshot seen
  let finalText = "";
  const approvals = new Map<string, HarnessApprovalRequest>();
  const decisions = new Map<string, "allow" | "deny">();
  let firstApproval: HarnessApprovalRequest | null = null;

  try {
    for await (const event of runtime.executeTurn({
      sessionId: session.id,
      task,
      signal,
      workspaceId: input.workspaceId ?? null,
      permissionMode: input.permissionMode,
    })) {
      onEvent?.(event);
      if (event.type === "text" && typeof event.text === "string") {
        const text = event.text;
        const delta = text.startsWith(snapshot) ? text.slice(snapshot.length) : text;
        snapshot = text;
        if (delta) onText(delta);
      } else if (event.type === "final" && typeof event.text === "string") {
        finalText = event.text;
      } else if (event.type === "session" && typeof event.sessionId === "string" && event.sessionId) {
        announcedId = event.sessionId;
      } else if (event.type === "approval" && typeof event.approvalId === "string") {
        const approval: HarnessApprovalRequest = {
          approvalId: event.approvalId,
          toolName: typeof event.toolName === "string" ? event.toolName : "tool",
          summary: typeof event.summary === "string" ? event.summary : "This action requires your approval.",
          ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
          ...(typeof event.callId === "string" ? { callId: event.callId } : {}),
        };
        approvals.set(approval.approvalId, approval);
        firstApproval ??= approval;
        onApproval?.(approval);
      } else if (event.type === "approval_decided" && typeof event.approvalId === "string") {
        const outcome = event.outcome;
        const answered = outcome === "allowed-once" ? "allow" : "deny";
        decisions.set(event.approvalId, answered);
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
    approval: firstApproval
      ? {
          id: firstApproval.approvalId,
          toolName: firstApproval.toolName,
          summary: firstApproval.summary,
          answered: decisions.get(firstApproval.approvalId) ?? "deny",
          canAlwaysAllow: false,
        }
      : null,
  };
}
