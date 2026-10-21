/**
 * Göreme: Şafak Balonları control rules (pure, integer cents, no DOM, no clock). The game component only wires these to
 * React state, so every rule a player can see (cost per mode, why "Bonus satın al" is off, when autoplay stops, what the
 * ledger may pay out) is unit-tested here. Same contract as lib/asena-controls.ts.
 */
import { GOREME_BET_LEVELS_CENTS, GOREME_COST_FRACTION, GOREME_MAX_WIN_MULTIPLIER, GOREME_RTP, goremeCostCents, type GoremeMode } from '@sollish/protocol';
import { nextDecision, recordRound, type AutoplayDecision, type AutoplayState } from './slot-kit/autoplay';
import { createBetLadder, type CostMode } from './slot-kit/bet';
import type { SlotSettings } from './slot-kit/settings';
import { rtpPercent, rtpRange } from './slot-format';
import type { Locale } from './i18n/config';
import { DEMO_CEILING_MULTIPLIER, DEMO_STAKE_CEILING_CENTS } from './demo';
import type { GoremeSpeed, GoremeTimelineOptions } from './goreme-timeline';

export const GOREME_BET_LADDER = createBetLadder(GOREME_BET_LEVELS_CENTS);
export const GOREME_MIN_BET_CENTS = GOREME_BET_LADDER[0]!;
export const GOREME_MAX_BET_CENTS = GOREME_BET_LADDER[GOREME_BET_LADDER.length - 1]!;
export const GOREME_DEFAULT_BET_CENTS = 1000;
/** Cost factors as slot-kit ratios, taken from the engine's own GOREME_COST_FRACTION. */
export const GOREME_COST_MODES: Readonly<Record<GoremeMode, CostMode>> = Object.freeze({
  standard: Object.freeze({ num: GOREME_COST_FRACTION.standard[0], den: GOREME_COST_FRACTION.standard[1] }),
  ante: Object.freeze({ num: GOREME_COST_FRACTION.ante[0], den: GOREME_COST_FRACTION.ante[1] }),
  buy: Object.freeze({ num: GOREME_COST_FRACTION.buy[0], den: GOREME_COST_FRACTION.buy[1] }),
});

export function goremeCost(betCents: number, mode: GoremeMode): number {
  return goremeCostCents(betCents, mode);
}

/**
 * Reservation limits for one round: the engine cap is 10 000 × BET, the ledger caps the payout at maxMultiplier × COST,
 * so maxMultiplier = ceil(10 000 × bet / cost) (standard 10 000, ante 8 000, buy 100).
 */
export function goremeLedgerLimits(betCents: number, mode: GoremeMode): { maxMultiplier: number; maxStakeCents: number } {
  const cost = goremeCost(betCents, mode);
  const maxMultiplier = Math.ceil((GOREME_MAX_WIN_MULTIPLIER * betCents) / cost);
  if (maxMultiplier < 1 || maxMultiplier > DEMO_CEILING_MULTIPLIER) throw new RangeError('Göreme cap exceeds the ledger ceiling');
  return { maxMultiplier, maxStakeCents: DEMO_STAKE_CEILING_CENTS };
}

/** 0.963 -> "%96,3" (tr). */
export function goremeRtp(ratio: number, locale: Locale = 'tr'): string { return rtpPercent(ratio, locale); }
/** "%95,7–96,8" (tr). */
export function goremeRtpRange(low: number, high: number, locale: Locale = 'tr'): string { return rtpRange(low, high, locale); }
export function goremeRtpText(mode: GoremeMode, locale: Locale = 'tr'): string {
  const r = GOREME_RTP[mode];
  return `${goremeRtp(r.rtp, locale)} (${goremeRtpRange(r.ciLow, r.ciHigh, locale)})`;
}

export interface GoremeBuyState { betCents: number; balanceCents: number; ante: boolean; autoplay: boolean; busy: boolean; gated?: boolean }
export type GoremeBuyBlock = { code: 'gated' | 'autoplay' | 'busy' | 'ante' } | { code: 'balance'; priceCents: number };
/** Why the bonus buy cannot be used right now, as a code (the screen translates it: `goreme.buy.block.<code>`), or null. First matching reason wins. */
export function goremeBuyBlock(state: GoremeBuyState): GoremeBuyBlock | null {
  if (state.gated) return { code: 'gated' };
  if (state.autoplay) return { code: 'autoplay' };
  if (state.busy) return { code: 'busy' };
  if (state.ante) return { code: 'ante' };
  const price = goremeCost(state.betCents, 'buy');
  if (price > state.balanceCents) return { code: 'balance', priceCents: price };
  return null;
}

/** Spin-speed setting -> timeline options (presentation only; the result is already fixed). */
export function goremeTimelineOptions(settings: Pick<SlotSettings, 'spinSpeed' | 'skipScreens'>, reducedMotion: boolean): GoremeTimelineOptions & { speed: GoremeSpeed } {
  return { speed: settings.spinSpeed, skipScreens: settings.skipScreens, reducedMotion };
}
/** Pause between autoplay rounds per speed (ms). */
export const GOREME_AUTOPLAY_GAP: Readonly<Record<GoremeSpeed, number>> = Object.freeze({ normal: 650, quick: 420, turbo: 220 });

/** Short, readable round id from the seed: first 4 + last 4 hex characters. */
export function goremeRoundId(seedHex: string): string {
  return seedHex.length <= 10 ? seedHex : `${seedHex.slice(0, 4)}…${seedHex.slice(-4)}`;
}

/* ------------------------------------------------------------------ autoplay adapter */
export interface GoremeAutoplayRound { costCents: number; payoutCents: number; featureTriggered: boolean; balanceBeforeCents: number }

/** Folds a settled round into the controller: balance after = before − cost + payout (one ledger round). */
export function goremeAutoplayAfterRound(state: AutoplayState, round: GoremeAutoplayRound): AutoplayState {
  return recordRound(state, {
    costCents: round.costCents, payoutCents: round.payoutCents, featureTriggered: round.featureTriggered,
    balanceAfterCents: round.balanceBeforeCents - round.costCents + round.payoutCents,
  });
}
/** Decision before the next autoplay spin. Autoplay never buys: the next cost is the standard or ante cost. */
export function goremeAutoplayBeforeSpin(state: AutoplayState, input: { balanceCents: number; betCents: number; ante: boolean; tabHidden: boolean }): AutoplayDecision & { costCents: number } {
  const costCents = goremeCost(input.betCents, input.ante ? 'ante' : 'standard');
  return { ...nextDecision(state, { balanceCents: input.balanceCents, nextCostCents: costCents, tabHidden: input.tabHidden }), costCents };
}
