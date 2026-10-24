/**
 * Size / length labels of the paytables shown on the game info pages. They used to be hard-coded in each info page;
 * they live here so tests/round-breakdown-paytables.test.ts can prove that every label covers exactly the cluster sizes
 * (or run lengths) the engine pays with that column. The pay VALUES are always read from the engine constants.
 */
import { EBRU_CLUSTER_TIER_STARTS, GOREME_MIN_LENGTH, GOREME_REELS } from '@sollish/protocol';

/** Labels of consecutive tier starts: [5, 6, 8] -> "5", "6–7", "8+". */
export function tierLabels(starts: readonly number[]): string[] {
  return starts.map((start, i) => {
    const next = starts[i + 1];
    if (next === undefined) return `${start}+`;
    return next - 1 === start ? `${start}` : `${start}–${next - 1}`;
  });
}
/** [min, max] of a label ("8–9", "12+", "5"); max is Infinity for "N+". */
export function labelRange(label: string): [number, number] {
  if (label.endsWith('+')) return [Number(label.slice(0, -1)), Infinity];
  const [a, b] = label.split('–');
  return [Number(a), Number(b ?? a)];
}

/** Candy Cascade and Tarhun: engine tier index 0..2 = sizes 8–9, 10–11, 12+. */
export const TUMBLE8_TIER_STARTS: readonly number[] = Object.freeze([8, 10, 12]);
export const TUMBLE8_TIER_LABELS: readonly string[] = Object.freeze(tierLabels(TUMBLE8_TIER_STARTS));
/** Asena: engine tier index 0..6 (asenaTier) = sizes 5, 6, 7, 8–9, 10–12, 13–17, 18+. */
export const ASENA_TIER_STARTS: readonly number[] = Object.freeze([5, 6, 7, 8, 10, 13, 18]);
export const ASENA_TIER_LABELS: readonly string[] = Object.freeze(tierLabels(ASENA_TIER_STARTS));
/** Ebru: straight from the engine's EBRU_CLUSTER_TIER_STARTS. */
export const EBRU_TIER_LABELS: readonly string[] = Object.freeze(tierLabels(EBRU_CLUSTER_TIER_STARTS));
/** Göreme: run lengths of the GOREME_PAYTABLE columns (3..6 reels). */
export const GOREME_LENGTHS: readonly number[] = Object.freeze(Array.from({ length: GOREME_REELS - GOREME_MIN_LENGTH + 1 }, (_, i) => GOREME_MIN_LENGTH + i));
