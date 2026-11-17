/**
 * LEAD_SCORE_V1 — a deterministic, explainable lead score.
 *
 * The score used to be whatever integer the language model chose, clamped to
 * 0-100. That number ordered the whole pipeline and could not be explained,
 * reproduced, or defended, and an injected instruction could set it to anything.
 * This module computes the number from stored signals instead: same inputs, same
 * score, and every point traceable to a reason.
 */

export const LEAD_SCORE_VERSION = "LEAD_SCORE_V1";

/** Whether a signal was actually looked at, and what it showed. */
export type SignalState = "observed" | "checked_absent" | "not_checked";

export interface Signal<T> {
  value?: T;
  state: SignalState;
  observedAt?: string | Date;
}

export interface LeadSignals {
  /** A. Fit — can they buy what we actually deliver? (max 30) */
  cloudFootprint?: Signal<"aws" | "azure" | "gcp" | "none">;
  headcount?: Signal<number>;
  industryMatch?: Signal<"exact" | "adjacent" | "none">;
  /** B. Intent — are they moving right now? (max 40) */
  funding?: Signal<"series_a_b" | "seed" | "none">;
  hiring?: Signal<number>;
  publicPain?: Signal<"migration" | "cost" | "compliance" | "outage" | "blog" | "none">;
  /** C. Access — can we reach the person who decides? (max 15) */
  authority?: Signal<"exec" | "lead" | "none">;
  reachable?: Signal<"verified" | "form" | "none">;
  warmPath?: Signal<boolean>;
  /** D. Commercial — is it worth the effort? (max 15) */
  valueBand?: Signal<"xl" | "l" | "m" | "s" | "unknown">;
  timing?: Signal<"60" | "180" | "none">;
  knockout?: {
    competitor?: boolean;
    repeatLost?: boolean;
    freeMailOnly?: boolean;
    cheapest?: boolean;
    archived?: boolean;
  };
}

export type LeadBand = "A" | "B" | "C" | "D" | "INSUFFICIENT_DATA";

export interface ScoreComponent {
  id: string;
  label: string;
  points: number;
  maxPoints: number;
  state: SignalState;
}

export interface ScoreKnockout {
  id: string;
  cap: number;
  reason: string;
}

export interface LeadScoreResult {
  score: number;
  band: LeadBand;
  version: string;
  components: ScoreComponent[];
  knockouts: ScoreKnockout[];
  /** Points before any knockout cap was applied. */
  rawScore: number;
  /** Signals that were never looked at, so the caller knows what is unknown. */
  unchecked: string[];
}

const DAY_MS = 86_400_000;

/** Linear decay to zero over `days`; a signal from the future is treated as fresh. */
function decay(value: number, observedAt: string | Date | undefined, days: number): number {
  if (!observedAt) return value;
  const at = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(at.getTime())) return value;
  const ageDays = (Date.now() - at.getTime()) / DAY_MS;
  if (ageDays <= 0) return value;
  const factor = Math.max(0, 1 - ageDays / days);
  return Math.round(value * factor);
}

function part(
  id: string,
  label: string,
  signal: Signal<any> | undefined,
  points: number,
  maxPoints: number
): ScoreComponent {
  const state: SignalState = signal?.state ?? "not_checked";
  // checked_absent is a real answer (a genuine 0); not_checked earns nothing but
  // is reported separately so an unresearched lead is not mistaken for a bad one.
  const awarded = state === "observed" ? points : 0;
  return { id, label, points: awarded, maxPoints, state };
}

export function scoreProspect(signals: LeadSignals = {}): LeadScoreResult {
  const s = signals;
  const components: ScoreComponent[] = [];

  // ---- A. Fit (30) ----
  const cloud =
    s.cloudFootprint?.state === "observed"
      ? s.cloudFootprint.value === "aws"
        ? 12
        : s.cloudFootprint.value === "azure" || s.cloudFootprint.value === "gcp"
          ? 4
          : 0
      : 0;
  components.push(part("A1", "Cloud footprint", s.cloudFootprint, cloud, 12));

  const headcountPoints =
    s.headcount?.state === "observed" && typeof s.headcount.value === "number"
      ? s.headcount.value >= 20 && s.headcount.value <= 200
        ? 8
        : s.headcount.value > 200 && s.headcount.value <= 1000
          ? 5
          : s.headcount.value < 20
            ? 4
            : 2
      : 0;
  components.push(part("A2", "Company size", s.headcount, headcountPoints, 8));

  const industryPoints =
    s.industryMatch?.state === "observed"
      ? s.industryMatch.value === "exact"
        ? 10
        : s.industryMatch.value === "adjacent"
          ? 5
          : 0
      : 0;
  components.push(part("A3", "Industry fit", s.industryMatch, industryPoints, 10));

  // ---- B. Intent (40), decayed ----
  const fundingPoints =
    s.funding?.state === "observed"
      ? decay(
          s.funding.value === "series_a_b" ? 14 : s.funding.value === "seed" ? 8 : 0,
          s.funding.observedAt,
          365
        )
      : 0;
  components.push(part("B1", "Funding", s.funding, fundingPoints, 14));

  const hiringPoints =
    s.hiring?.state === "observed" && typeof s.hiring.value === "number"
      ? decay(
          s.hiring.value >= 2 ? 14 : s.hiring.value === 1 ? 8 : 0,
          s.hiring.observedAt,
          180
        )
      : 0;
  components.push(part("B2", "Hiring for our services", s.hiring, hiringPoints, 14));

  const painPoints =
    s.publicPain?.state === "observed"
      ? decay(
          ["migration", "cost", "compliance", "outage"].includes(String(s.publicPain.value))
            ? 12
            : s.publicPain.value === "blog"
              ? 3
              : 0,
          s.publicPain.observedAt,
          365
        )
      : 0;
  components.push(part("B3", "Public pain", s.publicPain, painPoints, 12));

  // ---- C. Access (15) ----
  const authorityPoints =
    s.authority?.state === "observed"
      ? s.authority.value === "exec"
        ? 8
        : s.authority.value === "lead"
          ? 5
          : 2
      : 0;
  components.push(part("C1", "Decision-maker access", s.authority, authorityPoints, 8));

  const reachablePoints =
    s.reachable?.state === "observed"
      ? s.reachable.value === "verified"
        ? 4
        : s.reachable.value === "form"
          ? 2
          : 0
      : 0;
  components.push(part("C2", "Reachable contact", s.reachable, reachablePoints, 4));

  const warmPoints = s.warmPath?.state === "observed" && s.warmPath.value === true ? 3 : 0;
  components.push(part("C3", "Warm path", s.warmPath, warmPoints, 3));

  // ---- D. Commercial (15) ----
  const valuePoints =
    s.valueBand?.state === "observed"
      ? s.valueBand.value === "xl"
        ? 10
        : s.valueBand.value === "l"
          ? 7
          : s.valueBand.value === "m"
            ? 4
            : s.valueBand.value === "s"
              ? 1
              : 0
      : 0;
  components.push(part("D1", "Deal value", s.valueBand, valuePoints, 10));

  const timingPoints =
    s.timing?.state === "observed"
      ? s.timing.value === "60"
        ? 5
        : s.timing.value === "180"
          ? 3
          : 0
      : 0;
  components.push(part("D2", "Stated timing", s.timing, timingPoints, 5));

  // ---- Knockouts CAP, they never subtract ----
  const knockouts: ScoreKnockout[] = [];
  const k = s.knockout ?? {};
  if (k.competitor) knockouts.push({ id: "K1", cap: 20, reason: "Competitor or reseller" });
  if (k.repeatLost) knockouts.push({ id: "K2", cap: 25, reason: "Lost to us at this company in the last year" });
  if (k.freeMailOnly) knockouts.push({ id: "K3", cap: 30, reason: "Only a free-mail contact, no company domain" });
  if (k.cheapest) knockouts.push({ id: "K4", cap: 35, reason: "Explicitly shopping on lowest price" });

  const rawScore = components.reduce((total, component) => total + component.points, 0);
  const tightest = knockouts.reduce((cap, entry) => Math.min(cap, entry.cap), 100);
  const score = Math.min(rawScore, tightest);

  // ---- Band ----
  const intent = [s.funding, s.hiring, s.publicPain];
  const unchecked = components.filter((component) => component.state === "not_checked").map((c) => c.id);
  const intentUnchecked = intent.filter((signal) => (signal?.state ?? "not_checked") === "not_checked").length;

  let band: LeadBand;
  if (intentUnchecked >= 2) band = "INSUFFICIENT_DATA";
  else if (score >= 75) band = "A";
  else if (score >= 55) band = "B";
  else if (score >= 35) band = "C";
  else band = "D";

  return {
    score,
    band,
    version: LEAD_SCORE_VERSION,
    components,
    knockouts,
    rawScore,
    unchecked,
  };
}

/** One-line reason string for the activity trail / UI. */
export function describeScore(result: LeadScoreResult): string {
  const top = [...result.components].sort((a, b) => b.points - a.points).slice(0, 3).filter((c) => c.points > 0);
  const head = `${result.band === "INSUFFICIENT_DATA" ? "Unscored" : `Band ${result.band}`} — ${result.score}/100`;
  if (!top.length) return `${head}; no scoring signals collected yet`;
  return `${head} (${top.map((c) => `${c.label} +${c.points}`).join(", ")}${
    result.knockouts.length ? `; capped by ${result.knockouts.map((x) => x.id).join("+")}` : ""
  })`;
}
