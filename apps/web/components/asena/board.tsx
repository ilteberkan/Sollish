'use client';

import { memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { flushSync } from 'react-dom';
import { ASENA_COLS, ASENA_ROWS, type AsenaFall, type AsenaGrid, type AsenaSymbol, type AsenaWolfWalk } from '@sollish/protocol';
import { AS_UNITS, type AsPos, type AsenaConstellationPlan } from './geometry';
import { ASENA_SYMBOL_GLOW, ASENA_SYMBOL_LABELS, AsenaSymbolUse } from './symbols';
import styles from './board.module.css';

/* Asena 6 × 6 star field, drawn inside the frame well (above the scene's sky canvas, under the FX canvas).

   Layers (back → front): night-glass plate with star sockets (static SVG) · 36 cells, each absolutely placed by an
   outer transform (col, row in cell units) and keyed by `${epoch}:${id}` so a survivor keeps its element while it
   falls and the wolf keeps its element while it walks · constellation layer (DOM star links that grow with
   scaleX along the plan from geometry.ts, plus node rings) · glass sheen.

   Presentation only: every symbol, id and position comes from the engine; the board never computes a result.
   Animation is WAAPI on transform / opacity; every promise resolves on a wall-clock timer, so a hidden tab or
   reduced motion cannot stall a round. Reduced motion: cells swap in place, links appear complete. */

export interface AsenaBoardCell { id: number; symbol: AsenaSymbol; col: number; row: number }
export interface AsenaBoardSpeed {
  /** 1 normal, 0.6 quick, 0.35 turbo (durations scale with it). */
  speed?: number;
}
export interface AsenaBoardHandle {
  /** The 6 × 6 field element (FX maps board units 600 × 600 onto its rect). */
  readonly element: HTMLDivElement | null;
  /** Instant board (no animation); also reconciles ids after a walk. */
  setGrid(grid: AsenaGrid): void;
  /** New spin: the old stars drop out, `grid` falls in column by column (bottom rows land first). */
  dropIn(grid: AsenaGrid, opts?: AsenaBoardSpeed & { onColumn?: (col: number) => void }): Promise<void>;
  /** Winning clusters glow in their symbol colour, the rest dims. Ids from AsenaCluster.cells. */
  highlight(clusters: ReadonlyArray<{ symbol: AsenaSymbol; cells: readonly number[] }>): void;
  clearHighlight(): void;
  /** Draws the constellation links of `plan` over its cells (timed like fx.constellation). Links stay until clearConstellations(). */
  constellation(plan: AsenaConstellationPlan, opts?: { onNode?: (index: number) => void }): Promise<void>;
  clearConstellations(): void;
  /** Cells of AsenaStep.burst explode (they stay invisible until fall()). */
  burst(ids: readonly number[], opts?: AsenaBoardSpeed): Promise<void>;
  /** AsenaStep.fall: survivors drop with gravity and a bounce, fresh stars fall in from above. */
  fall(fall: AsenaFall, opts?: AsenaBoardSpeed & { onLand?: (col: number) => void }): Promise<void>;
  /** One AsenaWolfWalk: the wolf hops from → to, the consumed symbol is swallowed, a star-trail wild appears on `from`. */
  wolfWalk(walk: AsenaWolfWalk, opts?: AsenaBoardSpeed): Promise<void>;
  /** Moon (Ay Ata) cells glow: 'tease' = 2 moons waiting for a third, 'land' = scatter hit. null clears. */
  moons(cells: readonly AsPos[] | null, mode?: 'tease' | 'land'): void;
  /** Darken the field (feature intro, big win). */
  dim(on: boolean): void;
  /** Current position of a cell id (null when not on the board). */
  positionOf(id: number): AsPos | null;
  /** The cell element of an id (for focus rings / effects). */
  cellElement(id: number): HTMLElement | null;
}
export interface AsenaBoardProps {
  initial?: AsenaGrid | null;
  /** 'feature' tints the glass for the Ergenekon free spins. */
  mood?: 'base' | 'feature';
  className?: string;
  style?: CSSProperties;
  ref?: Ref<AsenaBoardHandle>;
  label?: string;
}

type View = AsenaBoardCell & { key: string; leaving?: boolean };
type CellEls = { cell: HTMLDivElement; inner: HTMLDivElement; glow: HTMLDivElement; sym: HTMLDivElement };
interface Link { key: string; x: number; y: number; len: number; deg: number; delay: number; dur: number }
interface Node { key: string; x: number; y: number; delay: number; big: boolean }

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, Math.max(0, ms)));
const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pct = (u: number) => `${((u / AS_UNITS) * 100).toFixed(3)}%`;
/** Distance from a cell centre where a link starts, so lines run between the symbols instead of across them. */
const LINK_GAP = 31;

/* Deterministic idle board (same on server and client); negative ids never clash with a round. */
const IDLE: AsenaSymbol[] = [
  'l2', 'h3', 'l1', 'l4', 'h2', 'l3',
  'l4', 'l1', 'moon', 'h1', 'l2', 'l1',
  'h4', 'l3', 'l2', 'wolf', 'l4', 'h3',
  'l1', 'h2', 'l4', 'l3', 'h1', 'l2',
  'l3', 'l2', 'h4', 'l1', 'trail', 'l4',
  'h1', 'l4', 'l3', 'h2', 'l2', 'moon',
];
/** Row-major idle list → engine-shaped grid[col][row]. */
export const ASENA_IDLE_GRID: AsenaGrid = Array.from({ length: ASENA_COLS }, (_, col) => Array.from({ length: ASENA_ROWS }, (_, row) => ({ id: -1 - (row * ASENA_COLS + col), symbol: IDLE[row * ASENA_COLS + col]! })));

const viewsOf = (grid: AsenaGrid, epoch: number): View[] => {
  const out: View[] = [];
  for (let col = 0; col < ASENA_COLS; col++) for (let row = 0; row < ASENA_ROWS; row++) { const c = grid[col]![row]!; out.push({ key: `${epoch}:${c.id}`, id: c.id, symbol: c.symbol, col, row }); }
  return out;
};

const Cell = memo(function Cell({ view, register }: { view: View; register: (key: string, els: CellEls | null) => void }) {
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) { register(view.key, null); return; }
    register(view.key, { cell: node, inner: node.firstElementChild as HTMLDivElement, glow: node.querySelector(`.${styles.glow}`) as HTMLDivElement, sym: node.querySelector(`.${styles.sym}`) as HTMLDivElement });
  }, [register, view.key]);
  return (
    <div ref={attach} className={styles.cell} role="img" aria-label={`${ASENA_SYMBOL_LABELS[view.symbol]}, sütun ${view.col + 1}, satır ${view.row + 1}`}
      aria-hidden={view.leaving || undefined} data-sym={view.symbol} data-leaving={view.leaving || undefined}
      style={{ transform: `translate3d(${view.col * 100}%, ${view.row * 100}%, 0)`, '--glow': ASENA_SYMBOL_GLOW[view.symbol] } as CSSProperties}>
      <div className={styles.inner}>
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.sym}><AsenaSymbolUse symbol={view.symbol} /></div>
      </div>
    </div>
  );
});

/** Gravity fall: accelerates, lands with a squash, one small rebound. dy in % of a cell. */
function fallFrames(dy: number, reduced: boolean, fresh: boolean): Keyframe[] {
  if (reduced) return fresh ? [{ transform: 'translate3d(0, -10%, 0)', opacity: 0 }, { transform: 'translate3d(0, 0, 0)', opacity: 1 }] : [{ transform: `translate3d(0, ${dy}%, 0)` }, { transform: 'translate3d(0, 0, 0)' }];
  const k = Math.min(1, Math.abs(dy) / 300);
  return [
    { offset: 0, transform: `translate3d(0, ${dy.toFixed(1)}%, 0) scale(.94, 1.06)`, opacity: fresh ? 0.35 : 1, easing: 'cubic-bezier(.55,0,.95,.6)' },
    { offset: 0.7, transform: `translate3d(0, 0, 0) scale(${(1 + 0.14 * k).toFixed(3)}, ${(1 - 0.14 * k).toFixed(3)})`, opacity: 1, easing: 'cubic-bezier(.2,.8,.4,1)' },
    { offset: 0.86, transform: `translate3d(0, ${(-6 * k).toFixed(1)}%, 0) scale(.98, 1.03)`, easing: 'cubic-bezier(.5,0,.8,.5)' },
    { offset: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)', opacity: 1 },
  ];
}
const fallMs = (rows: number, speed: number) => (210 + 125 * Math.sqrt(Math.max(0.3, rows))) * speed;

const Plate = memo(function Plate() {
  const dots: string[] = [];
  for (let c = 1; c < ASENA_COLS; c++) for (let r = 1; r < ASENA_ROWS; r++) dots.push(`M${c * 100 - 1.6} ${r * 100}h3.2M${c * 100} ${r * 100 - 1.6}v3.2`);
  return (
    <svg className={styles.plate} viewBox="0 0 600 600" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="asbGlass" cx="300" cy="230" r="460" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1a2668" stopOpacity=".78" /><stop offset=".55" stopColor="#0b1140" stopOpacity=".8" /><stop offset="1" stopColor="#04061c" stopOpacity=".9" />
        </radialGradient>
        <radialGradient id="asbSock" cx=".5" cy=".42" r=".6"><stop offset="0" stopColor="#3a4ea8" stopOpacity=".34" /><stop offset="1" stopColor="#3a4ea8" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="600" height="600" fill="url(#asbGlass)" />
      {Array.from({ length: 36 }, (_, i) => { const c = i % 6, r = Math.floor(i / 6); return <rect key={i} x={c * 100 + 5} y={r * 100 + 5} width="90" height="90" rx="16" fill="url(#asbSock)" stroke="#8ea6ff" strokeOpacity=".09" strokeWidth="1.2" />; })}
      <path d={dots.join('')} stroke="#cfe0ff" strokeOpacity=".45" strokeWidth="1.1" />
    </svg>
  );
});

export function AsenaBoard({ initial, mood = 'base', className, style, ref, label = 'Asena yıldız alanı' }: AsenaBoardProps) {
  const epoch = useRef(0);
  const [cells, setCells] = useState<View[]>(() => viewsOf(initial ?? ASENA_IDLE_GRID, 0));
  const [links, setLinks] = useState<Link[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [linksLeaving, setLinksLeaving] = useState(false);
  const els = useRef(new Map<string, CellEls>());
  const linkEls = useRef(new Map<string, HTMLElement>());
  const nodeEls = useRef(new Map<string, HTMLElement>());
  const pending = useRef<Array<() => void>>([]);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const rootRef = useRef<HTMLDivElement>(null);
  const planSeq = useRef(0);
  const register = useCallback((key: string, value: CellEls | null) => { if (value) els.current.set(key, value); else els.current.delete(key); }, []);
  useLayoutEffect(() => {
    if (!pending.current.length) return;
    const run = pending.current; pending.current = [];
    for (const job of run) job();
  });
  const live = () => cellsRef.current.filter((c) => !c.leaving);
  const byId = (id: number) => { const v = live().find((c) => c.id === id); return v ? els.current.get(v.key) ?? null : null; };
  const resetCell = (t: CellEls) => { for (const a of ['data-win', 'data-star', 'data-moon', 'data-hop']) t.cell.removeAttribute(a); };

  useImperativeHandle(ref, () => ({
    get element() { return rootRef.current; },
    setGrid(grid) {
      const cur = new Map(live().map((c) => [c.id, c]));
      const sameEpoch = [...cur.keys()].length > 0 && grid.every((col) => col.every((c) => cur.has(c.id)));
      if (!sameEpoch) epoch.current++;
      const e = epoch.current;
      flushSync(() => setCells(viewsOf(grid, e).map((v) => ({ ...v, key: cur.get(v.id) && sameEpoch ? cur.get(v.id)!.key : v.key }))));
    },
    async dropIn(grid, opts = {}) {
      const speed = opts.speed ?? 1, reduced = prefersReduced();
      rootRef.current?.removeAttribute('data-focus');
      const old = live();
      epoch.current++;
      const e = epoch.current;
      const next = viewsOf(grid, e);
      const oldKeys = new Set(old.map((c) => c.key));
      flushSync(() => setCells([...old.map((c) => ({ ...c, leaving: true })), ...next]));
      // the old field falls out of the bottom
      let outMs = 0;
      for (const c of old) {
        const t = els.current.get(c.key);
        if (!t) continue;
        resetCell(t);
        const delay = reduced ? 0 : (c.col * 34 + (ASENA_ROWS - 1 - c.row) * 14) * speed;
        const dur = (reduced ? 120 : 300) * speed;
        t.inner.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'translate3d(0,0,0)', opacity: 1, easing: 'cubic-bezier(.55,0,1,.6)' }, { transform: `translate3d(0, ${(ASENA_ROWS - c.row + 0.6) * 100}%, 0)`, opacity: 0.2 }], { duration: dur, delay, fill: 'forwards' });
        outMs = Math.max(outMs, delay + dur);
      }
      // the new field falls in, bottom rows first, column by column
      const lead = reduced ? 60 : Math.min(outMs * 0.55, 260 * speed);
      let inMs = 0;
      for (const c of next) {
        const t = els.current.get(c.key);
        if (!t) continue;
        const delay = lead + (reduced ? 0 : (c.col * 52 + (ASENA_ROWS - 1 - c.row) * 30) * speed);
        const dur = reduced ? 160 : fallMs(ASENA_ROWS + 0.5, speed);
        t.inner.animate(fallFrames(-(ASENA_ROWS + 0.5) * 100, reduced, true), { duration: dur, delay, fill: 'backwards' });
        inMs = Math.max(inMs, delay + dur);
      }
      if (opts.onColumn) for (let col = 0; col < ASENA_COLS; col++) window.setTimeout(() => opts.onColumn?.(col), lead + (col * 52 + 0) * speed + (reduced ? 160 : fallMs(ASENA_ROWS + 0.5, speed)) * 0.7);
      window.setTimeout(() => setCells((prev) => prev.filter((c) => !oldKeys.has(c.key))), Math.max(outMs, 30) + 20);
      await wait(Math.max(outMs, inMs) + 20);
    },
    highlight(clusters) {
      rootRef.current?.setAttribute('data-focus', '');
      const reduced = prefersReduced();
      for (const cl of clusters) for (const id of cl.cells) {
        const t = byId(id);
        if (!t) continue;
        t.cell.setAttribute('data-win', '');
        t.cell.style.setProperty('--win', ASENA_SYMBOL_GLOW[cl.symbol]);
        if (!reduced) t.sym.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.35 }, { transform: 'scale(1.08)' }], { duration: 520, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'forwards' });
      }
    },
    clearHighlight() {
      rootRef.current?.removeAttribute('data-focus');
      for (const c of live()) { const t = els.current.get(c.key); if (!t) continue; t.cell.removeAttribute('data-win'); t.cell.removeAttribute('data-star'); t.sym.getAnimations().forEach((a) => a.cancel()); }
    },
    async constellation(plan, opts = {}) {
      const reduced = prefersReduced();
      const seq = ++planSeq.current;
      const newLinks: Link[] = plan.edges.map((e, i) => {
        const ax = e.a[0] * 100 + 50, ay = e.a[1] * 100 + 50, bx = e.b[0] * 100 + 50, by = e.b[1] * 100 + 50;
        const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
        return { key: `${seq}:${i}`, x: ax + ux * LINK_GAP, y: ay + uy * LINK_GAP, len: Math.max(4, L - LINK_GAP * 2), deg: (Math.atan2(uy, ux) * 180) / Math.PI, delay: e.start + (e.dur * LINK_GAP) / L, dur: e.dur * (1 - (2 * LINK_GAP) / L) };
      });
      const newNodes: Node[] = plan.nodes.map(([c, r], i) => ({ key: `${seq}:${i}`, x: c * 100 + 50, y: r * 100 + 50, delay: plan.nodeAt[i]!, big: i === plan.nodes.length - 1 }));
      flushSync(() => { setLinksLeaving(false); setLinks((l) => [...l, ...newLinks]); setNodes((n) => [...n, ...newNodes]); });
      rootRef.current?.setAttribute('data-echo', '');
      // mark the template cells
      const pos = new Set(plan.nodes.map(([c, r]) => `${c},${r}`));
      for (const v of live()) if (pos.has(`${v.col},${v.row}`)) els.current.get(v.key)?.cell.setAttribute('data-star', '');
      for (const l of newLinks) {
        const el = linkEls.current.get(l.key);
        el?.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: reduced ? 1 : Math.max(60, l.dur), delay: reduced ? 0 : l.delay, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'backwards' });
      }
      newNodes.forEach((n, i) => {
        const el = nodeEls.current.get(n.key);
        el?.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.35)', opacity: 1, offset: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: reduced ? 1 : 420, delay: reduced ? 0 : n.delay, easing: 'cubic-bezier(.2,1.2,.4,1)', fill: 'backwards' });
        if (opts.onNode) window.setTimeout(() => opts.onNode?.(i), reduced ? 0 : n.delay);
      });
      await wait(reduced ? 60 : plan.duration + 120);
    },
    clearConstellations() {
      if (!linkEls.current.size && !nodeEls.current.size) return;
      setLinksLeaving(true);
      rootRef.current?.removeAttribute('data-echo');
      window.setTimeout(() => { setLinks([]); setNodes([]); setLinksLeaving(false); }, prefersReduced() ? 0 : 260);
    },
    async burst(ids, opts = {}) {
      const speed = opts.speed ?? 1, reduced = prefersReduced();
      const dur = (reduced ? 140 : 460) * speed;
      ids.forEach((id, i) => {
        const t = byId(id);
        if (!t) return;
        t.cell.setAttribute('data-gone', '');
        const delay = reduced ? 0 : Math.min(160, i * 12) * speed;
        t.sym.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
          { transform: 'scale(1.1) rotate(0deg)', opacity: 1 },
          { transform: 'scale(1.32) rotate(-6deg)', opacity: 1, offset: 0.28 },
          { transform: 'scale(.2) rotate(28deg)', opacity: 0 },
        ], { duration: dur, delay, easing: 'cubic-bezier(.4,0,.8,.5)', fill: 'forwards' });
        t.glow.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.9)' }], { duration: dur, delay, fill: 'forwards' });
      });
      await wait(dur + Math.min(160, ids.length * 12) * speed + 10);
    },
    async fall(f, opts = {}) {
      const speed = opts.speed ?? 1, reduced = prefersReduced();
      rootRef.current?.removeAttribute('data-focus');
      const e = epoch.current;
      const prev = new Map(live().map((c) => [c.id, c]));
      const dropsPerCol = new Array<number>(ASENA_COLS).fill(0);
      for (const d of f.drops) dropsPerCol[d.col]!++;
      const next = viewsOf(f.grid, e);
      flushSync(() => setCells(next));
      let longest = 0;
      const landAt = new Array<number>(ASENA_COLS).fill(0);
      pending.current.push(() => undefined);
      for (const v of next) {
        const t = els.current.get(v.key);
        if (!t) continue;
        resetCell(t);
        t.cell.removeAttribute('data-gone');
        const was = prev.get(v.id);
        const fresh = !was;
        const rows = fresh ? dropsPerCol[v.col]! + 0.35 : v.row - was.row;
        if (rows <= 0 && !fresh) continue;
        const dur = reduced ? 160 : fallMs(rows, speed);
        const delay = reduced ? 0 : (v.col * 30 + (fresh ? 70 : 0) + (ASENA_ROWS - 1 - v.row) * 10) * speed;
        t.sym.getAnimations().forEach((a) => a.cancel());
        t.glow.getAnimations().forEach((a) => a.cancel());
        t.inner.animate(fallFrames(-rows * 100, reduced, fresh), { duration: dur, delay, fill: 'backwards' });
        longest = Math.max(longest, delay + dur);
        landAt[v.col] = Math.max(landAt[v.col]!, delay + dur * 0.7);
      }
      if (opts.onLand) landAt.forEach((ms, col) => { if (ms > 0) window.setTimeout(() => opts.onLand?.(col), ms); });
      await wait(longest + 20);
    },
    async wolfWalk(w, opts = {}) {
      const speed = opts.speed ?? 1, reduced = prefersReduced();
      const cur = live();
      const wolf = cur.find((c) => c.id === w.id);
      const eaten = cur.find((c) => c.id === w.consumed.id);
      if (!wolf) return;
      const e = epoch.current;
      const trailKey = `${e}:${w.trail.id}`;
      flushSync(() => setCells((prev) => [
        ...prev.map((c) => c.key === wolf.key ? { ...c, col: w.to[0], row: w.to[1] } : eaten && c.key === eaten.key ? { ...c, leaving: true } : c),
        { key: trailKey, id: w.trail.id, symbol: 'trail', col: w.trail.col, row: w.trail.row },
      ]));
      const dur = (reduced ? 160 : 640) * speed;
      const dx = (w.from[0] - w.to[0]) * 100, dy = (w.from[1] - w.to[1]) * 100;
      const we = els.current.get(wolf.key);
      if (we) {
        we.cell.setAttribute('data-hop', '');
        we.inner.animate(reduced ? [{ transform: `translate3d(${dx}%, ${dy}%, 0)` }, { transform: 'translate3d(0,0,0)' }] : [
          { offset: 0, transform: `translate3d(${dx}%, ${dy}%, 0) scale(1, 1)`, easing: 'cubic-bezier(.5,0,.7,.4)' },
          { offset: 0.12, transform: `translate3d(${dx}%, ${dy + 4}%, 0) scale(1.08, .9)`, easing: 'cubic-bezier(.3,.6,.5,1)' },
          { offset: 0.5, transform: `translate3d(${dx / 2}%, ${dy / 2 - 34}%, 0) scale(1.1, 1.1)`, easing: 'cubic-bezier(.5,0,.8,.5)' },
          { offset: 0.84, transform: 'translate3d(0, 0, 0) scale(1.12, .88)', easing: 'cubic-bezier(.2,.8,.4,1)' },
          { offset: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)' },
        ], { duration: dur, fill: 'backwards' });
        window.setTimeout(() => we.cell.removeAttribute('data-hop'), dur + 20);
      }
      if (eaten) {
        const t = els.current.get(eaten.key);
        t?.sym.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.5 }, { transform: 'scale(.1) rotate(-40deg)', opacity: 0 }], { duration: dur * 0.75, delay: dur * 0.25, fill: 'forwards' });
        window.setTimeout(() => setCells((prev) => prev.filter((c) => c.key !== eaten.key)), dur + 40);
      }
      const te = els.current.get(trailKey);
      te?.sym.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'scale(.1) rotate(-30deg)', opacity: 0 }, { transform: 'scale(1.3) rotate(6deg)', opacity: 1, offset: 0.55 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], { duration: dur * 0.7, delay: dur * 0.18, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'backwards' });
      await wait(dur + 30);
    },
    moons(list, mode = 'land') {
      const want = new Set((list ?? []).map(([c, r]) => `${c},${r}`));
      for (const v of live()) {
        const t = els.current.get(v.key);
        if (!t) continue;
        if (want.has(`${v.col},${v.row}`)) t.cell.setAttribute('data-moon', mode); else t.cell.removeAttribute('data-moon');
      }
    },
    dim(on) { if (on) rootRef.current?.setAttribute('data-dim', ''); else rootRef.current?.removeAttribute('data-dim'); },
    positionOf(id) { const v = live().find((c) => c.id === id); return v ? [v.col, v.row] as const : null; },
    cellElement(id) { return byId(id)?.cell ?? null; },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const linkLayer = useMemo(() => (
    <div className={styles.links} data-leaving={linksLeaving || undefined} aria-hidden="true">
      {links.map((l) => (
        <span key={l.key} className={styles.link} style={{ left: pct(l.x), top: pct(l.y), width: pct(l.len), transform: `rotate(${l.deg.toFixed(2)}deg)` }}>
          <span ref={(el) => { if (el) linkEls.current.set(l.key, el); else linkEls.current.delete(l.key); }} className={styles.linkBeam} />
        </span>
      ))}
      {nodes.map((n) => (
        <span key={n.key} className={styles.nodeWrap} style={{ left: pct(n.x), top: pct(n.y) }}>
          <span ref={(el) => { if (el) nodeEls.current.set(n.key, el); else nodeEls.current.delete(n.key); }} className={styles.node} data-big={n.big || undefined} />
        </span>
      ))}
    </div>
  ), [links, nodes, linksLeaving]);

  return (
    <div ref={rootRef} className={`${styles.board} ${className ?? ''}`} style={style} data-mood={mood} role="group" aria-label={label}>
      <Plate />
      <div className={styles.cells}>
        {cells.map((v) => <Cell key={v.key} view={v} register={register} />)}
      </div>
      {linkLayer}
      <div className={styles.sheen} aria-hidden="true" />
    </div>
  );
}
