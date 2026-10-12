/**
 * Tarhun: Fırtına Tahtı control rules (pure, integer cents, no DOM, no clock). The game component only wires
 * these to React state, so every rule a player can see (cost per mode, why "Bonus satın al" is off, when autoplay
 * stops, what the ledger may pay out) is unit-tested here.
 */
import {
  STORM_BET_LEVELS_CENTS, STORM_COST_FRACTION, STORM_MAX_WIN_MULTIPLIER, STORM_RTP, stormCostCents, type StormMode,
} from '@sollish/protocol';
import { nextDecision, recordRound, type AutoplayDecision, type AutoplayState } from './slot-kit/autoplay';
import { createBetLadder, formatDemo, type CostMode } from './slot-kit/bet';
import type { SlotSettings } from './slot-kit/settings';
import type { StormSpeed, StormTimelineOptions } from './storm-timeline';

export const STORM_BET_LADDER = createBetLadder(STORM_BET_LEVELS_CENTS);
export const STORM_MIN_BET_CENTS = STORM_BET_LADDER[0]!;
export const STORM_MAX_BET_CENTS = STORM_BET_LADDER[STORM_BET_LADDER.length - 1]!;
export const STORM_DEFAULT_BET_CENTS = 1000;
/** Cost factors as slot-kit ratios, taken from the engine's own STORM_COST_FRACTION. */
export const STORM_COST_MODES: Readonly<Record<StormMode, CostMode>> = Object.freeze({
  standard: Object.freeze({ num: STORM_COST_FRACTION.standard[0], den: STORM_COST_FRACTION.standard[1] }),
  ante: Object.freeze({ num: STORM_COST_FRACTION.ante[0], den: STORM_COST_FRACTION.ante[1] }),
  buy: Object.freeze({ num: STORM_COST_FRACTION.buy[0], den: STORM_COST_FRACTION.buy[1] }),
});
/** The ledger's own ceilings (lib/demo.ts): payout multiplier on the reserved cost, and the stake ceiling. */
export const STORM_LEDGER_MAX_MULTIPLIER = 5000;
export const STORM_LEDGER_MAX_STAKE_CENTS = 5_000_000;
export const STORM_MODE_LABELS: Readonly<Record<StormMode, string>> = Object.freeze({ standard: 'Standart', ante: 'Şans ×2', buy: 'Bonus satın alma' });

export function stormCost(betCents: number, mode: StormMode): number {
  return stormCostCents(betCents, mode);
}

/**
 * Reservation limits for one round: the engine cap is 5000 × BET, the ledger caps the payout at
 * maxMultiplier × COST, so maxMultiplier = ceil(5000 × bet / cost) (standard 5000, ante 4000, buy 50).
 */
export function stormLedgerLimits(betCents: number, mode: StormMode): { maxMultiplier: number; maxStakeCents: number } {
  const cost = stormCost(betCents, mode);
  const maxMultiplier = Math.ceil((STORM_MAX_WIN_MULTIPLIER * betCents) / cost);
  if (maxMultiplier < 1 || maxMultiplier > STORM_LEDGER_MAX_MULTIPLIER) throw new RangeError('Tarhun cap exceeds the ledger ceiling');
  return { maxMultiplier, maxStakeCents: STORM_LEDGER_MAX_STAKE_CENTS };
}

/** 0.965 -> "%96,5". */
export function stormRtp(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `%${(Math.round(ratio * 1000) / 10).toFixed(1).replace('.', ',')}`;
}
/** "%95,9–97,0" */
export function stormRtpRange(low: number, high: number): string {
  return `${stormRtp(low)}–${stormRtp(high).slice(1)}`;
}
export function stormRtpText(mode: StormMode): string {
  const r = STORM_RTP[mode];
  return `${stormRtp(r.rtp)} (GA ${stormRtpRange(r.ciLow, r.ciHigh)})`;
}

export interface StormBuyState { betCents: number; balanceCents: number; ante: boolean; autoplay: boolean; busy: boolean; gated?: boolean }
/** Why "Bonus satın al" cannot be used right now, or null when it can. First matching reason wins. */
export function stormBuyBlockReason(state: StormBuyState): string | null {
  if (state.gated) return 'Yalnız DEMO kredisiyle satın alınır';
  if (state.autoplay) return 'Otomatik oyun sürerken satın alınamaz';
  if (state.busy) return 'Tur bitmeden satın alınamaz';
  if (state.ante) return 'Şans ×2 açıkken satın alınamaz';
  const price = stormCost(state.betCents, 'buy');
  if (price > state.balanceCents) return `Bakiye yetersiz (fiyat ${formatDemo(price)})`;
  return null;
}

/** Spin-speed setting -> timeline options (presentation only; the result is already fixed). */
export function stormTimelineOptions(settings: Pick<SlotSettings, 'spinSpeed' | 'skipScreens'>, reducedMotion: boolean): StormTimelineOptions & { speed: StormSpeed } {
  return { speed: settings.spinSpeed, skipScreens: settings.skipScreens, reducedMotion };
}
/** Pause between autoplay rounds per speed (ms). */
export const STORM_AUTOPLAY_GAP: Readonly<Record<StormSpeed, number>> = Object.freeze({ normal: 650, quick: 420, turbo: 220 });

/** Short, readable round id from the seed: first 4 + last 4 hex characters. */
export function stormRoundId(seedHex: string): string {
  return seedHex.length <= 10 ? seedHex : `${seedHex.slice(0, 4)}…${seedHex.slice(-4)}`;
}

/* ------------------------------------------------------------------ autoplay adapter */
export interface StormAutoplayRound { costCents: number; payoutCents: number; featureTriggered: boolean; balanceBeforeCents: number }

/** Folds a settled round into the controller: balance after = before − cost + payout (one ledger round). */
export function stormAutoplayAfterRound(state: AutoplayState, round: StormAutoplayRound): AutoplayState {
  return recordRound(state, {
    costCents: round.costCents, payoutCents: round.payoutCents, featureTriggered: round.featureTriggered,
    balanceAfterCents: round.balanceBeforeCents - round.costCents + round.payoutCents,
  });
}
/** Decision before the next autoplay spin. Autoplay never buys: the next cost is the standard or ante cost. */
export function stormAutoplayBeforeSpin(state: AutoplayState, input: { balanceCents: number; betCents: number; ante: boolean; tabHidden: boolean }): AutoplayDecision & { costCents: number } {
  const costCents = stormCost(input.betCents, input.ante ? 'ante' : 'standard');
  return { ...nextDecision(state, { balanceCents: input.balanceCents, nextCostCents: costCents, tabHidden: input.tabHidden }), costCents };
}
