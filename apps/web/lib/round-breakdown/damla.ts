import type { DamlaRound } from '@sollish/protocol';
import type { RoundBreakdown } from './types';

/** Damla (`damla-terraces-1`): the drop's path, its pool (number of right spills) and the pool multiplier; bet x multiplier = payout.
 * The engine has no cap reduction (its `capped` only marks the edge pool), so capHundredths is null. */
export function damlaBreakdown(round: DamlaRound): RoundBreakdown {
  return {
    game: 'damla', engine: round.engine, mode: round.mode, seedHex: round.seedHex, betCents: round.betCents,
    spins: [{
      index: 0, kind: 'base', factors: [], extras: [], winHundredths: round.totalHundredths,
      groups: [{
        step: 1, unit: 100, divisor: 1, factors: [], amountHundredths: round.totalHundredths,
        lines: [{ kind: 'pool', symbol: 'pool', count: round.rows, path: round.path.join(''), slot: round.slot, base: round.multiplierHundredths, factors: [], amount: round.multiplierHundredths, unit: 100 }],
      }],
    }],
    capHundredths: null, capped: false, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents,
  };
}
