/**
 * Damla: Pamukkale control rules (pure, integer cents, no DOM, no clock). The game component only wires these to React
 * state, so every rule a player can see (mode names, what is locked while drops are in flight, the ledger limits, the
 * order in which rain drops settle, when autobet stops, the balance shown while drops fall) is unit-tested here.
 *
 * Settlement model (the RGS model, docs/architecture/slot-rgs.md): a drop is resolved AND settled when it is admitted
 * (local: one DemoLedger reserve + settle; remote: the server). The screen then presents the already-settled drop. Until a
 * drop has landed on screen its payout is held back from the shown balance, its history row is hidden and the session /
 * autobet counters do not see it, so the presentation never reveals a result early and can never change one.
 */
import {
  DAMLA_BET_LEVELS_CENTS, DAMLA_EXACT_RTP, DAMLA_MODES, DAMLA_PAYTABLES, DAMLA_RISKS, DAMLA_ROWS, DAMLA_RTP,
  type DamlaMode, type DamlaRisk, type DamlaRows,
} from '@sollish/protocol';
import { nextDecision, recordRound, type AutoplayDecision, type AutoplayState } from './slot-kit/autoplay';
import { createBetLadder } from './slot-kit/bet';
import type { SpinSpeed } from './slot-kit/settings';
import { DEMO_CEILING_MULTIPLIER, DEMO_MAX_BET_CENTS } from './demo';
import { INTL_LOCALE, type Locale } from './i18n/config';

export const DAMLA_BET_LADDER = createBetLadder(DAMLA_BET_LEVELS_CENTS);
export const DAMLA_MIN_BET_CENTS = DAMLA_BET_LADDER[0]!;
export const DAMLA_MAX_BET_CENTS = DAMLA_BET_LADDER[DAMLA_BET_LADDER.length - 1]!;
export const DAMLA_DEFAULT_BET_CENTS = 100;
export const DAMLA_DEFAULT_RISK: DamlaRisk = 'medium';
export const DAMLA_DEFAULT_ROWS: DamlaRows = 12;
/** "Rain": this many drops, each its own round and nonce. */
export const DAMLA_RAIN_COUNTS = [5, 10] as const;
export type DamlaRainCount = (typeof DAMLA_RAIN_COUNTS)[number];

export function damlaMode(risk: DamlaRisk, rows: DamlaRows): DamlaMode { return `${risk}-${rows}`; }
export function parseDamlaMode(mode: string): { risk: DamlaRisk; rows: DamlaRows } | null {
  if (!(DAMLA_MODES as readonly string[]).includes(mode)) return null;
  const [risk, rows] = mode.split('-');
  return { risk: risk as DamlaRisk, rows: Number(rows) as DamlaRows };
}
export const isDamlaRisk = (v: unknown): v is DamlaRisk => typeof v === 'string' && (DAMLA_RISKS as readonly string[]).includes(v);
export const isDamlaRows = (v: unknown): v is DamlaRows => typeof v === 'number' && (DAMLA_ROWS as readonly number[]).includes(v);

/** Cost of one drop = the bet (no ante, no buy). */
export function damlaCost(betCents: number): number { return betCents; }
/** Largest pool of a mode, in hundredths of the bet. */
export function damlaCap(mode: DamlaMode): number { return Math.max(...DAMLA_PAYTABLES[mode]); }
/** Payout of pool `slot` in cents (floor, integer). */
export function damlaPayout(betCents: number, mode: DamlaMode, slot: number): number {
  return Number(BigInt(betCents) * BigInt(DAMLA_PAYTABLES[mode][slot]!) / 100n);
}

/** Reservation limits of one drop: the ledger caps the payout at maxMultiplier × cost (cost = bet), so the mode cap. */
export function damlaLedgerLimits(mode: DamlaMode): { maxMultiplier: number; maxStakeCents: number } {
  const maxMultiplier = Math.ceil(damlaCap(mode) / 100);
  if (maxMultiplier < 1 || maxMultiplier > DEMO_CEILING_MULTIPLIER) throw new RangeError('Damla cap exceeds the ledger ceiling');
  return { maxMultiplier, maxStakeCents: DEMO_MAX_BET_CENTS };
}

/* ------------------------------------------------------------------ locks */
export interface DamlaLockState { inFlight: number; autoplay: boolean; replaying: boolean; pending: boolean; gated?: boolean; booting?: boolean }
/** Risk, terraces and bet are frozen while any drop (or a replay) is in flight, a remote request is pending or autobet runs. */
export function damlaModeLocked(s: DamlaLockState): boolean {
  return s.inFlight > 0 || s.autoplay || s.replaying || s.pending || !!s.gated || !!s.booting;
}
/** Drop / Rain / Space: one press admits its drops; the button stays locked until they have all landed (game-standards §6). */
export function damlaDropLocked(s: DamlaLockState): boolean { return damlaModeLocked(s); }

/* ------------------------------------------------------------------ the balance while drops fall */
export interface DamlaUnseen { costCents: number; payoutCents: number }
/**
 * Balance shown on screen: the authoritative balance (already credited with every admitted drop) minus the payouts of drops
 * that have not landed on screen yet. Never negative.
 */
export function damlaShownBalance(authoritativeCents: number, unseen: readonly DamlaUnseen[]): number {
  let held = 0;
  for (const u of unseen) held += u.payoutCents;
  return Math.max(0, authoritativeCents - held);
}
/** Can `count` more drops of `costCents` be paid from the shown balance? (Unseen winnings are never staked.) */
export function damlaAffordable(shownBalanceCents: number, costCents: number, count = 1): boolean {
  return Number.isSafeInteger(costCents) && costCents > 0 && costCents * count <= shownBalanceCents;
}

/* ------------------------------------------------------------------ rain: launch spacing and in-order settlement */
/** Pause between two rain drops (ms of presentation). Remote drops also wait for their own server response. */
export const DAMLA_RAIN_GAP: Readonly<Record<SpinSpeed, number>> = Object.freeze({ normal: 260, quick: 190, turbo: 120 });
/** The RGS admits at most 4 rounds per second per session; remote rain never asks faster than this. */
export const DAMLA_REMOTE_MIN_GAP_MS = 280;
/** Pause between autobet drops (after the previous drop has landed). */
export const DAMLA_AUTOPLAY_GAP: Readonly<Record<SpinSpeed, number>> = Object.freeze({ normal: 380, quick: 240, turbo: 110 });

export interface DamlaQueued { seq: number; landed: boolean; settled: boolean }
/**
 * Drops settle on screen strictly in admission order: the head of the queue settles once it has landed; a later drop that
 * landed first (possible when the speed changed mid-rain) waits for the ones before it. Returns the sequence numbers to settle
 * now, in order.
 */
export function damlaSettleReady(queue: readonly DamlaQueued[]): number[] {
  const out: number[] = [];
  for (const q of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (q.settled) continue;
    if (!q.landed) break;
    out.push(q.seq);
  }
  return out;
}

/* ------------------------------------------------------------------ autobet */
export interface DamlaAutoplayRound { costCents: number; payoutCents: number; balanceBeforeCents: number }
/** Folds a landed drop into the controller: balance after = before − cost + payout. Damla has no feature. */
export function damlaAutoplayAfterRound(state: AutoplayState, round: DamlaAutoplayRound): AutoplayState {
  return recordRound(state, { costCents: round.costCents, payoutCents: round.payoutCents, featureTriggered: false, balanceAfterCents: round.balanceBeforeCents - round.costCents + round.payoutCents });
}
/** Decision before the next autobet drop (the loss limit is checked BEFORE a drop that could take the net loss over it). */
export function damlaAutoplayBeforeDrop(state: AutoplayState, input: { balanceCents: number; betCents: number; tabHidden: boolean }): AutoplayDecision & { costCents: number } {
  const costCents = damlaCost(input.betCents);
  return { ...nextDecision(state, { balanceCents: input.balanceCents, nextCostCents: costCents, tabHidden: input.tabHidden }), costCents };
}

/* ------------------------------------------------------------------ text helpers */
/** Short, readable round id from the seed: first 4 + last 4 hex characters. */
export function damlaRoundId(seedHex: string): string {
  return seedHex.length <= 10 ? seedHex : `${seedHex.slice(0, 4)}…${seedHex.slice(-4)}`;
}
const pct = new Map<string, Intl.NumberFormat>();
/** 0.984467773 -> "98.45%" (en) / "%98,45" (tr). */
export function damlaPercent(ratio: number, locale: Locale = 'tr', digits = 2): string {
  const key = `${locale}:${digits}`;
  let f = pct.get(key);
  if (!f) { f = new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }); pct.set(key, f); }
  return f.format(ratio);
}
/** Pool multiplier label from hundredths: 100000 -> "1000", 3300 -> "33", 250 -> "2.5", 33 -> "0.33" (locale decimal). */
export function damlaMultiplierText(hundredths: number, locale: Locale = 'tr'): string {
  const value = hundredths / 100;
  const digits = hundredths % 100 === 0 ? 0 : hundredths % 10 === 0 ? 1 : 2;
  return new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: value >= 10_000 }).format(value);
}
/** Exact RTP and house edge of a mode (binomial sum, DAMLA_EXACT_RTP) plus the Monte Carlo estimate (DAMLA_RTP). */
export function damlaModeFacts(mode: DamlaMode): { exact: number; houseEdge: number; simulated: number; stdDev: number; capHundredths: number } {
  const exact = DAMLA_EXACT_RTP[mode];
  return { exact, houseEdge: 1 - exact, simulated: DAMLA_RTP[mode].rtp, stdDev: DAMLA_RTP[mode].stdDev, capHundredths: damlaCap(mode) };
}
/** Lowest exact RTP over all modes (lobby headline). */
export const DAMLA_MIN_EXACT_RTP = Math.min(...DAMLA_MODES.map(m => DAMLA_EXACT_RTP[m]));
