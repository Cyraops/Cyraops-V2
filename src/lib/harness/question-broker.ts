/**
 * The in-process question broker between the harness plugin's user-question
 * answerer and the HTTP layer.
 *
 * The harness resolves an `ask_user_question` tool call through the
 * `user-questions/request` answerer waterfall (dsh-user-questions:
 * UserQuestionService.ask → waterfall, fail-closed with NO_PROVIDER when no
 * answerer accepts). In the native runtime the harness tree runs inside the
 * Next.js server process, so the cyraops-crm plugin's answerer publishes each
 * question here (via a globalThis symbol, because the plugin's module graph
 * is served by the vendored loader and cannot import Next code) and waits for
 * the user's answer.
 *
 * The broker:
 * - mints a wire-safe questionId per request (the tool call id when known),
 * - emits the request to the active turn's event queue (native-runtime
 *   subscribes and pushes a { type: "question" } harness event),
 * - resolves the answer when /api/harness/answer calls answer(),
 * - settles unattended questions with a skip batch after a timeout (below the
 *   tool's default 120s timed wait, so a turn whose user walked away still
 *   completes gracefully: the model receives the documented skip semantics
 *   — "empty selected and no custom" — instead of hanging or crashing),
 * - cancels on demand (the answerer forwards the harness request signal's
 *   abort).
 *
 * Only one turn runs at a time (the native runtime's global turn mutex), so
 * a single process-wide pending map is safe.
 */

import { randomUUID } from "node:crypto";

/** One question of the batch, in the service's wire vocabulary. */
export interface BrokerQuestion {
  id: string;
  question: string;
}

/** One answered question of the batch the tool result carries. */
export interface QuestionAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

/** The complete answer batch shape the answerer waterfall must return. */
export interface QuestionAnswerBatch {
  answers: QuestionAnswerItem[];
}

export interface QuestionRequestInfo {
  questions: BrokerQuestion[];
  /** The tool call this question was asked through (timed waits carry it). */
  callId?: string;
  /** The harness request signal; abort cancels the pending question. */
  signal?: AbortSignal;
}

export interface PendingQuestion {
  questionId: string;
  questions: BrokerQuestion[];
  /** Primary question text shown by the inline UI (first question of the batch). */
  text: string;
  callId?: string;
  decision: Promise<QuestionAnswerBatch>;
  cancel: () => void;
  timedOut: boolean;
  settled: boolean;
}

export interface QuestionDecidedInfo {
  questionId: string;
  /** True when the broker's own timeout settled the batch (skipped). */
  timedOut: boolean;
}

interface PendingRecord {
  info: QuestionRequestInfo;
  resolve: (batch: QuestionAnswerBatch) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
  settled: boolean;
  timedOut: boolean;
}

/** Raised by cancel(); the answerer rethrows it so the service maps the abort. */
export class QuestionAbortedError extends Error {
  constructor() {
    super("ask_user_question was cancelled before the user answered");
    this.name = "QuestionAbortedError";
  }
}

export const QUESTION_BROKER_KEY = Symbol.for("cyraops.harness.question-broker");

/**
 * Map one free-text answer onto the batch the service expects. The typed text
 * answers the FIRST question as its `custom` value; any remaining questions
 * of a multi-question batch are settled with the documented skip semantics
 * (empty `selected`, no `custom`), so the model continues without re-asking.
 */
export function answerBatchForText(questions: BrokerQuestion[], answerText: string): QuestionAnswerBatch {
  const text = answerText.trim();
  return {
    answers: questions.map((question, index) =>
      index === 0
        ? { id: question.id, selected: [], ...(text ? { custom: text } : {}) }
        : { id: question.id, selected: [] }
    ),
  };
}

/** The primary text the inline UI shows: the batch's first question. */
export function questionTextOf(questions: BrokerQuestion[]): string {
  return questions[0]?.question ?? "The assistant needs your input.";
}

export class QuestionBroker {
  private readonly pending = new Map<string, PendingRecord>();
  private readonly requestListeners = new Set<(request: PendingQuestion) => void>();
  private readonly decidedListeners = new Set<(info: QuestionDecidedInfo) => void>();

  constructor(private readonly timeoutMs: number = 110_000) {}

  /** The broker instance the plugin finds on globalThis (same symbol). */
  install(): this {
    (globalThis as Record<symbol, unknown>)[QUESTION_BROKER_KEY] = this;
    return this;
  }

  uninstall(): void {
    if ((globalThis as Record<symbol, unknown>)[QUESTION_BROKER_KEY] === this) {
      delete (globalThis as Record<symbol, unknown>)[QUESTION_BROKER_KEY];
    }
  }

  /** Publish a new question; the answer arrives via answer()/cancel()/timeout. */
  request(info: QuestionRequestInfo): PendingQuestion {
    // A timed tool call's id is the stable wire key; anything else (or a
    // duplicate) gets a minted id so two pending questions never collide.
    const callIdKey = info.callId && info.callId.length > 0 ? `${info.callId}` : "";
    const questionId = callIdKey && !this.pending.has(callIdKey) ? callIdKey : randomUUID();
    let resolveDecision!: (batch: QuestionAnswerBatch) => void;
    let rejectDecision!: (error: Error) => void;
    const decision = new Promise<QuestionAnswerBatch>((resolve, reject) => {
      resolveDecision = resolve;
      rejectDecision = reject;
    });
    const record: PendingRecord = {
      info,
      resolve: resolveDecision,
      reject: rejectDecision,
      timer: null,
      settled: false,
      timedOut: false,
    };
    const settle = (batch: QuestionAnswerBatch, timedOut: boolean) => {
      if (record.settled) return;
      record.settled = true;
      record.timedOut = timedOut;
      if (record.timer) clearTimeout(record.timer);
      record.timer = null;
      this.pending.delete(questionId);
      resolveDecision(batch);
      this.emitDecided({ questionId, timedOut });
    };
    // Unattended questions settle as skipped so the turn completes gracefully
    // (the model continues per the skip semantics instead of hanging).
    record.timer = setTimeout(() => settle(answerBatchForText(info.questions, ""), true), this.timeoutMs);
    this.pending.set(questionId, record);
    const pendingQuestion: PendingQuestion = {
      questionId,
      questions: info.questions,
      text: questionTextOf(info.questions),
      callId: info.callId,
      decision,
      // Cancellation REJECTS the decision (never a skip batch): the abort then
      // propagates through the answerer so the service records the question as
      // pending/aborted instead of silently claiming the user skipped it.
      cancel: () => {
        if (record.settled) return;
        record.settled = true;
        if (record.timer) clearTimeout(record.timer);
        record.timer = null;
        this.pending.delete(questionId);
        rejectDecision(new QuestionAbortedError());
        this.emitDecided({ questionId, timedOut: false });
      },
      get timedOut() {
        return record.timedOut;
      },
      get settled() {
        return record.settled;
      },
    };
    for (const listener of this.requestListeners) listener(pendingQuestion);
    return pendingQuestion;
  }

  /**
   * The user's answer from /api/harness/answer. Unknown/already-settled ids
   * throw; the returned batch is what the answerer hands the service.
   */
  answer(questionId: string, answerText: string): { batch: QuestionAnswerBatch; timedOut: boolean } {
    const record = this.pending.get(questionId);
    if (!record) throw new Error("Question request not found or already answered");
    const batch = answerBatchForText(record.info.questions, answerText);
    if (record.timer) clearTimeout(record.timer);
    record.timer = null;
    this.pending.delete(questionId);
    record.settled = true;
    record.resolve(batch);
    this.emitDecided({ questionId, timedOut: false });
    return { batch, timedOut: false };
  }

  /** Read-only view of a pending question (route diagnostics; never an answer). */
  peek(questionId: string): PendingQuestion | null {
    const record = this.pending.get(questionId);
    if (!record) return null;
    return {
      questionId,
      questions: record.info.questions,
      text: questionTextOf(record.info.questions),
      callId: record.info.callId,
      decision: Promise.resolve(answerBatchForText(record.info.questions, "")),
      cancel: () => {},
      timedOut: record.timedOut,
      settled: record.settled,
    };
  }

  /** Number of questions currently waiting for an answer. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Subscribe to new questions (the native runtime forwards them as events). */
  onRequest(listener: (request: PendingQuestion) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  /** Subscribe to settlements. */
  onDecided(listener: (info: QuestionDecidedInfo) => void): () => void {
    this.decidedListeners.add(listener);
    return () => this.decidedListeners.delete(listener);
  }

  private emitDecided(info: QuestionDecidedInfo): void {
    for (const listener of this.decidedListeners) listener(info);
  }
}

/** The process-wide broker the runtime, bot-stream and the answer route share. */
let defaultBroker: QuestionBroker | null = null;
export function questionBroker(): QuestionBroker {
  return (defaultBroker ??= new QuestionBroker(
    Number(process.env.HARNESS_QUESTION_TIMEOUT_MS) > 0
      ? Number(process.env.HARNESS_QUESTION_TIMEOUT_MS)
      : 110_000
  ).install());
}
