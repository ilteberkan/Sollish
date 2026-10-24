import { EBRU_MAX_WIN_MULTIPLIER } from '@sollish/protocol';
import type { EbruClustersStep, EbruRound } from '@sollish/protocol';
import type { BreakdownGroup, BreakdownSpin, RoundBreakdown } from './types';

/** Ebru (`ebru-ink-1`): every cluster step with its stain multiplier (free spins) and the comb scatter pay. */
export function ebruBreakdown(round: EbruRound, capHundredths: number = EBRU_MAX_WIN_MULTIPLIER * 100): RoundBreakdown {
  const spins: BreakdownSpin[] = round.spins.map(spin => {
    const steps = spin.steps.filter((step): step is EbruClustersStep => step.type === 'clusters');
    const groups: BreakdownGroup[] = steps.map((step, i) => ({
      step: i + 1, unit: 100, divisor: 1, factors: [], amountHundredths: step.stepHundredths,
      lines: step.clusters.map(c => ({
        kind: 'cluster', symbol: c.colour, count: c.size, base: c.payHundredths,
        factors: c.stainSum > 0 ? [{ kind: 'stain', value: c.multiplier }] : [], amount: c.winHundredths, unit: 100,
      })),
    }));
    return {
      index: spin.index, kind: spin.kind, groups, factors: [],
      extras: spin.scatterHundredths > 0 ? [{ kind: 'scatter', symbol: 'comb', count: spin.scatterCount, base: spin.scatterHundredths, factors: [], amount: spin.scatterHundredths, unit: 100 }] : [],
      winHundredths: spin.winHundredths,
    };
  });
  return {
    game: 'ebru', engine: round.engine, mode: round.mode, seedHex: round.seedHex, betCents: round.betCents, spins,
    capHundredths, capped: round.capped, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents,
  };
}
