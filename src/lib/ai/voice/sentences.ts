/**
 * Sentence boundaries for streamed replies.
 *
 * While tokens arrive, the voice screen speaks each finished sentence as soon
 * as its boundary appears (".", "!", "?" or "…" followed by whitespace or the
 * end of the text), instead of waiting for the whole answer. This module is
 * pure so the boundary rules are unit-testable.
 */

export interface SentenceSplit {
  /** The sentence, including its closing punctuation but not the trailing space. */
  sentence: string;
  /** Characters of `text` consumed by this sentence (without the trailing space). */
  consumed: number;
}

/**
 * The first complete sentence of `text`, or null when no boundary has arrived
 * yet — the caller then waits for more tokens.
 *
 * The trailing whitespace is left unconsumed on purpose: the next call starts
 * with it, so sentences in the stream stay separated exactly as written.
 */
export function nextSentence(text: string): SentenceSplit | null {
  const match = /^([\s\S]*?[.!?…])(?:\s|$)/.exec(text);
  if (!match) return null;
  return { sentence: match[1], consumed: match[1].length };
}
