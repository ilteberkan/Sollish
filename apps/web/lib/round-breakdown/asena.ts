import { ASENA_MAX_WIN_MULTIPLIER } from '@sollish/protocol';
import type { AsenaRound } from '@sollish/protocol';
import type { BreakdownGroup, BreakdownSpin, RoundBreakdown } from './types';

/** Asena (`asena-stars-1`): cluster pays with their constellation multiplier, the Ergenekon global multiplier per step, the moon pay. */
export function asenaBreakdown(round: AsenaRound, capHundredths: number = ASENA_MAX_WIN_MULTIPLIER * 100): RoundBreakdown {
  const spins: BreakdownSpin[] = round.spins.map(spin => {
    const groups: BreakdownGroup[] = spin.steps.filter(step => step.clusters.length > 0).map((step, i) => ({
      step: i + 1, unit: 100, divisor: 1, amountHundredths: step.winHundredths,
      factors: step.globalMultiplier > 1 ? [{ kind: 'global', value: step.globalMultiplier }] : [],
      lines: step.clusters.map(c => ({
        kind: 'cluster', symbol: c.symbol, count: c.size, base: c.basePayHundredths,
        factors: c.templateMultiplier > 1 ? [{ kind: 'template', value: c.templateMultiplier, name: c.constellation?.templateId }] : [],
        amount: c.payHundredths, unit: 100,
      })),
    }));
    return {
      index: spin.index, kind: spin.kind, groups, factors: [],
      extras: spin.scatterHundredths > 0 ? [{ kind: 'scatter', symbol: 'moon', count: spin.scatterCount, base: spin.scatterHundredths, factors: [], amount: spin.scatterHundredths, unit: 100 }] : [],
      winHundredths: spin.winHundredths,
    };
  });
  return {
    game: 'asena', engine: round.engine, mode: round.mode, seedHex: round.seedHex, betCents: round.betCents, spins,
    capHundredths, capped: round.capped, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents,
  };
}
