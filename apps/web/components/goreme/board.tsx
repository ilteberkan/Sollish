'use client';
/**
 * Göreme board: the 6 × 5 reel window's contents. Imperative (the game drives it from timeline events) but rendered by
 * React: non-balloon cells are absolutely placed by (col, row) and keyed by their engine cell id, so a fresh id mounts
 * and plays its own drop-in; balloons live on an overlay layer keyed by their STABLE engine id, so a lift is a CSS
 * transform transition from the old cell to the new one (rise + wind drift), a merge shrinks the absorbed balloon into
 * the survivor, and an exit leaves through the top (fly away, or up into the sky band). Every length comes from the
 * timeline event (stops, dropMs, ms), so the board ends exactly when the timeline moves on. Only transform / opacity
 * animate. Presentation only: the board never decides anything, it re-draws engine grids.
 */
import { memo, useCallback, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import { GOREME_REELS, GOREME_ROWS, type GoremeExit, type GoremeGrid, type GoremeLiftMove, type GoremeMerge, type GoremeSymbol as EngineSymbol } from '@sollish/protocol';
import { GoremeSymbol, goremeMergedSize, type GoremeSymbolState } from './symbols';
import styles from './board.module.css';

export interface GoremeBoardHandle {
  readonly element: HTMLDivElement | null;
  /** Whole fresh board: the old symbols drop out, reel c stops `stops[c]` ms from now. */
  spin(grid: GoremeGrid, opts: { stops: number[]; dropMs: number; teaseFrom: number | null }): void;
  /** Respin: balloons stay, every other cell drops in fresh (`drops` are the fresh ids), column c after `delays[c]` ms. */
  respin(grid: GoremeGrid, opts: { drops: number[]; delays: number[]; dropMs: number }): void;
  /** Burner flare: balloons bounce on their flames. */
  burn(): void;
  /** Rise + wind drift (`ms` long); exits leave through the top (moored: towards the sky band). */
  move(moves: readonly GoremeLiftMove[], exits: readonly GoremeExit[], ms: number): void;
  merge(merges: readonly GoremeMerge[], ms: number): void;
  /** Cells (by id) that glow; every other cell dims. null clears. */
  highlight(ids: readonly number[] | null): void;
  /** Places a grid at once without animation (idle board, end of round, recovery). */
  setGrid(grid: GoremeGrid): void;
  dim(on: boolean): void;
}

type CellMode = 'still' | 'reel' | 'drop';
interface BoardCell { id: number; symbol: Exclude<EngineSymbol, 'balloon'>; col: number; row: number; mode: CellMode; delay: number; dur: number }
interface Leaving { id: number; symbol: Exclude<EngineSymbol, 'balloon'>; col: number; row: number; key: string; dur: number }
type BalloonPhase = 'idle' | 'land' | 'grow' | 'exit' | 'moor' | 'absorbed';
interface BoardBalloon { id: number; col: number; row: number; multiplier: number; parts: number; phase: BalloonPhase; ms: number; delay: number }

const onBoard = (p: BalloonPhase) => p === 'idle' || p === 'land' || p === 'grow';
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

function split(grid: GoremeGrid, prev: ReadonlyMap<number, BoardBalloon>, mode: (id: number, col: number) => { mode: CellMode; delay: number; dur: number }, landBalloon: (id: number, col: number) => { phase: BalloonPhase; delay: number; ms: number }) {
  const cells: BoardCell[] = [], balloons: BoardBalloon[] = [];
  for (let col = 0; col < GOREME_REELS; col++) for (let row = 0; row < GOREME_ROWS; row++) {
    const cell = grid[col]![row]!;
    if (cell.symbol === 'balloon') {
      const old = prev.get(cell.id);
      const land = old ? { phase: 'idle' as BalloonPhase, delay: 0, ms: 0 } : landBalloon(cell.id, col);
      balloons.push({ id: cell.id, col, row, multiplier: cell.multiplier, parts: old?.parts ?? 1, ...land });
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
  const [reels, setReels] = useState<{ key: number; stops: number[]; dropMs: number; teaseFrom: number | null } | null>(null);
  const [burnKey, setBurnKey] = useState(0);
  const [dimmed, setDimmed] = useState(false);
  const cellsRef = useRef(cells); cellsRef.current = cells;
  const balloonsRef = useRef(balloons); balloonsRef.current = balloons;
  const timers = useRef(new Set<number>());
  const leaveKey = useRef(0);
  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, Math.max(0, ms));
    timers.current.add(id);
  }, []);

  const dropOut = useCallback((list: readonly BoardCell[], dur: number) => {
    if (!list.length) return;
    const key = ++leaveKey.current;
    setLeaving(prev => [...prev, ...list.map(c => ({ id: c.id, symbol: c.symbol, col: c.col, row: c.row, key: `${key}:${c.id}`, dur }))]);
    after(dur + 40, () => setLeaving(prev => prev.filter(l => !l.key.startsWith(`${key}:`))));
  }, [after]);

  useImperativeHandle(ref, () => ({
    get element() { return root.current; },
    spin(grid, { stops, dropMs, teaseFrom }) {
      setLit(null);
      dropOut(cellsRef.current, Math.min(260, Math.max(120, stops[0]! - dropMs)));
      const gone = balloonsRef.current;
      const prev = new Map<number, BoardBalloon>();
      const next = split(grid, prev, (_, col) => ({ mode: 'reel', delay: Math.max(0, stops[col]! - dropMs), dur: dropMs }), (_, col) => ({ phase: 'land', delay: Math.max(0, stops[col]! - dropMs), ms: dropMs }));
      setCells(next.cells);
      // Balloons of the previous board (base balloons never carry into free spins) drift away upwards.
      setBalloons([...gone.map(b => ({ ...b, row: -1.8, phase: 'exit' as BalloonPhase, ms: 420, delay: 0 })), ...next.balloons]);
      if (gone.length) after(460, () => setBalloons(list => list.filter(b => !gone.some(g => g.id === b.id && b.phase === 'exit'))));
      setReels({ key: Date.now(), stops, dropMs, teaseFrom });
      after(stops[stops.length - 1]! + 40, () => setReels(null));
    },
    respin(grid, { drops, delays, dropMs }) {
      setLit(null);
      const fresh = new Set(drops);
      const keep = new Map(balloonsRef.current.filter(b => b.phase !== 'exit' && b.phase !== 'moor' && b.phase !== 'absorbed').map(b => [b.id, b]));
      dropOut(cellsRef.current, Math.min(240, dropMs));
      const next = split(grid, keep, (id, col) => (fresh.has(id) ? { mode: 'drop', delay: delays[col]!, dur: dropMs } : { mode: 'still', delay: 0, dur: 0 }), (_, col) => ({ phase: 'land', delay: delays[col]!, ms: dropMs }));
      setCells(next.cells);
      setBalloons(prev => [...prev.filter(b => b.phase === 'exit' || b.phase === 'moor'), ...next.balloons]);
    },
    burn() { setLit(null); setBalloons(prev => prev.map(b => (b.phase === 'land' || b.phase === 'grow' ? { ...b, phase: 'idle', ms: 0, delay: 0 } : b))); setBurnKey(k => k + 1); },
    move(moves, exits, ms) {
      const to = new Map(moves.map(m => [m.id, m]));
      // Symbols under a cell a balloon is drifting into give way (the respin deals them again anyway).
      const targets = new Set(moves.map(m => `${m.to[0]},${m.to[1]}`));
      const covered = cellsRef.current.filter(c => targets.has(`${c.col},${c.row}`));
      if (covered.length) { dropOut(covered, Math.round(ms * 0.6)); setCells(prev => prev.filter(c => !targets.has(`${c.col},${c.row}`))); }
      const out = new Map(exits.map(e => [e.id, e]));
      setBalloons(prev => prev.map(b => {
        const m = to.get(b.id);
        if (m) return { ...b, col: m.to[0], row: m.to[1], multiplier: m.multiplierAfter, phase: 'idle', ms, delay: 0 };
        const e = out.get(b.id);
        if (e) return { ...b, row: e.moored ? -2.2 : -1.9, col: b.col, multiplier: e.multiplier, phase: e.moored ? 'moor' : 'exit', ms, delay: 0 };
        return b;
      }));
      if (exits.length) after(ms + 30, () => setBalloons(prev => prev.filter(b => !out.has(b.id))));
    },
    merge(merges, ms) {
      const absorbed = new Map<number, number>();
      for (const m of merges) for (const id of m.absorbed) absorbed.set(id, m.id);
      setBalloons(prev => {
        const partsOf = new Map(prev.map(b => [b.id, b.parts]));
        return prev.map(b => {
          const merge = merges.find(m => m.id === b.id);
          if (merge) return { ...b, multiplier: merge.multiplier, parts: b.parts + merge.absorbed.reduce((n, id) => n + (partsOf.get(id) ?? 1), 0), phase: 'grow', ms, delay: 0 };
          if (absorbed.has(b.id)) return { ...b, phase: 'absorbed', ms: Math.round(ms * 0.6), delay: 0 };
          return b;
        });
      });
      after(Math.round(ms * 0.6) + 30, () => setBalloons(prev => prev.filter(b => !absorbed.has(b.id))));
    },
    highlight(ids) { setLit(ids ? new Set(ids) : null); },
    setGrid(grid) {
      setLit(null); setReels(null); setLeaving([]);
      const prev = new Map(balloonsRef.current.map(b => [b.id, b]));
      const next = split(grid, prev, () => ({ mode: 'still', delay: 0, dur: 0 }), () => ({ phase: 'idle', delay: 0, ms: 0 }));
      setCells(next.cells);
      setBalloons(next.balloons.map(b => ({ ...b, phase: 'idle', ms: 0 })));
    },
    dim(on) { setDimmed(on); },
  }), [after, dropOut]);

  const stateOf = (id: number): GoremeSymbolState => (lit ? (lit.has(id) ? 'win' : 'dim') : 'idle');
  return (
    <div ref={root} className={styles.board} role="group" aria-label={label} data-mood={mood} data-dim={dimmed || undefined} data-lit={lit ? '' : undefined}>
      {reels && (
        <div key={reels.key} className={styles.reels} aria-hidden="true">
          {reels.stops.map((stop, col) => (
            <div key={col} className={styles.reel} data-tease={reels.teaseFrom !== null && col >= reels.teaseFrom ? '' : undefined}
              style={{ '--c': col, '--stop': `${Math.max(0, stop - reels.dropMs * 0.6)}ms` } as CSSProperties}>
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
      {cells.map(c => (
        <div key={c.id} className={styles.cell} data-mode={c.mode} data-sym={c.symbol}
          style={{ '--c': c.col, '--r': c.row, '--delay': `${c.delay + (c.mode === 'reel' ? (GOREME_ROWS - 1 - c.row) * 14 : 0)}ms`, '--dur': `${c.dur}ms` } as CSSProperties}>
          <GoremeSymbol sprite symbol={c.symbol} state={stateOf(c.id)} label={cellLabel(c.symbol, c.col, c.row, 0)} />
        </div>
      ))}
      <div className={styles.sky} key={`burn-${burnKey}`} data-burn={burnKey > 0 || undefined}>
        {balloons.map(b => (
          <div key={b.id} className={styles.balloon} data-phase={b.phase} data-sym={onBoard(b.phase) ? 'balloon' : undefined}
            style={{ '--c': b.col, '--r': b.row, '--ms': `${b.ms}ms`, '--delay': `${b.delay}ms` } as CSSProperties}>
            <div className={styles.balloonInner}>
              <GoremeSymbol sprite symbol="balloon" multiplier={b.multiplier} size={goremeMergedSize(b.parts)} state={onBoard(b.phase) ? stateOf(b.id) : 'idle'}
                label={onBoard(b.phase) ? cellLabel('balloon', b.col, b.row, b.multiplier) : null} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
