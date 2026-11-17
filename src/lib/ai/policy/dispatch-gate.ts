/**
 * The gate that governs background work.
 *
 * `resolveToolPolicy` was written for the chat path, where a human is sitting in
 * front of an approval card. The dispatcher runs agents with nobody watching, so
 * it needs a different final question: not "may this run?" but "may this run
 * *silently?*". Getting that wrong in the permissive direction is how a page an
 * agent just fetched steers a write — the classic indirect-injection path.
 *
 * Two rules keep this honest:
 *
 *  1. Before untrusted content enters the task, behaviour is exactly what it
 *     always was: a step runs unless the tool itself is flagged as needing
 *     approval. This gate never adds friction to a clean run.
 *  2. Once the task has read something written outside the CRM, anything the
 *     policy would want a person to see parks for approval instead of running,
 *     and anything the policy forbids fails outright.
 */

import { resolveToolPolicy, type PolicyInput, type PolicyDecision } from "./resolve-action";

export type DispatchGate = "run" | "park" | "block";

export interface DispatchGateResult {
  gate: DispatchGate;
  /** Why, in words a person reading the approval card can act on. */
  reason: string;
  decision: PolicyDecision;
}

export function gateDispatchStep(input: PolicyInput): DispatchGateResult {
  const decision = resolveToolPolicy(input);

  // A block is never a card: offering an approval button would imply the user
  // could override their own "never" decision from a background task.
  if (decision.decision === "deny") {
    return { gate: "block", reason: decision.reason, decision };
  }

  // Silence is only acceptable while the task is still clean.
  if (input.runTainted && decision.decision === "ask") {
    return { gate: "park", reason: decision.reason, decision };
  }

  return { gate: "run", reason: decision.reason, decision };
}
