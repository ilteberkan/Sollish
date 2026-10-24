import { CASCADE2_MAX_WIN_MULTIPLIER } from '@sollish/protocol';
import type { Cascade2Round } from '@sollish/protocol';
import type { BreakdownGroup, BreakdownSpin, RoundBreakdown } from './types';

/** Candy Cascade (`candy-cascade-2`): every tumble's scatter-pays wins, the crystal sum on the spin and the star scatter pay. */
export function cascadeBreakdown(round: Cascade2Round, capHundredths: number = CASCADE2_MAX_WIN_MULTIPLIER * 100): RoundBreakdown {
  const spins: BreakdownSpin[] = round.spins.map(spin => {
    const groups: BreakdownGroup[] = spin.steps.filter(step => step.wins.length > 0).map((step, i) => ({
      step: i + 1, unit: 100, divisor: 1, factors: [], amountHundredths: step.stepHundredths,
      lines: step.wins.map(win => ({ kind: 'cluster', symbol: win.symbol, count: win.count, base: win.payHundredths, factors: [], amount: win.payHundredths, unit: 100 })),
    }));
    return {
      index: spin.index, kind: spin.kind, groups,
      factors: spin.multiplierSum > 0 ? [{ kind: 'crystals', value: spin.multiplierSum }] : [],
      extras: spin.scatterHundredths > 0 ? [{ kind: 'scatter', symbol: 'star', count: spin.scatterCount, base: spin.scatterHundredths, factors: [], amount: spin.scatterHundredths, unit: 100 }] : [],
      winHundredths: spin.winHundredths,
    };
  });
  return {
    game: 'cascade', engine: round.engine, mode: round.mode, seedHex: round.seedHex, betCents: round.betCents, spins,
    capHundredths, capped: round.capped, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents,
  };
}
