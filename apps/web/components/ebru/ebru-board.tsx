'use client';
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { EBRU_COLS, EBRU_ROWS, type EbruColour, type EbruGrid, type EbruStains, type EbruSymbol } from '@sollish/protocol';
import type { EbruPlacedCell } from '@/lib/ebru-timeline';
import { EbruStainUse, EbruSymbolUse } from './symbols';
import { useEbruSymbolNames } from './use-symbol-names';
import { combRowTiming } from './water';
import styles from './ebru-board.module.css';

/* The 7×7 Ebru board, drawn inside the frame's water well above the EbruWater canvas. Two render modes:
     still  – every cell is absolutely positioned by an outer transform (col/row in cell units) and keyed by
              `${round}:${cellId}`, so a survivor keeps its element while it falls. The stain badges are a separate
              layer of board positions (falls do not move stains; the engine says so).
     comb   – for one comb pass the board renders each row as a strip holding three copies of the row (columns
              −7…13) with its stain badges, inside a clipped row band. Each strip slides translateX(shift·100/7 %)
              with combRowTiming() — the same curve the water shear and the comb sweep sound use — so symbols and the
              stain field re-arrange in sync, and the cyclic wrap is seamless. At comb-end the shifted engine grid is
              committed synchronously (flushSync) and the animations are cancelled: no frame shows a gap.
   Only transform/opacity animate (WAAPI). Pure presentation: every symbol, position and stain comes from the engine. */

export type EbruCellView = { key: string; id: number; symbol: EbruSymbol; col: number; row: number; leaving?: boolean };
type Stains = number[][];

export interface EbruBoardHandle {
  clear(ids: number[] | null, dur: number, reduced: boolean): void;
  deal(prefix: string, cells: EbruPlacedCell[], stains: EbruStains | null, reduced: boolean): void;
  /** Bleed: the drop and its neighbours take the colour. */
  recolour(dropId: number, colour: EbruColour, ids: number[], reduced: boolean): void;
  highlight(ids: number[], dur: number, reduced: boolean): void;
  /** Stained cells under winning clusters flare. */
  stainHit(cells: { col: number; row: number }[], dur: number, reduced: boolean): void;
  dissolve(ids: number[], dur: number, reduced: boolean): void;
  setStains(stains: EbruStains | null, changed: { col: number; row: number }[], reduced: boolean): void;
  fall(prefix: string, cells: EbruPlacedCell[], removed: number[], reduced: boolean): void;
  comb(shifts: readonly number[], dur: number, reduced: boolean): void;
  combEnd(grid: EbruGrid, stains: EbruStains | null): void;
  tease(ids: number[]): void;
  flare(ids: number[], dur: number, reduced: boolean): void;
  dim(on: boolean): void;
  /** The symbol box of a cell id (effect positions). */
  symbolOf(id: number): HTMLElement | null;
}

/* Deterministic idle board (same on server and client); negative ids never clash with a round. */
const IDLE: EbruSymbol[] = [
  'c3', 'c5', 'c1', 'c7', 'c2', 'c6', 'c4',
  'c6', 'c2', 'c4', 'comb', 'c5', 'c3', 'c1',
  'c1', 'c7', 'c5', 'c3', 'c6', 'drop', 'c2',
  'c4', 'c3', 'c2', 'c1', 'c4', 'c7', 'c5',
  'c5', 'drop', 'c6', 'c4', 'c3', 'c2', 'c6',
  'c2', 'c1', 'c3', 'c6', 'c7', 'c5', 'c4',
  'c7', 'c4', 'c5', 'c2', 'comb', 'c1', 'c3',
];
/** Row-major list above → views with col/row. */
export const EBRU_IDLE_CELLS: EbruCellView[] = IDLE.map((symbol, i) => ({ key: `idle:${i}`, id: -1 - i, symbol, col: i % 7, row: Math.floor(i / 7) }));

type CellEls = { cell: HTMLDivElement; inner: HTMLDivElement; glow: HTMLDivElement; sym: HTMLDivElement };
const Cell = memo(function Cell({ view, tease, register }: { view: EbruCellView; tease: boolean; register: (key: string, els: CellEls | null) => void }) {
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) { register(view.key, null); return; }
    register(view.key, { cell: node, inner: node.firstElementChild as HTMLDivElement, glow: node.querySelector(`.${styles.glow}`) as HTMLDivElement, sym: node.querySelector(`.${styles.sym}`) as HTMLDivElement });
  }, [register, view.key]);
  return (
    <div ref={attach} className={styles.cell} style={{ transform: `translate3d(${view.col * 100}%, ${view.row * 100}%, 0)` }} data-sym={view.symbol} data-tease={tease || undefined}>
      <div className={styles.inner}>
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.sym}><EbruSymbolUse symbol={view.symbol} /></div>
      </div>
    </div>
  );
});

/** Ink drop fall: accelerates, lands with a soft squash (a drop meeting water), small rebound. */
function fallFrames(dy: number, reduced: boolean, fresh: boolean): Keyframe[] {
  if (reduced) {
    return fresh
      ? [{ transform: 'translate3d(0, -12%, 0)', opacity: 0 }, { transform: 'translate3d(0, 0, 0)', opacity: 1 }]
      : [{ transform: `translate3d(0, ${dy}%, 0)` }, { transform: 'translate3d(0, 0, 0)' }];
  }
  const k = Math.min(1, Math.abs(dy) / 260);
  return [
    { offset: 0, transform: `translate3d(0, ${dy.toFixed(1)}%, 0) scale(.9, 1.1)`, opacity: fresh ? 0.2 : 1, easing: 'cubic-bezier(.5,0,.9,.55)' },
    { offset: 0.72, transform: `translate3d(0, 0, 0) scale(${(1 + 0.12 * k).toFixed(3)}, ${(1 - 0.12 * k).toFixed(3)})`, opacity: 1, easing: 'cubic-bezier(.2,.8,.35,1)' },
    { offset: 0.88, transform: `translate3d(0, ${(-2.5 * k).toFixed(1)}%, 0) scale(.98, 1.02)`, easing: 'cubic-bezier(.5,0,.75,.45)' },
    { offset: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)', opacity: 1 },
  ];
}

const emptyStains = (): Stains => Array.from({ length: EBRU_COLS }, () => new Array<number>(EBRU_ROWS).fill(0));
const rowsOf = (cells: EbruCellView[]) => Array.from({ length: EBRU_ROWS }, (_, row) => cells.filter(c => c.row === row && !c.leaving).sort((a, b) => a.col - b.col));

export function EbruBoard({ ref, label }: { ref?: Ref<EbruBoardHandle>; label: string }) {
  const names = useEbruSymbolNames();
  const [cells, setCells] = useState<EbruCellView[]>(EBRU_IDLE_CELLS);
  const [stains, setStainsState] = useState<Stains | null>(null);
  const [combShifts, setCombShifts] = useState<number[] | null>(null);
  const [teased, setTeased] = useState<ReadonlySet<number>>(() => new Set());
  const els = useRef(new Map<string, CellEls>());
  const stainEls = useRef(new Map<number, HTMLDivElement>());
  const strips = useRef<Array<HTMLDivElement | null>>([]);
  const combAnims = useRef<Animation[]>([]);
  const pending = useRef<Array<() => void>>([]);
  const prefix = useRef('idle');
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const boardRef = useRef<HTMLDivElement>(null);
  const register = useCallback((key: string, value: CellEls | null) => { if (value) els.current.set(key, value); else els.current.delete(key); }, []);
  useLayoutEffect(() => {
    if (!pending.current.length) return;
    const run = pending.current; pending.current = [];
    for (const job of run) job();
  });
  const byId = (id: number) => els.current.get(`${prefix.current}:${id}`) ?? els.current.get(`idle:${-1 - id}`);
  const animateEntries = (placed: EbruPlacedCell[], reduced: boolean) => {
    pending.current.push(() => {
      for (const cell of placed) {
        if (cell.dur <= 0) continue;
        const target = els.current.get(`${prefix.current}:${cell.id}`);
        if (!target) continue;
        target.inner.animate(fallFrames((cell.fromRow - cell.row) * 100, reduced, cell.fromRow < 0), { duration: cell.dur, delay: cell.delay, fill: 'backwards' });
      }
    });
  };
  const toView = (key: string, c: { id: number; symbol: EbruSymbol; col: number; row: number }): EbruCellView => ({ key, id: c.id, symbol: c.symbol, col: c.col, row: c.row });
  const resetCell = (target: CellEls) => { for (const attr of ['data-win', 'data-flare', 'data-gone']) target.cell.removeAttribute(attr); };
  const stopComb = () => { for (const a of combAnims.current) a.cancel(); combAnims.current = []; };

  useImperativeHandle(ref, () => ({
    clear(ids, dur, reduced) {
      boardRef.current?.removeAttribute('data-focus');
      setTeased(new Set());
      const wanted = ids ? new Set(ids.map(id => `${prefix.current}:${id}`)) : null;
      const leaving = cellsRef.current.filter(c => !c.leaving && (!wanted || wanted.has(c.key) || c.key.startsWith('idle:')));
      if (!leaving.length) return;
      const keys = new Set(leaving.map(c => c.key));
      let remaining = leaving.length;
      const done = () => { if (--remaining === 0) setCells(prev => prev.filter(c => !keys.has(c.key))); };
      for (const c of leaving) {
        const target = els.current.get(c.key);
        if (!target) { done(); continue; }
        resetCell(target);
        const delay = reduced ? 0 : (c.col + (EBRU_ROWS - 1 - c.row) * 0.5) * 22;
        const length = Math.max(60, dur - (reduced ? 0 : 140));
        const frames: Keyframe[] = reduced
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, easing: 'cubic-bezier(.5,0,.9,.5)' }, { transform: 'translate3d(0, 14%, 0) scale(.55)', opacity: 0 }];
        target.inner.animate(frames, { duration: length, delay, fill: 'forwards' }).finished.then(done, done);
      }
      setCells(prev => prev.map(c => (keys.has(c.key) ? { ...c, leaving: true } : c)));
    },
    deal(nextPrefix, placed, field, reduced) {
      prefix.current = nextPrefix;
      if (field) setStainsState(field.map(column => column.slice()));
      setCells(prev => [...prev.filter(c => c.leaving), ...placed.map(c => toView(`${nextPrefix}:${c.id}`, c))]);
      animateEntries(placed, reduced);
    },
    recolour(dropId, colour, ids, reduced) {
      const changed = new Set([dropId, ...ids].map(id => `${prefix.current}:${id}`));
      setCells(prev => prev.map(c => (changed.has(c.key) && !c.leaving ? { ...c, symbol: colour } : c)));
      pending.current.push(() => {
        let i = 0;
        for (const key of changed) {
          const target = els.current.get(key);
          if (!target) continue;
          const first = i++ === 0;
          target.sym.animate(reduced
            ? [{ opacity: 0.4 }, { opacity: 1 }]
            : [{ transform: 'scale(.55)', opacity: 0.35 }, { transform: `scale(${first ? 1.18 : 1.1})`, opacity: 1, offset: 0.55 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: reduced ? 200 : 460, delay: first ? 0 : 40 * i, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'backwards' });
          target.glow.animate([{ opacity: 0.9, transform: 'scale(.7)' }, { opacity: 0, transform: 'scale(1.4)' }], { duration: 520, easing: 'ease-out' });
        }
      });
    },
    highlight(ids, dur, reduced) {
      boardRef.current?.setAttribute('data-focus', '');
      for (const id of ids) {
        const target = byId(id); if (!target) continue;
        target.cell.setAttribute('data-win', '');
        target.glow.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.05)', offset: 0.35 }, { opacity: 0.75, transform: 'scale(.95)', offset: 0.7 }, { opacity: 1, transform: 'scale(1.06)' }],
          { duration: dur, fill: 'forwards', easing: 'ease-out' });
        if (!reduced) target.sym.animate([
          { transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.3 }, { transform: 'scale(1.06)', offset: 0.6 }, { transform: 'scale(1.12)' },
        ], { duration: dur, fill: 'forwards', easing: 'ease-in-out' });
      }
    },
    stainHit(list, dur, reduced) {
      for (const { col, row } of list) {
        const el = stainEls.current.get(col * EBRU_ROWS + row); if (!el) continue;
        el.setAttribute('data-hit', '');
        if (!reduced) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.55)', offset: 0.3 }, { transform: 'scale(1.3)', offset: 0.7 }, { transform: 'scale(1.4)' }], { duration: dur, fill: 'forwards', easing: 'cubic-bezier(.2,1.2,.4,1)' });
      }
    },
    dissolve(ids, dur, reduced) {
      for (const id of ids) {
        const target = byId(id); if (!target) continue;
        target.cell.setAttribute('data-gone', '');
        target.sym.animate(reduced
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ transform: 'scale(1.12)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0.9, offset: 0.25 }, { transform: 'scale(.35) rotate(-14deg)', opacity: 0, offset: 0.78 }, { transform: 'scale(.3)', opacity: 0 }],
        { duration: dur, fill: 'forwards', easing: 'cubic-bezier(.45,0,.8,.6)' });
        target.glow.animate([{ opacity: 1, transform: 'scale(1.06)' }, { opacity: 0, transform: 'scale(1.7)' }], { duration: dur, fill: 'forwards' });
      }
      for (const el of stainEls.current.values()) { el.removeAttribute('data-hit'); el.getAnimations().forEach(a => a.cancel()); }
    },
    setStains(field, changed, reduced) {
      setStainsState(field ? field.map(column => column.slice()) : null);
      if (!field || reduced) return;
      pending.current.push(() => {
        changed.forEach(({ col, row }, i) => {
          const el = stainEls.current.get(col * EBRU_ROWS + row);
          el?.animate([{ transform: 'scale(.2) rotate(-30deg)', opacity: 0 }, { transform: 'scale(1.35) rotate(6deg)', opacity: 1, offset: 0.6 }, { transform: 'scale(1) rotate(0)', opacity: 1 }],
            { duration: 420, delay: Math.min(260, i * 16), easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'backwards' });
        });
      });
    },
    fall(nextPrefix, placed, removed, reduced) {
      prefix.current = nextPrefix;
      boardRef.current?.removeAttribute('data-focus');
      const gone = new Set(removed.map(id => `${nextPrefix}:${id}`));
      const next = new Map(placed.map(c => [`${nextPrefix}:${c.id}`, c]));
      setCells(prev => {
        const kept = prev.filter(c => c.leaving || (!gone.has(c.key) && next.has(c.key))).map(c => {
          const p = next.get(c.key);
          return p && !c.leaving ? { ...c, col: p.col, row: p.row, symbol: p.symbol } : c;
        });
        const known = new Set(kept.map(c => c.key));
        return [...kept, ...placed.filter(c => !known.has(`${nextPrefix}:${c.id}`)).map(c => toView(`${nextPrefix}:${c.id}`, c))];
      });
      animateEntries(placed, reduced);
    },
    comb(shifts, dur, reduced) {
      stopComb();
      boardRef.current?.removeAttribute('data-focus');
      flushSync(() => setCombShifts([...shifts]));
      shifts.forEach((s, r) => {
        const el = strips.current[r];
        if (!el || !s) return;
        const t = combRowTiming(r, dur);
        const to = `translate3d(${(s * 100) / EBRU_COLS}%, 0, 0)`;
        combAnims.current.push(el.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: to }],
          reduced ? { duration: Math.max(1, Math.round(dur * 0.5)), easing: 'ease-in-out', fill: 'forwards' } : { delay: t.delay, duration: t.duration, easing: t.easing, fill: 'forwards' }));
      });
    },
    combEnd(grid, field) {
      flushSync(() => {
        const views: EbruCellView[] = [];
        for (let col = 0; col < EBRU_COLS; col++) for (let row = 0; row < EBRU_ROWS; row++) { const cell = grid[col]![row]!; views.push(toView(`${prefix.current}:${cell.id}`, { ...cell, col, row })); }
        setCells(views);
        if (field) setStainsState(field.map(column => column.slice()));
        setCombShifts(null);
      });
      stopComb();
    },
    tease(ids) { setTeased(new Set(ids)); },
    flare(ids, dur, reduced) {
      for (const id of ids) {
        const target = byId(id); if (!target) continue;
        target.cell.setAttribute('data-flare', '');
        if (!reduced) target.sym.animate([
          { transform: 'scale(1)' }, { transform: 'scale(1.4) rotate(-10deg)', offset: 0.25 }, { transform: 'scale(1.25) rotate(8deg)', offset: 0.5 },
          { transform: 'scale(1.34) rotate(-3deg)', offset: 0.75 }, { transform: 'scale(1)' },
        ], { duration: dur, easing: 'ease-in-out' });
        target.glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.85, offset: 0.8 }, { opacity: 0 }], { duration: dur });
      }
    },
    dim(on) { boardRef.current?.toggleAttribute('data-dim', on); if (!on) for (const target of els.current.values()) target.cell.removeAttribute('data-flare'); },
    symbolOf(id) { return byId(id)?.sym ?? null; },
  }));

  const rows = rowsOf(cells);
  const field = stains ?? emptyStains();
  const stainAt = (col: number, row: number) => field[col]?.[row] ?? 0;
  const registerStain = (key: number) => (node: HTMLDivElement | null) => { if (node) stainEls.current.set(key, node); else stainEls.current.delete(key); };

  // Screen readers get a plain 7×7 grid derived from the same state; the animated layers are hidden.
  return (
    <>
      <div role="grid" aria-label={label} aria-rowcount={EBRU_ROWS} aria-colcount={EBRU_COLS} className="sr-only">
        {rows.map((cellsInRow, row) => (
          <div key={row} role="row" aria-rowindex={row + 1}>
            {cellsInRow.map(c => <span key={c.key} role="gridcell" aria-colindex={c.col + 1}>{names.cell({ symbol: c.symbol, stain: stainAt(c.col, c.row) || undefined })}</span>)}
          </div>
        ))}
      </div>
      <div ref={boardRef} className={styles.board} data-board="" data-combing={combShifts ? '' : undefined} aria-hidden="true">
        {combShifts ? (
          <div className={styles.combLayer} data-cells="">
            {rows.map((cellsInRow, row) => (
              <div key={row} className={styles.band} style={{ top: `${(row * 100) / EBRU_ROWS}%` }}>
                <div ref={node => { strips.current[row] = node; }} className={styles.strip}>
                  {[-1, 0, 1].flatMap(copy => cellsInRow.map(c => {
                    const v = stainAt(c.col, row);
                    return (
                      <div key={`${copy}:${c.key}`} className={styles.stripCell} style={{ left: `${((c.col + EBRU_COLS * copy) * 100) / EBRU_COLS}%` }} data-sym={c.symbol}>
                        <div className={styles.sym}><EbruSymbolUse symbol={c.symbol} /></div>
                        {v > 0 && <div className={styles.badge}><EbruStainUse value={v} /></div>}
                      </div>
                    );
                  }))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className={styles.cells} data-cells="">
              {cells.map(view => <Cell key={view.key} view={view} tease={teased.has(view.id) && !view.leaving} register={register} />)}
              <div className={styles.dimmer} />
            </div>
            <div className={styles.stains}>
              {field.flatMap((column, col) => column.map((v, row) => (v > 0 ? (
                <div key={`${col}:${row}`} ref={registerStain(col * EBRU_ROWS + row)} className={styles.stainSlot} style={{ transform: `translate3d(${col * 100}%, ${row * 100}%, 0)` }}>
                  <div className={styles.badge} data-value={v}><EbruStainUse value={v} /></div>
                </div>
              ) : null)))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
