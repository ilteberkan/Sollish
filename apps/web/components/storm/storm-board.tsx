'use client';
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { StormSymbol } from '@sollish/protocol';
import type { StormPlacedCell } from '@/lib/storm-timeline';
import { StormSymbolUse } from './symbols';
import { useStormSymbolNames } from './use-symbol-names';
import styles from './storm-board.module.css';

/* The 6×5 Tarhun board, drawn inside <StormFrame>. Cells are absolutely positioned by an outer transform
   (col/row in cell units) and keyed by `${round}:${cellId}`, so a surviving cell (orbs and scatters included)
   keeps its element while it falls. Each cell is two <use> nodes referencing the shared sprite sheet
   (<StormSymbolSprites/> mounted once by the page). Every motion is WAAPI on inner elements, transform/opacity
   only. Pure presentation. */

export type StormCellView = { key: string; id: number; symbol: StormSymbol; multiplier?: number; col: number; row: number; leaving?: boolean };

export interface StormBoardHandle {
  clear(ids: number[] | null, dur: number, reduced: boolean): void;
  drop(prefix: string, cells: StormPlacedCell[], reduced: boolean): void;
  tumble(prefix: string, cells: StormPlacedCell[], removed: number[], reduced: boolean): void;
  highlight(ids: number[], dur: number, reduced: boolean): void;
  shatter(ids: number[], dur: number, reduced: boolean): void;
  tease(ids: number[]): void;
  flare(ids: number[], dur: number, reduced: boolean): void;
  dim(on: boolean): void;
  /** Orbs about to be struck start to crackle. */
  charge(ids: number[]): void;
  /** Lightning hit: flash, then the orb leaves its cell (a clone flies to the meter). */
  hit(id: number, reduced: boolean): void;
  /** Orbs without a win dim out. */
  fizzle(ids: number[]): void;
  /** The cell's symbol box (effect positions, orb clones). */
  symbolOf(id: number): HTMLElement | null;
}

const IDLE_LAYOUT: Array<[StormSymbol, number?]> = [
  ['h1'], ['l4'], ['l2'], ['h3'], ['l1'],
  ['l3'], ['h2'], ['l5'], ['orb', 10], ['l2'],
  ['l1'], ['scatter'], ['h4'], ['l3'], ['l5'],
  ['h3'], ['l2'], ['l1'], ['h1'], ['l4'],
  ['l5'], ['h4'], ['l3'], ['l2'], ['h2'],
  ['l4'], ['l1'], ['orb', 3], ['l5'], ['h1'],
];
/** Deterministic idle board (same on server and client); negative ids never clash with a round. */
export const STORM_IDLE_CELLS: StormCellView[] = IDLE_LAYOUT.map(([symbol, multiplier], i) => ({ key: `idle:${i}`, id: -1 - i, symbol, multiplier, col: Math.floor(i / 5), row: i % 5 }));

type CellEls = { cell: HTMLDivElement; inner: HTMLDivElement; glow: HTMLDivElement; sym: HTMLDivElement };
const Cell = memo(function Cell({ view, register }: { view: StormCellView; register: (key: string, els: CellEls | null) => void }) {
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) { register(view.key, null); return; }
    register(view.key, { cell: node, inner: node.firstElementChild as HTMLDivElement, glow: node.querySelector(`.${styles.glow}`) as HTMLDivElement, sym: node.querySelector(`.${styles.sym}`) as HTMLDivElement });
  }, [register, view.key]);
  return (
    <div ref={attach} className={styles.cell} style={{ transform: `translate3d(${view.col * 100}%, ${view.row * 100}%, 0)` }} data-sym={view.symbol}>
      <div className={styles.inner}>
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.sym}><StormSymbolUse symbol={view.symbol} multiplier={view.multiplier} /></div>
      </div>
    </div>
  );
});

/** Heavy stone fall: accelerates, lands with a short squash and a small rebound. */
function fallFrames(dy: number, reduced: boolean, fresh: boolean): Keyframe[] {
  if (reduced) {
    return fresh
      ? [{ transform: 'translate3d(0, -14%, 0)', opacity: 0 }, { transform: 'translate3d(0, 0, 0)', opacity: 1 }]
      : [{ transform: `translate3d(0, ${dy}%, 0)` }, { transform: 'translate3d(0, 0, 0)' }];
  }
  const k = Math.min(1, Math.abs(dy) / 260);
  return [
    { offset: 0, transform: `translate3d(0, ${dy.toFixed(1)}%, 0) scale(.97, 1.04)`, easing: 'cubic-bezier(.55,0,.95,.55)' },
    { offset: 0.7, transform: `translate3d(0, 0, 0) scale(${(1 + 0.09 * k).toFixed(3)}, ${(1 - 0.1 * k).toFixed(3)})`, easing: 'cubic-bezier(.2,.75,.35,1)' },
    { offset: 0.86, transform: `translate3d(0, ${(-3.5 * k).toFixed(1)}%, 0) scale(.99, 1.01)`, easing: 'cubic-bezier(.5,0,.75,.45)' },
    { offset: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)' },
  ];
}

export function StormBoard({ ref, label }: { ref?: Ref<StormBoardHandle>; label: string }) {
  const names = useStormSymbolNames();
  const [cells, setCells] = useState<StormCellView[]>(STORM_IDLE_CELLS);
  const els = useRef(new Map<string, CellEls>());
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
  const animateEntries = (placed: StormPlacedCell[], reduced: boolean) => {
    pending.current.push(() => {
      for (const cell of placed) {
        if (cell.dur <= 0) continue;
        const target = els.current.get(`${prefix.current}:${cell.id}`);
        if (!target) continue;
        target.inner.animate(fallFrames((cell.fromRow - cell.row) * 100, reduced, cell.fromRow < 0), { duration: cell.dur, delay: cell.delay, fill: 'backwards' });
      }
    });
  };
  const toView = (key: string, c: StormPlacedCell): StormCellView => ({ key, id: c.id, symbol: c.symbol, multiplier: c.multiplier, col: c.col, row: c.row });
  const resetCell = (target: CellEls) => { for (const attr of ['data-tease', 'data-win', 'data-flare', 'data-spent', 'data-charge', 'data-fizzle']) target.cell.removeAttribute(attr); };

  useImperativeHandle(ref, () => ({
    clear(ids, dur, reduced) {
      boardRef.current?.removeAttribute('data-focus');
      const wanted = ids ? new Set(ids.map(id => `${prefix.current}:${id}`)) : null;
      const leaving = cellsRef.current.filter(c => !c.leaving && (!wanted || wanted.has(c.key)));
      if (!leaving.length) return;
      const keys = new Set(leaving.map(c => c.key));
      let remaining = leaving.length;
      const done = () => { if (--remaining === 0) setCells(prev => prev.filter(c => !keys.has(c.key))); };
      for (const c of leaving) {
        const target = els.current.get(c.key);
        if (!target) { done(); continue; }
        resetCell(target);
        const delay = reduced ? 0 : c.col * 30;
        const length = Math.max(60, dur - (reduced ? 0 : 150));
        const frames: Keyframe[] = reduced
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ transform: 'translate3d(0, 0, 0)', opacity: 1, easing: 'cubic-bezier(.6,0,1,.6)' }, { transform: `translate3d(0, ${(5.6 - c.row) * 100}%, 0)`, opacity: 0.25 }];
        target.inner.animate(frames, { duration: length, delay, fill: 'forwards' }).finished.then(done, done);
      }
      setCells(prev => prev.map(c => (keys.has(c.key) ? { ...c, leaving: true } : c)));
    },
    drop(nextPrefix, placed, reduced) {
      prefix.current = nextPrefix;
      setCells(prev => [...prev.filter(c => c.leaving), ...placed.map(c => toView(`${nextPrefix}:${c.id}`, c))]);
      animateEntries(placed, reduced);
    },
    tumble(nextPrefix, placed, removed, reduced) {
      prefix.current = nextPrefix;
      boardRef.current?.removeAttribute('data-focus');
      const gone = new Set(removed.map(id => `${nextPrefix}:${id}`));
      const next = new Map(placed.map(c => [`${nextPrefix}:${c.id}`, c]));
      setCells(prev => {
        const kept = prev.filter(c => c.leaving || (!gone.has(c.key) && next.has(c.key))).map(c => {
          const p = next.get(c.key);
          return p && !c.leaving ? { ...c, col: p.col, row: p.row } : c;
        });
        const known = new Set(kept.map(c => c.key));
        return [...kept, ...placed.filter(c => !known.has(`${nextPrefix}:${c.id}`)).map(c => toView(`${nextPrefix}:${c.id}`, c))];
      });
      animateEntries(placed, reduced);
    },
    highlight(ids, dur, reduced) {
      boardRef.current?.setAttribute('data-focus', '');
      for (const id of ids) {
        const target = byId(id); if (!target) continue;
        target.cell.setAttribute('data-win', '');
        target.glow.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.05)', offset: 0.35 }, { opacity: 0.75, transform: 'scale(.95)', offset: 0.7 }, { opacity: 1, transform: 'scale(1.06)' }],
          { duration: dur, fill: 'forwards', easing: 'ease-out' });
        if (!reduced) target.sym.animate([
          { transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.3 }, { transform: 'scale(1.06)', offset: 0.6 }, { transform: 'scale(1.12)' },
        ], { duration: dur, fill: 'forwards', easing: 'ease-in-out' });
      }
    },
    shatter(ids, dur, reduced) {
      for (const id of ids) {
        const target = byId(id); if (!target) continue;
        target.sym.animate(reduced
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ transform: 'scale(1.12)', opacity: 1 }, { transform: 'scale(1.22)', opacity: 1, offset: 0.2 }, { transform: 'scale(.72) rotate(6deg)', opacity: 0, offset: 0.62 }, { transform: 'scale(.6)', opacity: 0 }],
        { duration: dur, fill: 'forwards', easing: 'cubic-bezier(.4,0,.8,.6)' });
        target.glow.animate([{ opacity: 1, transform: 'scale(1.06)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: dur, fill: 'forwards' });
      }
    },
    tease(ids) { for (const id of ids) byId(id)?.cell.setAttribute('data-tease', ''); },
    flare(ids, dur, reduced) {
      for (const id of ids) {
        const target = byId(id); if (!target) continue;
        target.cell.setAttribute('data-flare', '');
        if (!reduced) target.sym.animate([
          { transform: 'scale(1)' }, { transform: 'scale(1.42) rotate(-8deg)', offset: 0.25 }, { transform: 'scale(1.28) rotate(6deg)', offset: 0.5 },
          { transform: 'scale(1.36) rotate(-3deg)', offset: 0.75 }, { transform: 'scale(1)' },
        ], { duration: dur, easing: 'ease-in-out' });
        target.glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.85, offset: 0.8 }, { opacity: 0 }], { duration: dur });
      }
    },
    dim(on) { boardRef.current?.toggleAttribute('data-dim', on); if (!on) for (const target of els.current.values()) target.cell.removeAttribute('data-flare'); },
    charge(ids) { for (const id of ids) byId(id)?.cell.setAttribute('data-charge', ''); },
    hit(id, reduced) {
      const target = byId(id); if (!target) return;
      target.cell.removeAttribute('data-charge');
      target.cell.setAttribute('data-spent', '');
      if (!reduced) target.glow.animate([{ opacity: 1, transform: 'scale(1.3)' }, { opacity: 0, transform: 'scale(1.8)' }], { duration: 420, easing: 'ease-out' });
    },
    fizzle(ids) { for (const id of ids) byId(id)?.cell.setAttribute('data-fizzle', ''); },
    symbolOf(id) { return byId(id)?.sym ?? null; },
  }));

  // Screen readers get a plain 6×5 grid derived from the same state; the animated layer is hidden.
  const live = cells.filter(c => !c.leaving);
  const rows = Array.from({ length: 5 }, (_, row) => live.filter(c => c.row === row).sort((a, b) => a.col - b.col));
  return (
    <>
      <div role="grid" aria-label={label} aria-rowcount={5} aria-colcount={6} className="sr-only">
        {rows.map((cellsInRow, row) => (
          <div key={row} role="row" aria-rowindex={row + 1}>
            {cellsInRow.map(c => <span key={c.key} role="gridcell" aria-colindex={c.col + 1}>{names.cell(c)}</span>)}
          </div>
        ))}
      </div>
      <div ref={boardRef} className={styles.board} data-board="" aria-hidden="true">
        <div className={styles.cells} data-cells="">
          {cells.map(view => <Cell key={view.key} view={view} register={register} />)}
          <div className={styles.dimmer} />
        </div>
      </div>
    </>
  );
}
