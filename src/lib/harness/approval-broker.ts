/**
 * The in-process approval broker between the harness plugin's approval
 * answerer and the HTTP layer.
 *
 * The harness resolves an approval `ask` through the `approval/request`
 * answerer waterfall (dsh-user-approval: ApprovalService.request → decide()).
 * In the native runtime the harness tree runs inside the Next.js server
 * process, so the cyraops-crm plugin's answerer publishes each request here
 * (via a globalThis symbol, because the plugin's module graph is served by
 * the vendored loader and cannot import Next code) and waits for a decision.
 *
 * The broker:
 * - mints a wire-safe approvalId per request,
 * - emits the request to the active turn's event queue (native-runtime
 *   subscribes and pushes a { type: "approval" } harness event),
 * - resolves the decision when /api/harness/approve calls decide(),
 * - auto-rejects after a timeout (below the 180s turn timeout, so a denied
 *   turn still completes within the run window),
 * - cancels on demand (the answerer forwards the harness request signal's
 *   abort).
 *
 * Only one turn runs at a time (the native runtime's global turn mutex), so
 * a single process-wide pending map is safe.
 */

import { randomUUID } from "node:crypto";

export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled";

export interface ApprovalRequestInfo {
  toolName: string;
  callId?: string;
  reason?: string;
  /** Human-readable summary shown on the approval card. */
  summary: string;
}

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  summary: string;
  /** Epoch ms at which an unanswered request auto-rejects (the countdown the card shows). */
  deadline: number;
  decision: Promise<ApprovalOutcome>;
  /** Settles once the decision is known (same moment decision resolves). */
  outcome: Promise<ApprovalOutcome>;
  cancel: () => void;
  timedOut: boolean;
  settled: boolean;
}

export interface ApprovalDecidedInfo {
  approvalId: string;
  outcome: ApprovalOutcome;
  timedOut: boolean;
}

interface PendingRecord {
  info: ApprovalRequestInfo;
  resolve: (outcome: ApprovalOutcome) => void;
  timer: NodeJS.Timeout | null;
  settled: boolean;
  timedOut: boolean;
  deadline: number;
}

export const APPROVAL_BROKER_KEY = Symbol.for("cyraops.harness.approval-broker");

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingRecord>();
  private readonly requestListeners = new Set<(request: PendingApproval) => void>();
  private readonly decidedListeners = new Set<(info: ApprovalDecidedInfo) => void>();

  constructor(private readonly timeoutMs: number = 60_000) {}

  /** The broker instance the plugin finds on globalThis (same symbol). */
  install(): this {
    (globalThis as Record<symbol, unknown>)[APPROVAL_BROKER_KEY] = this;
    return this;
  }

  uninstall(): void {
    if ((globalThis as Record<symbol, unknown>)[APPROVAL_BROKER_KEY] === this) {
      delete (globalThis as Record<symbol, unknown>)[APPROVAL_BROKER_KEY];
    }
  }

  /** Publish a new approval request; the decision arrives via decide()/cancel()/timeout. */
  request(info: ApprovalRequestInfo): PendingApproval {
    const approvalId = randomUUID();
    let resolveDecision!: (outcome: ApprovalOutcome) => void;
    const decision = new Promise<ApprovalOutcome>((resolve) => {
      resolveDecision = resolve;
    });
    const record: PendingRecord = {
      info,
      resolve: resolveDecision,
      timer: null,
      settled: false,
      timedOut: false,
      deadline: Date.now() + this.timeoutMs,
    };
    const settle = (outcome: ApprovalOutcome, timedOut: boolean) => {
      if (record.settled) return;
      record.settled = true;
      record.timedOut = timedOut;
      if (record.timer) clearTimeout(record.timer);
      record.timer = null;
      this.pending.delete(approvalId);
      resolveDecision(outcome);
      this.emitDecided({ approvalId, outcome, timedOut });
    };
    record.timer = setTimeout(() => settle("rejected", true), this.timeoutMs);
    this.pending.set(approvalId, record);
    const pendingApproval: PendingApproval = {
      approvalId,
      toolName: info.toolName,
      callId: info.callId,
      reason: info.reason,
      summary: info.summary,
      deadline: record.deadline,
      decision,
      outcome: decision,
      cancel: () => settle("cancelled", false),
      get timedOut() {
        return record.timedOut;
      },
      get settled() {
        return record.settled;
      },
    };
    for (const listener of this.requestListeners) listener(pendingApproval);
    return pendingApproval;
  }

  /** The user's decision from /api/harness/approve. Unknown/already-decided ids throw. */
  decide(approvalId: string, approve: boolean): ApprovalOutcome {
    const record = this.pending.get(approvalId);
    if (!record) throw new Error("Approval request not found or already decided");
    const outcome: ApprovalOutcome = approve ? "allowed-once" : "rejected";
    if (record.timer) clearTimeout(record.timer);
    record.timer = null;
    this.pending.delete(approvalId);
    record.settled = true;
    record.resolve(outcome);
    this.emitDecided({ approvalId, outcome, timedOut: false });
    return outcome;
  }

  /** Read-only view of a pending request (route diagnostics; never a decision). */
  peek(approvalId: string): PendingApproval | null {
    const record = this.pending.get(approvalId);
    if (!record) return null;
    return {
      approvalId,
      toolName: record.info.toolName,
      callId: record.info.callId,
      reason: record.info.reason,
      summary: record.info.summary,
      deadline: record.deadline,
      decision: Promise.resolve("cancelled"),
      outcome: Promise.resolve("cancelled"),
      cancel: () => {},
      timedOut: record.timedOut,
      settled: record.settled,
    };
  }

  /** Number of requests currently waiting for a decision. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Subscribe to new requests (the native runtime forwards them as events). */
  onRequest(listener: (request: PendingApproval) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  /** Subscribe to decisions. */
  onDecided(listener: (info: ApprovalDecidedInfo) => void): () => void {
    this.decidedListeners.add(listener);
    return () => this.decidedListeners.delete(listener);
  }

  private emitDecided(info: ApprovalDecidedInfo): void {
    for (const listener of this.decidedListeners) listener(info);
  }
}

/** The process-wide broker the runtime, bot-stream and the approve route share. */
let defaultBroker: ApprovalBroker | null = null;
export function approvalBroker(): ApprovalBroker {
  return (defaultBroker ??= new ApprovalBroker(
    Number(process.env.HARNESS_APPROVAL_TIMEOUT_MS) > 0
      ? Number(process.env.HARNESS_APPROVAL_TIMEOUT_MS)
      : 60_000
  ).install());
}
