/**
 * Win celebration tiers and the escalating count-up schedule, shared by every Sollish slot.
 * Pure: integer milliseconds and integer hundredths of the base bet, no clock, no DOM, no randomness.
 * Presentation only — a schedule re-states a total the engine already fixed; it can never change it.
 *
 * Owner rule (docs/product/game-standards.md §6): round total / base bet decides the tier —
 * Büyük ≥10×, Mega ≥25×, Süper ≥50×, Efsane ≥100×, plus Azami for a round that hit the cap. The
 * counter climbs THROUGH the tiers: it opens as Büyük and upgrades as it passes each threshold.
 */

import { MULTIPLIER_CLASS_MIN, WIN_TIER_THRESHOLDS as TIER_MULTIPLES } from '../slot-audio/win-tiers';

/** 0 = no celebration; 1..4 = Büyük, Mega, Süper, Efsane. */
export type WinTier = 0 | 1 | 2 | 3 | 4;
/** What a celebration screen shows: a tier, or 5 = Azami (capped round). */
export type CelebrationLevel = 1 | 2 | 3 | 4 | 5;
export const MAX_WIN_LEVEL = 5 as const;

export interface WinTierInfo {
  level: CelebrationLevel;
  id: 'big' | 'mega' | 'super' | 'epic' | 'max';
  /** Title case, for announcements and accessible names: "Mega Kazanç". */
  title: string;
  /** The tier word on the lockup, already upper-cased for Turkish ("SÜPER", "AZAMİ"). */
  word: string;
  /** Minimum round total in hundredths of the base bet (0 for Azami: the cap decides). */
  minHundredths: number;
}
export const WIN_TIER_INFO: Readonly<Record<CelebrationLevel, WinTierInfo>> = Object.freeze({
  1: Object.freeze({ level: 1, id: 'big', title: 'Büyük Kazanç', word: 'BÜYÜK', minHundredths: TIER_MULTIPLES[1] * 100 }),
  2: Object.freeze({ level: 2, id: 'mega', title: 'Mega Kazanç', word: 'MEGA', minHundredths: TIER_MULTIPLES[2] * 100 }),
  3: Object.freeze({ level: 3, id: 'super', title: 'Süper Kazanç', word: 'SÜPER', minHundredths: TIER_MULTIPLES[3] * 100 }),
  4: Object.freeze({ level: 4, id: 'epic', title: 'Efsane Kazanç', word: 'EFSANE', minHundredths: TIER_MULTIPLES[4] * 100 }),
  5: Object.freeze({ level: 5, id: 'max', title: 'Azami Kazanç', word: 'AZAMİ', minHundredths: 0 }),
} as const);
/** Tier thresholds in hundredths of the base bet: 10×, 25×, 50×, 100× (single source: the sound engine's tier table). */
export const WIN_TIER_THRESHOLDS: readonly [number, number, number, number] = Object.freeze([
  TIER_MULTIPLES[1] * 100, TIER_MULTIPLES[2] * 100, TIER_MULTIPLES[3] * 100, TIER_MULTIPLES[4] * 100,
]) as readonly [number, number, number, number];

/** Tier of a round total (hundredths of the base bet). */
export function winTierOf(totalHundredths: number): WinTier {
  const [t1, t2, t3, t4] = WIN_TIER_THRESHOLDS;
  if (!Number.isFinite(totalHundredths)) return 0;
  return totalHundredths >= t4 ? 4 : totalHundredths >= t3 ? 3 : totalHundredths >= t2 ? 2 : totalHundredths >= t1 ? 1 : 0;
}
/** floor(payout × 100 / bet): a payout in cents as hundredths of the base bet (for games that only know cents). */
export function winRatioHundredths(payoutCents: number, betCents: number): number {
  if (!Number.isSafeInteger(payoutCents) || !Number.isSafeInteger(betCents) || betCents <= 0 || payoutCents < 0) throw new RangeError('payout and bet must be non-negative integer cents, bet > 0');
  return Math.floor((payoutCents * 100) / betCents);
}

/** How a finished round is presented: nothing, a short meter flourish (<10×), or a full celebration screen. */
export type RoundCelebration = 'none' | 'flourish' | 'celebration';
export function roundCelebration(totalHundredths: number, capped: boolean): RoundCelebration {
  if (capped) return 'celebration';
  if (totalHundredths <= 0) return 'none';
  return winTierOf(totalHundredths) === 0 ? 'flourish' : 'celebration';
}

/* ------------------------------------------------------------------ multiplier callouts */
/** Multiplier callout treatment: 0 = plain (<10×), 1..4 = ≥10×, ≥25×, ≥50×, ≥100×. */
export const MULTIPLIER_CALLOUT_THRESHOLDS: readonly [number, number, number, number] = Object.freeze([
  MULTIPLIER_CLASS_MIN.x10, MULTIPLIER_CLASS_MIN.x25, MULTIPLIER_CLASS_MIN.x50, MULTIPLIER_CLASS_MIN.x100,
]) as readonly [number, number, number, number];
export function multiplierCalloutTier(multiplier: number): WinTier {
  const [a, b, c, d] = MULTIPLIER_CALLOUT_THRESHOLDS;
  if (!Number.isFinite(multiplier)) return 0;
  return multiplier >= d ? 4 : multiplier >= c ? 3 : multiplier >= b ? 2 : multiplier >= a ? 1 : 0;
}

/* ------------------------------------------------------------------ count-up schedule */
export type CountUpSpeed = 'normal' | 'quick' | 'turbo';
export interface CountUpOptions {
  speed?: CountUpSpeed;
  /** "Giriş ekranlarını atla": the count-up is capped to SKIP_COUNT_UP_MS and the hold to SKIP_HOLD_MS. */
  skipScreens?: boolean;
  reducedMotion?: boolean;
}
/** Base (normal speed) count-up time spent inside each tier's band: 0→25×, 25→50×, 50→100×, 100×→total. */
export const COUNT_UP_STAGE_MS = Object.freeze([3000, 1800, 1800, 2400] as const);
/** Base hold after the count-up, per final level (1..4, 5 = Azami). */
export const COUNT_UP_HOLD_MS = Object.freeze([1800, 2000, 2200, 2600, 3000] as const);
export const COUNT_UP_SPEED_FACTOR: Readonly<Record<CountUpSpeed, number>> = Object.freeze({ normal: 1, quick: 0.6, turbo: 0.35 });
/** Reduced motion keeps the climb but shortens it further. */
export const COUNT_UP_REDUCED_FACTOR = 0.45;
/** The count-up never gets shorter than this (except with skipped screens), so a turbo celebration stays readable. */
export const COUNT_UP_MIN_MS = 1500;
/** Holds never get shorter than this (except with skipped screens). */
export const COUNT_UP_MIN_HOLD_MS = 1200;
export const SKIP_COUNT_UP_MS = 1000;
export const SKIP_HOLD_MS = 600;

/** One band of the climb: the counter moves `from` → `to` (hundredths) over [at, at + dur) and shows `level`. */
export interface CountUpStage { level: CelebrationLevel; at: number; dur: number; from: number; to: number }
export interface CountUpSchedule {
  totalHundredths: number;
  capped: boolean;
  /** The level the screen ends on (5 when capped). */
  finalLevel: CelebrationLevel;
  /** Milliseconds until the counter shows the final total. */
  countUp: number;
  /** Milliseconds the final total stays before the screen closes by itself. */
  hold: number;
  stages: CountUpStage[];
}

/**
 * The escalation plan for a celebration. Stage k covers the band from tier k's threshold to tier k+1's
 * (the first band starts at 0), so a 40× win spends ≈3 s as Büyük then upgrades to Mega; each band gets
 * its own share of time regardless of how wide it is. A capped round adds a final Azami stage of length 0
 * at the end of the count-up. Durations scale with speed; their sum is exactly `countUp`.
 */
export function countUpSchedule(totalHundredths: number, capped: boolean, options: CountUpOptions = {}): CountUpSchedule {
  if (!Number.isSafeInteger(totalHundredths) || totalHundredths < 0) throw new RangeError('total must be non-negative integer hundredths');
  const speed = options.speed ?? 'normal';
  const tier = winTierOf(totalHundredths);
  // Bands the counter passes through; a capped round below 10× (test caps only) climbs as one Azami band.
  const bands: Array<{ level: CelebrationLevel; from: number; to: number; base: number }> = [];
  for (let k = 1; k <= tier; k++) {
    const from = k === 1 ? 0 : WIN_TIER_THRESHOLDS[k - 1]!;
    const to = k === tier ? totalHundredths : WIN_TIER_THRESHOLDS[k]!;
    bands.push({ level: k as CelebrationLevel, from, to, base: COUNT_UP_STAGE_MS[k - 1]! });
  }
  if (bands.length === 0) bands.push({ level: capped ? MAX_WIN_LEVEL : 1, from: 0, to: totalHundredths, base: COUNT_UP_STAGE_MS[0] });
  const baseTotal = bands.reduce((sum, band) => sum + band.base, 0);
  let factor = COUNT_UP_SPEED_FACTOR[speed];
  if (options.reducedMotion) factor *= COUNT_UP_REDUCED_FACTOR;
  let countUp = Math.max(COUNT_UP_MIN_MS, Math.round(baseTotal * factor));
  if (options.skipScreens) countUp = Math.min(SKIP_COUNT_UP_MS, countUp);
  const finalLevel: CelebrationLevel = capped ? MAX_WIN_LEVEL : bands[bands.length - 1]!.level;
  const baseHold = COUNT_UP_HOLD_MS[finalLevel - 1]!;
  let hold = speed === 'normal' && !options.reducedMotion ? baseHold : Math.max(COUNT_UP_MIN_HOLD_MS, Math.round(baseHold * factor));
  if (options.skipScreens) hold = Math.min(SKIP_HOLD_MS, hold);

  const stages: CountUpStage[] = [];
  let at = 0;
  bands.forEach((band, i) => {
    const dur = i === bands.length - 1 ? countUp - at : Math.round((band.base * countUp) / baseTotal);
    stages.push({ level: band.level, at, dur, from: band.from, to: band.to });
    at += dur;
  });
  if (capped && stages[stages.length - 1]!.level !== MAX_WIN_LEVEL) stages.push({ level: MAX_WIN_LEVEL, at: countUp, dur: 0, from: totalHundredths, to: totalHundredths });
  return { totalHundredths, capped, finalLevel, countUp, hold, stages };
}

/** The stage showing at `elapsed` ms (clamped to the first and last stage). */
export function stageAt(schedule: CountUpSchedule, elapsed: number): CountUpStage {
  const { stages } = schedule;
  let current = stages[0]!;
  for (const stage of stages) {
    if (elapsed >= stage.at && (stage.dur > 0 || elapsed >= schedule.countUp)) current = stage;
  }
  return current;
}

/**
 * Counter value (integer hundredths) at `elapsed` ms. Monotonic in `elapsed`, starts at 0 and is exactly the
 * total from `countUp` on. Intermediate bands ease out gently so each threshold lands as a beat; the last band
 * decelerates more strongly into the final number.
 */
export function countUpValueAt(schedule: CountUpSchedule, elapsed: number): number {
  if (elapsed >= schedule.countUp) return schedule.totalHundredths;
  if (elapsed <= 0) return 0;
  const stage = stageAt(schedule, elapsed);
  if (stage.dur <= 0) return stage.to;
  const p = Math.min(1, Math.max(0, (elapsed - stage.at) / stage.dur));
  const last = stage === schedule.stages[schedule.stages.length - 1] || schedule.stages[schedule.stages.indexOf(stage) + 1]?.dur === 0;
  const eased = last ? 1 - (1 - p) ** 3 : 1 - (1 - p) ** 1.6;
  return Math.min(stage.to, stage.from + Math.floor((stage.to - stage.from) * eased));
}

/** Level showing at `elapsed` ms. */
export function levelAt(schedule: CountUpSchedule, elapsed: number): CelebrationLevel {
  return stageAt(schedule, elapsed).level;
}
