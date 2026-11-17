/**
 * The assistant used to send the last 20 messages and hope they fit. A document
 * dump or a long thread would silently blow the model's context window. This
 * module makes the window explicit: it estimates cost, and picks a contiguous
 * recent suffix that fits, never dropping the current question.
 */

export interface ContextMessage {
  role: string;
  content: string;
}

export interface BudgetOptions {
  /** Hard input budget for the conversation history. */
  maxTokens?: number;
  /** Always keep at least this many of the most recent messages. */
  minRecent?: number;
}

export interface SelectedContext<T extends ContextMessage> {
  messages: T[];
  /** Messages older than the window (replaced by the rolling summary). */
  dropped: number;
  estimatedTokens: number;
}

/**
 * Deliberately pessimistic, and script-aware.
 *
 * ASCII prose runs ~3.4 characters per token. Hindi/Devanagari and CJK tokenise
 * far worse (~1.2 chars/token), so a flat ratio under-counted those threads by
 * 3-5x: they passed the budget check and then the provider rejected the request
 * outright. Over-estimating only costs a little context; under-estimating
 * breaks the call.
 */
const ASCII_CHARS_PER_TOKEN = 3.4;
const NON_ASCII_TOKENS_PER_CHAR = 1 / 1.2;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let nonAscii = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 127) nonAscii += 1;
  }
  const ascii = text.length - nonAscii;
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + nonAscii * NON_ASCII_TOKENS_PER_CHAR);
}

export const DEFAULT_HISTORY_TOKENS = 6000;

export function selectContext<T extends ContextMessage>(
  messages: T[],
  options: BudgetOptions = {}
): SelectedContext<T> {
  const maxTokens = options.maxTokens ?? DEFAULT_HISTORY_TOKENS;
  const minRecent = options.minRecent ?? 4;

  if (messages.length === 0) return { messages: [], dropped: 0, estimatedTokens: 0 };

  // Walk backwards so the most recent turns are always kept, then restore order.
  const kept: T[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = estimateTokens(message.content ?? "");
    const mustKeep = kept.length < minRecent;
    if (!mustKeep && used + cost > maxTokens) break;
    kept.push(message);
    used += cost;
  }

  kept.reverse();
  return {
    messages: kept,
    dropped: messages.length - kept.length,
    estimatedTokens: used,
  };
}

/** True when the conversation is long enough that summarising is worthwhile. */
export function shouldSummarize(total: number, summarizedCount: number, threshold = 30): boolean {
  return total - summarizedCount >= threshold;
}
