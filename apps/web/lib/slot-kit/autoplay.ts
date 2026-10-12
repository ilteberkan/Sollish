/**
 * Autoplay controller (pure, deterministic, no timers, no DOM).
 *
 * The game loop asks `nextDecision` before every spin and reports the finished round with
 * `recordRound`. The loss limit is mandatory and is checked BEFORE a spin that could take the
 * net loss over it. All amounts are integer cents; every function returns new frozen state.
 */

import { formatDemo } from './bet';

export const AUTOPLAY_SPIN_OPTIONS = [10, 25, 50, 100, 250, 500, 1000] as const;
export type AutoplaySpins = (typeof AUTOPLAY_SPIN_OPTIONS)[number];

export interface AutoplayConfig {
  spins: AutoplaySpins;
  /** Required. Net loss (spent − won) since the start that autoplay may not exceed. */
  lossLimitCents: number;
  /** Stop after a single round whose payout is at least this much. */
  singleWinLimitCents?: number;
  /** Stop once the balance is at least this much above the starting balance. */
  balanceIncreaseCents?: number;
  stopOnAnyWin: boolean;
  stopOnFeature: boolean;
}

/**
 * Optional stop conditions live in a collapsed "Gelişmiş" section (game-standards §6: the main view shows only
 * the spin count, the required loss limit and Start). These are their defaults: stop on free spins is ON.
 */
export const AUTOPLAY_ADVANCED_DEFAULTS: Readonly<Pick<AutoplayConfig, 'stopOnAnyWin' | 'stopOnFeature'>> = Object.freeze({ stopOnAnyWin: false, stopOnFeature: true });

/** Short labels of the active optional stop conditions, for the collapsed "Gelişmiş" summary line. */
export function autoplayAdvancedSummary(config: Pick<AutoplayConfig, 'stopOnAnyWin' | 'stopOnFeature' | 'singleWinLimitCents' | 'balanceIncreaseCents'>): string[] {
  const out: string[] = [];
  if (config.stopOnAnyWin) out.push('Her kazançta');
  if (config.stopOnFeature) out.push('Bedava dönüşte');
  if (config.singleWinLimitCents !== undefined) out.push(`Tek kazanç ≥ ${formatDemo(config.singleWinLimitCents, { trimZeros: true })}`);
  if (config.balanceIncreaseCents !== undefined) out.push(`Bakiye +${formatDemo(config.balanceIncreaseCents, { trimZeros: true })}`);
  return out;
}

export type AutoplayStopCode =
  | 'cancelled'
  | 'tab-hidden'
  | 'invalid-input'
  | 'loss-limit'
  | 'loss-would-exceed'
  | 'insufficient-balance'
  | 'single-win'
  | 'balance-increase'
  | 'feature'
  | 'any-win'
  | 'completed';

export const AUTOPLAY_STOP_REASONS: Readonly<Record<AutoplayStopCode, string>> = Object.freeze({
  cancelled: 'Otomatik oyun durduruldu',
  'tab-hidden': 'Sekme gizlendiği için durduruldu',
  'invalid-input': 'Bakiye veya bahis okunamadı',
  'loss-limit': 'Kayıp limitine ulaşıldı',
  'loss-would-exceed': 'Sonraki dönüş kayıp limitini aşardı',
  'insufficient-balance': 'Bakiye yetersiz',
  'single-win': 'Tek kazanç limitine ulaşıldı',
  'balance-increase': 'Bakiye artış hedefine ulaşıldı',
  feature: 'Özellik tetiklendi',
  'any-win': 'Kazanç geldi',
  completed: 'Tur sayısı tamamlandı',
});

export interface AutoplayRoundRecord {
  readonly payoutCents: number;
  readonly featureTriggered: boolean;
  readonly balanceAfterCents: number;
}

export interface AutoplayState {
  readonly config: Readonly<AutoplayConfig>;
  readonly startBalanceCents: number;
  readonly spinsDone: number;
  readonly spinsRemaining: number;
  readonly spentCents: number;
  readonly wonCents: number;
  readonly lastRound: AutoplayRoundRecord | null;
  readonly cancelled: boolean;
}

export type AutoplayDecision = { continue: true } | { continue: false; reason: string; code: AutoplayStopCode };

export interface AutoplayDecisionInput {
  balanceCents: number;
  nextCostCents: number;
  /** True while the tab is hidden (`document.hidden`); autoplay never runs in the background. */
  tabHidden?: boolean;
}

export interface AutoplayRoundInput {
  costCents: number;
  payoutCents: number;
  featureTriggered: boolean;
  balanceAfterCents: number;
}

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isPositiveCents = (v: unknown): v is number => isCents(v) && v > 0;

/** Turkish validation messages; empty array means the config can start. */
export function validateAutoplayConfig(config: unknown): string[] {
  const errors: string[] = [];
  if (config === null || typeof config !== 'object') return ['Ayarlar okunamadı'];
  const c = config as Record<string, unknown>;
  if (!(AUTOPLAY_SPIN_OPTIONS as readonly unknown[]).includes(c.spins)) errors.push('Tur sayısı geçersiz');
  if (!isPositiveCents(c.lossLimitCents)) errors.push('Kayıp limiti zorunlu ve sıfırdan büyük olmalı');
  if (c.singleWinLimitCents !== undefined && !isPositiveCents(c.singleWinLimitCents)) errors.push('Tek kazanç limiti sıfırdan büyük olmalı');
  if (c.balanceIncreaseCents !== undefined && !isPositiveCents(c.balanceIncreaseCents)) errors.push('Bakiye artışı sıfırdan büyük olmalı');
  if (typeof c.stopOnAnyWin !== 'boolean') errors.push('Her kazançta durma seçimi geçersiz');
  if (typeof c.stopOnFeature !== 'boolean') errors.push('Özellikte durma seçimi geçersiz');
  return errors;
}

export function createAutoplay(config: AutoplayConfig, startBalanceCents: number): AutoplayState {
  const errors = validateAutoplayConfig(config);
  if (errors.length > 0) throw new RangeError(errors.join('; '));
  if (!isCents(startBalanceCents)) throw new RangeError('Başlangıç bakiyesi geçersiz');
  const copy: AutoplayConfig = {
    spins: config.spins,
    lossLimitCents: config.lossLimitCents,
    stopOnAnyWin: config.stopOnAnyWin,
    stopOnFeature: config.stopOnFeature,
  };
  if (config.singleWinLimitCents !== undefined) copy.singleWinLimitCents = config.singleWinLimitCents;
  if (config.balanceIncreaseCents !== undefined) copy.balanceIncreaseCents = config.balanceIncreaseCents;
  return Object.freeze({
    config: Object.freeze(copy),
    startBalanceCents,
    spinsDone: 0,
    spinsRemaining: config.spins,
    spentCents: 0,
    wonCents: 0,
    lastRound: null,
    cancelled: false,
  });
}

/** Spent minus won since the start; negative while the player is ahead. */
export function autoplayNetLossCents(state: AutoplayState): number {
  return state.spentCents - state.wonCents;
}

/** Player pressed the stop button; the next decision reports it. */
export function cancelAutoplay(state: AutoplayState): AutoplayState {
  return Object.freeze({ ...state, cancelled: true });
}

function stop(code: AutoplayStopCode): AutoplayDecision {
  return { continue: false, reason: AUTOPLAY_STOP_REASONS[code], code };
}

/**
 * Priority when several conditions hold: cancel, hidden tab, bad input, loss limit (reached, then
 * "would exceed"), balance, single win, balance target, feature, any win, spins done.
 */
export function nextDecision(state: AutoplayState, input: AutoplayDecisionInput): AutoplayDecision {
  if (state.cancelled) return stop('cancelled');
  if (input.tabHidden === true) return stop('tab-hidden');
  if (!isCents(input.balanceCents) || !isPositiveCents(input.nextCostCents)) return stop('invalid-input');

  const { config } = state;
  const netLoss = autoplayNetLossCents(state);
  if (netLoss >= config.lossLimitCents) return stop('loss-limit');
  if (netLoss + input.nextCostCents > config.lossLimitCents) return stop('loss-would-exceed');
  if (input.balanceCents < input.nextCostCents) return stop('insufficient-balance');

  const last = state.lastRound;
  if (last) {
    if (config.singleWinLimitCents !== undefined && last.payoutCents >= config.singleWinLimitCents) return stop('single-win');
    if (config.balanceIncreaseCents !== undefined && input.balanceCents - state.startBalanceCents >= config.balanceIncreaseCents) return stop('balance-increase');
    if (config.stopOnFeature && last.featureTriggered) return stop('feature');
    if (config.stopOnAnyWin && last.payoutCents > 0) return stop('any-win');
  }
  if (state.spinsRemaining <= 0) return stop('completed');
  return { continue: true };
}

export function recordRound(state: AutoplayState, round: AutoplayRoundInput): AutoplayState {
  if (!isCents(round.costCents) || !isCents(round.payoutCents) || !isCents(round.balanceAfterCents) || typeof round.featureTriggered !== 'boolean') {
    throw new RangeError('Tur kaydı geçersiz');
  }
  const spent = state.spentCents + round.costCents;
  const won = state.wonCents + round.payoutCents;
  if (!Number.isSafeInteger(spent) || !Number.isSafeInteger(won)) throw new RangeError('Tur toplamı çok büyük');
  return Object.freeze({
    ...state,
    spinsDone: state.spinsDone + 1,
    spinsRemaining: Math.max(0, state.spinsRemaining - 1),
    spentCents: spent,
    wonCents: won,
    lastRound: Object.freeze({ payoutCents: round.payoutCents, featureTriggered: round.featureTriggered, balanceAfterCents: round.balanceAfterCents }),
  });
}
