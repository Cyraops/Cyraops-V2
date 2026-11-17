import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, selectContext, shouldSummarize, type ContextMessage } from "./budget";

function msgs(count: number, size = 400): ContextMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(size),
  }));
}

describe("context budget", () => {
  it("estimates tokens pessimistically", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("a".repeat(34)), 10);
  });

  it("counts non-ASCII text far higher, so Hindi threads do not overflow", () => {
    const hindi = "नमस्ते ".repeat(20); // 160 chars of Devanagari
    const ascii = "a".repeat(160);
    assert.ok(
      estimateTokens(hindi) > estimateTokens(ascii) * 2,
      `Hindi should cost much more than ASCII: ${estimateTokens(hindi)} vs ${estimateTokens(ascii)}`
    );
  });

  it("keeps everything when it fits", () => {
    const list = msgs(4);
    const selected = selectContext(list, { maxTokens: 100_000 });
    assert.equal(selected.messages.length, 4);
    assert.equal(selected.dropped, 0);
  });

  it("drops the oldest turns first and keeps the newest", () => {
    const list = msgs(60);
    const selected = selectContext(list, { maxTokens: 3000 });
    assert.ok(selected.dropped > 0);
    assert.ok(selected.estimatedTokens <= 3000);
    // The last message must survive: it is the question being answered.
    assert.deepEqual(selected.messages.at(-1), list.at(-1));
  });

  it("always keeps a minimum number of recent messages", () => {
    const list = msgs(10, 5000);
    const selected = selectContext(list, { maxTokens: 100, minRecent: 4 });
    assert.equal(selected.messages.length, 4);
  });

  it("preserves chronological order", () => {
    const list = msgs(20);
    const selected = selectContext(list, { maxTokens: 2000 });
    const firstIndex = list.indexOf(selected.messages[0]);
    const lastIndex = list.indexOf(selected.messages.at(-1)!);
    assert.ok(firstIndex < lastIndex);
  });

  it("handles an empty conversation", () => {
    const selected = selectContext([]);
    assert.deepEqual(selected, { messages: [], dropped: 0, estimatedTokens: 0 });
  });

  it("summarises only once enough new messages accumulate", () => {
    assert.equal(shouldSummarize(20, 0), false);
    assert.equal(shouldSummarize(35, 0), true);
    assert.equal(shouldSummarize(35, 10), false);
  });
});
