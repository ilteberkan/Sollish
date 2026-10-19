/**
 * Tarhun: Fırtına Tahtı presentation timeline. Pure: converts an already-resolved `StormRound` (engine
 * `storm-throne-1`) into an ordered list of timed visual events. It never reads a clock, the DOM or randomness
 * and only re-states engine numbers (every meter, multiplier and total is derived from the round's integers), so
 * the speed setting, reduced motion or a tapped screen can change timing but never a displayed total.
 *
 * Time unit: ms from the round start. Grid coordinates: col 0..5, row 0..4 (row 0 on top).
 *
 * Orb rule as shown (engine authoritative, docs/product/storm-throne-spec.md):
 *   base spin  – when the tumble chain ends with a win, the god strikes every orb on the final grid; each orb flies
 *                to the multiplier meter (running sum), then the spin's tumble win is multiplied by the sum.
 *   free spin  – the TOTAL multiplier persists for the feature. A winning spin's orbs are struck one by one and
 *                ADDED to the total (the meter climbs orb by orb), then the spin's tumble win is multiplied by the
 *                new total. A winning spin without orbs still uses the current total. A spin without a win leaves
 *                its orbs unused ("fizzle") and the total unchanged.
 */
import {
  STORM_COLS, STORM_MAX_WIN_MULTIPLIER, STORM_ROWS, type StormGrid, type StormPaySymbol, type StormRound, type StormSymbol,
} from '@sollish/protocol';
import { stormMultiplierRank, stormMultiplierClass } from './slot-audio/storm-tiers';
import { countUpSchedule, roundCelebration, type CelebrationLevel, type CountUpSchedule } from './slot-kit/win-tiers';

export type StormSpeed = 'normal' | 'quick' | 'turbo';
export const STORM_SPEED_FACTOR: Readonly<Record<StormSpeed, number>> = Object.freeze({ normal: 1, quick: 0.6, turbo: 0.35 });
/** Holds (free-spin intro, total screen) never shrink below this in turbo so the text stays readable. */
export const STORM_TURBO_MIN_HOLD = 1500;
/** "Giriş ekranlarını atla": the free-spin intro and total screens still show, this long at most. */
export const STORM_SKIP_SCREEN_HOLD = 900;
/** Below this wind-up (ms) the character skips the charge pose and the bolt is thrown at the hit itself. */
export const STORM_FULL_WINDUP_MS = 300;

export interface StormTimelineOptions { speed?: StormSpeed; reducedMotion?: boolean; skipScreens?: boolean }

/** Multiplier callout class 0..6: <10, ≥10, ≥25, ≥50, ≥100, ≥250, ≥500 (owner rule: ≥10× gets its own big text). */
export type StormCalloutTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export function stormCalloutTier(multiplier: number): StormCalloutTier {
  return stormMultiplierRank(stormMultiplierClass(multiplier)) as StormCalloutTier;
}

/** A cell's place after an event; `fromRow` is where it starts visually (negative = above the board). */
export interface StormPlacedCell {
  id: number; symbol: StormSymbol; multiplier?: number;
  col: number; row: number; fromRow: number;
  /** Delay and duration of its entrance or fall, relative to the event start (0/0 = no motion). */
  delay: number; dur: number;
}
export interface StormTimelineWin {
  symbol: StormPaySymbol; count: number; payHundredths: number; ids: number[];
  /** Mean cell position of the cluster in cell units (col + 0.5, row + 0.5 = cell centre). */
  centroid: { x: number; y: number };
}
/**
 * Hundredths of the bet: this spin's running win and the capped, CUMULATIVE round total (never decreases inside
 * a round; ends exactly on the engine total).
 */
export interface StormMeter { spin: number; total: number }
export type StormHeroPose = 'idle' | 'charge' | 'laugh' | 'triumph' | 'calm';

type At = { at: number; dur: number };
export type StormEvent =
  | At & { type: 'spin-start'; spin: number; kind: 'base' | 'free'; freeSpinNumber: number; freeSpinsLeft: number; totalMultiplier: number; meter: StormMeter }
  | At & { type: 'clear'; spin: number; ids: number[] | null }
  | At & { type: 'drop'; spin: number; cells: StormPlacedCell[] }
  /** A column's stones hit the floor (stone thud). */
  | At & { type: 'land'; spin: number; col: number }
  /** An orb lands (electric crackle). */
  | At & { type: 'orb-land'; spin: number; id: number; value: number; col: number }
  /** `count` = scatters on the grid now (scatterLand(n) per new scatter). */
  | At & { type: 'scatter-land'; spin: number; ids: number[]; count: number }
  | At & { type: 'scatter-tease'; spin: number; ids: number[]; count: number }
  | At & { type: 'highlight'; spin: number; step: number; wins: StormTimelineWin[]; stepHundredths: number }
  /** Winning symbols shatter into stone shards and sparks; the meter adds the step win. */
  | At & { type: 'shatter'; spin: number; step: number; wins: StormTimelineWin[]; stepHundredths: number; meter: StormMeter }
  | At & { type: 'tumble'; spin: number; step: number; cells: StormPlacedCell[]; removed: number[] }
  | At & { type: 'hero'; pose: StormHeroPose }
  /** The god charges: orbs about to be struck glow. */
  | At & { type: 'orb-charge'; spin: number; ids: number[]; kind: 'base' | 'free' }
  /** Wind-up toward one orb (character strike pose); `dur` = the wind-up until 'orb-hit'. */
  | At & { type: 'orb-strike'; spin: number; id: number; value: number; index: number; col: number; row: number }
  /** Lightning reaches the orb; it lifts off toward the multiplier meter (`dur` = flight). */
  | At & { type: 'orb-hit'; spin: number; id: number; value: number; index: number; col: number; row: number }
  /** The orb merges into the meter. Base: `multiplier` = running orb sum. Free: running TOTAL multiplier. */
  | At & { type: 'orb-arrive'; spin: number; id: number; value: number; index: number; parts: number[]; multiplier: number; kind: 'base' | 'free' }
  /** Orbs without a win this spin: they dim and stay unused. */
  | At & { type: 'orb-fizzle'; spin: number; ids: number[] }
  /** The spin win is multiplied: base by the orb sum, free by the total multiplier. */
  | At & { type: 'multiply'; spin: number; kind: 'base' | 'free'; multiplier: number; baseHundredths: number; calloutTier: StormCalloutTier; meter: StormMeter }
  | At & { type: 'scatter-pay'; spin: number; count: number; hundredths: number; meter: StormMeter }
  | At & { type: 'scatter-trigger'; spin: number; ids: number[]; count: number; awarded: number; retrigger: boolean; freeSpinsLeft: number }
  | At & { type: 'free-intro'; spin: number; awarded: number; hold: true }
  | At & { type: 'free-mode'; on: boolean; freeSpinsLeft: number }
  | At & { type: 'spin-end'; spin: number; kind: 'base' | 'free'; winHundredths: number; totalMultiplier: number; meter: StormMeter }
  /** "Fırtına Dindi — Toplam": always ends a free-spin round. `totalMultiplier` = final total multiplier, `strikes` = orbs struck. */
  | At & { type: 'free-outro'; spins: number; totalHundredths: number; totalMultiplier: number; strikes: number; celebration: boolean; capped: boolean; hold: true }
  /** Short total-win flourish on the meter for a winning round below 10× without free spins. */
  | At & { type: 'total-win'; totalHundredths: number }
  | At & { type: 'big-win'; tier: CelebrationLevel; totalHundredths: number; capped: boolean; countUp: number; schedule: CountUpSchedule; hold: true }
  | At & { type: 'end'; totalHundredths: number; payoutCents: number; capped: boolean };
export type StormEventType = StormEvent['type'];

export interface StormTimeline { events: StormEvent[]; duration: number; speed: StormSpeed; skipScreens: boolean; reducedMotion: boolean }

/** Base timings (ms). Reduced motion keeps every step but uses short fades/slides. */
const NORMAL = {
  spinStart: 120, freeSpinStart: 380, clear: 400, clearColStagger: 30, dropAfterClear: 240,
  dropColStagger: 70, dropRowStagger: 26, dropFallBase: 300, dropFallK: 74,
  tumbleColStagger: 34, tumbleFreshDelay: 60, tumbleFallBase: 250, tumbleFallK: 85,
  settle: 150, highlight: 500, shatter: 420, shatterGap: 40,
  charge: 560, windup: 360, strikeGap: 260, orbFly: 560, afterOrbs: 200,
  fizzle: 420, scatterPay: 760,
  /** Multiply + callout time by callout tier (<10, ≥10, ≥25, ≥50, ≥100, ≥250, ≥500). */
  multiply: [800, 1150, 1350, 1550, 1800, 2000, 2200] as readonly number[],
  scatterTrigger: 1600, retrigger: 1600, freeIntro: 2600, freeOutro: 3000, totalWin: 900,
  spinEndWin: 560, spinEndNone: 260, freeSpinEndWin: 660, freeSpinEndNone: 240,
};
const REDUCED: typeof NORMAL = {
  ...NORMAL,
  clear: 200, clearColStagger: 0, dropAfterClear: 160,
  dropColStagger: 0, dropRowStagger: 0, dropFallBase: 240, dropFallK: 0,
  tumbleColStagger: 0, tumbleFreshDelay: 0, tumbleFallBase: 240, tumbleFallK: 0,
  shatter: 260, charge: 240, windup: 120, strikeGap: 140, orbFly: 320,
  multiply: [560, 720, 820, 920, 1020, 1100, 1200], scatterTrigger: 900, retrigger: 1100,
};

/** floor(bet × hundredths / 100): the engine's payout rule, used for every displayed amount. */
export function stormCents(betCents: number, hundredths: number): number {
  return Math.floor((betCents * hundredths) / 100);
}

function cellsOf(grid: StormGrid) {
  const out: Array<{ cell: StormGrid[number][number]; col: number; row: number }> = [];
  for (let col = 0; col < grid.length; col++) for (let row = 0; row < grid[col]!.length; row++) out.push({ cell: grid[col]![row]!, col, row });
  return out;
}
function place(cell: StormGrid[number][number], col: number, row: number, fromRow: number, delay: number, dur: number): StormPlacedCell {
  const placed: StormPlacedCell = { id: cell.id, symbol: cell.symbol, col, row, fromRow, delay, dur };
  if (cell.multiplier !== undefined) placed.multiplier = cell.multiplier;
  return placed;
}
const idsOf = (grid: StormGrid, symbol: StormSymbol) => cellsOf(grid).filter(({ cell }) => cell.symbol === symbol).map(({ cell }) => cell.id);

export function buildStormTimeline(round: StormRound, options: StormTimelineOptions = {}): StormTimeline {
  const speed: StormSpeed = options.speed ?? 'normal';
  const turbo = speed === 'turbo', reducedMotion = !!options.reducedMotion, skipScreens = !!options.skipScreens;
  const T = reducedMotion ? REDUCED : NORMAL;
  const k = STORM_SPEED_FACTOR[speed];
  const d = (ms: number) => Math.round(ms * k);
  const hold = (ms: number) => (turbo ? Math.max(STORM_TURBO_MIN_HOLD, d(ms)) : ms);
  const screen = (ms: number) => (skipScreens ? Math.min(STORM_SKIP_SCREEN_HOLD, hold(ms)) : hold(ms));
  const fall = (base: number, perRow: number, rows: number) => (rows <= 0 ? 0 : d(base + perRow * Math.sqrt(rows)));
  const cap = STORM_MAX_WIN_MULTIPLIER * 100;
  const events: StormEvent[] = [];
  const push = (event: StormEvent) => { events.push(event); };
  let t = 0, prevTotal = 0, freeNumber = 0, freeSpinsLeft = 0, totalMultiplier = 0, strikes = 0;
  let previousGridIds: number[] | null = null;

  for (const spin of round.spins) {
    const s = spin.index;
    if (spin.kind === 'free') { freeNumber++; freeSpinsLeft--; }
    let running = 0;
    const meter = (): StormMeter => ({ spin: Math.min(running, cap - prevTotal), total: Math.min(cap, prevTotal + running) });
    const startDur = d(spin.kind === 'free' ? T.freeSpinStart : T.spinStart);
    push({ type: 'spin-start', at: t, dur: startDur, spin: s, kind: spin.kind, freeSpinNumber: freeNumber, freeSpinsLeft: Math.max(0, freeSpinsLeft), totalMultiplier: spin.totalMultiplierBefore, meter: meter() });
    push({ type: 'hero', at: t, dur: 0, pose: 'idle' });
    t += startDur;

    // The previous grid crumbles away, then the new stones drop column by column (left to right).
    const clearDur = d(T.clear + T.clearColStagger * (STORM_COLS - 1));
    push({ type: 'clear', at: t, dur: clearDur, spin: s, ids: previousGridIds });
    t += Math.min(clearDur, d(T.dropAfterClear));
    const first = spin.steps[0]!.grid;
    const dropDist = STORM_ROWS + 0.4;
    const dropCells: StormPlacedCell[] = [];
    const impacts: Array<{ at: number; event: StormEvent }> = [];
    let scatterSeen = 0;
    for (let col = 0; col < STORM_COLS; col++) {
      let firstImpact = Infinity;
      for (let row = STORM_ROWS - 1; row >= 0; row--) {
        const cell = first[col]![row]!;
        const delay = d(T.dropColStagger * col + T.dropRowStagger * (STORM_ROWS - 1 - row));
        const dur = fall(T.dropFallBase, T.dropFallK, dropDist);
        dropCells.push(place(cell, col, row, row - dropDist, delay, dur));
        const impact = delay + Math.round(dur * 0.7);
        firstImpact = Math.min(firstImpact, impact);
        if (cell.symbol === 'orb') impacts.push({ at: impact, event: { type: 'orb-land', at: 0, dur: 0, spin: s, id: cell.id, value: cell.multiplier ?? 0, col } });
      }
      impacts.push({ at: firstImpact, event: { type: 'land', at: 0, dur: 0, spin: s, col } });
      const scatterIds = first[col]!.filter(c => c.symbol === 'scatter').map(c => c.id);
      if (scatterIds.length) {
        scatterSeen += scatterIds.length;
        impacts.push({ at: firstImpact + 1, event: { type: 'scatter-land', at: 0, dur: 0, spin: s, ids: scatterIds, count: scatterSeen } });
      }
    }
    dropCells.sort((a, b) => a.col - b.col || a.row - b.row);
    const dropDur = Math.max(...dropCells.map(c => c.delay + c.dur));
    push({ type: 'drop', at: t, dur: dropDur, spin: s, cells: dropCells });
    for (const impact of impacts) push({ ...impact.event, at: t + impact.at } as StormEvent);
    t += dropDur + d(T.settle);

    // Scatter tease: 3 on a base grid (4 trigger), 2 on a free grid (3 retrigger).
    const teaseAt = spin.kind === 'base' ? 3 : 2;
    let lastTease = 0;
    const tease = (grid: StormGrid) => {
      const ids = idsOf(grid, 'scatter');
      if (ids.length >= teaseAt && ids.length !== lastTease && ids.length < teaseAt + 1) { push({ type: 'scatter-tease', at: t, dur: 0, spin: s, ids, count: ids.length }); lastTease = ids.length; }
    };
    tease(first);

    let laughed = false;
    for (let stepIndex = 0; stepIndex < spin.steps.length; stepIndex++) {
      const step = spin.steps[stepIndex]!;
      if (step.wins.length === 0) break;
      const position = new Map<number, { col: number; row: number }>();
      for (const { cell, col, row } of cellsOf(step.grid)) position.set(cell.id, { col, row });
      const wins: StormTimelineWin[] = step.wins.map(win => {
        let x = 0, y = 0;
        for (const id of win.cells) { const p = position.get(id)!; x += p.col + 0.5; y += p.row + 0.5; }
        return { symbol: win.symbol, count: win.count, payHundredths: win.payHundredths, ids: [...win.cells], centroid: { x: x / win.cells.length, y: y / win.cells.length } };
      });
      const highlightDur = d(T.highlight);
      push({ type: 'highlight', at: t, dur: highlightDur, spin: s, step: stepIndex, wins, stepHundredths: step.stepHundredths });
      t += highlightDur;
      running += step.stepHundredths;
      const shatterDur = d(T.shatter);
      push({ type: 'shatter', at: t, dur: shatterDur, spin: s, step: stepIndex, wins, stepHundredths: step.stepHundredths, meter: meter() });
      // A long chain (third tumble) or a heavy step makes the god laugh, once per spin.
      if (!laughed && (stepIndex >= 2 || step.stepHundredths >= 1000)) { laughed = true; push({ type: 'hero', at: t, dur: 0, pose: 'laugh' }); }
      t += shatterDur + d(T.shatterGap);

      // Survivors (orbs and scatters included) fall into the gaps; fresh stones enter from above.
      const next = spin.steps[stepIndex + 1]!.grid;
      const removed = new Set<number>(wins.flatMap(win => win.ids));
      const moved: StormPlacedCell[] = [];
      const tumbleImpacts: Array<{ at: number; event: StormEvent }> = [];
      let scatters = idsOf(step.grid, 'scatter').length;
      for (let col = 0; col < STORM_COLS; col++) {
        const column = next[col]!;
        const fresh = column.filter(cell => !position.has(cell.id)).length;
        let impact = -1;
        const freshScatters: number[] = [];
        for (let row = 0; row < STORM_ROWS; row++) {
          const cell = column[row]!;
          const old = position.get(cell.id);
          const isFresh = !old;
          const fromRow = isFresh ? row - fresh - 0.3 : old.row;
          const rows = row - fromRow;
          const delay = rows > 0 ? d(T.tumbleColStagger * col + (isFresh ? T.tumbleFreshDelay : 0)) : 0;
          const dur = fall(T.tumbleFallBase, T.tumbleFallK, rows);
          moved.push(place(cell, col, row, fromRow, delay, dur));
          if (dur > 0) {
            const at = delay + Math.round(dur * 0.7);
            impact = Math.max(impact, at);
            if (isFresh && cell.symbol === 'orb') tumbleImpacts.push({ at, event: { type: 'orb-land', at: 0, dur: 0, spin: s, id: cell.id, value: cell.multiplier ?? 0, col } });
          }
          if (isFresh && cell.symbol === 'scatter') freshScatters.push(cell.id);
        }
        if (impact >= 0) tumbleImpacts.push({ at: impact, event: { type: 'land', at: 0, dur: 0, spin: s, col } });
        if (freshScatters.length) {
          scatters += freshScatters.length;
          tumbleImpacts.push({ at: Math.max(0, impact) + 1, event: { type: 'scatter-land', at: 0, dur: 0, spin: s, ids: freshScatters, count: scatters } });
        }
      }
      const tumbleDur = Math.max(0, ...moved.map(c => c.delay + c.dur));
      push({ type: 'tumble', at: t, dur: tumbleDur, spin: s, step: stepIndex + 1, cells: moved, removed: [...removed] });
      for (const impact of tumbleImpacts) push({ ...impact.event, at: t + impact.at } as StormEvent);
      t += tumbleDur + d(T.settle);
      tease(next);
    }

    // Orbs on the final grid.
    const finalGrid = spin.steps[spin.steps.length - 1]!.grid;
    const orbs = cellsOf(finalGrid).filter(({ cell }) => cell.symbol === 'orb');
    const won = spin.tumbleHundredths > 0;
    if (orbs.length && won) {
      const chargeDur = d(T.charge);
      push({ type: 'hero', at: t, dur: 0, pose: 'charge' });
      push({ type: 'orb-charge', at: t, dur: chargeDur, spin: s, ids: orbs.map(o => o.cell.id), kind: spin.kind });
      t += chargeDur;
      const windup = d(T.windup), gap = d(T.strikeGap), fly = d(T.orbFly);
      let multiplier = spin.kind === 'free' ? spin.totalMultiplierBefore : 0;
      const parts: number[] = [];
      let lastArrive = t;
      orbs.forEach(({ cell, col, row }, index) => {
        const value = cell.multiplier ?? 0;
        push({ type: 'orb-strike', at: t, dur: windup, spin: s, id: cell.id, value, index, col, row });
        push({ type: 'orb-hit', at: t + windup, dur: fly, spin: s, id: cell.id, value, index, col, row });
        multiplier += value;
        parts.push(value);
        lastArrive = t + windup + fly;
        push({ type: 'orb-arrive', at: lastArrive, dur: 0, spin: s, id: cell.id, value, index, parts: [...parts], multiplier, kind: spin.kind });
        strikes++;
        t += windup + gap;
      });
      t = lastArrive + d(T.afterOrbs);
      push({ type: 'hero', at: t, dur: 0, pose: 'idle' });
    } else if (orbs.length) {
      const fizzleDur = d(T.fizzle);
      push({ type: 'orb-fizzle', at: t, dur: fizzleDur, spin: s, ids: orbs.map(o => o.cell.id) });
      t += fizzleDur;
    }
    totalMultiplier = spin.kind === 'free' ? spin.totalMultiplierAfter : totalMultiplier;
    if (won && spin.appliedMultiplier > 1) {
      running = spin.tumbleHundredths * spin.appliedMultiplier;
      const calloutTier = stormCalloutTier(spin.appliedMultiplier);
      const multiplyDur = d(T.multiply[calloutTier]!);
      push({ type: 'multiply', at: t, dur: multiplyDur, spin: s, kind: spin.kind, multiplier: spin.appliedMultiplier, baseHundredths: spin.tumbleHundredths, calloutTier, meter: meter() });
      if (calloutTier >= 2) push({ type: 'hero', at: t, dur: 0, pose: 'laugh' });
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
      push({ type: 'hero', at: t, dur: 0, pose: 'triumph' });
      push({ type: 'scatter-trigger', at: t, dur: triggerDur, spin: s, ids: idsOf(finalGrid, 'scatter'), count: spin.scatterCount, awarded: spin.freeSpinsAwarded, retrigger, freeSpinsLeft: spin.freeSpinsLeft });
      t += triggerDur;
      if (!retrigger) {
        const introDur = screen(T.freeIntro);
        push({ type: 'free-intro', at: t, dur: introDur, spin: s, awarded: spin.freeSpinsAwarded, hold: true });
        t += introDur;
        push({ type: 'free-mode', at: t, dur: 0, on: true, freeSpinsLeft: spin.freeSpinsLeft });
      }
    }
    freeSpinsLeft = spin.freeSpinsLeft;
    const spinWin = spin.totalHundredthsAfter - prevTotal;
    const endDur = d(spin.kind === 'free' ? (spinWin > 0 ? T.freeSpinEndWin : T.freeSpinEndNone) : (spinWin > 0 ? T.spinEndWin : T.spinEndNone));
    push({ type: 'spin-end', at: t, dur: endDur, spin: s, kind: spin.kind, winHundredths: spinWin, totalMultiplier, meter: { spin: spinWin, total: spin.totalHundredthsAfter } });
    if (spinWin === 0 && spin.freeSpinsAwarded === 0) push({ type: 'hero', at: t, dur: 0, pose: 'calm' });
    t += endDur;
    prevTotal = spin.totalHundredthsAfter;
    previousGridIds = cellsOf(finalGrid).map(({ cell }) => cell.id);
  }

  const celebration = roundCelebration(round.totalHundredths, round.capped);
  if (round.freeSpinsTriggered) {
    const outroDur = screen(T.freeOutro);
    push({ type: 'hero', at: t, dur: 0, pose: celebration === 'celebration' ? 'triumph' : 'idle' });
    push({ type: 'free-outro', at: t, dur: outroDur, spins: round.spins.length - 1, totalHundredths: round.totalHundredths, totalMultiplier, strikes, celebration: celebration === 'celebration', capped: round.capped, hold: true });
    t += outroDur;
  } else if (celebration === 'flourish') {
    const flourishDur = d(T.totalWin);
    push({ type: 'total-win', at: t, dur: flourishDur, totalHundredths: round.totalHundredths });
    t += flourishDur;
  }
  if (celebration === 'celebration') {
    const schedule = countUpSchedule(round.totalHundredths, round.capped, { speed, skipScreens, reducedMotion });
    const total = schedule.countUp + schedule.hold;
    push({ type: 'hero', at: t, dur: 0, pose: 'triumph' });
    push({ type: 'big-win', at: t, dur: total, tier: schedule.finalLevel, totalHundredths: round.totalHundredths, capped: round.capped, countUp: schedule.countUp, schedule, hold: true });
    t += total;
  }
  push({ type: 'hero', at: t, dur: 0, pose: 'idle' });
  push({ type: 'end', at: t, dur: 0, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents, capped: round.capped });
  events.sort((a, b) => a.at - b.at); // stable: equal times keep insertion order
  return { events, duration: t, speed, skipScreens, reducedMotion };
}

/** The board at the very end of the round. */
export function stormFinalCells(round: StormRound): StormPlacedCell[] {
  const spin = round.spins[round.spins.length - 1]!;
  return cellsOf(spin.steps[spin.steps.length - 1]!.grid).map(({ cell, col, row }) => place(cell, col, row, row, 0, 0));
}

/** Fixed two-decimal amount: 3510 -> "35,10". */
let twoDecimals: Intl.NumberFormat | null = null;
const fixed2 = () => (twoDecimals ??= new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export function stormMoney(cents: number): string { return fixed2().format(cents / 100); }
/** Hundredths of the bet as a multiple: 1240 -> "12,40". */
export function stormTimes(hundredths: number): string { return fixed2().format(hundredths / 100); }

/** What a history row says about a round, without wording (the translated UI builds the text from this). */
export type StormHistoryParts =
  | { kind: 'capped'; totalHundredths: number }
  | { kind: 'free'; spins: number; totalMultiplier: number; totalHundredths: number }
  | { kind: 'none' }
  | { kind: 'tumbles'; tumbles: number; multiplier: number; totalHundredths: number };
export function stormHistoryParts(round: StormRound): StormHistoryParts {
  if (round.capped) return { kind: 'capped', totalHundredths: round.totalHundredths };
  const last = round.spins[round.spins.length - 1]!;
  if (round.freeSpinsTriggered) return { kind: 'free', spins: round.spins.length - 1, totalMultiplier: last.totalMultiplierAfter, totalHundredths: round.totalHundredths };
  if (round.totalHundredths === 0) return { kind: 'none' };
  const base = round.spins[0]!;
  const tumbles = base.steps.filter(step => step.wins.length > 0).length;
  return { kind: 'tumbles', tumbles, multiplier: base.appliedMultiplier > 1 && base.tumbleHundredths > 0 ? base.appliedMultiplier : 0, totalHundredths: round.totalHundredths };
}

/** History row text (Turkish, stored with the record): "3 düşme · ×12 · 24,00×", "Bedava dönüş ×15 · toplam ×37 · 183,50×", "Kazanç yok". */
export function stormHistoryDetail(round: StormRound): string {
  const parts = stormHistoryParts(round);
  switch (parts.kind) {
    case 'capped': return `Azami kazanç · ${stormTimes(parts.totalHundredths)}×`;
    case 'free': return `Bedava dönüş ×${parts.spins}${parts.totalMultiplier > 0 ? ` · toplam ×${parts.totalMultiplier}` : ''} · ${stormTimes(parts.totalHundredths)}×`;
    case 'none': return 'Kazanç yok';
    case 'tumbles': return `${parts.tumbles} düşme${parts.multiplier > 0 ? ` · ×${parts.multiplier}` : ''} · ${stormTimes(parts.totalHundredths)}×`;
  }
}

/** Screen-reader line for one cluster: "8 altın boğa ritonu, 9,60× kazanç". */
export function stormWinAnnouncement(win: Pick<StormTimelineWin, 'symbol' | 'count' | 'payHundredths'>, labels: Record<string, string>): string {
  return `${win.count} ${(labels[win.symbol] ?? win.symbol).toLocaleLowerCase('tr-TR')}, ${stormTimes(win.payHundredths)}× kazanç`;
}
