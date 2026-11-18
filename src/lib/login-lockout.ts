/**
 * Login rate-limit lockout math, shared by the login route and the login form.
 *
 * The semantics are the historical ones and must stay put: 12 failed attempts
 * per key (ip / email) inside a 15-minute window trip a 429. This module only
 * computes the remaining seconds so the client can render a ticking countdown.
 */

export const LOGIN_LOCKOUT_HITS = 12;

export interface RateLimitBucket {
  windowEnds: Date | number;
  hits: number;
}

/**
 * Seconds until the lockout lifts, or null when no bucket has tripped. When
 * several buckets trip (ip and email), the longest remaining window wins so
 * the countdown covers whichever clears last.
 */
export function retryAfterSecondsFor(
  buckets: RateLimitBucket[],
  now: Date | number = Date.now(),
  threshold: number = LOGIN_LOCKOUT_HITS,
): number | null {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const endsAt = (bucket: RateLimitBucket) =>
    typeof bucket.windowEnds === "number" ? bucket.windowEnds : bucket.windowEnds.getTime();
  const locked = buckets.filter((bucket) => endsAt(bucket) > nowMs && bucket.hits >= threshold);
  if (locked.length === 0) return null;
  const lockedUntil = Math.max(...locked.map(endsAt));
  return Math.max(1, Math.ceil((lockedUntil - nowMs) / 1000));
}

/** "899" → "14m 59s", the countdown spelling the login form shows. */
export function formatRetryAfter(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
