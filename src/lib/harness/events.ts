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
