/**
 * Göreme win lines: the per-way amounts the board labels show ("Avanos Çömleği 3× · 9 yol · ×6 = 4,80"). Pure and
 * presentation only: every number is copied from the engine round (`goreme-balloons-1`), nothing here can change a
 * result or a payout.
 *
 * Amounts in cents add up EXACTLY to the round payout. The engine pays the round as floor(bet × totalHundredths / 100)
 * after summing boards in hundredths (each board floored after its sky multiplier, the round clamped at the cap), so a
 * per-way floor would drift by a cent here and there. Instead:
 *   - every paid board (and the base scatter pay) gets the cents the meter actually adds at that point:
 *     cents(running total after) − cents(running total before), with the round cap applied to the running total, so
 *     the boards and the scatter sum to the payout;
 *   - inside a board those cents are split over its ways by largest remainder, weighted by the engine's
 *     payTenThousandths (the sky multiplier is common to every way of a board), so the lines sum to the board.
 */
import { GOREME_MAX_WIN_MULTIPLIER, type GoremePaySymbol, type GoremeRound, type GoremeWayWin } from '@sollish/protocol';

export interface GoremeWinLine {
  symbol: GoremePaySymbol;
  /** Run length: leading reels 3..6 the way crosses. */
  reels: number;
  /** Plain way count (engine `ways`). */
  ways: number;
  /** Largest multiplier one way gets: balloon product × sky (1 = no multiplier). */
  multiplier: number;
  /** Engine pay of this way before the sky, ten-thousandths of the bet. */
  payTenThousandths: number;
  /** This way's share of the board's cents (see the file comment). */
  amountCents: number;
  /** Cell ids of the run (symbol and balloon cells, reel-major), from the engine. */
  cells: number[];
}

export interface GoremeWinBoard { spin: number; step: number; sky: number; winHundredths: number; cents: number; lines: GoremeWinLine[] }
export interface GoremeRoundWins { boards: GoremeWinBoard[]; scatterCents: number; payoutCents: number }

const centsOf = (betCents: number, hundredths: number) => Math.floor((betCents * hundredths) / 100);

/** Splits `total` over `weights` (non-negative integers) by largest remainder: the parts are integers and sum to total. */
export function splitByWeight(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) { const out = weights.map(() => 0); out[0] = total; return out; }
  // BigInt: total × weight can pass 2^53 near the cap
  const T = BigInt(total), S = BigInt(sum);
  const parts = weights.map(w => Number((T * BigInt(w)) / S));
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => ({ i, r: (T * BigInt(w)) % S })).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k]!.i]!++;
  return parts;
}

/** The lines of one paid board, given the cents this board adds to the round. */
export function goremeWinLines(wins: readonly GoremeWayWin[], sky: number, boardCents: number): GoremeWinLine[] {
  const shares = splitByWeight(boardCents, wins.map(w => w.payTenThousandths));
  return wins.map((w, i) => ({
    symbol: w.symbol, reels: w.length, ways: w.ways, multiplier: w.multiplierProduct * Math.max(1, sky),
    payTenThousandths: w.payTenThousandths, amountCents: shares[i]!, cells: w.cells.slice(),
  }));
}

/** Every paid board of the round in play order, with its lines; boards + scatter sum to round.payoutCents. */
export function goremeRoundWins(round: GoremeRound, capHundredths: number = GOREME_MAX_WIN_MULTIPLIER * 100): GoremeRoundWins {
  const bet = round.betCents;
  const boards: GoremeWinBoard[] = [];
  let running = 0, scatterCents = 0;
  const add = (hundredths: number) => {
    const before = centsOf(bet, running);
    running = Math.min(capHundredths, running + hundredths);
    return centsOf(bet, running) - before;
  };
  for (const spin of round.spins) {
    spin.steps.forEach((step, i) => {
      if (step.type === 'ways' && step.wins.length) {
        const cents = add(step.winHundredths);
        boards.push({ spin: spin.index, step: i, sky: step.skyMultiplier, winHundredths: step.winHundredths, cents, lines: goremeWinLines(step.wins, step.skyMultiplier, cents) });
      } else if (step.type === 'scatter' && spin.kind === 'base' && step.payHundredths > 0) scatterCents += add(step.payHundredths);
    });
  }
  return { boards, scatterCents, payoutCents: centsOf(bet, running) };
}

/** Order the per-way highlight cycles through: biggest amount first, engine order on ties. */
export function goremeLineOrder(lines: readonly GoremeWinLine[]): number[] {
  return lines.map((l, i) => ({ l, i })).sort((a, b) => b.l.amountCents - a.l.amountCents || b.l.payTenThousandths - a.l.payTenThousandths || a.i - b.i).map(x => x.i);
}
