/**
 * Bet ladder helpers (pure, integer cents). A ladder is a strictly ascending list of bet levels.
 * "Cost" is what a spin actually takes: bet × mode factor (ante, buy feature), rounded up.
 */

export type BetLadder = readonly number[];

/** Cost factor as an integer ratio, e.g. ante ×1,25 = { num: 5, den: 4 }. */
export interface CostMode { readonly num: number; readonly den: number }
export const STANDARD_COST_MODE: CostMode = Object.freeze({ num: 1, den: 1 });

export interface BetLimits {
  balanceCents: number;
  /** Table/game maximum for the bet level (not the cost). */
  maxBetCents?: number;
  cost?: CostMode;
}

export type BetLevelReason = 'balance' | 'limit';
export interface BetLevelStatus {
  readonly betCents: number;
  readonly costCents: number;
  readonly enabled: boolean;
  /** Why a level is disabled; the table limit wins when both apply. */
  readonly reason: BetLevelReason | null;
}

export function createBetLadder(levels: readonly number[]): BetLadder {
  if (!Array.isArray(levels) || levels.length === 0) throw new RangeError('Bahis basamakları boş olamaz');
  for (const level of levels) {
    if (!Number.isSafeInteger(level) || level <= 0) throw new RangeError('Bahis basamağı pozitif tam sayı olmalı');
  }
  return Object.freeze(Array.from(new Set(levels)).sort((a, b) => a - b));
}

function assertMode(mode: CostMode): void {
  if (!Number.isSafeInteger(mode.num) || !Number.isSafeInteger(mode.den) || mode.num <= 0 || mode.den <= 0) throw new RangeError('Maliyet çarpanı geçersiz');
}

/** ceil(bet × num / den) in integer arithmetic. */
export function modeCostCents(betCents: number, mode: CostMode = STANDARD_COST_MODE): number {
  assertMode(mode);
  if (!Number.isSafeInteger(betCents) || betCents < 0) throw new RangeError('Bahis geçersiz');
  const product = betCents * mode.num;
  if (!Number.isSafeInteger(product)) throw new RangeError('Maliyet çok büyük');
  return Math.floor(product / mode.den) + (product % mode.den === 0 ? 0 : 1);
}

export function betLevelStatus(betCents: number, limits: BetLimits): BetLevelStatus {
  const costCents = modeCostCents(betCents, limits.cost);
  let reason: BetLevelReason | null = null;
  if (limits.maxBetCents !== undefined && betCents > limits.maxBetCents) reason = 'limit';
  else if (costCents > limits.balanceCents) reason = 'balance';
  return { betCents, costCents, enabled: reason === null, reason };
}

export function betLevels(ladder: BetLadder, limits: BetLimits): BetLevelStatus[] {
  return ladder.map(level => betLevelStatus(level, limits));
}

/** Highest enabled level, or null when even the lowest is unaffordable. */
export function maxAffordableBet(ladder: BetLadder, limits: BetLimits): number | null {
  let best: number | null = null;
  for (const level of ladder) if (betLevelStatus(level, limits).enabled) best = level;
  return best;
}

/** Largest ladder level ≤ value (or the lowest level when value is below the ladder). */
export function snapToLadder(ladder: BetLadder, value: number): number {
  let out = ladder[0];
  for (const level of ladder) if (level <= value) out = level;
  return out;
}

/**
 * One step along the ladder. Up stops at the first level that is disabled (levels are monotonic
 * in cost); down is always allowed since a lower bet is cheaper.
 */
export function stepBet(ladder: BetLadder, currentCents: number, direction: 1 | -1, limits?: BetLimits): number {
  const index = ladder.indexOf(snapToLadder(ladder, currentCents));
  const target = ladder[Math.min(ladder.length - 1, Math.max(0, index + direction))];
  if (direction === 1 && limits && !betLevelStatus(target, limits).enabled) return ladder[index];
  return target;
}

export function canStep(ladder: BetLadder, currentCents: number, direction: 1 | -1, limits?: BetLimits): boolean {
  const index = ladder.indexOf(snapToLadder(ladder, currentCents));
  if (direction === -1) return index > 0;
  return index < ladder.length - 1 && (!limits || betLevelStatus(ladder[index + 1], limits).enabled);
}

/** Keep a stored/remembered bet valid: nearest level at or below, then clamp to affordable. */
export function clampBetToLimits(ladder: BetLadder, valueCents: number, limits: BetLimits): number {
  let level = snapToLadder(ladder, valueCents);
  while (!betLevelStatus(level, limits).enabled) {
    const index = ladder.indexOf(level);
    if (index <= 0) break;
    level = ladder[index - 1];
  }
  return level;
}

const MINUS = '−';

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 123456 → "1.234,56". Not a finite integer → "—". Negative uses the true minus sign. */
export function formatAmount(cents: number, options: { trimZeros?: boolean } = {}): string {
  if (!Number.isSafeInteger(cents)) return '—';
  const abs = Math.abs(cents);
  const whole = groupThousands(String(Math.floor(abs / 100)));
  const fraction = String(abs % 100).padStart(2, '0');
  const body = options.trimZeros && fraction === '00' ? whole : `${whole},${fraction}`;
  return cents < 0 ? `${MINUS}${body}` : body;
}

/** "1.234,56 DEMO". */
export function formatDemo(cents: number, options: { trimZeros?: boolean } = {}): string {
  return `${formatAmount(cents, options)} DEMO`;
}

/** "+12,40 DEMO", "−3,00 DEMO", "0,00 DEMO". */
export function formatSignedDemo(cents: number): string {
  if (!Number.isSafeInteger(cents)) return '—';
  return cents > 0 ? `+${formatDemo(cents)}` : formatDemo(cents);
}

/** Multiplier in hundredths: 125 → "×1,25"; 100 → "×1". */
export function formatFactor(num: number, den: number): string {
  const hundredths = Math.round((num * 100) / den);
  const text = formatAmount(hundredths, { trimZeros: true });
  return `×${text.replace(/,(\d)0$/, ',$1')}`;
}

const MAX_INPUT_CENTS = 1_000_000_000_00;

/**
 * Parse player input like "25", "12,5" or "12.50" into cents. No thousands separators (ambiguous),
 * at most two decimals, no signs/exponents. Returns null for anything else, including zero.
 */
export function parseDemoAmountCents(text: string): number | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return cents > 0 && cents <= MAX_INPUT_CENTS ? cents : null;
}
