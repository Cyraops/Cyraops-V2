/**
 * Audit persistence for harness chat turns (FIX 2).
 *
 * The V1 assistant path leaves three audit trails per turn — AiToolCall rows
 * (pre-logged RUNNING then updated by the tool registry), an AiUsageLog row
 * (provider usage via recordAiUsage), and an AssistantPendingAction row for
 * every approval (PENDING → APPROVED/REJECTED in decidePendingAction). The
 * harness branch wrote none of them: a native turn could update a ticket,
 * spend tokens and ask for approval while the DB stayed silent.
 *
 * This module mirrors those V1 shapes from the harness event stream:
 *
 * - one AiToolCall row per tool_call/tool_result pair observed (the harness
 *   projector emits `tool_call` with { callId, tool, input } and `tool_result`
 *   with { callId, status: "completed"|"error", result, error? } — shapes read
 *   from vendor/tooling/vendored-boot and the vendored dsh-headless projector);
 * - one AiUsageLog row per turn from the last step_end usage
 *   ({ inputTokens, outputTokens, totalTokens } → prompt/completion/total
 *   tokens, the same unit the V1 provider usage uses);
 * - one AssistantPendingAction row per approval (the SAME table the V1
 *   assistant path uses; AiApproval cannot fit — its taskId requires an AiTask
 *   row and chat turns have none). The row is created PENDING when the
 *   approval event surfaces and updated when the broker settles the decision.
 *
 * Everything here is best-effort: an audit write failure must never break the
 * chat stream, exactly like the V1 registry's try/catch logging.
 */

import { db } from "@/lib/db";
import { estimateCostUsd } from "@/lib/ai/models";
import { recordAiUsage } from "@/lib/ai/usage";
import { usageOf } from "./events";
import { approvalBroker, type ApprovalBroker, type ApprovalDecidedInfo } from "./approval-broker";
import type { HarnessEvent } from "./client";

/**
 * Same sensitive-key masking the V1 tool registry applies before persisting
 * tool inputs/outputs (src/lib/ai/tools/registry.ts). Kept as a mirror here so
 * the V1 module stays untouched; the whole-word regex matters — a substring
 * test masked `author`/`authorId` because they contain "auth".
 */
const SENSITIVE_KEY =
  /(^|[^a-z])(password|passwd|secret|token|api[-_]?key|credential|authorization|cookie|session)([^a-z]|$)/;

export function maskSensitiveData(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEY.test(lowerKey)) {
      sanitized[key] = "***MASKED***";
    } else if (typeof val === "object" && val !== null) {
      sanitized[key] = maskSensitiveData(val);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

/**
 * The harness exposes exactly one CRM write tool, cyraops_update_ticket, and it
 * is ask-gated in the native runtime (TASK 1). Reads are CLASS_A, that write
 * is CLASS_B — the same split the V1 registry applies to its tools. Any other
 * tool name (harness-internal tools like todo/web) is logged CLASS_A; its
 * writes touch harness storage, not CRM rows.
 */
const WRITE_TOOLS = new Set(["cyraops_update_ticket"]);

export interface HarnessToolCallRow {
  conversationId: string | null;
  toolId: string;
  toolName: string;
  input: string;
  output: string | null;
  status: "SUCCESS" | "ERROR";
  error: string | null;
  riskClass: "CLASS_A" | "CLASS_B" | "CLASS_C";
  requiresApproval: boolean;
  executionTimeMs: number;
}

/** Per-callId arrival timestamps, for the V1-style executionTimeMs column. */
export interface ToolCallTimings {
  get(callId: string): { call?: number; result?: number } | undefined;
}

/** Mask a tool output the way the V1 registry does: objects → masked JSON, text stays text. */
export function maskToolOutput(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  const text = typeof result === "string" ? result : JSON.stringify(maskSensitiveData(result));
  // Text results are not object-shaped: attempt JSON masking when they are, else keep the text.
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      if (parsed && typeof parsed === "object") return JSON.stringify(maskSensitiveData(parsed));
    } catch {
      // not JSON — keep as text
    }
    return text;
  }
  return text;
}

/** The tool_call → tool_result pairing, one row per pair (unpaired calls are skipped). */
export function harnessToolCallRows(
  events: HarnessEvent[],
  conversationId: string,
  timings?: ToolCallTimings
): HarnessToolCallRow[] {
  const calls = new Map<string, { tool: string; input: unknown; callId: string }>();
  const results = new Map<
    string,
    { status: string; result?: unknown; error?: unknown }
  >();
  const approvalCallIds = new Set<string>();

  for (const event of events) {
    if (event.type === "tool_call" && typeof event.callId === "string") {
      if (!calls.has(event.callId)) calls.set(event.callId, { callId: event.callId, tool: typeof event.tool === "string" ? event.tool : "tool", input: event.input });
    } else if (event.type === "tool_result" && typeof event.callId === "string") {
      if (!results.has(event.callId)) {
        results.set(event.callId, {
          status: typeof event.status === "string" ? event.status : "completed",
          result: event.result,
          ...(event.error !== undefined ? { error: event.error } : {}),
        });
      }
    } else if (event.type === "approval" && typeof event.callId === "string") {
      approvalCallIds.add(event.callId);
    }
  }

  const rows: HarnessToolCallRow[] = [];
  for (const [callId, call] of calls) {
    const result = results.get(callId);
    if (!result) continue; // no tool_result observed: nothing to record an outcome for
    const isWrite = WRITE_TOOLS.has(call.tool);
    const timingsFor = timings?.get(callId);
    rows.push({
      conversationId,
      toolId: call.tool,
      toolName: call.tool,
      input: JSON.stringify(maskSensitiveData(call.input) || {}),
      output: maskToolOutput(result.result),
      status: result.status === "completed" ? "SUCCESS" : "ERROR",
      error: typeof result.error === "string" ? result.error : result.status === "completed" ? null : "Tool call failed",
      riskClass: isWrite ? "CLASS_B" : "CLASS_A",
      requiresApproval: isWrite && approvalCallIds.has(callId),
      executionTimeMs: Math.max(0, (timingsFor?.result ?? 0) - (timingsFor?.call ?? 0)),
    });
  }
  return rows;
}

/**
 * The model name for harness usage rows. The harness projector does not
 * announce the model in any event, so this mirrors the configured harness
 * agent default (DSH settings: agent-default-model deepseek-official /
 * deepseek-v4-flash-vision-exp); HARNESS_MODEL overrides it. estimateCostUsd
 * matches "deepseek" → the V1 DeepSeek Chat rates ($0.14 / $0.28 per 1M).
 */
export function harnessModelName(env: { [key: string]: string | undefined } = process.env): string {
  return env.HARNESS_MODEL?.trim() || "deepseek-v4-flash-vision-exp";
}

export interface HarnessUsageParams {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Map the last step_end usage to the V1 fields. Units are identical (tokens):
 * inputTokens → promptTokens, outputTokens → completionTokens.
 */
export function harnessUsageParams(
  events: HarnessEvent[],
  env: { [key: string]: string | undefined } = process.env
): HarnessUsageParams | null {
  const usage = usageOf(events);
  if (!usage) return null;
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
  return { model: harnessModelName(env), promptTokens, completionTokens, totalTokens };
}

/** Persist one AiToolCall row per observed pair (best-effort, like the V1 registry). */
export async function persistHarnessToolCalls(rows: HarnessToolCallRow[]): Promise<void> {
  for (const row of rows) {
    try {
      await db.aiToolCall.create({
        data: {
          taskId: null,
          conversationId: row.conversationId,
          stepId: null,
          toolId: row.toolId,
          toolName: row.toolName,
          idempotencyKey: null,
          input: row.input,
          output: row.output,
          status: row.status,
          error: row.error,
          riskClass: row.riskClass,
          requiresApproval: row.requiresApproval,
          executionTimeMs: row.executionTimeMs,
        },
      });
    } catch (error) {
      console.warn("[HarnessAudit] Failed to log tool call:", error);
    }
  }
}

/** Persist the turn's AiUsageLog row via the same recordAiUsage the V1 path uses. */
export async function persistHarnessUsage(params: {
  userId: string;
  usage: HarnessUsageParams;
  durationMs?: number;
}): Promise<void> {
  try {
    await recordAiUsage({
      userId: params.userId,
      // The V1 assistant turn logs source "agent"; harness turns get their own
      // label so the per-source report can tell the engines apart.
      source: "harness",
      agentSlug: "harness",
      model: params.usage.model,
      promptTokens: params.usage.promptTokens,
      completionTokens: params.usage.completionTokens,
      durationMs: params.durationMs || 0,
    });
  } catch (error) {
    console.warn("[HarnessAudit] Failed to log usage:", error);
  }
}

// ---------------------------------------------------------------------------
// Approvals: AssistantPendingAction rows (the V1 assistant's approval table),
// PENDING at request time, settled by the broker's onDecided emitter.
// ---------------------------------------------------------------------------

/** approvalId (broker-minted) → AssistantPendingAction row id, for the settle step. */
const approvalRowIds = new Map<string, string>();
const hookedBrokers = new WeakSet<ApprovalBroker>();

/** The masked tool input for an approval, correlated via its callId when observed. */
export function toolInputForApproval(
  events: HarnessEvent[],
  callId: string | undefined,
  toolName: string
): string {
  if (callId) {
    const call = events.find((event) => event.type === "tool_call" && event.callId === callId);
    if (call) return JSON.stringify(maskSensitiveData(call.input) || {});
  }
  return JSON.stringify({ tool: toolName });
}

/**
 * Create the PENDING row when a harness approval event surfaces. The row uses
 * the same columns the V1 path writes (assistantId/userId/conversationId/
 * toolId/toolName/input/summary, status "PENDING").
 */
export async function createHarnessApprovalRow(params: {
  approvalId: string;
  assistantId: string;
  userId: string;
  conversationId: string | null;
  toolName: string;
  summary: string;
  input: string;
}): Promise<string | null> {
  try {
    const row = await db.assistantPendingAction.create({
      data: {
        assistantId: params.assistantId,
        userId: params.userId,
        conversationId: params.conversationId,
        toolId: params.toolName,
        toolName: params.toolName,
        input: params.input,
        summary: params.summary,
        status: "PENDING",
      },
    });
    approvalRowIds.set(params.approvalId, row.id);
    return row.id;
  } catch (error) {
    console.warn("[HarnessAudit] Failed to log approval request:", error);
    return null;
  }
}

/** Settle the row when the broker decides: allowed-once → APPROVED, else REJECTED. */
async function settleHarnessApprovalRow(info: ApprovalDecidedInfo): Promise<void> {
  const rowId = approvalRowIds.get(info.approvalId);
  if (!rowId) return; // not a bot-chat approval this process logged (e.g. /api/harness/run) — nothing to update
  approvalRowIds.delete(info.approvalId);
  const status = info.outcome === "allowed-once" ? "APPROVED" : "REJECTED";
  try {
    await db.assistantPendingAction.update({ where: { id: rowId }, data: { status } });
  } catch (error) {
    console.warn("[HarnessAudit] Failed to settle approval row:", error);
  }
}

/**
 * Subscribe one broker to decision settling. The broker emits synchronously
 * when /api/harness/approve decides (or the request times out), and the row is
 * always created before a decision can land: the approval event is forwarded
 * to the turn's queue at request time, the decision only after a user acts.
 */
export function installApprovalDecisionHook(broker: ApprovalBroker = approvalBroker()): void {
  if (hookedBrokers.has(broker)) return;
  hookedBrokers.add(broker);
  broker.onDecided((info) => {
    void settleHarnessApprovalRow(info);
  });
}

/**
 * Everything a completed (or failed) turn can still record: tool rows and the
 * usage row. Approval rows were created/settled during the turn.
 */
export async function persistHarnessTurnAudit(params: {
  events: HarnessEvent[];
  conversationId: string;
  userId: string;
  durationMs: number;
  timings?: ToolCallTimings;
}): Promise<void> {
  const rows = harnessToolCallRows(params.events, params.conversationId, params.timings);
  await persistHarnessToolCalls(rows);
  const usage = harnessUsageParams(params.events);
  if (usage) {
    await persistHarnessUsage({ userId: params.userId, usage, durationMs: params.durationMs });
  }
}

/** Cost estimate mirroring the V1 usage row's estimatedCostUsd (documented for tests/reports). */
export function estimatedCostFor(usage: HarnessUsageParams): number {
  return estimateCostUsd(usage.model, usage.promptTokens, usage.completionTokens);
}
