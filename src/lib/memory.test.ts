import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankMemories } from "./ai/assistant/runtime";

function memory(content: string, minutesAgo: number, pinned = false) {
  return { content, pinned, updatedAt: new Date(Date.now() - minutesAgo * 60_000) };
}

describe("memory recall ranking", () => {
  it("prefers a fact that matches the question over a newer unrelated one", () => {
    const rows = [
      memory("Client Acme pays net-30", 600),
      memory("User likes short answers", 1),
    ];
    const recalled = rankMemories(rows, "what are Acme's payment terms?", 1);
    assert.deepEqual(recalled, ["Client Acme pays net-30"]);
  });

  it("falls back to recency when nothing matches", () => {
    const rows = [memory("Older fact about pipelines", 500), memory("Newer fact about invoices", 5)];
    const recalled = rankMemories(rows, "completely unrelated words", 1);
    assert.deepEqual(recalled, ["Newer fact about invoices"]);
  });

  it("always surfaces a pinned fact", () => {
    const rows = [
      memory("Pinned: never email before 10am", 9999, true),
      memory("Unpinned about pricing", 1),
    ];
    const recalled = rankMemories(rows, "pricing", 2);
    assert.ok(recalled.includes("Pinned: never email before 10am"));
  });

  it("respects the recall limit", () => {
    const rows = Array.from({ length: 20 }, (_, index) => memory(`fact number ${index} about deals`, index));
    assert.equal(rankMemories(rows, "deals", 5).length, 5);
  });

  it("ignores stopword-length terms so matching stays meaningful", () => {
    const rows = [memory("Prefers Hindi for calls", 10), memory("Uses Notion for notes", 5)];
    // "to" and "is" are too short to count, so recency decides.
    const recalled = rankMemories(rows, "is it to", 1);
    assert.deepEqual(recalled, ["Uses Notion for notes"]);
  });
});
