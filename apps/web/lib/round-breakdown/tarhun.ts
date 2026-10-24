import { STORM_MAX_WIN_MULTIPLIER } from '@sollish/protocol';
import type { StormRound } from '@sollish/protocol';
import type { BreakdownGroup, BreakdownSpin, RoundBreakdown } from './types';

/** Tarhun (`storm-throne-1`): tumble wins, the orb sum (base) or the persistent total multiplier (free), the seal scatter pay. */
export function tarhunBreakdown(round: StormRound, capHundredths: number = STORM_MAX_WIN_MULTIPLIER * 100): RoundBreakdown {
  const spins: BreakdownSpin[] = round.spins.map(spin => {
    const groups: BreakdownGroup[] = spin.steps.filter(step => step.wins.length > 0).map((step, i) => ({
      step: i + 1, unit: 100, divisor: 1, factors: [], amountHundredths: step.stepHundredths,
      lines: step.wins.map(win => ({ kind: 'cluster', symbol: win.symbol, count: win.count, base: win.payHundredths, factors: [], amount: win.payHundredths, unit: 100 })),
    }));
    // The engine multiplies tumbleHundredths by appliedMultiplier (base: orb sum || 1, free: total multiplier || 1).
    const factors: BreakdownSpin['factors'] = spin.appliedMultiplier > 1 ? [{ kind: spin.kind === 'base' ? 'orbs' : 'total', value: spin.appliedMultiplier }] : [];
    return {
      index: spin.index, kind: spin.kind, groups, factors,
      extras: spin.scatterHundredths > 0 ? [{ kind: 'scatter', symbol: 'scatter', count: spin.scatterCount, base: spin.scatterHundredths, factors: [], amount: spin.scatterHundredths, unit: 100 }] : [],
      winHundredths: spin.winHundredths,
    };
  });
  return {
    game: 'tarhun', engine: round.engine, mode: round.mode, seedHex: round.seedHex, betCents: round.betCents, spins,
    capHundredths, capped: round.capped, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents,
  };
}
