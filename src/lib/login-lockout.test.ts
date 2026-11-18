import { strict as assert } from "node:assert";
import test from "node:test";
import { LOGIN_LOCKOUT_HITS, formatRetryAfter, retryAfterSecondsFor } from "./login-lockout";

const MINUTE = 60 * 1000;

test("retryAfterSecondsFor: null while no bucket has tripped the threshold", () => {
  const now = new Date("2026-11-19T02:00:00Z");
  const buckets = [
    { windowEnds: new Date(now.getTime() + 15 * MINUTE), hits: LOGIN_LOCKOUT_HITS - 1 },
    { windowEnds: new Date(now.getTime() - MINUTE), hits: LOGIN_LOCKOUT_HITS + 5 }, // window expired
  ];
  assert.equal(retryAfterSecondsFor(buckets, now), null);
});

test("retryAfterSecondsFor: returns the seconds left on the tripping bucket", () => {
  const now = new Date("2026-11-19T02:00:00Z");
  const buckets = [{ windowEnds: new Date(now.getTime() + 15 * MINUTE), hits: LOGIN_LOCKOUT_HITS }];
  assert.equal(retryAfterSecondsFor(buckets, now), 900);
});

test("retryAfterSecondsFor: rounds up so the countdown never hits zero early", () => {
  const now = new Date("2026-11-19T02:00:00Z");
  const buckets = [{ windowEnds: new Date(now.getTime() + 899_001), hits: LOGIN_LOCKOUT_HITS }];
  assert.equal(retryAfterSecondsFor(buckets, now), 900);
});

test("retryAfterSecondsFor: a fully elapsed window never trips", () => {
  const now = new Date("2026-11-19T02:00:00Z");
  const buckets = [{ windowEnds: new Date(now.getTime() - 1), hits: LOGIN_LOCKOUT_HITS }];
  assert.equal(retryAfterSecondsFor(buckets, now), null);
});

test("retryAfterSecondsFor: when ip and email buckets both trip, the longest window wins", () => {
  const now = new Date("2026-11-19T02:00:00Z");
  const buckets = [
    { windowEnds: new Date(now.getTime() + 3 * MINUTE), hits: LOGIN_LOCKOUT_HITS },
    { windowEnds: new Date(now.getTime() + 14 * MINUTE), hits: LOGIN_LOCKOUT_HITS },
  ];
  assert.equal(retryAfterSecondsFor(buckets, now), 840);
});

test("retryAfterSecondsFor: accepts numeric timestamps", () => {
  const now = 1_770_000_000_000;
  const buckets = [{ windowEnds: now + 120_000, hits: LOGIN_LOCKOUT_HITS }];
  assert.equal(retryAfterSecondsFor(buckets, now), 120);
});

test("formatRetryAfter: renders the login form countdown spelling", () => {
  assert.equal(formatRetryAfter(899), "14m 59s");
  assert.equal(formatRetryAfter(900), "15m 0s");
  assert.equal(formatRetryAfter(59), "0m 59s");
  assert.equal(formatRetryAfter(1), "0m 1s");
  assert.equal(formatRetryAfter(0), "0m 0s");
});
