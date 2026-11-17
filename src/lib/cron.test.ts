import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidCron, nextCronRun, parseCron } from "./ai/automation/cron";

describe("Cron expression parsing", () => {
  it("accepts standard five-field expressions", () => {
    assert.equal(isValidCron("0 9 * * *"), true);
    assert.equal(isValidCron("*/15 * * * *"), true);
    assert.equal(isValidCron("30 3 1,15 * 1-5"), true);
  });

  it("rejects malformed expressions", () => {
    assert.equal(isValidCron("0 9 * *"), false);
    assert.equal(isValidCron("0 25 * * *"), false);
    assert.equal(isValidCron("0 9 * * 9"), false);
    assert.equal(isValidCron("not a cron"), false);
    assert.equal(isValidCron("0 9 * * */0"), false);
  });

  it("expands ranges, lists and steps", () => {
    const parsed = parseCron("0,30 9-10 * * 1-5");
    assert.ok(parsed);
    assert.deepEqual([...parsed.minutes].sort((a, b) => a - b), [0, 30]);
    assert.deepEqual([...parsed.hours].sort((a, b) => a - b), [9, 10]);
    assert.deepEqual([...parsed.daysOfWeek].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });
});

describe("Next run calculation", () => {
  it("finds the next 09:00 for the daily brief", () => {
    // 2026-11-08T21:00:00 local -> next 09:00 is the following morning.
    const from = new Date(2026, 10, 8, 21, 0, 0);
    const next = nextCronRun("0 9 * * *", from);
    assert.ok(next);
    assert.equal(next.getDate(), 9);
    assert.equal(next.getHours(), 9);
    assert.equal(next.getMinutes(), 0);
    assert.equal(next.getSeconds(), 0);
  });

  it("returns the same day when the time has not passed yet", () => {
    const from = new Date(2026, 10, 8, 6, 0, 0);
    const next = nextCronRun("0 9 * * *", from);
    assert.ok(next);
    assert.equal(next.getDate(), 8);
    assert.equal(next.getHours(), 9);
  });

  it("is strictly after the reference time", () => {
    const from = new Date(2026, 10, 8, 9, 0, 0);
    const next = nextCronRun("0 9 * * *", from);
    assert.ok(next);
    assert.equal(next.getDate(), 9);
  });

  it("handles quarter-hourly schedules", () => {
    const from = new Date(2026, 10, 8, 10, 7, 0);
    const next = nextCronRun("*/15 * * * *", from);
    assert.ok(next);
    assert.equal(next.getMinutes(), 15);
    assert.equal(next.getHours(), 10);
  });

  it("returns null for an invalid expression", () => {
    assert.equal(nextCronRun("nope", new Date()), null);
  });
});
