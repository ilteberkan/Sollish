/**
 * Cezeri: Zamanın Çarkları control rules (pure, integer cents, no DOM, no clock). The game component only wires these
 * to React state, so every rule a player can see (cost per mode, why "Bonus satın al" is off, when autoplay stops,
 * what the ledger may pay out) is unit-tested here. Same contract as lib/storm-controls.ts and lib/ebru-controls.ts.
 */
import { CEZERI_BET_LEVELS_CENTS, CEZERI_COST_FRACTION, CEZERI_MAX_WIN_MULTIPLIER, CEZERI_RTP, cezeriCostCents, type CezeriMode } from '@sollish/protocol';
import { nextDecision, recordRound, type AutoplayDecision, type AutoplayState } from './slot-kit/autoplay';
import { createBetLadder, formatDemo, type CostMode } from './slot-kit/bet';
import type { SlotSettings } from './slot-kit/settings';
import { rtpPercent, rtpRange } from './slot-format';
import type { Locale } from './i18n/config';
import { DEMO_CEILING_MULTIPLIER, DEMO_STAKE_CEILING_CENTS } from './demo';
import type { CezeriSpeed, CezeriTimelineOptions } from './cezeri-timeline';

export const CEZERI_BET_LADDER = createBetLadder(CEZERI_BET_LEVELS_CENTS);
export const CEZERI_MIN_BET_CENTS = CEZERI_BET_LADDER[0]!;
export const CEZERI_MAX_BET_CENTS = CEZERI_BET_LADDER[CEZERI_BET_LADDER.length - 1]!;
export const CEZERI_DEFAULT_BET_CENTS = 1000;
/** Cost factors as slot-kit ratios, taken from the engine's own CEZERI_COST_FRACTION. */
export const CEZERI_COST_MODES: Readonly<Record<CezeriMode, CostMode>> = Object.freeze({
  standard: Object.freeze({ num: CEZERI_COST_FRACTION.standard[0], den: CEZERI_COST_FRACTION.standard[1] }),
  ante: Object.freeze({ num: CEZERI_COST_FRACTION.ante[0], den: CEZERI_COST_FRACTION.ante[1] }),
  buy: Object.freeze({ num: CEZERI_COST_FRACTION.buy[0], den: CEZERI_COST_FRACTION.buy[1] }),
});
export const CEZERI_MODE_LABELS: Readonly<Record<CezeriMode, string>> = Object.freeze({ standard: 'Standart', ante: 'Şans ×2', buy: 'Bonus satın alma' });

export function cezeriCost(betCents: number, mode: CezeriMode): number {
  return cezeriCostCents(betCents, mode);
}

/**
 * Reservation limits for one round: the engine cap is 10000 × BET, the ledger caps the payout at maxMultiplier ×
 * COST, so maxMultiplier = ceil(10000 × bet / cost) (standard 10000, ante 8000, buy 100).
 */
export function cezeriLedgerLimits(betCents: number, mode: CezeriMode): { maxMultiplier: number; maxStakeCents: number } {
  const cost = cezeriCost(betCents, mode);
  const maxMultiplier = Math.ceil((CEZERI_MAX_WIN_MULTIPLIER * betCents) / cost);
  if (maxMultiplier < 1 || maxMultiplier > DEMO_CEILING_MULTIPLIER) throw new RangeError('Cezeri cap exceeds the ledger ceiling');
  return { maxMultiplier, maxStakeCents: DEMO_STAKE_CEILING_CENTS };
}

/** 0.955 -> "%95,5". */
export function cezeriRtp(ratio: number, locale: Locale = 'tr'): string { return rtpPercent(ratio, locale); }
/** "%95,0–96,1" (tr) */
export function cezeriRtpRange(low: number, high: number, locale: Locale = 'tr'): string { return rtpRange(low, high, locale); }
export function cezeriRtpText(mode: CezeriMode): string {
  const r = CEZERI_RTP[mode];
  return `${cezeriRtp(r.rtp)} (GA ${cezeriRtpRange(r.ciLow, r.ciHigh)})`;
}

export interface CezeriBuyState { betCents: number; balanceCents: number; ante: boolean; autoplay: boolean; busy: boolean; gated?: boolean }
export type CezeriBuyBlock = { code: 'gated' | 'autoplay' | 'busy' | 'ante' } | { code: 'balance'; priceCents: number };
/** Why the bonus buy cannot be used right now, as a code (the screen translates it: `cezeri.buy.block.<code>`), or null when it can. First matching reason wins. */
export function cezeriBuyBlock(state: CezeriBuyState): CezeriBuyBlock | null {
  if (state.gated) return { code: 'gated' };
  if (state.autoplay) return { code: 'autoplay' };
  if (state.busy) return { code: 'busy' };
  if (state.ante) return { code: 'ante' };
  const price = cezeriCost(state.betCents, 'buy');
  if (price > state.balanceCents) return { code: 'balance', priceCents: price };
  return null;
}
/** Why "Bonus satın al" cannot be used right now, in Turkish (tests, legacy callers), or null when it can. */
export function cezeriBuyBlockReason(state: CezeriBuyState): string | null {
  const block = cezeriBuyBlock(state);
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
export function cezeriTimelineOptions(settings: Pick<SlotSettings, 'spinSpeed' | 'skipScreens'>, reducedMotion: boolean): CezeriTimelineOptions & { speed: CezeriSpeed } {
  return { speed: settings.spinSpeed, skipScreens: settings.skipScreens, reducedMotion };
}
/** Pause between autoplay rounds per speed (ms). */
export const CEZERI_AUTOPLAY_GAP: Readonly<Record<CezeriSpeed, number>> = Object.freeze({ normal: 650, quick: 420, turbo: 220 });

/** Short, readable round id from the seed: first 4 + last 4 hex characters. */
export function cezeriRoundId(seedHex: string): string {
  return seedHex.length <= 10 ? seedHex : `${seedHex.slice(0, 4)}…${seedHex.slice(-4)}`;
}

/* ------------------------------------------------------------------ autoplay adapter */
export interface CezeriAutoplayRound { costCents: number; payoutCents: number; featureTriggered: boolean; balanceBeforeCents: number }

/** Folds a settled round into the controller: balance after = before − cost + payout (one ledger round). */
export function cezeriAutoplayAfterRound(state: AutoplayState, round: CezeriAutoplayRound): AutoplayState {
  return recordRound(state, {
    costCents: round.costCents, payoutCents: round.payoutCents, featureTriggered: round.featureTriggered,
    balanceAfterCents: round.balanceBeforeCents - round.costCents + round.payoutCents,
  });
}
/** Decision before the next autoplay spin. Autoplay never buys: the next cost is the standard or ante cost. */
export function cezeriAutoplayBeforeSpin(state: AutoplayState, input: { balanceCents: number; betCents: number; ante: boolean; tabHidden: boolean }): AutoplayDecision & { costCents: number } {
  const costCents = cezeriCost(input.betCents, input.ante ? 'ante' : 'standard');
  return { ...nextDecision(state, { balanceCents: input.balanceCents, nextCostCents: costCents, tabHidden: input.tabHidden }), costCents };
}
