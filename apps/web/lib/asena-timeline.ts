/**
 * Asena: Yıldız Kurdu presentation timeline. Pure: converts an already-resolved `AsenaRound` (engine `asena-stars-1`)
 * into an ordered list of timed events. It never reads a clock, the DOM or randomness and only re-states engine numbers
 * (every meter, multiplier, map piece, wolf step and total comes from the round's integers), so the speed setting,
 * reduced motion or a tapped hold screen change timing but never a displayed amount, a grid or a payout.
 *
 * Every visual and audio beat binds to these timestamps: the game calls the board, the canvas FX, the scene and the
 * sound from the same event. Board durations are computed with the same formulas as components/asena/board.tsx, so
 * the next event starts when the board's own animation ends. The constellation trace uses the shared stroke plan of
 * components/asena/geometry.ts (board links, FX tracers, sky echo and the star-by-star sound all read one plan).
 *
 * Time unit: ms from the round start. Grid coordinates: col 0..5, row 0..5 (row 0 on top), grid[col][row].
 *
 * Engine data -> events (packages/protocol/src/asena.ts; the reference order is ASENA_STEP_MAPPING in art-lab.tsx):
 *   spin start         -> spin-start (free spins: counter, map pieces, global multiplier)
 *   steps[0].grid      -> drop-in (the old field falls out, the new one falls in), land per column, moon-land per moon,
 *                         moon-tease (exactly 2 moons waiting)
 *   steps[k].grid      -> grid (k ≥ 1: the board after fall + wolf walks; the board reconciles ids)
 *   steps[k].clusters  -> highlight
 *   cluster.constellation (each) -> constellation (the timed plan) and howl (trace end + the sound's howl delay;
 *                         multiplier callout when template × global ≥ 10)
 *   steps[k].map       -> map (stars fly to the sky map), ergenekon (global multiplier rose), map-spins (+5)
 *   steps[k].burst     -> burst (the cumulative meter adds the step win here)
 *   steps[k].fall      -> fall, land per column, moon-land for fresh moons, moon-tease
 *   steps[k].wolfWalks -> wolf-walk (one after another)
 *   spin end           -> moons (3+), scatter-pay, scatter-trigger, free-intro / free-mode, spin-end
 *   round end          -> free-outro (always after free spins), total-win flourish (<10×) or big-win (≥10×, Azami when capped)
 */
import {
  ASENA_COLS, ASENA_MAX_WIN_MULTIPLIER, ASENA_MAP_MULTIPLIERS, ASENA_ROWS, ASENA_TEMPLATES,
  type AsenaGrid, type AsenaIgnition, type AsenaMapEvent, type AsenaPaySymbol, type AsenaRound, type AsenaWolfWalk,
} from '@sollish/protocol';
import { asenaConstellationPlan, type AsPos, type AsPoint, type AsenaConstellationPlan } from '../components/asena/geometry';
import { countUpSchedule, roundCelebration, type CelebrationLevel, type CountUpSchedule } from './slot-kit/win-tiers';
import { multiplierClass, multiplierRank } from './slot-audio/win-tiers';

export type AsenaSpeed = 'normal' | 'quick' | 'turbo';
/** Board / FX duration factor (board.tsx `speed`: 1 normal, 0.6 quick, 0.35 turbo). */
export const ASENA_SPEED_FACTOR: Readonly<Record<AsenaSpeed, number>> = Object.freeze({ normal: 1, quick: 0.6, turbo: 0.35 });
/** Holds (free-spin intro, total screen) never shrink below this in turbo so the text stays readable. */
export const ASENA_TURBO_MIN_HOLD = 1500;
/** "Giriş ekranlarını atla": the intro and total screens still show, this long at most. */
export const ASENA_SKIP_SCREEN_HOLD = 900;
/** Base trace length of the signature constellation (ms); quick/turbo never draw it faster than 0.6 of this. */
export const ASENA_TRACE_MS = 1400;
/** The sound engine starts the howl this long after the last star lights (asena-tiers.ts HOWL_DELAY = 0.16 s). */
export const ASENA_HOWL_DELAY_MS = 160;

export interface AsenaTimelineOptions { speed?: AsenaSpeed; reducedMotion?: boolean; skipScreens?: boolean }

/** Multiplier callout class 0..5: <10, ≥10, ≥25, ≥50, ≥100, ≥250 (owner rule: ≥10× gets its own big text and sound). */
export type AsenaCalloutTier = 0 | 1 | 2 | 3 | 4 | 5;
export function asenaCalloutTier(multiplier: number): AsenaCalloutTier {
  return multiplierRank(multiplierClass(multiplier)) as AsenaCalloutTier;
}
/** Ergenekon level 0..3 of a global multiplier (×1, ×2, ×3, ×5): the scene's cracks and the sky-map emblem. */
export function asenaErgenekonLevel(multiplier: number): 0 | 1 | 2 | 3 {
  return multiplier >= ASENA_MAP_MULTIPLIERS.twice ? 3 : multiplier >= ASENA_MAP_MULTIPLIERS[6] ? 2 : multiplier >= ASENA_MAP_MULTIPLIERS[3] ? 1 : 0;
}

/** Hundredths of the bet: this spin's running win and the capped, CUMULATIVE round total (never decreases). */
export interface AsenaMeter { spin: number; total: number }
export interface AsenaTimelineCluster {
  symbol: AsenaPaySymbol; size: number; ids: number[]; positions: AsPos[];
  basePayHundredths: number; templateMultiplier: number; payHundredths: number;
  /** Pay with the step's global multiplier applied (what this cluster adds to the meter). */
  winHundredths: number;
  templateId: string | null;
  /** Mean cell position in cell units (col + 0.5, row + 0.5 = cell centre). */
  centroid: { x: number; y: number };
}
export interface AsenaMoonSpot { id: number; col: number; row: number }

type At = { at: number; dur: number };
export type AsenaEvent =
  | At & { type: 'spin-start'; spin: number; kind: 'base' | 'free'; freeSpinNumber: number; freeSpinsLeft: number; meter: AsenaMeter; pieces: number[]; globalMultiplier: number }
  /** New spin: the old field falls out, `grid` falls in column by column (board.dropIn with `speed`). */
  | At & { type: 'drop-in'; spin: number; grid: AsenaGrid; speed: number }
  /** A column's stars touch down (sound.dropIn(col)). */
  | At & { type: 'land'; spin: number; col: number }
  /** The n-th moon of this spin lands (sound.moonLand(n); the sound teases from the 2nd). */
  | At & { type: 'moon-land'; spin: number; n: number; id: number; col: number; row: number }
  /** Exactly two moons wait for a third (board + FX glow). */
  | At & { type: 'moon-tease'; spin: number; cells: AsPos[] }
  /** Start of tumble step k ≥ 1: the board after the fall and the wolf walks (reconcile; ids already match). */
  | At & { type: 'grid'; spin: number; step: number; grid: AsenaGrid }
  | At & { type: 'highlight'; spin: number; step: number; clusters: AsenaTimelineCluster[]; stepHundredths: number; globalMultiplier: number }
  /** The signature moment: one ignited template traced star by star over its cells (board, FX, sky echo, sound). */
  | At & { type: 'constellation'; spin: number; step: number; index: number; ignition: AsenaIgnition; plan: AsenaConstellationPlan; symbol: AsenaPaySymbol; payHundredths: number; persist: boolean; freeSpins: boolean }
  /** The wolf on the rock howls (trace end + the sound's howl delay). `callout` when template × global ≥ 10. */
  | At & { type: 'howl'; spin: number; step: number; index: number; templateId: string; multiplier: number; callout: { value: number; tier: AsenaCalloutTier } | null }
  /** Free spins: map pieces unlock, a star flies from each constellation to its sky-map tile. */
  | At & { type: 'map'; spin: number; step: number; unlocked: Array<{ template: number; templateId: string; count: number; from: AsPoint | null; delay: number }>; pieces: number[]; distinct: number }
  /** The global multiplier rose: Ergenekon's iron mountain cracks (level 1 ×2, 2 ×3, 3 ×5). */
  | At & { type: 'ergenekon'; spin: number; step: number; before: number; after: number; level: 0 | 1 | 2 | 3; distinct: number }
  | At & { type: 'map-spins'; spin: number; step: number; awarded: number; freeSpinsLeft: number }
  /** Cluster cells burst into stars (wolves stay); the cumulative meter adds the step win. */
  | At & { type: 'burst'; spin: number; step: number; ids: number[]; positions: AsPos[]; clusters: AsenaTimelineCluster[]; stepHundredths: number; meter: AsenaMeter; speed: number }
  | At & { type: 'fall'; spin: number; step: number; fall: NonNullable<AsenaRound['spins'][number]['steps'][number]['fall']>; speed: number }
  | At & { type: 'wolf-walk'; spin: number; step: number; index: number; walk: AsenaWolfWalk; speed: number; ms: number }
  /** 3+ moons on the final board of a spin. */
  | At & { type: 'moons'; spin: number; cells: AsPos[]; count: number }
  | At & { type: 'scatter-pay'; spin: number; count: number; hundredths: number; meter: AsenaMeter }
  | At & { type: 'scatter-trigger'; spin: number; count: number; awarded: number; retrigger: boolean; freeSpinsLeft: number }
  | At & { type: 'free-intro'; spin: number; awarded: number; hold: true }
  | At & { type: 'free-mode'; on: boolean; freeSpinsLeft: number }
  | At & { type: 'spin-end'; spin: number; kind: 'base' | 'free'; winHundredths: number; meter: AsenaMeter; freeSpinsLeft: number; globalMultiplier: number; pieces: number[] }
  /** "Ergenekon — Toplam": always ends a free-spin round. */
  | At & { type: 'free-outro'; spins: number; totalHundredths: number; constellations: number; distinct: number; globalMultiplier: number; wolfSteps: number; celebration: boolean; capped: boolean; hold: true }
  /** Short total-win flourish on the meter for a winning round below 10× without free spins. */
  | At & { type: 'total-win'; totalHundredths: number }
  | At & { type: 'big-win'; tier: CelebrationLevel; totalHundredths: number; capped: boolean; countUp: number; schedule: CountUpSchedule; hold: true }
  | At & { type: 'end'; totalHundredths: number; payoutCents: number; capped: boolean };
export type AsenaEventType = AsenaEvent['type'];

export interface AsenaTimeline { events: AsenaEvent[]; duration: number; speed: AsenaSpeed; skipScreens: boolean; reducedMotion: boolean }

/** Base timings (ms, normal speed). Reduced motion keeps every step (constellations included) with short fades. */
const NORMAL = {
  spinStart: 120, freeSpinStart: 420, settle: 110, highlight: 560,
  constellationHold: 900, constellationHoldLow: 600, calloutHold: 1250, cascade: 0.5, wolfOverlap: 0.62, flight: 720, flightStagger: 120, mapTail: 220,
  ergenekon: 1500, mapSpins: 900, wolfGap: 60,
  moons: 1500, scatterPay: 760, scatterTrigger: 1300, retrigger: 1300, freeIntro: 3200, freeOutro: 3400, totalWin: 900,
  spinEndWin: 560, spinEndNone: 260, freeSpinEndWin: 640, freeSpinEndNone: 240,
};
const REDUCED: typeof NORMAL = {
  ...NORMAL, highlight: 420, constellationHold: 600, constellationHoldLow: 500, calloutHold: 900, flight: 30, flightStagger: 0, mapTail: 260,
  ergenekon: 1000, moons: 800, scatterTrigger: 900, retrigger: 900,
};

/** floor(bet × hundredths / 100): the engine's payout rule, used for every displayed amount. */
export function asenaCents(betCents: number, hundredths: number): number {
  return Math.floor((betCents * hundredths) / 100);
}

/* ---- board.tsx timing, same formulas (presentation only) */
const boardFallMs = (rows: number, speed: number) => (210 + 125 * Math.sqrt(Math.max(0.3, rows))) * speed;
/** board.dropIn: total length and per-column landing times (onColumn). */
export function asenaDropInTiming(speed: number, reduced: boolean): { dur: number; landAt: number[]; cellLandAt: (col: number, row: number) => number } {
  let outMs = 0;
  for (let col = 0; col < ASENA_COLS; col++) for (let row = 0; row < ASENA_ROWS; row++) {
    const delay = reduced ? 0 : (col * 34 + (ASENA_ROWS - 1 - row) * 14) * speed;
    outMs = Math.max(outMs, delay + (reduced ? 120 : 300) * speed);
  }
  const lead = reduced ? 60 : Math.min(outMs * 0.55, 260 * speed);
  const fall = reduced ? 160 : boardFallMs(ASENA_ROWS + 0.5, speed);
  let inMs = 0;
  for (let col = 0; col < ASENA_COLS; col++) for (let row = 0; row < ASENA_ROWS; row++) inMs = Math.max(inMs, lead + (reduced ? 0 : (col * 52 + (ASENA_ROWS - 1 - row) * 30) * speed) + fall);
  return {
    dur: Math.round(Math.max(outMs, inMs) + 20),
    landAt: Array.from({ length: ASENA_COLS }, (_, col) => Math.round(lead + col * 52 * speed + fall * 0.7)),
    cellLandAt: (col, row) => Math.round(lead + (reduced ? 0 : (col * 52 + (ASENA_ROWS - 1 - row) * 30) * speed) + fall * 0.7),
  };
}
/** board.fall: total length and per-column landing times. */
export function asenaFallTiming(fall: { grid: AsenaGrid; moves: { id: number; col: number; fromRow: number; toRow: number }[]; drops: { id: number; col: number; row: number }[] }, speed: number, reduced: boolean): { dur: number; landAt: (number | null)[]; cellLandAt: Map<number, number> } {
  const dropsPerCol = new Array<number>(ASENA_COLS).fill(0);
  for (const d of fall.drops) dropsPerCol[d.col]!++;
  const fresh = new Set(fall.drops.map(d => d.id));
  const moved = new Map(fall.moves.map(m => [m.id, m]));
  let longest = 0;
  const landAt: (number | null)[] = new Array(ASENA_COLS).fill(null);
  const cellLandAt = new Map<number, number>();
  for (let col = 0; col < ASENA_COLS; col++) for (let row = 0; row < ASENA_ROWS; row++) {
    const cell = fall.grid[col]![row]!;
    const isFresh = fresh.has(cell.id);
    const move = moved.get(cell.id);
    const rows = isFresh ? dropsPerCol[col]! + 0.35 : move ? move.toRow - move.fromRow : 0;
    if (rows <= 0 && !isFresh) continue;
    const dur = reduced ? 160 : boardFallMs(rows, speed);
    const delay = reduced ? 0 : (col * 30 + (isFresh ? 70 : 0) + (ASENA_ROWS - 1 - row) * 10) * speed;
    longest = Math.max(longest, delay + dur);
    const land = Math.round(delay + dur * 0.7);
    landAt[col] = Math.max(landAt[col] ?? 0, land);
    cellLandAt.set(cell.id, land);
  }
  return { dur: Math.round(longest + 20), landAt, cellLandAt };
}
/** board.burst length for n cells. */
export const asenaBurstMs = (n: number, speed: number, reduced: boolean) => Math.round((reduced ? 140 : 460) * speed + (reduced ? 0 : Math.min(160, n * 12) * speed) + 20);
/** Constellation trace length at a speed: never faster than 0.6 × base, so the signature stays a drawing. */
export const asenaTraceMs = (k: number, reduced: boolean) => Math.round(ASENA_TRACE_MS * (reduced ? 0.5 : Math.max(0.6, k)));

const positionsOf = (grid: AsenaGrid) => {
  const at = new Map<number, AsPos>();
  for (let col = 0; col < ASENA_COLS; col++) for (let row = 0; row < ASENA_ROWS; row++) at.set(grid[col]![row]!.id, [col, row]);
  return at;
};
export const asenaMoonCells = (grid: AsenaGrid): AsenaMoonSpot[] => {
  const out: AsenaMoonSpot[] = [];
  for (let col = 0; col < ASENA_COLS; col++) for (let row = 0; row < ASENA_ROWS; row++) if (grid[col]![row]!.symbol === 'moon') out.push({ id: grid[col]![row]!.id, col, row });
  return out;
};
/** Applies the step's wolf walks to its fall grid: the next step's grid (engine contract, checked in the tests). */
export function asenaApplyWalks(grid: AsenaGrid, walks: readonly AsenaWolfWalk[]): AsenaGrid {
  if (!walks.length) return grid;
  const board = grid.map(column => column.slice());
  for (const w of walks) {
    const wolf = board[w.from[0]]![w.from[1]]!;
    board[w.to[0]]![w.to[1]] = wolf;
    board[w.from[0]]![w.from[1]] = { id: w.trail.id, symbol: 'trail' };
  }
  return board;
}

export function buildAsenaTimeline(round: AsenaRound, options: AsenaTimelineOptions = {}): AsenaTimeline {
  const speed: AsenaSpeed = options.speed ?? 'normal';
  const turbo = speed === 'turbo', reducedMotion = !!options.reducedMotion, skipScreens = !!options.skipScreens;
  const T = reducedMotion ? REDUCED : NORMAL;
  const k = ASENA_SPEED_FACTOR[speed];
  const d = (ms: number) => Math.round(ms * k);
  const hold = (ms: number) => (turbo ? Math.max(ASENA_TURBO_MIN_HOLD, d(ms)) : ms);
  const screen = (ms: number) => (skipScreens ? Math.min(ASENA_SKIP_SCREEN_HOLD, hold(ms)) : hold(ms));
  const traceMs = asenaTraceMs(k, reducedMotion);
  const cap = ASENA_MAX_WIN_MULTIPLIER * 100;
  const events: AsenaEvent[] = [];
  const push = (event: AsenaEvent) => { events.push(event); };
  let t = 0, prevTotal = 0, freeNumber = 0, freeLeft = 0;
  let constellationsFree = 0, wolfStepsFree = 0;

  for (const spin of round.spins) {
    const s = spin.index, free = spin.kind === 'free';
    if (free) { freeNumber++; freeLeft = Math.max(0, freeLeft - 1); }
    let running = 0;
    const meter = (): AsenaMeter => ({ spin: Math.min(running, cap - prevTotal), total: Math.min(cap, prevTotal + running) });
    const startDur = d(free ? T.freeSpinStart : T.spinStart);
    push({ type: 'spin-start', at: t, dur: startDur, spin: s, kind: spin.kind, freeSpinNumber: freeNumber, freeSpinsLeft: freeLeft, meter: meter(), pieces: spin.mapBefore.slice(), globalMultiplier: spin.globalMultiplierBefore });
    t += startDur;

    // Moons never burst and nothing walks onto them: the count only grows within a spin.
    let moonCount = 0;
    const seenMoons = new Set<number>();
    const landMoons = (at: number, spots: Array<AsenaMoonSpot & { land: number }>) => {
      spots.sort((a, b) => a.land - b.land || a.col - b.col || b.row - a.row);
      for (const m of spots) { if (seenMoons.has(m.id)) continue; seenMoons.add(m.id); moonCount++; push({ type: 'moon-land', at: at + m.land, dur: 0, spin: s, n: moonCount, id: m.id, col: m.col, row: m.row }); }
    };
    const tease = (at: number, grid: AsenaGrid) => {
      const moons = asenaMoonCells(grid);
      if (moons.length === 2) push({ type: 'moon-tease', at, dur: 0, spin: s, cells: moons.map(m => [m.col, m.row] as AsPos) });
    };

    // drop-in
    const first = spin.steps[0]!;
    const drop = asenaDropInTiming(k, reducedMotion);
    push({ type: 'drop-in', at: t, dur: drop.dur, spin: s, grid: first.grid, speed: k });
    drop.landAt.forEach((ms, col) => push({ type: 'land', at: t + ms, dur: 0, spin: s, col }));
    landMoons(t, asenaMoonCells(first.grid).map(m => ({ ...m, land: drop.cellLandAt(m.col, m.row) + 1 })));
    t += drop.dur + d(T.settle);
    tease(t, first.grid);

    for (let i = 0; i < spin.steps.length; i++) {
      const step = spin.steps[i]!;
      if (i > 0) push({ type: 'grid', at: t, dur: 0, spin: s, step: i, grid: step.grid });
      if (!step.clusters.length) break;
      const at = positionsOf(step.grid);
      const clusters: AsenaTimelineCluster[] = step.clusters.map(cl => {
        const positions = cl.cells.map(id => at.get(id)!).filter(Boolean);
        let x = 0, y = 0;
        for (const [c, r] of positions) { x += c + 0.5; y += r + 0.5; }
        return {
          symbol: cl.symbol, size: cl.size, ids: cl.cells.slice(), positions, basePayHundredths: cl.basePayHundredths, templateMultiplier: cl.templateMultiplier,
          payHundredths: cl.payHundredths, winHundredths: cl.payHundredths * step.globalMultiplier, templateId: cl.constellation?.templateId ?? null,
          centroid: { x: x / Math.max(1, positions.length), y: y / Math.max(1, positions.length) },
        };
      });
      const highlightDur = d(T.highlight);
      push({ type: 'highlight', at: t, dur: highlightDur, spin: s, step: i, clusters, stepHundredths: step.winHundredths, globalMultiplier: step.globalMultiplier });
      t += highlightDur;

      // constellations, in cluster order
      const globalBefore = step.map ? step.map.globalMultiplierBefore : step.globalMultiplier;
      const plans: AsenaConstellationPlan[] = [];
      // Several constellations of one step draw in a cascade: each starts when the previous is half traced (reduced
      // motion: one after another), so a chain of ignitions stays a sequence of drawings without stalling the round.
      let index = 0, start = t, end = t;
      for (const cl of step.clusters) {
        if (!cl.constellation) continue;
        const plan = asenaConstellationPlan(cl.constellation, traceMs);
        plans.push(plan);
        if (free) constellationsFree++;
        const value = cl.templateMultiplier * globalBefore;
        const callout = value >= 10 ? { value, tier: asenaCalloutTier(value) } : null;
        if (index > 0) start += reducedMotion ? traceMs : Math.round(traceMs * T.cascade);
        const dur = traceMs + d(callout ? T.calloutHold : cl.templateMultiplier >= 6 ? T.constellationHold : T.constellationHoldLow);
        push({ type: 'constellation', at: start, dur, spin: s, step: i, index, ignition: cl.constellation, plan, symbol: cl.symbol, payHundredths: cl.payHundredths, persist: free, freeSpins: free });
        push({ type: 'howl', at: start + traceMs + ASENA_HOWL_DELAY_MS, dur: 0, spin: s, step: i, index, templateId: cl.constellation.templateId, multiplier: cl.templateMultiplier, callout });
        end = Math.max(end, start + dur);
        index++;
      }
      t = end;

      // Ergenekon map (free spins only)
      if (step.map) {
        const ev: AsenaMapEvent = step.map;
        const unlocked = ev.unlocked.map((u, n) => ({ template: u.template, templateId: u.templateId, count: u.count, from: plans.find(p => p.templateIndex === u.template)?.center ?? null, delay: n * T.flightStagger }));
        const mapDur = (reducedMotion ? 0 : d(T.flight + T.flightStagger * Math.max(0, unlocked.length - 1))) + d(T.mapTail);
        push({ type: 'map', at: t, dur: mapDur, spin: s, step: i, unlocked: unlocked.map(u => ({ ...u, delay: d(u.delay) })), pieces: ev.pieces.slice(), distinct: ev.distinct });
        t += mapDur;
        if (ev.globalMultiplierAfter > ev.globalMultiplierBefore) {
          const dur = turbo ? Math.max(900, d(T.ergenekon)) : d(T.ergenekon);
          push({ type: 'ergenekon', at: t, dur, spin: s, step: i, before: ev.globalMultiplierBefore, after: ev.globalMultiplierAfter, level: asenaErgenekonLevel(ev.globalMultiplierAfter), distinct: ev.distinct });
          t += dur;
        }
        if (ev.freeSpinsAwarded > 0) {
          freeLeft += ev.freeSpinsAwarded;
          const dur = d(T.mapSpins);
          push({ type: 'map-spins', at: t, dur, spin: s, step: i, awarded: ev.freeSpinsAwarded, freeSpinsLeft: freeLeft });
          t += dur;
        }
      }

      // burst: the meter collects the step win
      running += step.winHundredths;
      const burstPositions = step.burst.map(id => at.get(id)!).filter(Boolean);
      const burstDur = asenaBurstMs(step.burst.length, k, reducedMotion);
      push({ type: 'burst', at: t, dur: burstDur, spin: s, step: i, ids: step.burst.slice(), positions: burstPositions, clusters, stepHundredths: step.winHundredths, meter: meter(), speed: k });
      t += burstDur;

      // fall
      if (step.fall) {
        const ft = asenaFallTiming(step.fall, k, reducedMotion);
        push({ type: 'fall', at: t, dur: ft.dur, spin: s, step: i, fall: step.fall, speed: k });
        ft.landAt.forEach((ms, col) => { if (ms !== null) push({ type: 'land', at: t + ms, dur: 0, spin: s, col }); });
        landMoons(t, step.fall.drops.filter(dr => dr.symbol === 'moon').map(dr => ({ id: dr.id, col: dr.col, row: dr.row, land: (ft.cellLandAt.get(dr.id) ?? 0) + 1 })));
        t += ft.dur + d(T.settle);
        if (!step.wolfWalks.length) tease(t, step.fall.grid);
      }
      // wolf walks, one after another
      // Wolves walk one after another (engine order); the next hop starts while the previous lands.
      step.wolfWalks.forEach((walk, n) => {
        const ms = Math.round((reducedMotion ? 160 : 640) * k);
        const last = n === step.wolfWalks.length - 1;
        const next = reducedMotion ? ms + d(T.wolfGap) : Math.round(ms * T.wolfOverlap);
        push({ type: 'wolf-walk', at: t, dur: last ? ms + d(T.wolfGap) : next, spin: s, step: i, index: n, walk, speed: k, ms });
        t += last ? ms + d(T.wolfGap) : next;
        if (free) wolfStepsFree++;
      });
      if (step.wolfWalks.length && step.fall) tease(t, asenaApplyWalks(step.fall.grid, step.wolfWalks));
    }

    const lastGrid = spin.steps[spin.steps.length - 1]!.grid;
    if (spin.scatterCount >= 3) {
      const dur = d(T.moons);
      push({ type: 'moons', at: t, dur, spin: s, cells: asenaMoonCells(lastGrid).map(m => [m.col, m.row] as AsPos), count: spin.scatterCount });
      t += dur;
    }
    if (spin.scatterHundredths > 0) {
      running += spin.scatterHundredths;
      const payDur = d(T.scatterPay);
      push({ type: 'scatter-pay', at: t, dur: payDur, spin: s, count: spin.scatterCount, hundredths: spin.scatterHundredths, meter: meter() });
      t += payDur;
    }
    const scatterAwarded = Math.min(spin.scatterSpinsAwarded, spin.freeSpinsAwarded);
    if (scatterAwarded > 0) {
      const retrigger = free;
      const triggerDur = d(retrigger ? T.retrigger : T.scatterTrigger);
      push({ type: 'scatter-trigger', at: t, dur: triggerDur, spin: s, count: spin.scatterCount, awarded: scatterAwarded, retrigger, freeSpinsLeft: spin.freeSpinsLeft });
      t += triggerDur;
      if (!retrigger) {
        const introDur = screen(T.freeIntro);
        push({ type: 'free-intro', at: t, dur: introDur, spin: s, awarded: scatterAwarded, hold: true });
        t += introDur;
        push({ type: 'free-mode', at: t, dur: 0, on: true, freeSpinsLeft: spin.freeSpinsLeft });
      }
    }
    freeLeft = spin.freeSpinsLeft;
    const spinWin = spin.totalHundredthsAfter - prevTotal;
    const endDur = d(free ? (spinWin > 0 ? T.freeSpinEndWin : T.freeSpinEndNone) : (spinWin > 0 ? T.spinEndWin : T.spinEndNone));
    push({ type: 'spin-end', at: t, dur: endDur, spin: s, kind: spin.kind, winHundredths: spinWin, meter: { spin: spinWin, total: spin.totalHundredthsAfter }, freeSpinsLeft: spin.freeSpinsLeft, globalMultiplier: spin.globalMultiplierAfter, pieces: spin.mapAfter.slice() });
    t += endDur;
    prevTotal = spin.totalHundredthsAfter;
  }

  const celebration = roundCelebration(round.totalHundredths, round.capped);
  if (round.freeSpinsTriggered) {
    const last = round.spins[round.spins.length - 1]!;
    const outroDur = screen(T.freeOutro);
    push({
      type: 'free-outro', at: t, dur: outroDur, spins: round.spins.length - 1, totalHundredths: round.totalHundredths, constellations: constellationsFree,
      distinct: last.mapAfter.filter(p => p > 0).length, globalMultiplier: last.globalMultiplierAfter, wolfSteps: wolfStepsFree,
      celebration: celebration === 'celebration', capped: round.capped, hold: true,
    });
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

/** The board at the very end of the round (grid [col][row]): the last step of the last spin. */
export function asenaFinalBoard(round: AsenaRound): AsenaGrid {
  const spin = round.spins[round.spins.length - 1]!;
  return spin.steps[spin.steps.length - 1]!.grid;
}

/** Fixed two-decimal amount: 3510 -> "35,10". */
let twoDecimals: Intl.NumberFormat | null = null;
const fixed2 = () => (twoDecimals ??= new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export function asenaMoney(cents: number): string { return fixed2().format(cents / 100); }
/** Hundredths of the bet as a multiple: 1240 -> "12,40". */
export function asenaTimes(hundredths: number): string { return fixed2().format(hundredths / 100); }

/** History row text: "3 küme · 1 takımyıldız · 0,48×", "Ergenekon ×10 · genel ×3 · 89,56×", "Kazanç yok". */
export function asenaHistoryDetail(round: AsenaRound): string {
  const total = `${asenaTimes(round.totalHundredths)}×`;
  if (round.capped) return `Azami kazanç · ${total}`;
  if (round.freeSpinsTriggered) {
    const last = round.spins[round.spins.length - 1]!;
    return `Ergenekon ×${round.spins.length - 1}${last.globalMultiplierAfter > 1 ? ` · genel ×${last.globalMultiplierAfter}` : ''} · ${total}`;
  }
  if (round.totalHundredths === 0) return 'Kazanç yok';
  const base = round.spins[0]!;
  const clusters = base.steps.reduce((n, st) => n + st.clusters.length, 0);
  const stars = base.steps.reduce((n, st) => n + st.clusters.filter(c => c.constellation).length, 0);
  const parts = [`${clusters} küme`];
  if (stars > 0) parts.push(`${stars} takımyıldız`);
  if (base.scatterHundredths > 0) parts.push(`${base.scatterCount} Ay Ata`);
  return `${parts.join(' · ')} · ${total}`;
}

/** Screen-reader line for one cluster: "6 asena, Kurt Başı ×10, 12,00× kazanç". */
export function asenaClusterAnnouncement(cluster: Pick<AsenaTimelineCluster, 'symbol' | 'size' | 'winHundredths' | 'templateId' | 'templateMultiplier'>, labels: Record<string, string>): string {
  const name = (labels[cluster.symbol] ?? cluster.symbol).toLocaleLowerCase('tr-TR');
  const template = cluster.templateId ? ASENA_TEMPLATES.find(tp => tp.id === cluster.templateId) : null;
  return `${cluster.size} ${name}${template ? `, ${template.name} ×${cluster.templateMultiplier}` : ''}, ${asenaTimes(cluster.winHundredths)}× kazanç`;
}
