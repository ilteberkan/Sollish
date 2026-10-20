/**
 * Ebru: Mürekkep Bahçesi presentation timeline. Pure: converts an already-resolved `EbruRound` (engine `ebru-ink-1`)
 * into an ordered list of timed events. It never reads a clock, the DOM or randomness and only re-states engine
 * numbers (every meter, stain, shift and total comes from the round's integers), so the speed setting, reduced
 * motion or a tapped hold screen can change timing but never a displayed amount or a grid.
 *
 * Every visual and audio beat of the game binds to these timestamps: the game calls the water FX, the board and the
 * sound controller from the same event, so the comb's sweep sound, the water shear and the sliding symbol rows (and
 * the stain field under them) start and end together.
 *
 * Time unit: ms from the round start. Grid coordinates: col 0..6, row 0..6 (row 0 on top), grid[col][row].
 *
 * Engine step -> events (packages/protocol/src/ebru.ts):
 *   drop-in   -> clear (previous grid sinks), deal (ink drops land column by column), land per column, scatter-land
 *   bleed     -> bleed (the wild drop spreads ink), bleed-apply (neighbours take the colour, mid-way)
 *   clusters  -> highlight, stain-hit (free spins: stained clusters, ×N labels and the ≥10 callout)
 *   burst     -> dissolve (the clusters melt into the water; the cumulative meter adds the step win)
 *   stains    -> stains (new and doubled stain multipliers bloom in the burst cells)
 *   fall      -> fall (survivors drop, fresh drops enter from above), land, scatter-land
 *   comb      -> comb (rows slide by the engine shifts while the water shears) and comb-end (the shifted grid and
 *                stain field become the board state)
 *   spin end  -> scatter-pay, scatter-trigger, free-intro / free-mode, spin-end
 *   round end -> free-outro (always after free spins), total-win flourish (<10×) or big-win (≥10×, Azami when capped)
 */
import {
  EBRU_COLS, EBRU_MAX_WIN_MULTIPLIER, EBRU_ROWS, type EbruColour, type EbruGrid, type EbruRound, type EbruStains, type EbruSymbol,
} from '@sollish/protocol';
import { countUpSchedule, roundCelebration, type CelebrationLevel, type CountUpSchedule } from './slot-kit/win-tiers';
import { multiplierClass, multiplierRank } from './slot-audio/win-tiers';

export type EbruSpeed = 'normal' | 'quick' | 'turbo';
export const EBRU_SPEED_FACTOR: Readonly<Record<EbruSpeed, number>> = Object.freeze({ normal: 1, quick: 0.6, turbo: 0.35 });
/** Holds (free-spin intro, total screen) never shrink below this in turbo so the text stays readable. */
export const EBRU_TURBO_MIN_HOLD = 1500;
/** "Giriş ekranlarını atla": the free-spin intro and total screens still show, this long at most. */
export const EBRU_SKIP_SCREEN_HOLD = 900;
/** Shortest comb pass on screen (turbo): the sweep stays readable as a sweep. */
export const EBRU_MIN_COMB_MS = 560;

export interface EbruTimelineOptions { speed?: EbruSpeed; reducedMotion?: boolean; skipScreens?: boolean }

/** Multiplier callout class 0..5: <10, ≥10, ≥25, ≥50, ≥100, ≥250 (owner rule: ≥10× gets its own big text and sound). */
export type EbruCalloutTier = 0 | 1 | 2 | 3 | 4 | 5;
export function ebruCalloutTier(multiplier: number): EbruCalloutTier {
  return multiplierRank(multiplierClass(multiplier)) as EbruCalloutTier;
}

/** A cell's place after an event; `fromRow` is where it starts visually (negative = above the board). */
export interface EbruPlacedCell {
  id: number; symbol: EbruSymbol; col: number; row: number; fromRow: number;
  /** Delay and duration of its entrance or fall, relative to the event start (0/0 = no motion). */
  delay: number; dur: number;
}
export interface EbruTimelineCluster {
  colour: EbruColour; size: number; ids: number[]; cells: { id: number; col: number; row: number }[];
  payHundredths: number; stainSum: number; multiplier: number; winHundredths: number;
  /** Mean cell position in cell units (col + 0.5, row + 0.5 = cell centre). */
  centroid: { x: number; y: number };
}
/** Hundredths of the bet: this spin's running win and the capped, CUMULATIVE round total (never decreases). */
export interface EbruMeter { spin: number; total: number }

type At = { at: number; dur: number };
export type EbruEvent =
  | At & { type: 'spin-start'; spin: number; kind: 'base' | 'free'; freeSpinNumber: number; freeSpinsLeft: number; meter: EbruMeter }
  /** The previous grid sinks into the water (ids of the cells to remove; null = the idle board). */
  | At & { type: 'clear'; spin: number; ids: number[] | null }
  /** Ink drops land column by column (engine `drop-in`). `stains` = the persistent field in free spins. */
  | At & { type: 'deal'; spin: number; cells: EbruPlacedCell[]; stains: EbruStains | null }
  /** A column's drops touch the water (ripples, the plip of that column). */
  | At & { type: 'land'; spin: number; col: number; rows: number[] }
  /** `count` = combs on the grid now (scatterLand(n) per new comb). */
  | At & { type: 'scatter-land'; spin: number; ids: number[]; count: number }
  | At & { type: 'scatter-tease'; spin: number; ids: number[]; count: number }
  /** The wild drop spreads its ink (engine `bleed`). */
  | At & { type: 'bleed'; spin: number; id: number; col: number; row: number; colour: EbruColour; source: 'majority' | 'tie' | 'random'; targets: { id: number; col: number; row: number }[] }
  /** Mid-way through a bleed: the drop and its recoloured neighbours take the colour (board state = engine grid). */
  | At & { type: 'bleed-apply'; spin: number; id: number; colour: EbruColour; recoloured: { id: number; col: number; row: number; from: EbruColour; to: EbruColour }[] }
  | At & { type: 'highlight'; spin: number; step: number; clusters: EbruTimelineCluster[]; stepHundredths: number }
  /** Free spins: the stains under winning clusters light up; `best` = highest cluster factor (callout when ≥10). */
  | At & { type: 'stain-hit'; spin: number; step: number; clusters: EbruTimelineCluster[]; best: number; calloutTier: EbruCalloutTier }
  /** The clusters melt into the water; the meter adds the step win. */
  | At & { type: 'dissolve'; spin: number; step: number; clusters: EbruTimelineCluster[]; stepHundredths: number; meter: EbruMeter }
  /** New or doubled stain multipliers in the burst cells (free spins). */
  | At & { type: 'stains'; spin: number; changes: { col: number; row: number; from: number; to: number }[]; stains: EbruStains; maxValue: number }
  | At & { type: 'fall'; spin: number; cells: EbruPlacedCell[]; removed: number[] }
  /** One comb pass: row r slides by shifts[r] columns (cyclic) over `dur`, with the water and the stain field. */
  | At & { type: 'comb'; spin: number; pass: number; amplitude: number; phase: number; rowStep: number; shifts: number[]; createsWin: boolean }
  /** The comb has passed: the engine grid (and stain field) after the shifts is now the board state. */
  | At & { type: 'comb-end'; spin: number; pass: number; grid: EbruGrid; stains: EbruStains | null; createsWin: boolean }
  | At & { type: 'scatter-pay'; spin: number; count: number; hundredths: number; meter: EbruMeter }
  | At & { type: 'scatter-trigger'; spin: number; ids: number[]; count: number; awarded: number; retrigger: boolean; freeSpinsLeft: number }
  | At & { type: 'free-intro'; spin: number; awarded: number; hold: true }
  | At & { type: 'free-mode'; on: boolean; freeSpinsLeft: number }
  | At & { type: 'spin-end'; spin: number; kind: 'base' | 'free'; winHundredths: number; meter: EbruMeter; maxStain: number; stainedCells: number; combPasses: number }
  /** "Lale Ebrusu — Toplam": always ends a free-spin round. */
  | At & { type: 'free-outro'; spins: number; totalHundredths: number; maxStain: number; stainedClusters: number; combWins: number; celebration: boolean; capped: boolean; hold: true }
  /** Short total-win flourish on the meter for a winning round below 10× without free spins. */
  | At & { type: 'total-win'; totalHundredths: number }
  | At & { type: 'big-win'; tier: CelebrationLevel; totalHundredths: number; capped: boolean; countUp: number; schedule: CountUpSchedule; hold: true }
  | At & { type: 'end'; totalHundredths: number; payoutCents: number; capped: boolean };
export type EbruEventType = EbruEvent['type'];

export interface EbruTimeline { events: EbruEvent[]; duration: number; speed: EbruSpeed; skipScreens: boolean; reducedMotion: boolean }

/** Base timings (ms). Reduced motion keeps every step (the comb included) but uses short fades and slides. */
const NORMAL = {
  spinStart: 120, freeSpinStart: 420, clear: 420, dealAfterClear: 260,
  dealColStagger: 64, dealRowStagger: 22, dealFall: 420,
  fallColStagger: 32, fallFreshDelay: 60, fallBase: 250, fallK: 82,
  settle: 160, bleed: 860, bleedApply: 0.42, highlight: 540,
  /** stain-hit time by callout tier (<10, ≥10, ≥25, ≥50, ≥100, ≥250). */
  stainHit: [760, 1150, 1350, 1550, 1800, 2000] as readonly number[],
  dissolve: 640, dissolveGap: 40, stains: 460,
  comb: 1700, combSettle: 180,
  scatterPay: 760, scatterTrigger: 1600, retrigger: 1500, freeIntro: 2800, freeOutro: 3200, totalWin: 900,
  spinEndWin: 560, spinEndNone: 260, freeSpinEndWin: 640, freeSpinEndNone: 240,
};
const REDUCED: typeof NORMAL = {
  ...NORMAL,
  clear: 220, dealAfterClear: 160, dealColStagger: 0, dealRowStagger: 0, dealFall: 260,
  fallColStagger: 0, fallFreshDelay: 0, fallBase: 240, fallK: 0,
  bleed: 440, highlight: 420, stainHit: [520, 700, 800, 900, 1000, 1100], dissolve: 320, stains: 300, comb: 380, combSettle: 120,
  scatterTrigger: 900, retrigger: 1000,
};

/** floor(bet × hundredths / 100): the engine's payout rule, used for every displayed amount. */
export function ebruCents(betCents: number, hundredths: number): number {
  return Math.floor((betCents * hundredths) / 100);
}

const cellsOf = (grid: EbruGrid) => {
  const out: Array<{ id: number; symbol: EbruSymbol; col: number; row: number }> = [];
  for (let col = 0; col < grid.length; col++) for (let row = 0; row < grid[col]!.length; row++) out.push({ id: grid[col]![row]!.id, symbol: grid[col]![row]!.symbol, col, row });
  return out;
};
const combIds = (grid: EbruGrid) => cellsOf(grid).filter(c => c.symbol === 'comb').map(c => c.id);
const maxOf = (stains: EbruStains | null) => { let m = 0; if (stains) for (const column of stains) for (const v of column) if (v > m) m = v; return m; };

export function buildEbruTimeline(round: EbruRound, options: EbruTimelineOptions = {}): EbruTimeline {
  const speed: EbruSpeed = options.speed ?? 'normal';
  const turbo = speed === 'turbo', reducedMotion = !!options.reducedMotion, skipScreens = !!options.skipScreens;
  const T = reducedMotion ? REDUCED : NORMAL;
  const k = EBRU_SPEED_FACTOR[speed];
  const d = (ms: number) => Math.round(ms * k);
  const hold = (ms: number) => (turbo ? Math.max(EBRU_TURBO_MIN_HOLD, d(ms)) : ms);
  const screen = (ms: number) => (skipScreens ? Math.min(EBRU_SKIP_SCREEN_HOLD, hold(ms)) : hold(ms));
  const fallMs = (base: number, perRow: number, rows: number) => (rows <= 0 ? 0 : d(base + perRow * Math.sqrt(rows)));
  const combMs = reducedMotion ? T.comb : Math.max(EBRU_MIN_COMB_MS, d(T.comb));
  const cap = EBRU_MAX_WIN_MULTIPLIER * 100;
  const events: EbruEvent[] = [];
  const push = (event: EbruEvent) => { events.push(event); };
  let t = 0, prevTotal = 0, freeNumber = 0, freeSpinsLeft = 0;
  let maxStainRound = 0, stainedClusters = 0, combWinsFree = 0;
  let previousIds: number[] | null = null;

  for (const spin of round.spins) {
    const s = spin.index;
    if (spin.kind === 'free') { freeNumber++; freeSpinsLeft--; }
    let running = 0;
    const meter = (): EbruMeter => ({ spin: Math.min(running, cap - prevTotal), total: Math.min(cap, prevTotal + running) });
    const startDur = d(spin.kind === 'free' ? T.freeSpinStart : T.spinStart);
    push({ type: 'spin-start', at: t, dur: startDur, spin: s, kind: spin.kind, freeSpinNumber: freeNumber, freeSpinsLeft: Math.max(0, freeSpinsLeft), meter: meter() });
    t += startDur;

    // Scatter bookkeeping: combs only ever move (never burst), so the count on the grid only grows within a spin.
    const teaseAt = 2;
    let scatterSeen = 0, teased = false;
    const tease = (grid: EbruGrid) => {
      const ids = combIds(grid);
      if (!teased && ids.length >= teaseAt && ids.length < 3) { teased = true; push({ type: 'scatter-tease', at: t, dur: 0, spin: s, ids, count: ids.length }); }
    };
    const position = new Map<number, { col: number; row: number }>();
    const track = (grid: EbruGrid) => { position.clear(); for (const c of cellsOf(grid)) position.set(c.id, { col: c.col, row: c.row }); };

    let stepIndex = 0;
    for (let i = 0; i < spin.steps.length; i++) {
      const step = spin.steps[i]!;
      switch (step.type) {
        case 'drop-in': {
          const clearDur = d(T.clear);
          push({ type: 'clear', at: t, dur: clearDur, spin: s, ids: previousIds });
          t += Math.min(clearDur, d(T.dealAfterClear));
          const cells: EbruPlacedCell[] = [];
          const impacts: Array<{ at: number; event: EbruEvent }> = [];
          for (let col = 0; col < EBRU_COLS; col++) {
            let firstImpact = Infinity;
            const scatters: number[] = [];
            for (let row = EBRU_ROWS - 1; row >= 0; row--) {
              const cell = step.grid[col]![row]!;
              const delay = d(T.dealColStagger * col + T.dealRowStagger * (EBRU_ROWS - 1 - row));
              const dur = d(T.dealFall);
              cells.push({ id: cell.id, symbol: cell.symbol, col, row, fromRow: row - (EBRU_ROWS + 0.4), delay, dur });
              firstImpact = Math.min(firstImpact, delay + Math.round(dur * 0.72));
              if (cell.symbol === 'comb') scatters.push(cell.id);
            }
            impacts.push({ at: firstImpact, event: { type: 'land', at: 0, dur: 0, spin: s, col, rows: [0, 1, 2, 3, 4, 5, 6] } });
            if (scatters.length) {
              scatterSeen += scatters.length;
              impacts.push({ at: firstImpact + 1, event: { type: 'scatter-land', at: 0, dur: 0, spin: s, ids: scatters, count: scatterSeen } });
            }
          }
          cells.sort((a, b) => a.col - b.col || a.row - b.row);
          const dealDur = Math.max(...cells.map(c => c.delay + c.dur));
          push({ type: 'deal', at: t, dur: dealDur, spin: s, cells, stains: step.stains });
          for (const impact of impacts) push({ ...impact.event, at: t + impact.at } as EbruEvent);
          t += dealDur + d(T.settle);
          track(step.grid);
          tease(step.grid);
          break;
        }
        case 'bleed': {
          const dur = d(T.bleed);
          const targets = step.recoloured.map(r => ({ id: r.id, col: r.col, row: r.row }));
          push({ type: 'bleed', at: t, dur, spin: s, id: step.id, col: step.col, row: step.row, colour: step.colour, source: step.source, targets });
          push({ type: 'bleed-apply', at: t + Math.round(dur * T.bleedApply), dur: 0, spin: s, id: step.id, colour: step.colour, recoloured: step.recoloured });
          t += dur;
          track(step.grid);
          break;
        }
        case 'clusters': {
          const clusters: EbruTimelineCluster[] = step.clusters.map(cl => {
            let x = 0, y = 0;
            for (const c of cl.cells) { x += c.col + 0.5; y += c.row + 0.5; }
            return {
              colour: cl.colour, size: cl.size, ids: cl.cells.map(c => c.id), cells: cl.cells.map(c => ({ id: c.id, col: c.col, row: c.row })),
              payHundredths: cl.payHundredths, stainSum: cl.stainSum, multiplier: cl.multiplier, winHundredths: cl.winHundredths,
              centroid: { x: x / cl.cells.length, y: y / cl.cells.length },
            };
          });
          const highlightDur = d(T.highlight);
          push({ type: 'highlight', at: t, dur: highlightDur, spin: s, step: stepIndex, clusters, stepHundredths: step.stepHundredths });
          t += highlightDur;
          const stained = clusters.filter(c => c.stainSum > 0);
          if (stained.length) {
            stainedClusters += stained.length;
            const best = Math.max(...stained.map(c => c.multiplier));
            const calloutTier = ebruCalloutTier(best);
            const hitDur = d(T.stainHit[calloutTier]!);
            push({ type: 'stain-hit', at: t, dur: hitDur, spin: s, step: stepIndex, clusters: stained, best, calloutTier });
            t += hitDur;
          }
          running += step.stepHundredths;
          const dissolveDur = d(T.dissolve);
          push({ type: 'dissolve', at: t, dur: dissolveDur, spin: s, step: stepIndex, clusters, stepHundredths: step.stepHundredths, meter: meter() });
          t += dissolveDur + d(T.dissolveGap);
          stepIndex++;
          break;
        }
        case 'burst':
          // Shown by `dissolve` (the same cells); the board removes them when the fall starts.
          break;
        case 'stains': {
          const dur = d(T.stains);
          const maxValue = step.changes.reduce((m, c) => Math.max(m, c.to), 0);
          maxStainRound = Math.max(maxStainRound, maxOf(step.stains));
          push({ type: 'stains', at: t, dur, spin: s, changes: step.changes, stains: step.stains, maxValue });
          t += dur;
          break;
        }
        case 'fall': {
          const freshIds = new Set(step.fresh.map(f => f.id));
          const freshPerCol = new Array<number>(EBRU_COLS).fill(0);
          for (const f of step.fresh) freshPerCol[f.col]!++;
          const after = new Set(cellsOf(step.grid).map(c => c.id));
          const removed = [...position.keys()].filter(id => !after.has(id));
          const cells: EbruPlacedCell[] = [];
          const impacts: Array<{ at: number; event: EbruEvent }> = [];
          for (let col = 0; col < EBRU_COLS; col++) {
            let impact = -1;
            const landed: number[] = [];
            const scatters: number[] = [];
            for (let row = 0; row < EBRU_ROWS; row++) {
              const cell = step.grid[col]![row]!;
              const fresh = freshIds.has(cell.id);
              const old = position.get(cell.id);
              const fromRow = fresh || !old ? row - freshPerCol[col]! - 0.3 : old.row;
              const rows = row - fromRow;
              const delay = rows > 0 ? d(T.fallColStagger * col + (fresh ? T.fallFreshDelay : 0)) : 0;
              const dur = fallMs(T.fallBase, T.fallK, rows);
              cells.push({ id: cell.id, symbol: cell.symbol, col, row, fromRow, delay, dur });
              if (dur > 0) { impact = Math.max(impact, delay + Math.round(dur * 0.72)); landed.push(row); }
              if (fresh && cell.symbol === 'comb') scatters.push(cell.id);
            }
            if (impact >= 0) impacts.push({ at: impact, event: { type: 'land', at: 0, dur: 0, spin: s, col, rows: landed } });
            if (scatters.length) {
              scatterSeen += scatters.length;
              impacts.push({ at: Math.max(0, impact) + 1, event: { type: 'scatter-land', at: 0, dur: 0, spin: s, ids: scatters, count: scatterSeen } });
            }
          }
          const fallDur = Math.max(0, ...cells.map(c => c.delay + c.dur));
          push({ type: 'fall', at: t, dur: fallDur, spin: s, cells, removed });
          for (const impact of impacts) push({ ...impact.event, at: t + impact.at } as EbruEvent);
          t += fallDur + d(T.settle);
          track(step.grid);
          tease(step.grid);
          break;
        }
        case 'comb': {
          push({ type: 'comb', at: t, dur: combMs, spin: s, pass: step.pass, amplitude: step.amplitude, phase: step.phase, rowStep: step.rowStep, shifts: [...step.shifts], createsWin: step.createsWin });
          t += combMs;
          push({ type: 'comb-end', at: t, dur: 0, spin: s, pass: step.pass, grid: step.grid, stains: step.stains, createsWin: step.createsWin });
          if (step.createsWin && spin.kind === 'free') combWinsFree++;
          t += d(T.combSettle);
          track(step.grid);
          if (step.stains) maxStainRound = Math.max(maxStainRound, maxOf(step.stains));
          break;
        }
      }
    }

    // Final grid of the spin.
    let finalGrid: EbruGrid | null = null;
    for (let i = spin.steps.length - 1; i >= 0 && !finalGrid; i--) {
      const step = spin.steps[i]!;
      if (step.type === 'drop-in' || step.type === 'bleed' || step.type === 'fall' || step.type === 'comb') finalGrid = step.grid;
    }
    const lastGrid = finalGrid!;
    if (spin.scatterHundredths > 0) {
      running += spin.scatterHundredths;
      const payDur = d(T.scatterPay);
      push({ type: 'scatter-pay', at: t, dur: payDur, spin: s, count: spin.scatterCount, hundredths: spin.scatterHundredths, meter: meter() });
      t += payDur;
    }
    if (spin.freeSpinsAwarded > 0) {
      const retrigger = spin.kind === 'free';
      const triggerDur = d(retrigger ? T.retrigger : T.scatterTrigger);
      push({ type: 'scatter-trigger', at: t, dur: triggerDur, spin: s, ids: combIds(lastGrid), count: spin.scatterCount, awarded: spin.freeSpinsAwarded, retrigger, freeSpinsLeft: spin.freeSpinsLeft });
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
    push({ type: 'spin-end', at: t, dur: endDur, spin: s, kind: spin.kind, winHundredths: spinWin, meter: { spin: spinWin, total: spin.totalHundredthsAfter }, maxStain: spin.maxStain, stainedCells: spin.stainedCells, combPasses: spin.combPasses });
    t += endDur;
    prevTotal = spin.totalHundredthsAfter;
    previousIds = cellsOf(lastGrid).map(c => c.id);
  }

  const celebration = roundCelebration(round.totalHundredths, round.capped);
  if (round.freeSpinsTriggered) {
    const outroDur = screen(T.freeOutro);
    push({ type: 'free-outro', at: t, dur: outroDur, spins: round.spins.length - 1, totalHundredths: round.totalHundredths, maxStain: maxStainRound, stainedClusters, combWins: combWinsFree, celebration: celebration === 'celebration', capped: round.capped, hold: true });
    t += outroDur;
  } else if (celebration === 'flourish') {
    const flourishDur = d(T.totalWin);
    push({ type: 'total-win', at: t, dur: flourishDur, totalHundredths: round.totalHundredths });
    t += flourishDur;
  }
  if (celebration === 'celebration') {
    const schedule = countUpSchedule(round.totalHundredths, round.capped, { speed, skipScreens, reducedMotion });
    const total = schedule.countUp + schedule.hold;
    push({ type: 'big-win', at: t, dur: total, tier: schedule.finalLevel, totalHundredths: round.totalHundredths, capped: round.capped, countUp: schedule.countUp, schedule, hold: true });
    t += total;
  }
  push({ type: 'end', at: t, dur: 0, totalHundredths: round.totalHundredths, payoutCents: round.payoutCents, capped: round.capped });
  events.sort((a, b) => a.at - b.at); // stable: equal times keep insertion order
  return { events, duration: t, speed, skipScreens, reducedMotion };
}

/** The board at the very end of the round (grid [col][row]) and the stain field shown with it (null outside free spins). */
export function ebruFinalBoard(round: EbruRound): { grid: EbruGrid; stains: EbruStains | null } {
  const spin = round.spins[round.spins.length - 1]!;
  let grid: EbruGrid | null = null, stains: EbruStains | null = null;
  for (const step of spin.steps) {
    if (step.type === 'drop-in') { grid = step.grid; stains = step.stains; }
    else if (step.type === 'bleed' || step.type === 'fall') grid = step.grid;
    else if (step.type === 'comb') { grid = step.grid; stains = step.stains; }
    else if (step.type === 'stains') stains = step.stains;
  }
  return { grid: grid!, stains };
}

/** Fixed two-decimal amount: 3510 -> "35,10". */
let twoDecimals: Intl.NumberFormat | null = null;
const fixed2 = () => (twoDecimals ??= new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export function ebruMoney(cents: number): string { return fixed2().format(cents / 100); }
/** Hundredths of the bet as a multiple: 1240 -> "12,40". */
export function ebruTimes(hundredths: number): string { return fixed2().format(hundredths / 100); }

/** What a history row says about a round, without wording (the translated UI builds the text from this). */
export type EbruHistoryParts =
  | { kind: 'capped'; totalHundredths: number }
  | { kind: 'free'; spins: number; maxStain: number; totalHundredths: number }
  | { kind: 'none' }
  | { kind: 'clusters'; clusters: number; combWins: number; combs: number; totalHundredths: number };
export function ebruHistoryParts(round: EbruRound): EbruHistoryParts {
  if (round.capped) return { kind: 'capped', totalHundredths: round.totalHundredths };
  if (round.freeSpinsTriggered) return { kind: 'free', spins: round.spins.length - 1, maxStain: Math.max(0, ...round.spins.map(s => s.maxStain)), totalHundredths: round.totalHundredths };
  if (round.totalHundredths === 0) return { kind: 'none' };
  const base = round.spins[0]!;
  return { kind: 'clusters', clusters: base.clusterCount, combWins: base.combWins, combs: base.scatterHundredths > 0 ? base.scatterCount : 0, totalHundredths: round.totalHundredths };
}

/** History row text (Turkish, stored with the record): "4 küme · 1 tarak kazancı · 3,04×", "Lale Ebrusu ×8 · en büyük leke ×16 · 40,20×", "Kazanç yok". */
export function ebruHistoryDetail(round: EbruRound): string {
  const parts = ebruHistoryParts(round);
  switch (parts.kind) {
    case 'capped': return `Azami kazanç · ${ebruTimes(parts.totalHundredths)}×`;
    case 'free': return `Lale Ebrusu ×${parts.spins}${parts.maxStain > 0 ? ` · en büyük leke ×${parts.maxStain}` : ''} · ${ebruTimes(parts.totalHundredths)}×`;
    case 'none': return 'Kazanç yok';
    case 'clusters': {
      const items = [`${parts.clusters} küme`];
      if (parts.combWins > 0) items.push(`${parts.combWins} tarak kazancı`);
      if (parts.combs > 0) items.push(`${parts.combs} Altın Tarak`);
      return `${items.join(' · ')} · ${ebruTimes(parts.totalHundredths)}×`;
    }
  }
}

/** Screen-reader line for one cluster: "6 altın lale, leke ×4, 12,00× kazanç". */
export function ebruClusterAnnouncement(cluster: Pick<EbruTimelineCluster, 'colour' | 'size' | 'winHundredths' | 'stainSum'>, labels: Record<string, string>): string {
  const name = (labels[cluster.colour] ?? cluster.colour).toLocaleLowerCase('tr-TR');
  return `${cluster.size} ${name}${cluster.stainSum > 0 ? `, leke ×${cluster.stainSum}` : ''}, ${ebruTimes(cluster.winHundredths)}× kazanç`;
}
