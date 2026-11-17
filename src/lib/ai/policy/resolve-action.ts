/**
 * One place that decides whether a tool call may run.
 *
 * Before this module the whole safety model was `tool.riskClass !== "CLASS_A"`
 * in the turn loop: the `requiresApproval`, `readOnly` and taint metadata we set
 * on every tool was never read. This resolver makes that metadata decisive and
 * adds the two properties that actually keep an assistant safe:
 *
 *  1. A DENY rule always wins. No "always allow", no mode, and no later rule can
 *     punch through a block.
 *  2. A tainted run — one where content from outside the CRM entered it, e.g. a
 *     web page or an email body — cannot quietly take an action that outside
 *     text could have asked for.
 */

export type ApprovalMode = "ASK" | "AUTO" | "NEVER";
export type RuleEffect = "ALLOW" | "DENY" | "ASK";
export type RiskClass = "CLASS_A" | "CLASS_B" | "CLASS_C";

export interface PolicyTool {
  id: string;
  riskClass: RiskClass;
  requiresApproval: boolean;
  /** Reads data, changes nothing. */
  readOnly?: boolean;
  /** Result may carry text an outsider wrote. */
  taintsRun?: boolean;
  /**
   * Reaches outside the CRM (a web page, a mailbox). Only these reads are worth
   * interrupting a tainted run for — reading our own data never is.
   */
  externalRead?: boolean;
  /** Saves content that outlives the turn (a memory, a page). */
  persistsContent?: boolean;
  /** So consequential that it can never be auto-approved, even by a rule. */
  explicitApproval?: boolean;
}

export interface PolicyRule {
  toolName: string;
  effect: RuleEffect;
}

export interface PolicyInput {
  tool: PolicyTool;
  rules: PolicyRule[];
  mode: ApprovalMode;
  /** Content from outside the CRM entered this run. */
  runTainted: boolean;
  /** Nobody is present to answer a card (routine, webhook, inbound email). */
  unattended?: boolean;
}

export interface PolicyDecision {
  decision: "allow" | "ask" | "deny";
  source: "rule" | "explicit" | "read" | "risk" | "mode" | "taint";
  reason: string;
  /** Whether the UI may offer "always allow this tool". */
  canAlwaysAllow: boolean;
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "ASK" || value === "AUTO" || value === "NEVER";
}

export function normalizeApprovalMode(value: unknown): ApprovalMode {
  return isApprovalMode(value) ? value : "ASK";
}

/**
 * Rule precedence is by effect, never by array order: a block outranks an
 * explicit ask, which outranks a standing allow. Picking the first match would
 * let a stored ALLOW rule silently defeat a later DENY.
 */
function ruleFor(rules: PolicyRule[], toolId: string): RuleEffect | undefined {
  const effects = rules.filter((rule) => rule.toolName === toolId).map((rule) => rule.effect);
  if (effects.includes("DENY")) return "DENY";
  if (effects.includes("ASK")) return "ASK";
  if (effects.includes("ALLOW")) return "ALLOW";
  return undefined;
}

export function resolveToolPolicy(input: PolicyInput): PolicyDecision {
  const { tool, rules, mode, runTainted, unattended = false } = input;
  const rule = ruleFor(rules, tool.id);

  // 1. A block is absolute. It survives every mode, every allow rule and taint.
  if (rule === "DENY") {
    return {
      decision: "deny",
      source: "rule",
      reason: `${tool.id} is blocked for this assistant.`,
      canAlwaysAllow: false,
    };
  }

  // 2. Security-boundary tools can never be permanently allowed, and a tainted
  //    run may not use them silently — outside text could have asked for them.
  if (tool.explicitApproval) {
    if (mode === "NEVER" && runTainted) {
      return {
        decision: "deny",
        source: "taint",
        reason: "Untrusted content entered this run, so this action cannot be taken silently.",
        canAlwaysAllow: false,
      };
    }
    return {
      decision: "ask",
      source: "explicit",
      reason: `${tool.id} always needs a person.`,
      canAlwaysAllow: false,
    };
  }

  const consequential = tool.requiresApproval || tool.riskClass !== "CLASS_A";

  // 3. Reads that change nothing are free — unless untrusted content entered
  //    the run, because then an outsider may have chosen what to look up
  //    (a read whose arguments were injected is how data gets exfiltrated).
  if (!consequential && tool.readOnly) {
    // Only a read that reaches outside the CRM can be steered into fetching
    // something it should not. Searching our own leads or the user's own chat
    // history is never worth an approval card, tainted run or not.
    if (runTainted && tool.externalRead && mode !== "NEVER") {
      return {
        decision: "ask",
        source: "taint",
        reason: "Untrusted content entered this run, so this fetch outside the CRM needs a person.",
        canAlwaysAllow: false,
      };
    }
    return {
      decision: "allow",
      source: "read",
      reason: `${tool.id} only reads.`,
      canAlwaysAllow: false,
    };
  }

  // 3b. Writing *content* (a memory, a page) is not a transaction, but it
  //     persists — which is exactly how an injection makes itself permanent.
  if (!consequential && tool.persistsContent && runTainted && mode !== "NEVER") {
    return {
      decision: "ask",
      source: "taint",
      reason: "Untrusted content entered this run, so saving new content needs a person.",
      canAlwaysAllow: false,
    };
  }

  // 4. Everything else is allowed outright.
  if (!consequential) {
    return {
      decision: "allow",
      source: "risk",
      reason: `${tool.id} is a safe action.`,
      canAlwaysAllow: false,
    };
  }

  // 5. From here the tool changes something. An explicit "ask" rule keeps asking.
  if (rule === "ASK") {
    return {
      decision: "ask",
      source: "rule",
      reason: `You asked to approve ${tool.id} every time.`,
      canAlwaysAllow: false,
    };
  }

  // 6. A standing allow skips the card — except where outside text steered the
  //    run, because then the human's earlier consent is no longer about this.
  // Taint beats a standing allow in EVERY mode: one "always allow" click used to
  // disarm the injection guard, so a page the assistant had just read could
  // steer the very tool the user had pre-approved.
  if (rule === "ALLOW" && !runTainted) {
    return {
      decision: "allow",
      source: "rule",
      reason: `You allowed ${tool.id} in advance.`,
      canAlwaysAllow: false,
    };
  }

  // 7. Mode decides what is left.
  if (mode === "NEVER") {
    // "Never ask" never means "never check": a steered run stops here rather
    // than acting on something an outsider asked for.
    if (runTainted) {
      return {
        decision: "deny",
        source: "taint",
        reason: "Untrusted content entered this run, so this action needs a person and this space never asks.",
        canAlwaysAllow: false,
      };
    }
    return {
      decision: "allow",
      source: "mode",
      reason: "This assistant never asks before acting.",
      canAlwaysAllow: false,
    };
  }

  if (mode === "AUTO" && tool.readOnly && !runTainted) {
    return {
      decision: "allow",
      source: "mode",
      reason: "Auto mode passes reads that untrusted content did not steer.",
      canAlwaysAllow: false,
    };
  }

  return {
    decision: "ask",
    source: "mode",
    reason: unattended
      ? "This run has nobody watching, so the action waits for you in the conversation."
      : `Approve ${tool.id} before it runs.`,
    canAlwaysAllow: !unattended,
  };
}

/** Any tool whose output can carry outsider text taints the run. */
export function toolTaintsRun(tool: PolicyTool): boolean {
  return Boolean(tool.taintsRun);
}
