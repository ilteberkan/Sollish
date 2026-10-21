/**
 * Damla: Pamukkale presentation timeline (pure). One engine round (damla-terraces-1) -> the drop's flight over the
 * terraces as timed events and a position function the canvas samples every frame. Presentation only: the round (path,
 * pool, payout) is fixed before this runs and nothing here can change it; the drop follows `round.path` exactly.
 *
 * Geometry is in lattice units: on terrace row i (0 = top) the drop sits in basin b = number of right spills so far (0..i),
 * at x = b − i/2 (0 = the centre line). After the last terrace it falls into bottom pool `slot` at x = slot − rows/2, y = rows.
 */
import type { DamlaRound } from '@sollish/protocol';
import { WIN_TIER_INFO, winTierOf, type CelebrationLevel } from './slot-kit/win-tiers';
import type { SpinSpeed } from './slot-kit/settings';

export interface DamlaTimelineOptions { speed?: SpinSpeed; reducedMotion?: boolean }
export type DamlaEvent =
  | { type: 'drop'; at: number; dur: number }
  /** The drop lands in basin `basin` of terrace `terrace` (splash + plink), coming from the left/right rim above. */
  | { type: 'splash'; at: number; dur: number; terrace: number; basin: number; x: number; from: 'L' | 'R' | null }
  /** Into the bottom pool: overflow and glow. */
  | { type: 'land'; at: number; dur: number; slot: number; x: number; multiplierHundredths: number; payoutCents: number; edge: boolean; signature: boolean; tier: DamlaTier }
  /** The drop's result is presented (balance, history, strip) once its landing glow has peaked. */
  | { type: 'settle'; at: number; dur: number }
  | { type: 'end'; at: number; dur: 0 };
export interface DamlaTimeline { rows: number; events: DamlaEvent[]; landAt: number; settleAt: number; duration: number; hop: number; fall: number }

/** Landing tiers (chime and glow strength): by multiplier of the bet. */
export type DamlaTier = 0 | 1 | 2 | 3 | 4 | 5;
/** < 1× (loss), 1–2×, 2–5×, 5–10×, 10–100×, ≥ 100×. */
export function damlaTier(hundredths: number): DamlaTier {
  if (hundredths < 100) return 0;
  if (hundredths < 200) return 1;
  if (hundredths < 500) return 2;
  if (hundredths < 1000) return 3;
  if (hundredths < 10_000) return 4;
  return 5;
}
/** Win tier screen level of a drop (game-standards §6: Big ≥10×, Mega ≥25×, Super ≥50×, Epic ≥100×, Max at the cap). */
export function damlaCelebration(hundredths: number, capped: boolean): CelebrationLevel | null {
  if (capped) return 5;
  const tier = winTierOf(hundredths);
  return tier === 0 ? null : tier;
}
export const DAMLA_TIER_INFO = WIN_TIER_INFO;

/** Hop length (ms) per terrace for each speed; the first fall is longer. */
export const DAMLA_HOP_MS: Readonly<Record<SpinSpeed, number>> = Object.freeze({ normal: 230, quick: 160, turbo: 95 });
const FALL_FACTOR = 1.6;
const LAND_GLOW_MS = 260;

export function buildDamlaTimeline(round: DamlaRound, options: DamlaTimelineOptions = {}): DamlaTimeline {
  const speed = options.speed ?? 'normal';
  const hop = DAMLA_HOP_MS[speed] * (options.reducedMotion ? 0.8 : 1);
  const fall = Math.round(hop * FALL_FACTOR);
  const rows = round.rows;
  if (round.path.length !== rows) throw new RangeError('path length must equal rows');
  const events: DamlaEvent[] = [{ type: 'drop', at: 0, dur: fall }];
  let basin = 0;
  for (let i = 0; i < rows; i++) {
    const at = Math.round(fall + i * hop);
    events.push({ type: 'splash', at, dur: hop, terrace: i, basin, x: basin - i / 2, from: i === 0 ? null : round.path[i - 1]! });
    if (round.path[i] === 'R') basin++;
  }
  if (basin !== round.slot) throw new RangeError('path does not end in round.slot');
  const landAt = Math.round(fall + rows * hop);
  const edge = round.slot === 0 || round.slot === rows;
  const settleAt = landAt + LAND_GLOW_MS;
  events.push({
    type: 'land', at: landAt, dur: LAND_GLOW_MS, slot: round.slot, x: round.slot - rows / 2, multiplierHundredths: round.multiplierHundredths,
    payoutCents: round.payoutCents, edge, signature: round.risk === 'high' && round.capped, tier: damlaTier(round.multiplierHundredths),
  });
  events.push({ type: 'settle', at: settleAt, dur: 0 });
  events.push({ type: 'end', at: settleAt, dur: 0 });
  return { rows, events, landAt, settleAt, duration: settleAt, hop, fall };
}

/** Lattice x of the drop on each terrace row (0..rows-1) and in the bottom pool (index rows). */
export function damlaLatticeXs(round: Pick<DamlaRound, 'path' | 'rows'>): number[] {
  const xs: number[] = [];
  let basin = 0;
  for (let i = 0; i < round.rows; i++) { xs.push(basin - i / 2); if (round.path[i] === 'R') basin++; }
  xs.push(basin - round.rows / 2);
  return xs;
}

export interface DamlaDropState {
  /** Lattice x and row y (y = −1.2 at the start, i on terrace i, rows in the pool). */
  x: number; y: number;
  /** 'fall' (before terrace 0), 'hop' (between rows), 'pool' (landed). */
  phase: 'fall' | 'hop' | 'pool';
  /** Index of the row the drop is heading to. */
  to: number;
  /** 0..1 progress of the current fall/hop. */
  u: number;
  /** Squash (0..1) right after a splash. */
  squash: number;
}

/**
 * Where the drop is at presentation time `t` (ms since its launch). It hangs at the top, falls into terrace 0, then hops
 * basin to basin: it spills over the rim (a small rise and a sideways glide) and drops into the next terrace, and finally
 * into its pool. Pure, so tests can check that it passes through every basin of `round.path` and ends in `round.slot`.
 */
export function damlaDropAt(timeline: DamlaTimeline, xs: readonly number[], t: number): DamlaDropState {
  const { fall, hop, rows } = timeline;
  if (t <= 0) return { x: xs[0]!, y: -1.2, phase: 'fall', to: 0, u: 0, squash: 0 };
  if (t < fall) {
    const u = t / fall;
    return { x: xs[0]!, y: -1.2 + 1.2 * u * u, phase: 'fall', to: 0, u, squash: 0 };
  }
  const k = (t - fall) / hop;
  if (k >= rows) {
    const since = t - (fall + rows * hop);
    return { x: xs[rows]!, y: rows, phase: 'pool', to: rows, u: 1, squash: Math.max(0, 1 - since / 140) };
  }
  const i = Math.floor(k), u = k - i;
  const x0 = xs[i]!, x1 = xs[i + 1]!;
  // spill: the first 30 % glides to the rim with a small rise, then a gravity fall into the next basin
  const glide = Math.min(1, u / 0.42);
  const x = x0 + (x1 - x0) * (1 - (1 - glide) * (1 - glide));
  const y = u < 0.3 ? i - 0.16 * Math.sin((u / 0.3) * Math.PI * 0.5) : i - 0.16 + 1.16 * ((u - 0.3) / 0.7) ** 2;
  const squash = Math.max(0, 1 - (u * hop) / 120);
  return { x, y, phase: 'hop', to: i + 1, u, squash };
}

/** History row data, re-derived from the engine round in the active language. */
export interface DamlaHistorySummary { mode: DamlaRound['mode']; slot: number; rows: number; multiplierHundredths: number; capped: boolean; rights: number }
export function damlaHistorySummary(round: DamlaRound): DamlaHistorySummary {
  return { mode: round.mode, slot: round.slot, rows: round.rows, multiplierHundredths: round.multiplierHundredths, capped: round.capped, rights: round.path.filter(p => p === 'R').length };
}
/** Turkish ledger line (stored in the DEMO record; the history re-derives the shown text). */
export function damlaHistoryDetail(round: DamlaRound): string {
  return `${round.mode} · havuz ${round.slot + 1}/${round.rows + 1} · ${(round.multiplierHundredths / 100).toFixed(2).replace('.', ',')}×`;
}
