/**
 * Pure parsing for the harness's newline-delimited JSON event stream.
 *
 * Kept side-effect free so the adapter's parsing logic is unit-testable without
 * spawning a process. Used by both the CLI-backed runtime and, later, the
 * in-process cordis runtime — both emit the same projector format.
 */

import type { HarnessEvent } from "./client";

/** Parse one NDJSON line; null for blank lines or diagnostics (non-JSON). */
export function parseHarnessLine(line: string): HarnessEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as HarnessEvent;
    return typeof parsed?.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** The session id announced by the stream, if any. */
export function sessionIdOf(events: HarnessEvent[]): string | null {
  for (const event of events) {
    if (event.type === "session" && typeof event.sessionId === "string" && event.sessionId) return event.sessionId;
  }
  return null;
}

/** Final answer: the `final` event wins; otherwise the last text event. */
export function finalTextOf(events: HarnessEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "final" && typeof event.text === "string") return event.text;
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "text" && typeof event.text === "string" && event.text) return event.text;
  }
  return "";
}

/** The turn's token usage, from the last step_end carrying one. */
export function usageOf(events: HarnessEvent[]): HarnessEvent["usage"] {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].phase === "step_end" && events[i].usage) return events[i].usage;
  }
  return undefined;
}

/** Number of completed steps (agent iterations) in the run. */
export function stepCountOf(events: HarnessEvent[]): number {
  return events.filter((event) => event.phase === "step_end").length;
}

/**
 * Distinct tool names a turn called, in first-call order — the done payload's
 * toolCallsUsed array (TASK 3: tool timeline).
 */
export function toolCallsUsedOf(events: HarnessEvent[]): string[] {
  const names: string[] = [];
  for (const event of events) {
    if (event.type === "tool_call" && typeof event.tool === "string" && event.tool && !names.includes(event.tool)) {
      names.push(event.tool);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Plan preview (Tier-2): pure shaping of the harness's plan-mode surface.
//
// Evidence (scratch/tier2-plan-probe): plan mode is only entered through the
// harness's /plan surface, which the headless runner does not provide; the
// chat route activates it per turn (native host planMode option). Once
// active, the finished plan surfaces as the exit_plan_mode tool call's
// `input.plan` markdown, and the review runs through the user-questions
// waterfall the question broker already bridges (question id "plan-review",
// intent kind "plan-review", options Approve / Keep planning).
// ---------------------------------------------------------------------------

/** The plan-mode exit tool; its `input.plan` carries the complete plan. */
export const EXIT_PLAN_MODE = "exit_plan_mode";

/** The review question's intent kind, as the harness plan-mode service sends it. */
export const PLAN_REVIEW_KIND = "plan-review";

/** The review question's approve option label (exit_plan_mode compares it). */
export const PLAN_REVIEW_APPROVE = "Approve";

/** The review question's keep-planning option label. */
export const PLAN_REVIEW_KEEP_PLANNING = "Keep planning";

/** One exit_plan_mode tool call, shaped for the { type: "plan" } SSE payload. */
export interface HarnessPlanPayload {
  /** Stable wire id: the exit_plan_mode tool call id (or the review question id). */
  planId: string;
  /** The plan markdown, starting with a # heading. */
  text: string;
  /** The review question's broker id (answers go to /api/harness/answer). */
  questionId?: string;
  /** True once the review question is waiting for the user's decision. */
  review: boolean;
}

/**
 * The plan from an exit_plan_mode tool_call event, or null for anything else.
 * The projector shapes tool inputs as objects (`input.plan`); raw session
 * tool/call events carry the arguments as a JSON string, tolerated here so
 * both sources shape identically.
 */
export function planOfToolCall(event: HarnessEvent): HarnessPlanPayload | null {
  if (event.type !== "tool_call" || event.tool !== EXIT_PLAN_MODE) return null;
  const callId = typeof event.callId === "string" && event.callId ? event.callId : "";
  let input: unknown = event.input;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      input = null;
    }
  }
  const plan = typeof input === "object" && input !== null ? (input as { plan?: unknown }).plan : undefined;
  if (typeof plan !== "string" || plan.trim() === "") return null;
  return { planId: callId, text: plan, review: false };
}

/** A broker question carrying the harness review intent (options + kind). */
export interface PlanReviewQuestion {
  /** The review question's own id ("plan-review"). */
  id: string;
  question: string;
  /** The plan markdown the review presents (mirrors the tool call's input). */
  detail?: string;
  options?: Array<{ label?: string; description?: string }>;
  intent?: unknown;
}

/**
 * The plan review inside a question batch: the first question whose intent is
 * kind "plan-review", shaped for the { type: "plan" } SSE payload. The
 * originating exit_plan_mode call id rides in intent.callId, so the payload
 * can reuse the planId the UI already attached to the tool call.
 */
export function planReviewOfQuestion(questions: PlanReviewQuestion[], questionId?: string): HarnessPlanPayload | null {
  const review = questions.find((entry) => {
    const intent = entry?.intent;
    return typeof intent === "object" && intent !== null && (intent as { kind?: unknown }).kind === PLAN_REVIEW_KIND;
  });
  if (!review) return null;
  const intent = review.intent as { callId?: unknown };
  const planId = typeof intent?.callId === "string" && intent.callId ? intent.callId : "";
  const text = typeof review.detail === "string" && review.detail.trim() !== "" ? review.detail : review.question;
  return {
    planId,
    text,
    ...(questionId ? { questionId } : {}),
    review: true,
  };
}

/**
 * The approve option's label; the answer route and the UI send it back as the
 * review question's `selected` value so exit_plan_mode approves the plan.
 * The review intent carries the authoritative label; the harness default
 * applies when it is absent.
 */
export function planApproveLabelOf(questions: PlanReviewQuestion[]): string {
  const review = questions.find((entry) => entry?.intent && typeof entry.intent === "object" && (entry.intent as { kind?: unknown }).kind === PLAN_REVIEW_KIND);
  const label = (review?.intent as { approve?: unknown } | undefined)?.approve;
  return typeof label === "string" && label !== "" ? label : PLAN_REVIEW_APPROVE;
}
