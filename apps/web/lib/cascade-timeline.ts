/**
 * Candy Cascade presentation timeline. Pure: converts an already-resolved `CascadeRound` into an
 * ordered list of timed visual events. It never reads a clock, the DOM or randomness, and it only
 * re-states engine numbers (every meter value is derived from the round's integer hundredths), so
 * turbo, reduced motion or a skipped animation can change timing but never a displayed total.
 *
 * Time unit: milliseconds from the round start. Grid coordinates: col 0..5, row 0..4 (row 0 top).
 */
import { CASCADE_COLS, CASCADE_MAX_WIN_MULTIPLIER, CASCADE_ROWS, type CascadeCell, type CascadeGrid, type CascadePaySymbol, type CascadeRound, type CascadeSymbol } from '@sollish/protocol';

export const CASCADE_TURBO_FACTOR = 0.35;
/** Holds (intro card, big-win, max-win) never shrink below this in turbo so the text stays readable. */
export const CASCADE_TURBO_MIN_HOLD = 1500;
/** Round-total thresholds in hundredths of the stake: 20x, 50x, 100x. */
export const CASCADE_BIG_WIN_THRESHOLDS = [2000, 5000, 10_000] as const;
export type BigWinTier = 0 | 1 | 2 | 3;

export type TimelineOptions = { turbo?: boolean; reducedMotion?: boolean };

/** A cell's place after an event; `fromRow` is where it starts visually (negative = above the board). */
export interface PlacedCell {
  id: number; symbol: CascadeSymbol; multiplier?: number;
  col: number; row: number; fromRow: number;
  /** Delay and duration of its entrance or fall, relative to the event start (0/0 = no motion). */
  delay: number; dur: number;
}
export interface TimelineWin {
  symbol: CascadePaySymbol; count: number; payHundredths: number; ids: number[];
  /** Mean cell position of the cluster, in cell units (col + 0.5, row + 0.5 = cell centre). */
  centroid: { x: number; y: number };
}
/** Hundredths of the stake: this spin's running win and the capped round total. */
export interface Meter { spin: number; total: number }

type At = { at: number; dur: number };
export type TimelineEvent =
  | At & { type: 'spin-start'; spin: number; kind: 'base' | 'free'; freeSpinNumber: number; freeSpinsLeft: number; meter: Meter }
  | At & { type: 'clear'; spin: number; ids: number[] | null }
  | At & { type: 'drop'; spin: number; cells: PlacedCell[] }
  | At & { type: 'land'; spin: number; col: number; crystal: boolean }
  | At & { type: 'scatter-tease'; spin: number; ids: number[]; count: number }
  | At & { type: 'highlight'; spin: number; step: number; wins: TimelineWin[] }
  | At & { type: 'pop'; spin: number; step: number; wins: TimelineWin[]; stepHundredths: number; meter: Meter }
  | At & { type: 'tumble'; spin: number; step: number; cells: PlacedCell[]; removed: number[] }
  | At & { type: 'crystal-collect'; spin: number; crystals: Array<{ id: number; value: number; delay: number; fly: number }>; sum: number }
  | At & { type: 'crystal-arrive'; spin: number; id: number; value: number; parts: number[] }
  | At & { type: 'multiply'; spin: number; sum: number; baseHundredths: number; meter: Meter }
  | At & { type: 'scatter-pay'; spin: number; count: number; hundredths: number; meter: Meter }
  | At & { type: 'scatter-trigger'; spin: number; ids: number[]; count: number; awarded: number; retrigger: boolean; freeSpinsLeft: number }
  | At & { type: 'free-intro'; spin: number; awarded: number; hold: true }
  | At & { type: 'free-mode'; on: boolean }
  | At & { type: 'spin-end'; spin: number; kind: 'base' | 'free'; winHundredths: number; meter: Meter }
  | At & { type: 'max-win'; hold: true }
  | At & { type: 'big-win'; tier: 1 | 2 | 3; totalHundredths: number; countUp: number; hold: true }
  | At & { type: 'end'; totalHundredths: number; payoutCents: number; capped: boolean };
export type TimelineEventType = TimelineEvent['type'];

export interface CascadeTimeline { events: TimelineEvent[]; duration: number; turbo: boolean; reducedMotion: boolean }

/** Base timings (ms). Reduced motion keeps every step but uses short fades/slides. */
const NORMAL = {
  spinStart: 120, freeSpinStart: 360, clear: 420, clearColStagger: 30, dropAfterClear: 250,
  dropColStagger: 62, dropRowStagger: 24, dropFallBase: 300, dropFallK: 72,
  tumbleColStagger: 34, tumbleFreshDelay: 60, tumbleFallBase: 250, tumbleFallK: 85,
  settle: 150, highlight: 450, pop: 360, popGap: 40,
  collectStagger: 240, collectFly: 560, collectSum: 300, multiply: 780, scatterPay: 760,
  scatterTrigger: 1500, retrigger: 1500, freeIntro: 2400,
  spinEndWin: 560, spinEndNone: 260, freeSpinEndWin: 480, freeSpinEndNone: 220,
  maxWin: 2600, bigWinCountUp: [2800, 3800, 4800] as readonly number[], bigWinHold: 1700,
};
const REDUCED: typeof NORMAL = {
  ...NORMAL,
  clear: 200, clearColStagger: 0, dropAfterClear: 160,
  dropColStagger: 0, dropRowStagger: 0, dropFallBase: 240, dropFallK: 0,
  tumbleColStagger: 0, tumbleFreshDelay: 0, tumbleFallBase: 240, tumbleFallK: 0,
  pop: 240, collectStagger: 120, collectFly: 320, multiply: 520, scatterTrigger: 900, retrigger: 1100,
  bigWinCountUp: [1200, 1400, 1600],
};

/** floor(stake x hundredths / 100): the engine's own payout rule, also used for every displayed amount. */
export function centsFor(stakeCents: number, hundredths: number): number {
  return Math.floor((stakeCents * hundredths) / 100);
}
export function bigWinTier(totalHundredths: number): BigWinTier {
  const [t1, t2, t3] = CASCADE_BIG_WIN_THRESHOLDS;
  return totalHundredths >= t3 ? 3 : totalHundredths >= t2 ? 2 : totalHundredths >= t1 ? 1 : 0;
}
/** Fixed two-decimal DEMO amount for meters and labels: 3510 -> "35,10". */
let twoDecimals: Intl.NumberFormat | null = null;
const fixed2 = () => (twoDecimals ??= new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export function moneyText(cents: number): string {
  return fixed2().format(cents / 100);
}
/** 1240 -> "12,40", 500000 -> "5.000,00" (Turkish grouping and decimal comma). */
export function multiplierText(hundredths: number): string {
  return fixed2().format(hundredths / 100);
}

function cellsOf(grid: CascadeGrid): Array<{ cell: CascadeCell; col: number; row: number }> {
  const out: Array<{ cell: CascadeCell; col: number; row: number }> = [];
  for (let col = 0; col < grid.length; col++) for (let row = 0; row < grid[col]!.length; row++) out.push({ cell: grid[col]![row]!, col, row });
  return out;
}
function place(cell: CascadeCell, col: number, row: number, fromRow: number, delay: number, dur: number): PlacedCell {
  const placed: PlacedCell = { id: cell.id, symbol: cell.symbol, col, row, fromRow, delay, dur };
  if (cell.multiplier !== undefined) placed.multiplier = cell.multiplier;
  return placed;
}
function starIds(grid: CascadeGrid): number[] {
  return cellsOf(grid).filter(({ cell }) => cell.symbol === 'star').map(({ cell }) => cell.id);
}

export function buildCascadeTimeline(round: CascadeRound, options: TimelineOptions = {}): CascadeTimeline {
  const turbo = !!options.turbo, reducedMotion = !!options.reducedMotion;
  const T = reducedMotion ? REDUCED : NORMAL;
  const k = turbo ? CASCADE_TURBO_FACTOR : 1;
  const d = (ms: number) => Math.round(ms * k);
  const hold = (ms: number) => (turbo ? Math.max(CASCADE_TURBO_MIN_HOLD, d(ms)) : ms);
  const fall = (base: number, perRow: number, rows: number) => (rows <= 0 ? 0 : d(base + perRow * Math.sqrt(rows)));
  const cap = CASCADE_MAX_WIN_MULTIPLIER * 100;
  const events: TimelineEvent[] = [];
  let t = 0, prevTotal = 0, freeNumber = 0, freeSpinsLeft = 0;
  let previousGridIds: number[] | null = null;
  const push = (event: TimelineEvent) => { events.push(event); };

  for (const spin of round.spins) {
    const s = spin.index;
    if (spin.kind === 'free') { freeNumber++; freeSpinsLeft--; }
    let running = 0;
    const meter = (): Meter => ({ spin: Math.min(running, cap - prevTotal), total: Math.min(cap, prevTotal + running) });
    const startDur = d(spin.kind === 'free' ? T.freeSpinStart : T.spinStart);
    push({ type: 'spin-start', at: t, dur: startDur, spin: s, kind: spin.kind, freeSpinNumber: freeNumber, freeSpinsLeft: Math.max(0, freeSpinsLeft), meter: meter() });
    t += startDur;

    // Old grid falls out, then the new one drops column by column (left to right).
    const clearDur = d(T.clear + T.clearColStagger * (CASCADE_COLS - 1));
    push({ type: 'clear', at: t, dur: clearDur, spin: s, ids: previousGridIds });
    t += Math.min(clearDur, d(T.dropAfterClear));
    const first = spin.steps[0]!.grid;
    const dropDist = CASCADE_ROWS + 0.4;
    const dropCells: PlacedCell[] = [];
    const landings: Array<{ col: number; at: number; crystal: boolean }> = [];
    for (let col = 0; col < CASCADE_COLS; col++) {
      let crystal = false, firstImpact = Infinity;
      for (let row = 0; row < CASCADE_ROWS; row++) {
        const cell = first[col]![row]!;
        const delay = d(T.dropColStagger * col + T.dropRowStagger * (CASCADE_ROWS - 1 - row));
        const dur = fall(T.dropFallBase, T.dropFallK, dropDist);
        dropCells.push(place(cell, col, row, row - dropDist, delay, dur));
        if (cell.symbol === 'crystal') crystal = true;
        firstImpact = Math.min(firstImpact, delay + Math.round(dur * 0.7));
      }
      landings.push({ col, at: firstImpact, crystal });
    }
    const dropDur = Math.max(...dropCells.map(c => c.delay + c.dur));
    push({ type: 'drop', at: t, dur: dropDur, spin: s, cells: dropCells });
    for (const landing of landings) push({ type: 'land', at: t + landing.at, dur: 0, spin: s, col: landing.col, crystal: landing.crystal });
    t += dropDur + d(T.settle);

    let lastTease = 0;
    const tease = (grid: CascadeGrid) => {
      const ids = starIds(grid);
      if (ids.length >= 3 && ids.length !== lastTease) { push({ type: 'scatter-tease', at: t, dur: 0, spin: s, ids, count: ids.length }); lastTease = ids.length; }
    };
    tease(first);

    for (let stepIndex = 0; stepIndex < spin.steps.length; stepIndex++) {
      const step = spin.steps[stepIndex]!;
      if (step.wins.length === 0) break;
      const position = new Map<number, { col: number; row: number }>();
      for (const { cell, col, row } of cellsOf(step.grid)) position.set(cell.id, { col, row });
      const wins: TimelineWin[] = step.wins.map(win => {
        let x = 0, y = 0;
        for (const id of win.cells) { const p = position.get(id)!; x += p.col + 0.5; y += p.row + 0.5; }
        return { symbol: win.symbol, count: win.count, payHundredths: win.payHundredths, ids: [...win.cells], centroid: { x: x / win.cells.length, y: y / win.cells.length } };
      });
      const highlightDur = d(T.highlight);
      push({ type: 'highlight', at: t, dur: highlightDur, spin: s, step: stepIndex, wins });
      t += highlightDur;
      running += step.stepHundredths;
      const popDur = d(T.pop);
      push({ type: 'pop', at: t, dur: popDur, spin: s, step: stepIndex, wins, stepHundredths: step.stepHundredths, meter: meter() });
      t += popDur + d(T.popGap);

      // Survivors fall into the gaps; fresh cells enter from above the board.
      const next = spin.steps[stepIndex + 1]!.grid;
      const removed = new Set<number>(wins.flatMap(win => win.ids));
      const moved: PlacedCell[] = [];
      const tumbleLandings: Array<{ col: number; at: number; crystal: boolean }> = [];
      for (let col = 0; col < CASCADE_COLS; col++) {
        const column = next[col]!;
        const fresh = column.filter(cell => !position.has(cell.id)).length;
        let crystal = false, impact = -1;
        for (let row = 0; row < CASCADE_ROWS; row++) {
          const cell = column[row]!;
          const old = position.get(cell.id);
          const isFresh = !old;
          const fromRow = isFresh ? row - fresh - 0.3 : old.row;
          const rows = row - fromRow;
          const delay = rows > 0 ? d(T.tumbleColStagger * col + (isFresh ? T.tumbleFreshDelay : 0)) : 0;
          const dur = fall(T.tumbleFallBase, T.tumbleFallK, rows);
          moved.push(place(cell, col, row, fromRow, delay, dur));
          if (dur > 0) { impact = Math.max(impact, delay + Math.round(dur * 0.7)); if (cell.symbol === 'crystal' && isFresh) crystal = true; }
        }
        if (impact >= 0) tumbleLandings.push({ col, at: impact, crystal });
      }
      const tumbleDur = Math.max(0, ...moved.map(c => c.delay + c.dur));
      push({ type: 'tumble', at: t, dur: tumbleDur, spin: s, step: stepIndex + 1, cells: moved, removed: [...removed] });
      for (const landing of tumbleLandings) push({ type: 'land', at: t + landing.at, dur: 0, spin: s, col: landing.col, crystal: landing.crystal });
      t += tumbleDur + d(T.settle);
      tease(next);
    }

    const finalGrid = spin.steps[spin.steps.length - 1]!.grid;
    if (spin.multiplierSum > 0 && spin.tumbleHundredths > 0) {
      const crystals = cellsOf(finalGrid).filter(({ cell }) => cell.symbol === 'crystal')
        .map(({ cell }, i) => ({ id: cell.id, value: cell.multiplier ?? 0, delay: d(T.collectStagger * i), fly: d(T.collectFly) }));
      const collectDur = Math.max(...crystals.map(c => c.delay + c.fly)) + d(T.collectSum);
      push({ type: 'crystal-collect', at: t, dur: collectDur, spin: s, crystals, sum: spin.multiplierSum });
      const parts: number[] = [];
      for (const crystal of crystals) {
        parts.push(crystal.value);
        push({ type: 'crystal-arrive', at: t + crystal.delay + crystal.fly, dur: 0, spin: s, id: crystal.id, value: crystal.value, parts: [...parts] });
      }
      t += collectDur;
      running = spin.tumbleHundredths * spin.multiplierSum;
      const multiplyDur = d(T.multiply);
      push({ type: 'multiply', at: t, dur: multiplyDur, spin: s, sum: spin.multiplierSum, baseHundredths: spin.tumbleHundredths, meter: meter() });
      t += multiplyDur;
    }
    if (spin.scatterHundredths > 0) {
      running += spin.scatterHundredths;
      const payDur = d(T.scatterPay);
      push({ type: 'scatter-pay', at: t, dur: payDur, spin: s, count: spin.scatterCount, hundredths: spin.scatterHundredths, meter: meter() });
      t += payDur;
    }
    if (spin.freeSpinsAwarded > 0) {
      const retrigger = spin.kind === 'free';
      freeSpinsLeft = spin.freeSpinsLeft;
      const triggerDur = d(retrigger ? T.retrigger : T.scatterTrigger);
      push({ type: 'scatter-trigger', at: t, dur: triggerDur, spin: s, ids: starIds(finalGrid), count: spin.scatterCount, awarded: spin.freeSpinsAwarded, retrigger, freeSpinsLeft: spin.freeSpinsLeft });
      t += triggerDur;
      if (!retrigger) {
        const introDur = hold(T.freeIntro);
        push({ type: 'free-intro', at: t, dur: introDur, spin: s, awarded: spin.freeSpinsAwarded, hold: true });
        t += introDur;
        push({ type: 'free-mode', at: t, dur: 0, on: true });
      }
    }
    freeSpinsLeft = spin.freeSpinsLeft;
    const spinWin = spin.totalHundredthsAfter - prevTotal;
    const endDur = d(spin.kind === 'free' ? (spinWin > 0 ? T.freeSpinEndWin : T.freeSpinEndNone) : (spinWin > 0 ? T.spinEndWin : T.spinEndNone));
    push({ type: 'spin-end', at: t, dur: endDur, spin: s, kind: spin.kind, winHundredths: spinWin, meter: { spin: spinWin, total: spin.totalHundredthsAfter } });
    t += endDur;
    prevTotal = spin.totalHundredthsAfter;
    previousGridIds = cellsOf(finalGrid).map(({ cell }) => cell.id);
  }

  if (round.capped) {
    const capDur = hold(T.maxWin);
    push({ type: 'max-win', at: t, dur: capDur, hold: true });
    t += capDur;
  }
  const tier = bigWinTier(round.totalHundredths);
  if (tier !== 0) {
    const countUp = turbo ? Math.max(CASCADE_TURBO_MIN_HOLD, d(T.bigWinCountUp[tier - 1]!)) : T.bigWinCountUp[tier - 1]!;
    const total = countUp + hold(T.bigWinHold);
    push({ type: 'big-win', at: t, dur: total, tier, totalHundredths: round.totalHundredths, countUp, hold: true });
    t += total;
  }
  push({ type: 'end', at: t, dur: 0, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents, capped: round.capped });
  events.sort((a, b) => a.at - b.at); // stable: equal times keep insertion order
  return { events, duration: t, turbo, reducedMotion };
}

/** The board, meters and mode at the very end of the round, for "Atla" and for unmount. */
export function finalState(round: CascadeRound): { cells: PlacedCell[]; meter: Meter; free: boolean; freeSpinsPlayed: number } {
  const spin = round.spins[round.spins.length - 1]!;
  const grid = spin.steps[spin.steps.length - 1]!.grid;
  const prev = round.spins.length > 1 ? round.spins[round.spins.length - 2]!.totalHundredthsAfter : 0;
  return {
    cells: cellsOf(grid).map(({ cell, col, row }) => place(cell, col, row, row, 0, 0)),
    meter: { spin: spin.totalHundredthsAfter - prev, total: round.totalHundredths },
    free: round.freeSpinsTriggered, freeSpinsPlayed: round.spins.length - 1,
  };
}

/** History row text: "3 düşme · 12,40×", "Bedava dönüş ×12 · 183,50×", "Kazanç yok". */
export function cascadeHistoryDetail(round: CascadeRound): string {
  const total = `${multiplierText(round.totalHundredths)}×`;
  if (round.capped) return `Azami kazanç · ${total}`;
  if (round.freeSpinsTriggered) return `Bedava dönüş ×${round.spins.length - 1} · ${total}`;
  if (round.totalHundredths === 0) return 'Kazanç yok';
  const tumbles = round.spins[0]!.steps.filter(step => step.wins.length > 0).length;
  return `${tumbles} düşme · ${total}`;
}

/** Screen-reader line for one cluster: "8 çilek, 2,02× kazanç". */
export function winAnnouncement(win: Pick<TimelineWin, 'symbol' | 'count' | 'payHundredths'>, labels: Record<string, string>): string {
  return `${win.count} ${(labels[win.symbol] ?? win.symbol).toLocaleLowerCase('tr-TR')}, ${multiplierText(win.payHundredths)}× kazanç`;
}
