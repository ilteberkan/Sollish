/**
 * Asena: Yıldız Kurdu control rules (pure, integer cents, no DOM, no clock). The game component only wires these to
 * React state, so every rule a player can see (cost per mode, why "Bonus satın al" is off, when autoplay stops, what the
 * ledger may pay out) is unit-tested here. Same contract as lib/ebru-controls.ts.
 */
import { ASENA_BET_LEVELS_CENTS, ASENA_COST_FRACTION, ASENA_MAX_WIN_MULTIPLIER, ASENA_RTP, asenaCostCents, type AsenaMode } from '@sollish/protocol';
import { nextDecision, recordRound, type AutoplayDecision, type AutoplayState } from './slot-kit/autoplay';
import { createBetLadder, formatDemo, type CostMode } from './slot-kit/bet';
import type { SlotSettings } from './slot-kit/settings';
import { rtpPercent, rtpRange } from './slot-format';
import type { Locale } from './i18n/config';
import { DEMO_CEILING_MULTIPLIER, DEMO_STAKE_CEILING_CENTS } from './demo';
import type { AsenaSpeed, AsenaTimelineOptions } from './asena-timeline';

export const ASENA_BET_LADDER = createBetLadder(ASENA_BET_LEVELS_CENTS);
export const ASENA_MIN_BET_CENTS = ASENA_BET_LADDER[0]!;
export const ASENA_MAX_BET_CENTS = ASENA_BET_LADDER[ASENA_BET_LADDER.length - 1]!;
export const ASENA_DEFAULT_BET_CENTS = 1000;
/** Cost factors as slot-kit ratios, taken from the engine's own ASENA_COST_FRACTION. */
export const ASENA_COST_MODES: Readonly<Record<AsenaMode, CostMode>> = Object.freeze({
  standard: Object.freeze({ num: ASENA_COST_FRACTION.standard[0], den: ASENA_COST_FRACTION.standard[1] }),
  ante: Object.freeze({ num: ASENA_COST_FRACTION.ante[0], den: ASENA_COST_FRACTION.ante[1] }),
  buy: Object.freeze({ num: ASENA_COST_FRACTION.buy[0], den: ASENA_COST_FRACTION.buy[1] }),
});
export const ASENA_MODE_LABELS: Readonly<Record<AsenaMode, string>> = Object.freeze({ standard: 'Standart', ante: 'Şans ×2', buy: 'Bonus satın alma' });

export function asenaCost(betCents: number, mode: AsenaMode): number {
  return asenaCostCents(betCents, mode);
}

/**
 * Reservation limits for one round: the engine cap is 5000 × BET, the ledger caps the payout at maxMultiplier × COST,
 * so maxMultiplier = ceil(5000 × bet / cost) (standard 5000, ante 4000, buy 63).
 */
export function asenaLedgerLimits(betCents: number, mode: AsenaMode): { maxMultiplier: number; maxStakeCents: number } {
  const cost = asenaCost(betCents, mode);
  const maxMultiplier = Math.ceil((ASENA_MAX_WIN_MULTIPLIER * betCents) / cost);
  if (maxMultiplier < 1 || maxMultiplier > DEMO_CEILING_MULTIPLIER) throw new RangeError('Asena cap exceeds the ledger ceiling');
  return { maxMultiplier, maxStakeCents: DEMO_STAKE_CEILING_CENTS };
}

/** 0.952 -> "%95,2". */
export function asenaRtp(ratio: number, locale: Locale = 'tr'): string { return rtpPercent(ratio, locale); }
/** "%94,2–96,1" (tr) */
export function asenaRtpRange(low: number, high: number, locale: Locale = 'tr'): string { return rtpRange(low, high, locale); }
export function asenaRtpText(mode: AsenaMode): string {
  const r = ASENA_RTP[mode];
  return `${asenaRtp(r.rtp)} (GA ${asenaRtpRange(r.ciLow, r.ciHigh)})`;
}

export interface AsenaBuyState { betCents: number; balanceCents: number; ante: boolean; autoplay: boolean; busy: boolean; gated?: boolean }
export type AsenaBuyBlock = { code: 'gated' | 'autoplay' | 'busy' | 'ante' } | { code: 'balance'; priceCents: number };
/** Why the bonus buy cannot be used right now, as a code (the screen translates it: `asena.buy.block.<code>`), or null when it can. First matching reason wins. */
export function asenaBuyBlock(state: AsenaBuyState): AsenaBuyBlock | null {
  if (state.gated) return { code: 'gated' };
  if (state.autoplay) return { code: 'autoplay' };
  if (state.busy) return { code: 'busy' };
  if (state.ante) return { code: 'ante' };
  const price = asenaCost(state.betCents, 'buy');
  if (price > state.balanceCents) return { code: 'balance', priceCents: price };
  return null;
}
/** Why "Bonus satın al" cannot be used right now, in Turkish (tests, legacy callers), or null when it can. */
export function asenaBuyBlockReason(state: AsenaBuyState): string | null {
  const block = asenaBuyBlock(state);
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
export function asenaTimelineOptions(settings: Pick<SlotSettings, 'spinSpeed' | 'skipScreens'>, reducedMotion: boolean): AsenaTimelineOptions & { speed: AsenaSpeed } {
  return { speed: settings.spinSpeed, skipScreens: settings.skipScreens, reducedMotion };
}
/** Pause between autoplay rounds per speed (ms). */
export const ASENA_AUTOPLAY_GAP: Readonly<Record<AsenaSpeed, number>> = Object.freeze({ normal: 650, quick: 420, turbo: 220 });

/** Short, readable round id from the seed: first 4 + last 4 hex characters. */
export function asenaRoundId(seedHex: string): string {
  return seedHex.length <= 10 ? seedHex : `${seedHex.slice(0, 4)}…${seedHex.slice(-4)}`;
}

/* ------------------------------------------------------------------ autoplay adapter */
export interface AsenaAutoplayRound { costCents: number; payoutCents: number; featureTriggered: boolean; balanceBeforeCents: number }

/** Folds a settled round into the controller: balance after = before − cost + payout (one ledger round). */
export function asenaAutoplayAfterRound(state: AutoplayState, round: AsenaAutoplayRound): AutoplayState {
  return recordRound(state, {
    costCents: round.costCents, payoutCents: round.payoutCents, featureTriggered: round.featureTriggered,
    balanceAfterCents: round.balanceBeforeCents - round.costCents + round.payoutCents,
  });
}
/** Decision before the next autoplay spin. Autoplay never buys: the next cost is the standard or ante cost. */
export function asenaAutoplayBeforeSpin(state: AutoplayState, input: { balanceCents: number; betCents: number; ante: boolean; tabHidden: boolean }): AutoplayDecision & { costCents: number } {
  const costCents = asenaCost(input.betCents, input.ante ? 'ante' : 'standard');
  return { ...nextDecision(state, { balanceCents: input.balanceCents, nextCostCents: costCents, tabHidden: input.tabHidden }), costCents };
}
