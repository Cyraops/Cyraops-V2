import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreProspect, describeScore, LEAD_SCORE_VERSION } from "./lead-score";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("lead scoring", () => {
  it("is deterministic", () => {
    const signals = {
      cloudFootprint: { value: "aws" as const, state: "observed" as const },
      hiring: { value: 3, state: "observed" as const, observedAt: daysAgo(10) },
    };
    assert.deepEqual(scoreProspect(signals), scoreProspect(signals));
  });

  it("the breakdown always adds up to the score (or the knockout cap)", () => {
    const signals = {
      cloudFootprint: { value: "aws" as const, state: "observed" as const },
      headcount: { value: 120, state: "observed" as const },
      industryMatch: { value: "exact" as const, state: "observed" as const },
      funding: { value: "series_a_b" as const, state: "observed" as const, observedAt: daysAgo(5) },
      hiring: { value: 4, state: "observed" as const, observedAt: daysAgo(3) },
      publicPain: { value: "migration" as const, state: "observed" as const, observedAt: daysAgo(20) },
      authority: { value: "exec" as const, state: "observed" as const },
      reachable: { value: "verified" as const, state: "observed" as const },
      warmPath: { value: true, state: "observed" as const },
      valueBand: { value: "xl" as const, state: "observed" as const },
      timing: { value: "60" as const, state: "observed" as const },
    };
    const result = scoreProspect(signals);
    const sum = result.components.reduce((total, component) => total + component.points, 0);
    assert.equal(sum, result.rawScore);
    assert.equal(result.score, Math.min(result.rawScore, ...result.knockouts.map((k) => k.cap), 100));
    assert.equal(result.band, "A");
    assert.match(describeScore(result), /Band A/);
    assert.equal(result.version, LEAD_SCORE_VERSION);
  });

  it("decays stale intent to nothing", () => {
    const fresh = scoreProspect({ hiring: { value: 2, state: "observed", observedAt: daysAgo(1) } });
    const stale = scoreProspect({ hiring: { value: 2, state: "observed", observedAt: daysAgo(400) } });
    assert.ok(fresh.score > stale.score);
    assert.equal(stale.components.find((c) => c.id === "B2")?.points, 0);
  });

  it("knockouts cap rather than subtract", () => {
    const strong = scoreProspect({
      cloudFootprint: { value: "aws", state: "observed" },
      headcount: { value: 100, state: "observed" },
      industryMatch: { value: "exact", state: "observed" },
      knockout: { competitor: true },
    });
    assert.equal(strong.score, 20);

    const weak = scoreProspect({ warmPath: { value: true, state: "observed" }, knockout: { competitor: true } });
    assert.equal(weak.score, 3, "a cap must not reduce points below the earned total");
  });

  it("distinguishes checked-absent from never-checked", () => {
    const checked = scoreProspect({
      funding: { value: "none", state: "checked_absent" },
      hiring: { value: 0, state: "checked_absent" },
      publicPain: { value: "none", state: "checked_absent" },
    });
    const unchecked = scoreProspect({});
    assert.equal(checked.band, "D", "we looked and found nothing → a real low score");
    assert.equal(unchecked.band, "INSUFFICIENT_DATA", "we never looked → unknown, not bad");
    assert.ok(unchecked.unchecked.length > 0);
  });

  it("bands by score once intent has actually been checked", () => {
    // A weak but fully-researched lead is a real D, not "unknown".
    const weak = scoreProspect({
      warmPath: { value: true, state: "observed" },
      funding: { value: "none", state: "checked_absent" },
      hiring: { value: 0, state: "checked_absent" },
      publicPain: { value: "none", state: "checked_absent" },
    });
    assert.equal(weak.score, 3);
    assert.equal(weak.band, "D");

    // A strong, freshly-researched lead lands in A.
    const strong = scoreProspect({
      cloudFootprint: { value: "aws", state: "observed" },
      headcount: { value: 120, state: "observed" },
      industryMatch: { value: "exact", state: "observed" },
      funding: { value: "series_a_b", state: "observed", observedAt: daysAgo(2) },
      hiring: { value: 3, state: "observed", observedAt: daysAgo(2) },
      publicPain: { value: "cost", state: "observed", observedAt: daysAgo(2) },
      authority: { value: "exec", state: "observed" },
      reachable: { value: "verified", state: "observed" },
      valueBand: { value: "xl", state: "observed" },
      timing: { value: "60", state: "observed" },
    });
    assert.ok(strong.score >= 75, `expected A band, got ${strong.score}`);
    assert.equal(strong.band, "A");
  });

  it("scores zero with an empty input and still explains itself", () => {
    const empty = scoreProspect({});
    assert.equal(empty.score, 0);
    assert.ok(empty.components.every((component) => component.state === "not_checked"));
  });
});
