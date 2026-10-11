/**
 * Candy Cascade control rules (pure, integer cents, no DOM, no clock). The game component only wires these
 * to React state, so every rule a player can see (what a spin costs, why "Bonus satın al" is off, when
 * autoplay stops, what the ledger may pay out) is unit-tested here.
 */
import {
  CASCADE2_BET_LEVELS_CENTS, CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_RTP, cascadeCostCents, type CascadeMode,
} from '@sollish/protocol';
import {
  nextDecision, recordRound, type AutoplayDecision, type AutoplayState,
} from './slot-kit/autoplay';
import { createBetLadder, formatDemo, type CostMode } from './slot-kit/bet';
import type { SlotSettings } from './slot-kit/settings';
import type { CascadeSpeed, TimelineOptions } from './cascade-timeline';

export const CASCADE_BET_LADDER = createBetLadder(CASCADE2_BET_LEVELS_CENTS);
export const CASCADE_MIN_BET_CENTS = CASCADE_BET_LADDER[0]!;
export const CASCADE_MAX_BET_CENTS = CASCADE_BET_LADDER[CASCADE_BET_LADDER.length - 1]!;
export const CASCADE_DEFAULT_BET_CENTS = 1000;
/** Cost factors as the slot kit's integer ratios (they match the engine's CASCADE2_COST_FRACTION). */
export const CASCADE_COST_MODES: Readonly<Record<CascadeMode, CostMode>> = Object.freeze({
  standard: Object.freeze({ num: 1, den: 1 }), ante: Object.freeze({ num: 5, den: 4 }), buy: Object.freeze({ num: 100, den: 1 }),
});
/** The ledger's own ceilings (lib/demo.ts): payout multiplier on the reserved cost, and the stake ceiling. */
export const CASCADE_LEDGER_MAX_MULTIPLIER = 5000;
export const CASCADE_LEDGER_MAX_STAKE_CENTS = 5_000_000;

export const CASCADE_MODE_LABELS: Readonly<Record<CascadeMode, string>> = Object.freeze({ standard: 'Standart', ante: 'Şans ×2', buy: 'Bonus satın alma' });

/** What one round of `mode` takes from the balance (engine rule). */
export function cascadeCost(betCents: number, mode: CascadeMode): number {
  return cascadeCostCents(betCents, mode);
}

/**
 * Reservation limits for one round: the engine cap is 5000 x BET, the ledger caps the payout at
 * maxMultiplier x COST, so maxMultiplier = ceil(5000 x bet / cost) (standard 5000, ante 4000, buy 50).
 */
export function cascadeLedgerLimits(betCents: number, mode: CascadeMode): { maxMultiplier: number; maxStakeCents: number } {
  const cost = cascadeCost(betCents, mode);
  const maxMultiplier = Math.ceil((CASCADE2_MAX_WIN_MULTIPLIER * betCents) / cost);
  if (maxMultiplier < 1 || maxMultiplier > CASCADE_LEDGER_MAX_MULTIPLIER) throw new RangeError('Cascade cap exceeds the ledger ceiling');
  return { maxMultiplier, maxStakeCents: CASCADE_LEDGER_MAX_STAKE_CENTS };
}

/** 0.962 -> "%96,2" (Turkish percent, one decimal). */
export function formatRtp(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `%${(Math.round(ratio * 1000) / 10).toFixed(1).replace('.', ',')}`;
}
/** "%95,1–96,3" interval text. */
export function formatRtpRange(low: number, high: number): string {
  return `${formatRtp(low)}–${formatRtp(high).slice(1)}`;
}
export function cascadeRtpText(mode: CascadeMode): string {
  const r = CASCADE2_RTP[mode];
  return `${formatRtp(r.rtp)} (GA ${formatRtpRange(r.ciLow, r.ciHigh)})`;
}

export interface BuyState {
  betCents: number;
  balanceCents: number;
  ante: boolean;
  autoplay: boolean;
  busy: boolean;
  gated?: boolean;
}
/** Why "Bonus satın al" cannot be used right now, or null when it can. First matching reason wins. */
export function buyBlockReason(state: BuyState): string | null {
  if (state.gated) return 'Yalnız DEMO kredisiyle satın alınır';
  if (state.autoplay) return 'Otomatik oyun sürerken satın alınamaz';
  if (state.busy) return 'Tur bitmeden satın alınamaz';
  if (state.ante) return 'Şans ×2 açıkken satın alınamaz';
  const price = cascadeCost(state.betCents, 'buy');
  if (price > state.balanceCents) return `Bakiye yetersiz (fiyat ${formatDemo(price)})`;
  return null;
}

/** Spin-speed setting -> timeline options (presentation only; the result is already fixed). */
export function cascadeTimelineOptions(settings: Pick<SlotSettings, 'spinSpeed' | 'skipScreens'>, reducedMotion: boolean): TimelineOptions & { speed: CascadeSpeed } {
  return { speed: settings.spinSpeed, skipScreens: settings.skipScreens, reducedMotion };
}
/** Pause between autoplay rounds per speed (ms). */
export const CASCADE_AUTOPLAY_GAP: Readonly<Record<CascadeSpeed, number>> = Object.freeze({ normal: 650, quick: 420, turbo: 220 });

/** Short, readable round id from the seed: first 4 + last 4 hex characters. */
export function shortRoundId(seedHex: string): string {
  return seedHex.length <= 10 ? seedHex : `${seedHex.slice(0, 4)}…${seedHex.slice(-4)}`;
}

/* ------------------------------------------------------------------ autoplay adapter */
export interface CascadeAutoplayRound { costCents: number; payoutCents: number; featureTriggered: boolean; balanceBeforeCents: number }

/** Folds a settled round into the controller: the balance after is before - cost + payout (one ledger round). */
export function autoplayAfterRound(state: AutoplayState, round: CascadeAutoplayRound): AutoplayState {
  return recordRound(state, {
    costCents: round.costCents, payoutCents: round.payoutCents, featureTriggered: round.featureTriggered,
    balanceAfterCents: round.balanceBeforeCents - round.costCents + round.payoutCents,
  });
}

/**
 * Decision before the next autoplay spin. Autoplay never buys: the next cost is the standard or ante cost.
 * Returns the kit decision plus the cost it was checked against.
 */
export function autoplayBeforeSpin(state: AutoplayState, input: { balanceCents: number; betCents: number; ante: boolean; tabHidden: boolean }): AutoplayDecision & { costCents: number } {
  const costCents = cascadeCost(input.betCents, input.ante ? 'ante' : 'standard');
  return { ...nextDecision(state, { balanceCents: input.balanceCents, nextCostCents: costCents, tabHidden: input.tabHidden }), costCents };
}
