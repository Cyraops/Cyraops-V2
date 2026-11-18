import assert from "node:assert/strict";
import { test } from "node:test";
import { smoothLevel } from "./recorder";

test("smoothLevel: attack is instant — sound jumps the meter straight up", () => {
  assert.equal(smoothLevel(0, 0.5), 0.5);
  assert.equal(smoothLevel(0.2, 0.6), 0.6);
  assert.equal(smoothLevel(0.9, 1), 1);
});

test("smoothLevel: release is eased — the meter fades instead of dropping to zero", () => {
  assert.equal(smoothLevel(0.8, 0.1), 0.8 * 0.85);
  assert.equal(smoothLevel(1, 0), 0.85);
});

test("smoothLevel: an equal level holds still", () => {
  assert.equal(smoothLevel(0.4, 0.4), 0.4);
});

test("smoothLevel: inputs are clamped to 0..1", () => {
  assert.equal(smoothLevel(0, 2), 1);
  assert.equal(smoothLevel(0, -3), 0);
  assert.equal(smoothLevel(5, 0.2), 0.85); // 5 clamped to 1, then decayed
});

test("smoothLevel: decay is configurable", () => {
  assert.equal(smoothLevel(1, 0, 0.5), 0.5);
});

test("smoothLevel: non-finite frames are ignored instead of freezing the meter", () => {
  assert.equal(smoothLevel(0.7, Number.NaN), 0.7);
  assert.equal(smoothLevel(0.7, Number.POSITIVE_INFINITY), 0.7);
  // A poisoned previous value recovers from zero on the next finite frame.
  assert.equal(smoothLevel(Number.NaN, 0.3), 0.3);
});

test("smoothLevel: repeated silence decays geometrically, never below zero", () => {
  let level = 1;
  for (let i = 0; i < 100; i += 1) level = smoothLevel(level, 0);
  assert.ok(level > 0 && level < 1e-6);
  assert.ok(level >= 0);
});
