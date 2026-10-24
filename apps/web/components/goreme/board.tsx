'use client';
/**
 * Göreme board: the 6 × 5 reel window's contents. Imperative (the game drives it from timeline events) but rendered by
 * React: non-balloon cells are absolutely placed by (col, row) and keyed by their engine cell id, so a fresh id mounts
 * and plays its own landing; balloons live on an overlay layer keyed by their STABLE engine id (`data-balloon-id`), so a
 * lift is a CSS transform transition from the old cell to the new one (rise + wind drift + a lean into the wind), the
 * +1 badge ticks part-way up, two balloons heading for one cell meet side by side and then merge (the absorbed one is
 * pulled into the survivor, which swells), and an exit leaves through the top: in the base game it flies off the top of
 * the table, in Şafak Şöleni it flies into its own sky-band slot (a target the game measures) and stays parked there
 * until the sky band takes it over, so the flight never breaks. Respins spin the reels again behind the balloons and
 * stop them left to right; a burner flare lights each envelope from inside; the wind draws streaks across the window;
 * a winning ways run gets gold cell frames and a per-reel count path along the bottom rim; `showWins` / `focusWin` add the
 * win presentation (win-fx.tsx: bouncing cells with kilim spark bursts, a burst on big boards, per-way labels, then each
 * way traced reel by reel) while every other symbol dims.
 * Every length comes from the timeline event (stops, delays, dropMs, ms, tickMs), so the board ends exactly when the
 * timeline moves on. Only transform / opacity animate. Presentation only: the board never decides anything, it re-draws
 * engine grids.
 */
import { memo, useCallback, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import { GOREME_REELS, GOREME_ROWS, type GoremeExit, type GoremeGrid, type GoremeLiftMove, type GoremeMerge, type GoremeSymbol as EngineSymbol } from '@sollish/protocol';
import { GoremeSymbol, goremeMergedSize, type GoremeSymbolState } from './symbols';
import { GoremeWinFx, type GoremeWinShow, type GoremeWinShowLine, type GoremeWinSpot } from './win-fx';
import styles from './board.module.css';

/** Where a mooring balloon flies to, in board cell units (col, row may be fractional and outside 0..5 / 0..4) and its scale there. */
export interface GoremeMoorTarget { col: number; row: number; scale: number }
export type GoremeWindDir = 'left' | 'calm' | 'right';

export interface GoremeBoardHandle {
  readonly element: HTMLDivElement | null;
  /** Whole fresh board: the old symbols drop out, reel c stops `stops[c]` ms from now. */
  spin(grid: GoremeGrid, opts: { stops: number[]; dropMs: number; teaseFrom: number | null }): void;
  /** Respin: balloons stay, the reels spin behind them and every other cell lands fresh (`drops` are the fresh ids),
   * column c starting to land after `delays[c]` ms, down `dropMs` later. */
  respin(grid: GoremeGrid, opts: { drops: number[]; delays: number[]; dropMs: number }): void;
  /** Burner flare (`ms` long): every balloon's envelope lights up from inside and bounces on its flame. */
  burn(ms: number): void;
  /** Wind streaks across the window for `ms`. */
  wind(dir: GoremeWindDir, ms: number): void;
  /** Rise + wind drift (`ms` long); the +1 badges tick after `tickMs`. Exits leave through the top: moored exits fly to
   * `moorTargets` (by id) and stay parked there until `releaseParked`. */
  move(moves: readonly GoremeLiftMove[], exits: readonly GoremeExit[], ms: number, opts?: { tickMs?: number; moorTargets?: ReadonlyMap<number, GoremeMoorTarget> }): void;
  merge(merges: readonly GoremeMerge[], ms: number): void;
  /** The sky band now shows these balloons: drop the parked copies (all parked balloons when omitted). */
  releaseParked(ids?: readonly number[]): void;
  /** Cells (by id) that glow; every other cell dims. `path` = cell ids of the run to trace along the bottom rim
   * (per-reel counts). null clears. */
  highlight(ids: readonly number[] | null, path?: readonly number[] | null): void;
  /** Places a grid at once without animation (idle board, end of round, recovery). */
  setGrid(grid: GoremeGrid): void;
  dim(on: boolean): void;
  /** All-wins summary of a board (`ms` long): every way's cells glow and bounce, the rest dims, labels list each way. */
  showWins(lines: readonly GoremeWinShowLine[], opts: { ms: number; burst: boolean; fx: boolean }): void;
  /** After showWins: one way (index into its lines) is highlighted and traced reel by reel for `ms`. */
  focusWin(index: number, ms: number): void;
  /** How many balloons a balloon on the board is made of (1, or more after merges); 1 when unknown. */
  partsOf(id: number): number;
}

type CellMode = 'still' | 'reel' | 'drop';
interface BoardCell { id: number; symbol: Exclude<EngineSymbol, 'balloon'>; col: number; row: number; mode: CellMode; delay: number; dur: number }
interface Leaving { id: number; symbol: Exclude<EngineSymbol, 'balloon'>; col: number; row: number; key: string; dur: number }
type BalloonPhase = 'idle' | 'land' | 'rise' | 'grow' | 'exit' | 'moor' | 'parked' | 'absorbed';
interface BoardBalloon {
  id: number; col: number; row: number; multiplier: number; parts: number; phase: BalloonPhase; ms: number; delay: number;
  /** Horizontal offset in cells (two balloons meeting in one cell sit side by side until they merge). */
  ox: number;
  /** Lean while drifting: -1 left, 0, 1 right. */
  tilt: number;
  /** Scale of the whole balloon (moor flight shrinks it to its sky-band size). */
  scale: number;
  /** +N chip (a tick of the badge): key and amount. */
  tick: number; plus: number;
  /** Moor flight: the band already shows it, drop it on arrival. */
  release?: boolean;
}
interface ReelSet { key: number; cols: Array<{ col: number; hideAt: number; tease: boolean }>; kind: 'spin' | 'respin' }
interface Puff { key: number; col: number; row: number }
interface WaysPath { key: number; counts: number[] }

const onBoard = (p: BalloonPhase) => p === 'idle' || p === 'land' || p === 'grow' || p === 'rise';
export type GoremeCellLabel = (symbol: EngineSymbol, col: number, row: number, multiplier: number) => string;

/** A pleasant, symbol-only idle board (ids are negative: they never collide with engine ids). */
const IDLE: EngineSymbol[][] = [
  ['h1', 'l2', 'l4', 'h3', 'l1'],
  ['l3', 'h2', 'l5', 'l1', 'h4'],
  ['h4', 'l1', 'l3', 'l3', 'l2'],
  ['l5', 'h3', 'l2', 'h1', 'l4'],
  ['l2', 'l4', 'h1', 'l5', 'h2'],
  ['h2', 'l5', 'l3', 'h4', 'l1'],
];
export const GOREME_IDLE_GRID: GoremeGrid = IDLE.map((column, col) => column.map((symbol, row) => ({ id: -1 - (col * GOREME_ROWS + row), symbol, multiplier: 0 })));
/** Symbols shown in the spinning blur strip of a reel (cosmetic only). */
const STRIP: Exclude<EngineSymbol, 'balloon'>[] = ['l1', 'h2', 'l4', 'h1', 'l3', 'h4', 'l5', 'h3', 'l2', 'l1'];
/** Base-game fly-away: the balloon climbs this many rows above the window (off the top of the table) while it fades. */
const FLY_AWAY_ROW = -7;
/** Two balloons meeting in one cell sit this far apart (cells) until they merge. */
const MEET_OFFSET = 0.2;

function balloonOf(id: number, col: number, row: number, multiplier: number, parts: number, phase: BalloonPhase, ms: number, delay: number): BoardBalloon {
  return { id, col, row, multiplier, parts, phase, ms, delay, ox: 0, tilt: 0, scale: 1, tick: 0, plus: 0 };
}

function split(grid: GoremeGrid, prev: ReadonlyMap<number, BoardBalloon>, mode: (id: number, col: number) => { mode: CellMode; delay: number; dur: number }, landBalloon: (id: number, col: number) => { phase: BalloonPhase; delay: number; ms: number }) {
  const cells: BoardCell[] = [], balloons: BoardBalloon[] = [];
  for (let col = 0; col < GOREME_REELS; col++) for (let row = 0; row < GOREME_ROWS; row++) {
    const cell = grid[col]![row]!;
    if (cell.symbol === 'balloon') {
      const old = prev.get(cell.id);
      if (old) balloons.push({ ...old, col, row, multiplier: cell.multiplier, phase: 'idle', ms: 0, delay: 0, ox: 0, tilt: 0, scale: 1 });
      else { const land = landBalloon(cell.id, col); balloons.push(balloonOf(cell.id, col, row, cell.multiplier, 1, land.phase, land.ms, land.delay)); }
    } else cells.push({ id: cell.id, symbol: cell.symbol, col, row, ...mode(cell.id, col) });
  }
  return { cells, balloons };
}

export const GoremeBoard = memo(function GoremeBoard({ ref, label, cellLabel, mood = 'base' }: { ref?: Ref<GoremeBoardHandle>; label: string; cellLabel: GoremeCellLabel; mood?: 'base' | 'feature' }) {
  const root = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => split(GOREME_IDLE_GRID, new Map(), () => ({ mode: 'still', delay: 0, dur: 0 }), () => ({ phase: 'idle', delay: 0, ms: 0 })), []);
  const [cells, setCells] = useState<BoardCell[]>(initial.cells);
  const [balloons, setBalloons] = useState<BoardBalloon[]>(initial.balloons);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const [lit, setLit] = useState<ReadonlySet<number> | null>(null);
  const [path, setPath] = useState<WaysPath | null>(null);
  const [reels, setReels] = useState<ReelSet | null>(null);
  const [burn, setBurn] = useState<{ key: number; ms: number } | null>(null);
  const [gust, setGust] = useState<{ key: number; dir: GoremeWindDir; ms: number } | null>(null);
  const [puffs, setPuffs] = useState<Puff[]>([]);
  const [dimmed, setDimmed] = useState(false);
  const [win, setWin] = useState<GoremeWinShow | null>(null);
  const winRef = useRef(win); winRef.current = win;
  const cellsRef = useRef(cells); cellsRef.current = cells;
  const balloonsRef = useRef(balloons); balloonsRef.current = balloons;
  const timers = useRef(new Set<number>());
  const keySeq = useRef(0);
  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, Math.max(0, ms));
    timers.current.add(id);
  }, []);
  const clearTimers = useCallback(() => { for (const id of timers.current) window.clearTimeout(id); timers.current.clear(); }, []);

  const dropOut = useCallback((list: readonly BoardCell[], dur: number) => {
    if (!list.length) return;
    const key = ++keySeq.current;
    setLeaving(prev => [...prev, ...list.map(c => ({ id: c.id, symbol: c.symbol, col: c.col, row: c.row, key: `${key}:${c.id}`, dur }))]);
    after(dur + 40, () => setLeaving(prev => prev.filter(l => !l.key.startsWith(`${key}:`))));
  }, [after]);
  const showReels = useCallback((cols: ReelSet['cols'], kind: ReelSet['kind']) => {
    if (!cols.length) { setReels(null); return; }
    const key = ++keySeq.current;
    setReels({ key, cols, kind });
    after(Math.max(...cols.map(c => c.hideAt)) + 160, () => setReels(r => (r?.key === key ? null : r)));
  }, [after]);

  /** Per-reel counts of a run's cells along the bottom rim (null clears). */
  const tracePath = useCallback((pathIds: readonly number[] | null) => {
    if (!pathIds?.length) { setPath(null); return; }
    const colOf = new Map<number, number>();
    for (const c of cellsRef.current) colOf.set(c.id, c.col);
    for (const b of balloonsRef.current) if (onBoard(b.phase)) colOf.set(b.id, b.col);
    const counts = new Array<number>(GOREME_REELS).fill(0);
    for (const id of pathIds) { const col = colOf.get(id); if (col !== undefined) counts[col]!++; }
    let length = 0;
    while (length < GOREME_REELS && counts[length]! > 0) length++;
    setPath(length >= 3 ? { key: ++keySeq.current, counts: counts.slice(0, length) } : null);
  }, []);

  useImperativeHandle(ref, () => ({
    get element() { return root.current; },
    spin(grid, { stops, dropMs, teaseFrom }) {
      clearTimers();
      setLit(null); setPath(null); setWin(null); setPuffs([]); setBurn(null); setGust(null);
      dropOut(cellsRef.current, Math.min(260, Math.max(120, stops[0]! - dropMs)));
      // Balloons of the previous board (base balloons never carry into free spins) float away upwards.
      const gone = balloonsRef.current.filter(b => onBoard(b.phase));
      const next = split(grid, new Map(), (_, col) => ({ mode: 'reel', delay: Math.max(0, stops[col]! - dropMs), dur: dropMs }), (_, col) => ({ phase: 'land', delay: Math.max(0, stops[col]! - dropMs), ms: dropMs }));
      setCells(next.cells);
      setBalloons([...gone.map(b => ({ ...b, row: b.row - 2.5, phase: 'exit' as BalloonPhase, ms: 520, delay: 0, plus: 0 })), ...next.balloons]);
      if (gone.length) after(560, () => setBalloons(list => list.filter(b => !(b.phase === 'exit' && gone.some(g => g.id === b.id)))));
      showReels(stops.map((stop, col) => ({ col, hideAt: Math.max(0, stop - dropMs * 0.6), tease: teaseFrom !== null && col >= teaseFrom })), 'spin');
    },
    respin(grid, { drops, delays, dropMs }) {
      setLit(null); setPath(null); setWin(null);
      const fresh = new Set(drops);
      const keep = new Map(balloonsRef.current.filter(b => onBoard(b.phase)).map(b => [b.id, b]));
      // Every non-balloon cell is dealt again: the old symbols blur away under the spinning strips.
      dropOut(cellsRef.current, 240);
      const next = split(grid, keep, (id, col) => (fresh.has(id) ? { mode: 'reel', delay: delays[col]!, dur: dropMs } : { mode: 'still', delay: 0, dur: 0 }), (_, col) => ({ phase: 'land', delay: delays[col]!, ms: dropMs }));
      setCells(next.cells);
      setBalloons(prev => [...prev.filter(b => b.phase === 'exit' || b.phase === 'moor' || b.phase === 'parked'), ...next.balloons]);
      const freshCols = new Set<number>();
      for (const c of next.cells) if (fresh.has(c.id)) freshCols.add(c.col);
      for (const b of next.balloons) if (b.phase === 'land') freshCols.add(b.col);
      showReels([...freshCols].sort((a, b) => a - b).map(col => ({ col, hideAt: delays[col]! + dropMs * 0.4, tease: false })), 'respin');
      after(Math.max(...delays) + dropMs, () => setPuffs([]));
    },
    burn(ms) {
      setLit(null); setPath(null); setWin(null);
      setBalloons(prev => prev.map(b => (b.phase === 'land' || b.phase === 'grow' || b.phase === 'rise' ? { ...b, phase: 'idle', ms: 0, delay: 0 } : b)));
      setBurn({ key: ++keySeq.current, ms });
    },
    wind(dir, ms) { setGust({ key: ++keySeq.current, dir, ms }); },
    move(moves, exits, ms, opts = {}) {
      const tickMs = opts.tickMs ?? Math.round(ms * 0.55);
      const to = new Map(moves.map(m => [m.id, m]));
      // Two (or more) balloons heading for one cell meet side by side; the merge then pulls them together.
      const byCell = new Map<string, number[]>();
      for (const m of moves) { const k = `${m.to[0]},${m.to[1]}`; byCell.set(k, [...(byCell.get(k) ?? []), m.id]); }
      const offsetOf = new Map<number, number>();
      for (const ids of byCell.values()) if (ids.length > 1) {
        const order = [...ids].sort((a, b) => (to.get(a)!.from[0] - to.get(b)!.from[0]) || a - b);
        order.forEach((id, i) => offsetOf.set(id, (i - (order.length - 1) / 2) * 2 * MEET_OFFSET));
      }
      // Symbols under a cell a balloon is drifting into give way (the respin deals them again anyway).
      const targets = new Set(moves.map(m => `${m.to[0]},${m.to[1]}`));
      const covered = cellsRef.current.filter(c => targets.has(`${c.col},${c.row}`));
      if (covered.length) { dropOut(covered, Math.round(ms * 0.5)); setCells(prev => prev.filter(c => !targets.has(`${c.col},${c.row}`))); }
      // The cells the balloons leave get a puff of burner smoke until the respin fills them.
      const vacated = [...moves.map(m => m.from), ...exits.map(e => e.from)].filter(([c, r]) => !targets.has(`${c},${r}`));
      if (vacated.length) { const base = ++keySeq.current * 100; setPuffs(prev => [...prev, ...vacated.map(([col, row], i) => ({ key: base + i, col, row }))]); }
      const out = new Map(exits.map(e => [e.id, e]));
      const moorTargets = opts.moorTargets;
      setBalloons(prev => prev.map(b => {
        const m = to.get(b.id);
        if (m) return { ...b, col: m.to[0], row: m.to[1], phase: 'rise', ms, delay: 0, ox: offsetOf.get(b.id) ?? 0, tilt: Math.sign(m.to[0] - m.from[0]), scale: 1 };
        const e = out.get(b.id);
        if (e) {
          const shift = moves.length ? Math.sign(moves[0]!.to[0] - moves[0]!.from[0]) : 0;
          if (e.moored) {
            const target = moorTargets?.get(e.id);
            return target
              ? { ...b, col: target.col, row: target.row, scale: target.scale, phase: 'moor', ms, delay: 0, ox: 0, tilt: 0 }
              : { ...b, row: -2.2, scale: 0.72, phase: 'moor', ms, delay: 0, ox: 0, tilt: 0 };
          }
          return { ...b, row: FLY_AWAY_ROW, col: b.col + shift * 0.8, scale: 0.62, phase: 'exit', ms: Math.round(ms * 1.25), delay: 0, ox: 0, tilt: shift };
        }
        return b;
      }));
      // The +1 tick lands when the burner has lifted the balloon most of the way.
      after(tickMs, () => setBalloons(prev => prev.map(b => {
        const m = to.get(b.id);
        if (m && b.phase === 'rise') return { ...b, multiplier: m.multiplierAfter, tick: b.tick + 1, plus: m.multiplierAfter - m.multiplierBefore };
        const e = out.get(b.id);
        if (e && (b.phase === 'moor' || b.phase === 'exit')) return { ...b, multiplier: e.multiplier, tick: b.tick + 1, plus: 1 };
        return b;
      })));
      after(ms, () => {
        setBurn(null);
        setBalloons(prev => prev.filter(b => !(b.phase === 'moor' && b.release)).map(b => (b.phase === 'rise' ? { ...b, phase: 'idle', tilt: 0, ms: 0 } : b.phase === 'moor' ? { ...b, phase: 'parked', ms: 0 } : b)));
      });
      if (exits.some(e => !e.moored)) after(Math.round(ms * 1.25) + 40, () => setBalloons(prev => prev.filter(b => !(b.phase === 'exit' && out.has(b.id)))));
    },
    merge(merges, ms) {
      const absorbed = new Map<number, number>();
      for (const m of merges) for (const id of m.absorbed) absorbed.set(id, m.id);
      const pull = Math.round(ms * 0.42);
      setBalloons(prev => {
        const partsOf = new Map(prev.map(b => [b.id, b.parts]));
        return prev.map(b => {
          const merge = merges.find(m => m.id === b.id);
          if (merge) return { ...b, ox: 0, ms: pull, delay: 0 };
          const into = absorbed.get(b.id);
          if (into !== undefined) return { ...b, ox: 0, phase: 'absorbed', ms: pull, delay: 0, parts: partsOf.get(b.id) ?? 1 };
          return b;
        });
      });
      // The parts meet: the survivor swells to its merged size, its badge ticks to the sum.
      after(pull, () => setBalloons(prev => {
        const partsOf = new Map(prev.map(b => [b.id, b.parts]));
        return prev.filter(b => !absorbed.has(b.id)).map(b => {
          const merge = merges.find(m => m.id === b.id);
          if (!merge) return b;
          return { ...b, multiplier: merge.multiplier, parts: b.parts + merge.absorbed.reduce((n, id) => n + (partsOf.get(id) ?? 1), 0), phase: 'grow', ms: ms - pull, delay: 0, tick: b.tick + 1, plus: merge.multiplier - (merge.parts[0] ?? merge.multiplier) };
        });
      }));
      after(ms, () => setBalloons(prev => prev.map(b => (b.phase === 'grow' ? { ...b, phase: 'idle', ms: 0 } : b))));
    },
    releaseParked(ids) {
      const set = ids ? new Set(ids) : null;
      const hit = (b: BoardBalloon) => !set || set.has(b.id);
      // a balloon still finishing its flight (the sky event can land a frame before the transition ends) completes it
      // and is dropped on arrival instead of parking
      setBalloons(prev => prev.filter(b => !(b.phase === 'parked' && hit(b))).map(b => (b.phase === 'moor' && hit(b) ? { ...b, release: true } : b)));
    },
    highlight(ids, pathIds) {
      setWin(null);
      setLit(ids ? new Set(ids) : null);
      tracePath(ids && pathIds?.length ? pathIds : null);
    },
    showWins(lines, { ms, burst, fx }) {
      const all = [...new Set(lines.flatMap(l => l.cells))];
      setLit(new Set(all));
      const best = lines.reduce<GoremeWinShowLine | null>((m, l) => (!m || l.amountCents > m.amountCents ? l : m), null);
      tracePath(best?.cells ?? null);
      setWin({ key: ++keySeq.current, lines, focus: null, burst, fx, ms });
    },
    focusWin(index, ms) {
      const show = winRef.current, line = show?.lines[index];
      if (!show || !line) return;
      setLit(new Set(line.cells));
      tracePath(line.cells);
      setWin({ ...show, key: ++keySeq.current, focus: index, ms });
    },
    setGrid(grid) {
      clearTimers();
      setLit(null); setPath(null); setWin(null); setReels(null); setLeaving([]); setPuffs([]); setBurn(null); setGust(null);
      const prev = new Map(balloonsRef.current.filter(b => onBoard(b.phase)).map(b => [b.id, b]));
      const next = split(grid, prev, () => ({ mode: 'still', delay: 0, dur: 0 }), () => ({ phase: 'idle', delay: 0, ms: 0 }));
      setCells(next.cells);
      setBalloons(next.balloons.map(b => ({ ...b, phase: 'idle', ms: 0, plus: 0 })));
    },
    dim(on) { setDimmed(on); },
    partsOf(id) { return balloonsRef.current.find(b => b.id === id)?.parts ?? 1; },
  }), [after, clearTimers, dropOut, showReels, tracePath]);

  const stateOf = (id: number): GoremeSymbolState => (lit ? (lit.has(id) ? 'win' : 'dim') : 'idle');
  const spots = useMemo(() => {
    if (!win) return null;
    const map = new Map<number, GoremeWinSpot>();
    for (const c of cells) map.set(c.id, { id: c.id, col: c.col, row: c.row });
    for (const b of balloons) if (onBoard(b.phase)) map.set(b.id, { id: b.id, col: b.col, row: b.row });
    return map;
  }, [win, cells, balloons]);
  const bursting = !!win && win.burst && win.fx && win.focus === null;
  return (
    <div ref={root} className={styles.board} role="group" aria-label={label} data-mood={mood} data-dim={dimmed || undefined} data-lit={lit ? '' : undefined}
      data-burst={bursting || undefined} style={win ? ({ '--win-ms': `${win.ms}ms` } as CSSProperties) : undefined}>
      <div className={styles.cells}>
        {reels && (
          <div key={reels.key} className={styles.reels} data-kind={reels.kind} aria-hidden="true">
            {reels.cols.map(({ col, hideAt, tease }) => (
              <div key={col} className={styles.reel} data-tease={tease || undefined} style={{ '--c': col, '--stop': `${hideAt}ms` } as CSSProperties}>
                <div className={styles.strip}>
                  {[...STRIP, ...STRIP].map((s, i) => <div key={i} className={styles.stripCell}><GoremeSymbol sprite symbol={s} label={null} /></div>)}
                </div>
              </div>
            ))}
          </div>
        )}
        {leaving.map(l => (
          <div key={l.key} className={styles.cell} data-leaving="" style={{ '--c': l.col, '--r': l.row, '--dur': `${l.dur}ms` } as CSSProperties} aria-hidden="true">
            <GoremeSymbol sprite symbol={l.symbol} label={null} />
          </div>
        ))}
        {puffs.map(p => <div key={p.key} className={styles.puff} style={{ '--c': p.col, '--r': p.row } as CSSProperties} aria-hidden="true" data-testid="goreme-puff"><span /><span /><span /></div>)}
        {cells.map(c => (
          <div key={c.id} className={styles.cell} data-mode={c.mode} data-sym={c.symbol} data-win={lit?.has(c.id) || undefined}
            style={{ '--c': c.col, '--r': c.row, '--delay': `${c.delay + (c.mode === 'reel' ? (GOREME_ROWS - 1 - c.row) * 14 : 0)}ms`, '--dur': `${c.dur}ms` } as CSSProperties}>
            <div className={styles.fx}><GoremeSymbol sprite symbol={c.symbol} state={stateOf(c.id)} label={cellLabel(c.symbol, c.col, c.row, 0)} /></div>
          </div>
        ))}
        {gust && (
          <div key={gust.key} className={styles.gust} data-dir={gust.dir} style={{ '--ms': `${gust.ms}ms` } as CSSProperties} aria-hidden="true" data-testid="goreme-gust">
            {[0, 1, 2, 3, 4, 5].map(i => <span key={i} style={{ '--i': i } as CSSProperties} />)}
          </div>
        )}
      </div>
      {win && spots && <GoremeWinFx show={win} spots={spots} />}
      {path && (
        <div key={path.key} className={styles.path} aria-hidden="true" data-testid="goreme-ways-path" style={{ '--len': path.counts.length } as CSSProperties}>
          <span className={styles.pathLine} />
          {path.counts.map((n, col) => <span key={col} className={styles.pathChip} style={{ '--c': col } as CSSProperties}>{n}</span>)}
        </div>
      )}
      <div className={styles.sky} data-burn={burn ? '' : undefined} style={burn ? ({ '--burn': `${burn.ms}ms` } as CSSProperties) : undefined}>
        {balloons.map(b => (
          <div key={b.id} className={styles.balloon} data-phase={b.phase} data-balloon-id={b.id} data-mult={b.multiplier} data-sym={onBoard(b.phase) ? 'balloon' : undefined}
            style={{ '--c': b.col, '--r': b.row, '--ox': b.ox, '--s': b.scale, '--tilt': b.tilt, '--ms': `${b.ms}ms`, '--delay': `${b.delay}ms` } as CSSProperties}>
            <div className={styles.balloonInner}>
              <div className={styles.lean}>
                {burn && onBoard(b.phase) && <span key={burn.key} className={styles.plume} aria-hidden="true" data-testid="goreme-burner"><i /></span>}
                <GoremeSymbol sprite symbol="balloon" multiplier={b.multiplier} size={goremeMergedSize(b.parts)} state={onBoard(b.phase) ? stateOf(b.id) : 'idle'}
                  label={onBoard(b.phase) ? cellLabel('balloon', b.col, b.row, b.multiplier) : null} />
              </div>
              {b.tick > 0 && b.plus > 0 && <span key={b.tick} className={styles.plus} aria-hidden="true" data-testid="goreme-plus">+{b.plus}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
