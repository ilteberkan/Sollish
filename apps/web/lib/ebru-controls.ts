/**
 * Ebru: Mürekkep Bahçesi control rules (pure, integer cents, no DOM, no clock). The game component only wires these
 * to React state, so every rule a player can see (cost per mode, why "Bonus satın al" is off, when autoplay stops,
 * what the ledger may pay out) is unit-tested here. Same contract as lib/storm-controls.ts.
 */
import { EBRU_BET_LEVELS_CENTS, EBRU_COST_FRACTION, EBRU_MAX_WIN_MULTIPLIER, EBRU_RTP, ebruCostCents, type EbruMode } from '@sollish/protocol';
import { nextDecision, recordRound, type AutoplayDecision, type AutoplayState } from './slot-kit/autoplay';
import { createBetLadder, formatDemo, type CostMode } from './slot-kit/bet';
import type { SlotSettings } from './slot-kit/settings';
import { DEMO_CEILING_MULTIPLIER, DEMO_STAKE_CEILING_CENTS } from './demo';
import type { EbruSpeed, EbruTimelineOptions } from './ebru-timeline';

export const EBRU_BET_LADDER = createBetLadder(EBRU_BET_LEVELS_CENTS);
export const EBRU_MIN_BET_CENTS = EBRU_BET_LADDER[0]!;
export const EBRU_MAX_BET_CENTS = EBRU_BET_LADDER[EBRU_BET_LADDER.length - 1]!;
export const EBRU_DEFAULT_BET_CENTS = 1000;
/** Cost factors as slot-kit ratios, taken from the engine's own EBRU_COST_FRACTION. */
export const EBRU_COST_MODES: Readonly<Record<EbruMode, CostMode>> = Object.freeze({
  standard: Object.freeze({ num: EBRU_COST_FRACTION.standard[0], den: EBRU_COST_FRACTION.standard[1] }),
  ante: Object.freeze({ num: EBRU_COST_FRACTION.ante[0], den: EBRU_COST_FRACTION.ante[1] }),
  buy: Object.freeze({ num: EBRU_COST_FRACTION.buy[0], den: EBRU_COST_FRACTION.buy[1] }),
});
export const EBRU_MODE_LABELS: Readonly<Record<EbruMode, string>> = Object.freeze({ standard: 'Standart', ante: 'Şans ×2', buy: 'Bonus satın alma' });

export function ebruCost(betCents: number, mode: EbruMode): number {
  return ebruCostCents(betCents, mode);
}

/**
 * Reservation limits for one round: the engine cap is 10000 × BET, the ledger caps the payout at maxMultiplier ×
 * COST, so maxMultiplier = ceil(10000 × bet / cost) (standard 10000, ante 8000, buy 100).
 */
export function ebruLedgerLimits(betCents: number, mode: EbruMode): { maxMultiplier: number; maxStakeCents: number } {
  const cost = ebruCost(betCents, mode);
  const maxMultiplier = Math.ceil((EBRU_MAX_WIN_MULTIPLIER * betCents) / cost);
  if (maxMultiplier < 1 || maxMultiplier > DEMO_CEILING_MULTIPLIER) throw new RangeError('Ebru cap exceeds the ledger ceiling');
  return { maxMultiplier, maxStakeCents: DEMO_STAKE_CEILING_CENTS };
}

/** 0.957 -> "%95,7". */
export function ebruRtp(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `%${(Math.round(ratio * 1000) / 10).toFixed(1).replace('.', ',')}`;
}
/** "%94,7–96,7" */
export function ebruRtpRange(low: number, high: number): string {
  return `${ebruRtp(low)}–${ebruRtp(high).slice(1)}`;
}
export function ebruRtpText(mode: EbruMode): string {
  const r = EBRU_RTP[mode];
  return `${ebruRtp(r.rtp)} (GA ${ebruRtpRange(r.ciLow, r.ciHigh)})`;
}

export interface EbruBuyState { betCents: number; balanceCents: number; ante: boolean; autoplay: boolean; busy: boolean; gated?: boolean }
export type EbruBuyBlock = { code: 'gated' | 'autoplay' | 'busy' | 'ante' } | { code: 'balance'; priceCents: number };
/** Why "Bonus satın al" cannot be used right now (a code the UI translates), or null when it can. First matching reason wins. */
export function ebruBuyBlock(state: EbruBuyState): EbruBuyBlock | null {
  if (state.gated) return { code: 'gated' };
  if (state.autoplay) return { code: 'autoplay' };
  if (state.busy) return { code: 'busy' };
  if (state.ante) return { code: 'ante' };
  const price = ebruCost(state.betCents, 'buy');
  if (price > state.balanceCents) return { code: 'balance', priceCents: price };
  return null;
}
/** Turkish text of `ebruBuyBlock` (legacy; the translated UI uses the code and `ebru.buyBlock.<code>`). */
export function ebruBuyBlockReason(state: EbruBuyState): string | null {
  const block = ebruBuyBlock(state);
  if (!block) return null;
  switch (block.code) {
    case 'gated': return 'Yalnız DEMO kredisiyle satın alınır';
    case 'autoplay': return 'Otomatik oyun sürerken satın alınamaz';
    case 'busy': return 'Tur bitmeden satın alınamaz';
    case 'ante': return 'Şans ×2 açıkken satın alınamaz';
    case 'balance': return `Bakiye yetersiz (fiyat ${formatDemo(block.priceCents)})`;
  }
}

/** Spin-speed setting -> timeline options (presentation only; the result is already fixed). */
export function ebruTimelineOptions(settings: Pick<SlotSettings, 'spinSpeed' | 'skipScreens'>, reducedMotion: boolean): EbruTimelineOptions & { speed: EbruSpeed } {
  return { speed: settings.spinSpeed, skipScreens: settings.skipScreens, reducedMotion };
}
/** Pause between autoplay rounds per speed (ms). */
export const EBRU_AUTOPLAY_GAP: Readonly<Record<EbruSpeed, number>> = Object.freeze({ normal: 650, quick: 420, turbo: 220 });

/** Short, readable round id from the seed: first 4 + last 4 hex characters. */
export function ebruRoundId(seedHex: string): string {
  return seedHex.length <= 10 ? seedHex : `${seedHex.slice(0, 4)}…${seedHex.slice(-4)}`;
}

/* ------------------------------------------------------------------ autoplay adapter */
export interface EbruAutoplayRound { costCents: number; payoutCents: number; featureTriggered: boolean; balanceBeforeCents: number }

/** Folds a settled round into the controller: balance after = before − cost + payout (one ledger round). */
export function ebruAutoplayAfterRound(state: AutoplayState, round: EbruAutoplayRound): AutoplayState {
  return recordRound(state, {
    costCents: round.costCents, payoutCents: round.payoutCents, featureTriggered: round.featureTriggered,
    balanceAfterCents: round.balanceBeforeCents - round.costCents + round.payoutCents,
  });
}
/** Decision before the next autoplay spin. Autoplay never buys: the next cost is the standard or ante cost. */
export function ebruAutoplayBeforeSpin(state: AutoplayState, input: { balanceCents: number; betCents: number; ante: boolean; tabHidden: boolean }): AutoplayDecision & { costCents: number } {
  const costCents = ebruCost(input.betCents, input.ante ? 'ante' : 'standard');
  return { ...nextDecision(state, { balanceCents: input.balanceCents, nextCostCents: costCents, tabHidden: input.tabHidden }), costCents };
}
