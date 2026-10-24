import { CEZERI_MAX_WIN_MULTIPLIER } from '@sollish/protocol';
import type { CezeriEndStep, CezeriRound, CezeriScatterStep, CezeriWinStep } from '@sollish/protocol';
import type { BreakdownSpin, RoundBreakdown } from './types';

/** Cezeri (`cezeri-gears-1`): every new spoke win of the gear-lock chain ((full - paid before) x hub) and the vessel scatter pay.
 * The chain is one group: its amount is the engine's `end.chainHundredths`. */
export function cezeriBreakdown(round: CezeriRound, capHundredths: number = CEZERI_MAX_WIN_MULTIPLIER * 100): RoundBreakdown {
  const spins: BreakdownSpin[] = round.spins.map(spin => {
    const wins = spin.steps.filter((s): s is CezeriWinStep => s.type === 'win');
    const end = spin.steps.find((s): s is CezeriEndStep => s.type === 'end');
    const scatter = spin.steps.find((s): s is CezeriScatterStep => s.type === 'scatter');
    const chain = end ? end.chainHundredths : spin.chainHundredths;
    return {
      index: spin.index, kind: spin.kind,
      groups: wins.length ? [{
        step: 1, unit: 100, divisor: 1, factors: [], amountHundredths: chain,
        lines: wins.map(w => ({
          kind: 'spoke', symbol: w.symbol, count: w.length, spoke: w.spoke + 1, startRing: w.startRing, rotation: w.round + 1,
          base: w.fullHundredths, deduct: w.paidBefore > 0 ? w.paidBefore : undefined, factors: [{ kind: 'hub', value: w.hub }], amount: w.winHundredths, unit: 100,
        })),
      }] : [],
      factors: [],
      extras: scatter && scatter.payHundredths > 0 ? [{ kind: 'scatter', symbol: 'vessel', count: scatter.count, base: scatter.payHundredths, factors: [], amount: spin.scatterHundredths, unit: 100 }] : [],
      winHundredths: spin.winHundredths,
    };
  });
  return {
    game: 'cezeri', engine: round.engine, mode: round.mode, seedHex: round.seedHex, betCents: round.betCents, spins,
    capHundredths, capped: round.capped, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents,
  };
}
