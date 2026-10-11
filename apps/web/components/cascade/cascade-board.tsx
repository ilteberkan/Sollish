'use client';
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { CASCADE_CRYSTAL_WEIGHTS } from '@sollish/protocol';
import type { PlacedCell } from '@/lib/cascade-timeline';
import { SYMBOL_LABELS, SymbolArt, type CascadeArtSymbol } from './symbols';
import styles from './cascade-game.module.css';

/* The 6x5 board. Cells are absolutely positioned by an outer transform (col/row in cell units) and
   keyed by `${round}:${cellId}`, so a surviving cell keeps its element while it falls. Every motion
   runs on inner elements through WAAPI, transform/opacity only. Pure presentation. */

export type CellView = { key: string; id: number; symbol: CascadeArtSymbol; multiplier?: number; col: number; row: number; leaving?: boolean };

export interface BoardHandle {
  clear(ids: number[] | null, dur: number, reduced: boolean): void;
  drop(prefix: string, cells: PlacedCell[], reduced: boolean): void;
  tumble(prefix: string, cells: PlacedCell[], removed: number[], reduced: boolean): void;
  highlight(ids: number[], dur: number, reduced: boolean): void;
  pop(ids: number[], dur: number, reduced: boolean): void;
  tease(ids: number[]): void;
  flare(ids: number[], dur: number, reduced: boolean): void;
  dim(on: boolean): void;
  spend(id: number): void;
  /** The cell's symbol box (for effects positions and crystal clones). */
  symbolOf(id: number): HTMLElement | null;
  showFinal(prefix: string, cells: PlacedCell[]): void;
}

const IDLE_LAYOUT: CascadeArtSymbol[] = [
  'cherry', 'lemon', 'kiwi', 'blueberry', 'gumdrop',
  'crown', 'donut', 'strawberry', 'gumdrop', 'cherry',
  'strawberry', 'star', 'cupcake', 'lemon', 'kiwi',
  'blueberry', 'cupcake', 'crown', 'cherry', 'donut',
  'kiwi', 'gumdrop', 'lemon', 'strawberry', 'cupcake',
  'donut', 'cherry', 'blueberry', 'crown', 'lemon',
];
/** Deterministic idle board (same on server and client), negative ids never clash with a round. */
export const IDLE_CELLS: CellView[] = IDLE_LAYOUT.map((symbol, i) => ({ key: `idle:${i}`, id: -1 - i, symbol, col: Math.floor(i / 5), row: i % 5 }));

export function cellLabel(cell: { symbol: CascadeArtSymbol; multiplier?: number }) {
  return cell.symbol === 'crystal' && cell.multiplier ? `${SYMBOL_LABELS.crystal} ${cell.multiplier}×` : SYMBOL_LABELS[cell.symbol];
}

/* Every symbol is drawn once into a hidden sprite; cells reference it with <use>, so a falling cell
   mounts two nodes instead of a ~60-node SVG tree (cheap tumbles, small DOM, same art). */
const PLAIN: CascadeArtSymbol[] = ['crown', 'cupcake', 'donut', 'gumdrop', 'strawberry', 'blueberry', 'kiwi', 'lemon', 'cherry', 'star'];
const CRYSTAL_VALUES = new Set(CASCADE_CRYSTAL_WEIGHTS.map(([value]) => value));
const spriteId = (symbol: CascadeArtSymbol, multiplier?: number) => (symbol === 'crystal' ? `ccs-crystal-${multiplier}` : `ccs-${symbol}`);
export const SymbolSprites = memo(function SymbolSprites() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        {PLAIN.map(symbol => <symbol key={symbol} id={spriteId(symbol)} viewBox="0 0 100 100" overflow="visible"><SymbolArt symbol={symbol} size={100} /></symbol>)}
        {[...CRYSTAL_VALUES].map(value => <symbol key={value} id={spriteId('crystal', value)} viewBox="0 0 100 100" overflow="visible"><SymbolArt symbol="crystal" multiplier={value} size={100} /></symbol>)}
      </defs>
    </svg>
  );
});
function CellArt({ symbol, multiplier }: { symbol: CascadeArtSymbol; multiplier?: number }) {
  if (symbol === 'crystal' && (multiplier === undefined || !CRYSTAL_VALUES.has(multiplier))) return <SymbolArt symbol={symbol} multiplier={multiplier} />;
  return <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}><use href={`#${spriteId(symbol, multiplier)}`} /></svg>;
}

type CellEls = { cell: HTMLDivElement; inner: HTMLDivElement; glow: HTMLDivElement; sym: HTMLDivElement };
const Cell = memo(function Cell({ view, register }: { view: CellView; register: (key: string, els: CellEls | null) => void }) {
  const cellRef = useRef<HTMLDivElement>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    cellRef.current = node;
    if (!node) { register(view.key, null); return; }
    register(view.key, { cell: node, inner: node.firstElementChild as HTMLDivElement, glow: node.querySelector(`.${styles.glow}`) as HTMLDivElement, sym: node.querySelector(`.${styles.sym}`) as HTMLDivElement });
  }, [register, view.key]);
  const style = { transform: `translate3d(${view.col * 100}%, ${view.row * 100}%, 0)` };
  return (
    <div ref={attach} className={styles.cell} style={style} data-sym={view.symbol}>
      <div className={styles.inner}>
        <div className={styles.aura} aria-hidden="true" />
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.sym}><CellArt symbol={view.symbol} multiplier={view.multiplier} /></div>
        {view.symbol === 'crystal' && <span className={styles.glint} aria-hidden="true" />}
      </div>
    </div>
  );
});

function fallFrames(dy: number, reduced: boolean, fresh: boolean): Keyframe[] {
  if (reduced) {
    return fresh
      ? [{ transform: 'translate3d(0, -14%, 0)', opacity: 0 }, { transform: 'translate3d(0, 0, 0)', opacity: 1 }]
      : [{ transform: `translate3d(0, ${dy}%, 0)` }, { transform: 'translate3d(0, 0, 0)' }];
  }
  const k = Math.min(1, Math.abs(dy) / 260);
  const sx = 1 + 0.16 * k, sy = 1 - 0.19 * k;
  return [
    { offset: 0, transform: `translate3d(0, ${dy.toFixed(1)}%, 0) scale(.93, 1.09)`, easing: 'cubic-bezier(.52,0,.9,.52)' },
    { offset: 0.68, transform: `translate3d(0, 0, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`, easing: 'cubic-bezier(.2,.75,.35,1)' },
    { offset: 0.84, transform: `translate3d(0, ${(-7 * k).toFixed(1)}%, 0) scale(.97, 1.04)`, easing: 'cubic-bezier(.5,0,.75,.45)' },
    { offset: 0.93, transform: `translate3d(0, 0, 0) scale(${(1 + 0.04 * k).toFixed(3)}, ${(1 - 0.04 * k).toFixed(3)})` },
    { offset: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)' },
  ];
}

export function CascadeBoard({ ref, label, free }: { ref?: Ref<BoardHandle>; label: string; free: boolean }) {
  const [cells, setCells] = useState<CellView[]>(IDLE_CELLS);
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
  const animateEntries = (placed: PlacedCell[], reduced: boolean) => {
    pending.current.push(() => {
      for (const cell of placed) {
        if (cell.dur <= 0) continue;
        const target = els.current.get(`${prefix.current}:${cell.id}`);
        if (!target) continue;
        const fresh = cell.fromRow < 0;
        target.inner.animate(fallFrames((cell.fromRow - cell.row) * 100, reduced, fresh), { duration: cell.dur, delay: cell.delay, fill: 'backwards' });
        if (cell.symbol === 'crystal' && !reduced) {
          target.sym.animate([{ transform: 'rotate(-300deg) scale(.7)' }, { transform: 'rotate(0deg) scale(1)', offset: 0.7 }, { transform: 'rotate(0deg) scale(1)' }],
            { duration: cell.dur, delay: cell.delay, fill: 'backwards', easing: 'cubic-bezier(.3,.6,.4,1)' });
        }
      }
    });
  };
  const toView = (key: string, c: PlacedCell): CellView => ({ key, id: c.id, symbol: c.symbol, multiplier: c.multiplier, col: c.col, row: c.row });

  useImperativeHandle(ref, () => ({
    clear(ids, dur, reduced) {
      const boardEl = boardRef.current; boardEl?.removeAttribute('data-focus');
      const wanted = ids ? new Set(ids.map(id => `${prefix.current}:${id}`)) : null;
      const leaving = cellsRef.current.filter(c => !c.leaving && (!wanted || wanted.has(c.key)));
      if (!leaving.length) return;
      const keys = new Set(leaving.map(c => c.key));
      let remaining = leaving.length;
      const done = () => { if (--remaining === 0) setCells(prev => prev.filter(c => !keys.has(c.key))); };
      for (const c of leaving) {
        const target = els.current.get(c.key);
        if (!target) { done(); continue; }
        target.cell.removeAttribute('data-tease'); target.cell.removeAttribute('data-win'); target.cell.removeAttribute('data-flare'); target.cell.removeAttribute('data-spent');
        const delay = reduced ? 0 : c.col * 30;
        const length = Math.max(60, dur - (reduced ? 0 : 150));
        const frames: Keyframe[] = reduced
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ transform: 'translate3d(0, 0, 0) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(.55,0,.95,.5)' },
            { transform: `translate3d(0, ${(5.6 - c.row) * 100}%, 0) rotate(${(c.id % 2 ? 1 : -1) * (6 + (c.id % 5) * 3)}deg)`, opacity: 0.2 }];
        const anim = target.inner.animate(frames, { duration: length, delay, fill: 'forwards' });
        anim.finished.then(done, done);
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
        target.glow.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.35 }, { opacity: 0.7, transform: 'scale(.94)', offset: 0.7 }, { opacity: 1, transform: 'scale(1.08)' }],
          { duration: dur, fill: 'forwards', easing: 'ease-out' });
        if (!reduced) {
          target.sym.animate([
            { transform: 'rotate(0deg) scale(1)' }, { transform: 'rotate(-8deg) scale(1.1)', offset: 0.22 }, { transform: 'rotate(7deg) scale(1.13)', offset: 0.46 },
            { transform: 'rotate(-5deg) scale(1.12)', offset: 0.7 }, { transform: 'rotate(0deg) scale(1.1)' },
          ], { duration: dur, fill: 'forwards', easing: 'ease-in-out' });
        }
      }
    },
    pop(ids, dur, reduced) {
      for (const id of ids) {
        const target = byId(id); if (!target) continue;
        target.sym.animate(reduced
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ transform: 'rotate(0deg) scale(1.1)', opacity: 1 }, { transform: 'rotate(0deg) scale(1.34)', opacity: 1, offset: 0.32 }, { transform: 'rotate(12deg) scale(.2)', opacity: 0 }],
        { duration: dur, fill: 'forwards', easing: 'cubic-bezier(.4,0,.8,.6)' });
        target.glow.animate([{ opacity: 1, transform: 'scale(1.08)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: dur, fill: 'forwards' });
      }
    },
    tease(ids) { for (const id of ids) byId(id)?.cell.setAttribute('data-tease', ''); },
    flare(ids, dur, reduced) {
      for (const id of ids) {
        const target = byId(id); if (!target) continue;
        target.cell.setAttribute('data-flare', '');
        if (!reduced) target.sym.animate([
          { transform: 'scale(1) rotate(0deg)' }, { transform: 'scale(1.5) rotate(-14deg)', offset: 0.25 }, { transform: 'scale(1.28) rotate(10deg)', offset: 0.5 },
          { transform: 'scale(1.42) rotate(-4deg)', offset: 0.75 }, { transform: 'scale(1) rotate(0deg)' },
        ], { duration: dur, easing: 'ease-in-out' });
        target.glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.85, offset: 0.8 }, { opacity: 0 }], { duration: dur });
      }
    },
    dim(on) { boardRef.current?.toggleAttribute('data-dim', on); if (!on) for (const target of els.current.values()) target.cell.removeAttribute('data-flare'); },
    spend(id) { byId(id)?.cell.setAttribute('data-spent', ''); },
    symbolOf(id) { return byId(id)?.sym ?? null; },
    showFinal(nextPrefix, placed) {
      prefix.current = nextPrefix;
      for (const target of els.current.values()) {
        for (const anim of target.inner.getAnimations()) anim.cancel();
        for (const anim of target.sym.getAnimations()) anim.cancel();
        for (const anim of target.glow.getAnimations()) anim.cancel();
        for (const attr of ['data-win', 'data-flare', 'data-spent']) target.cell.removeAttribute(attr);
      }
      boardRef.current?.removeAttribute('data-focus'); boardRef.current?.removeAttribute('data-dim');
      setCells(placed.map(c => toView(`${nextPrefix}:${c.id}`, c)));
    },
  }));

  // Screen readers get a plain 6x5 grid derived from the same state; the animated layer is hidden.
  const live = cells.filter(c => !c.leaving);
  const rows = Array.from({ length: 5 }, (_, row) => live.filter(c => c.row === row).sort((a, b) => a.col - b.col));
  return (
    <>
      <SymbolSprites />
      <div role="grid" aria-label={label} aria-rowcount={5} aria-colcount={6} className="sr-only">
        {rows.map((cellsInRow, row) => (
          <div key={row} role="row" aria-rowindex={row + 1}>
            {cellsInRow.map(c => <span key={c.key} role="gridcell" aria-colindex={c.col + 1}>{cellLabel(c)}</span>)}
          </div>
        ))}
      </div>
      <div ref={boardRef} className={`${styles.board} ${free ? styles.boardFree : ''}`} data-board="" aria-hidden="true">
        <div className={styles.slots}>{Array.from({ length: 30 }, (_, i) => <span key={i} />)}</div>
        <div className={styles.cells} data-cells="">
          {cells.map(view => <Cell key={view.key} view={view} register={register} />)}
          <div className={styles.dimmer} />
        </div>
      </div>
    </>
  );
}
