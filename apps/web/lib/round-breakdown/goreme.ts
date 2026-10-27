import { GOREME_MAX_WIN_MULTIPLIER } from '@sollish/protocol';
import type { GoremeRound, GoremeScatterStep, GoremeWaysStep } from '@sollish/protocol';
import type { BreakdownGroup, BreakdownSpin, RoundBreakdown } from './types';
import { goremeRoundWins } from '../goreme-wins';

/** Göreme (`goreme-balloons-1`): every paid board of a spin (first board and every lift respin). A ways line is
 * pay per way (ten-thousandths of the bet) x multiplier-weighted ways; the board is floor(sum x sky / 100) hundredths. */
export function goremeBreakdown(round: GoremeRound, capHundredths: number = GOREME_MAX_WIN_MULTIPLIER * 100): RoundBreakdown {
  // the per-way cents the board labels show (lib/goreme-wins.ts), in play order: paid boards of each spin
  const wins = goremeRoundWins(round, capHundredths);
  const shares = wins.boards;
  let paid = 0;
  const spins: BreakdownSpin[] = round.spins.map(spin => {
    const boards = spin.steps.filter((s): s is GoremeWaysStep => s.type === 'ways');
    const groups: BreakdownGroup[] = [];
    boards.forEach((board, i) => {
      if (board.wins.length === 0) return;
      const share = shares[paid++];
      groups.push({
        step: i + 1, unit: 10_000, divisor: 100, clamp: capHundredths, amountHundredths: board.winHundredths,
        factors: board.skyMultiplier > 1 ? [{ kind: 'sky', value: board.skyMultiplier }] : [],
        lines: board.wins.map((w, k) => ({
          kind: 'ways', symbol: w.symbol, count: w.length, ways: w.ways, base: w.payPerWayTenThousandths,
          factors: [{ kind: 'ways', value: w.weightedWays }], clamp: capHundredths * 100, amount: w.payTenThousandths, unit: 10_000,
          shareCents: share?.lines[k]?.amountCents,
        })),
      });
    });
    const scatter = spin.steps.find((s): s is GoremeScatterStep => s.type === 'scatter');
    return {
      index: spin.index, kind: spin.kind, groups, factors: [],
      extras: scatter && scatter.payHundredths > 0 ? [{
        kind: 'scatter', symbol: 'sun', count: scatter.count, base: scatter.payHundredths, factors: [], amount: spin.scatterHundredths, unit: 100,
        shareCents: spin.kind === 'base' ? wins.scatterCents : undefined,
      }] : [],
      winHundredths: spin.winHundredths,
    };
  });
  return {
    game: 'goreme', engine: round.engine, mode: round.mode, seedHex: round.seedHex, betCents: round.betCents, spins,
    capHundredths, capped: round.capped, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents,
  };
}
