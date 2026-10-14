'use client';

import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { flushSync } from 'react-dom';
import type { CezeriBoard as EngineBoard, CezeriPos, CezeriSymbol } from '@sollish/protocol';
import {
  CZ_BOUNDS, CZ_C, CZ_HUB_R, CZ_RIM_R, CZ_RINGS, CZ_SLICES, CZ_SLICE_DEG,
  annulusPath, cellStyle, czPct, cezeriSpinPlan, dividerPath, gearTeethPath, polar, ringBand, ringDirection, ringTeeth,
  sliceAngle, slicePath, symbolBox, wedgeStyle,
} from './geometry';
import { CEZERI_SYMBOL_LABELS, CZ_PALETTE as P, CezeriSymbolUse } from './symbols';
import styles from './board.module.css';

/* Cezeri board: hub + 4 concentric rings × 12 slices, drawn as composited HTML layers.

   Layers (back → front): back plate SVG (tooth channels) · 4 ring layers (each one <div> that rotates: an SVG
   with its enamel band, slice plates, brass dividers and gear teeth, plus 12 upright symbol cells that
   counter-rotate with the same keyframes) · held/pinned overlay (Dişli Kilidi clamps and falcon wilds: they
   never rotate, so a respin turns every ring underneath them) · win glow overlay · rim with the 12 spoke lamps
   (fixed, meshes with ring 3) · hub with its tooth ring and the odometer counter · fixed glass highlight.

   Presentation only: the board shows what it is told; it never computes a result. Animation is WAAPI on
   transform/opacity; every promise resolves on a wall-clock timer (a hidden tab or reduced motion cannot stall
   it). Reduced motion: rings swap without turning, counters jump, clamps appear. */

export type CezeriBoardSlices = CezeriSymbol[][];
export interface CezeriRingTarget { ring: number; slices: readonly CezeriSymbol[]; held?: readonly number[]; pinned?: readonly number[] }
export interface CezeriRotateOptions {
  /** 1 normal, 0.6 quick, 0.35 turbo. */
  speed?: number;
  /** Extra ms between ring stops (default 210 · speed). */
  stagger?: number;
  /** Called on every escapement tick of a settling ring (sound / sparks). */
  onTick?: (ring: number, tick: number, last: boolean) => void;
  /** Called when a ring has fully settled. */
  onRingStop?: (ring: number) => void;
}
export interface CezeriBoardHandle {
  /** The board square element (for the FX canvas). */
  readonly element: HTMLDivElement | null;
  /** Instant board (no animation). */
  setBoard(board: EngineBoard | CezeriBoardSlices): void;
  /** Spins every listed ring to its new slices (engine `rotate` step `rings`). Resolves when the last ring settled. */
  rotate(rings: readonly CezeriRingTarget[], opts?: CezeriRotateOptions): Promise<void>;
  /** Highlights winning cells (engine `win` step `cells`); `spoke` lights the rim lamp. Accumulates until clearWins(). */
  showWin(cells: readonly CezeriPos[], spoke?: number): void;
  clearWins(): void;
  /** Dişli Kilidi: clamps slam onto `newHeld` (engine `lock` step). Resolves after the slam (~380 ms). */
  lock(newHeld: readonly CezeriPos[]): Promise<void>;
  /** End of a chain: every clamp lifts away and the slices rejoin their rings. */
  release(): Promise<void>;
  /** Falcon wilds pinned to the window (engine `falcon.wilds`); `fresh` ones drop in with a flash. */
  setPinned(wilds: readonly CezeriPos[], fresh?: readonly CezeriPos[]): void;
  /** Hub counter. `respin` rolls one notch with the ratchet clank; other reasons roll to the value. */
  hub(value: number, reason?: 'spin' | 'respin' | 'set'): Promise<void>;
  /** A short mechanical jolt of all rings (lock / hub tick). */
  jolt(strength?: number): void;
  /** Vessel cells glow (scatter) until cleared. */
  showVessels(cells: readonly CezeriPos[] | null): void;
}
export interface CezeriBoardProps {
  initial: EngineBoard | CezeriBoardSlices;
  hubValue?: number;
  /** 'feature' tints the enamel for Fil Saati. */
  mood?: 'base' | 'feature';
  className?: string;
  style?: CSSProperties;
  ref?: Ref<CezeriBoardHandle>;
  /** Accessible name of the board region. */
  label?: string;
}

const key = (r: number, s: number) => r * CZ_SLICES + s;
const FILLERS: CezeriSymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l1', 'l2', 'l3', 'l4', 'gear', 'vessel'];
const filler = () => FILLERS[Math.floor(Math.random() * FILLERS.length)]!;
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, Math.max(0, ms)));
const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const r2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ static ring art */
const RING_TONES = [
  { a: '#13636a', b: '#083a40', c: '#021a1e', rim: P.turq.light, glow: '#5ff0e0' },
  { a: '#26389a', b: '#121c5c', c: '#060a2a', rim: P.lapis.light, glow: '#8aa4ff' },
  { a: '#13636a', b: '#083a40', c: '#021a1e', rim: P.turq.light, glow: '#5ff0e0' },
  { a: '#26389a', b: '#121c5c', c: '#060a2a', rim: P.lapis.light, glow: '#8aa4ff' },
] as const;

const RingArt = memo(function RingArt({ ring, uid }: { ring: number; uid: string }) {
  const b = ringBand(ring);
  const t = RING_TONES[ring]!;
  const teeth = ringTeeth(ring);
  const id = (n: string) => `${uid}r${ring}${n}`;
  const st = (r: number) => r2(r / 500);
  const plates = useMemo(() => Array.from({ length: CZ_SLICES }, (_, s) => slicePath(ring, s, 3.2)).join(''), [ring]);
  const inlays = useMemo(() => Array.from({ length: CZ_SLICES }, (_, s) => slicePath(ring, s, 9)).join(''), [ring]);
  // outer rings have spare tangential room: a brass rosette and two dots flank each symbol
  const orn = useMemo(() => {
    if (ring < 2) return [] as Array<readonly [number, number]>;
    const off = ring === 2 ? 12.4 : 11.2, rc = (b.inner + b.outer) / 2;
    const out: Array<readonly [number, number]> = [];
    for (let s = 0; s < CZ_SLICES; s++) for (const d of [-off, off]) { const p = polar(rc, sliceAngle(s) + d); out.push([r2(p.x), r2(p.y)]); }
    return out;
  }, [ring, b.inner, b.outer]);
  const sockets = useMemo(() => Array.from({ length: CZ_SLICES }, (_, s) => { const c = symbolBox(ring, s); return [r2(c.cx), r2(c.cy), r2(c.size * 0.5)] as const; }), [ring]);
  const rivets = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let s = 0; s < CZ_SLICES; s++) {
      const a = sliceAngle(s) + CZ_SLICE_DEG / 2;
      for (const r of [b.inner + 4, b.outer - 4]) { const p = polar(r, a); out.push([r2(p.x), r2(p.y)]); }
    }
    return out;
  }, [ring, b.inner, b.outer]);
  // motion streaks: concentric dashed arcs across the band (rotation-invariant, faded in while spinning)
  const streaks = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ r: r2(b.inner + 8 + (i * (b.outer - b.inner - 16)) / 6), dash: `${18 + (i % 3) * 14} ${10 + (i % 2) * 16}`, o: 0.18 + (i % 3) * 0.08 })), [b.inner, b.outer]);
  return (
    <svg className={styles.ringSvg} viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id('band')} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse">
          <stop offset={st(b.inner)} stopColor={t.c} />
          <stop offset={st(b.inner + 10)} stopColor={t.b} />
          <stop offset={st(b.mid)} stopColor={t.a} />
          <stop offset={st(b.outer - 10)} stopColor={t.b} />
          <stop offset={st(b.outer)} stopColor={t.c} />
        </radialGradient>
        <radialGradient id={id('plate')} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse">
          <stop offset={st(b.inner)} stopColor={t.b} />
          <stop offset={st(b.mid - 8)} stopColor={t.a} />
          <stop offset={st(b.mid + 14)} stopColor={t.a} />
          <stop offset={st(b.outer)} stopColor={t.c} />
        </radialGradient>
        <radialGradient id={id('socket')}>
          <stop offset="0" stopColor={t.glow} stopOpacity=".42" />
          <stop offset=".55" stopColor={t.glow} stopOpacity=".12" />
          <stop offset="1" stopColor={t.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('brass')} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse">
          <stop offset={st(b.inner - 8)} stopColor={P.brass.deep} />
          <stop offset={st(b.inner + 2)} stopColor={P.brass.light} />
          <stop offset={st(b.mid)} stopColor={P.brass.base} />
          <stop offset={st(b.outer - 2)} stopColor={P.brass.light} />
          <stop offset={st(b.outer + 8)} stopColor={P.brass.deep} />
        </radialGradient>
      </defs>
      <path d={annulusPath(b.inner - 1, b.outer + 1)} fill={`url(#${id('band')})`} fillRule="evenodd" />
      <path d={plates} fill={`url(#${id('plate')})`} stroke="#000" strokeOpacity=".55" strokeWidth="1.6" />
      {sockets.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={`url(#${id('socket')})`} />)}
      <path d={inlays} fill="none" stroke={P.brass.light} strokeOpacity=".38" strokeWidth="1.3" />
      {orn.map(([x, y], i) => (
        <g key={i} opacity=".7">
          <path d={`M${x} ${y - 8}Q${x + 1.6} ${y - 1.6} ${x + 8} ${y}Q${x + 1.6} ${y + 1.6} ${x} ${y + 8}Q${x - 1.6} ${y + 1.6} ${x - 8} ${y}Q${x - 1.6} ${y - 1.6} ${x} ${y - 8}Z`} fill={P.brass.light} />
          <circle cx={x} cy={y} r="2.2" fill={t.rim} />
        </g>
      ))}
      <path d={plates} fill="none" stroke={t.rim} strokeOpacity=".3" strokeWidth="1.2" transform="translate(500 500) scale(.994) translate(-500 -500)" />
      {/* brass dividers with rivets */}
      <path d={dividerPath(ring)} stroke="#140a02" strokeWidth="7" strokeLinecap="round" />
      <path d={dividerPath(ring)} stroke={`url(#${id('brass')})`} strokeWidth="4" strokeLinecap="round" />
      {rivets.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.4" fill={P.brass.hi} stroke="#2a1604" strokeWidth=".8" />)}
      {/* rims: brass lips with teeth that mesh with the neighbours */}
      <circle cx={CZ_C} cy={CZ_C} r={b.outer} fill="none" stroke="#140a02" strokeWidth="4.4" />
      <circle cx={CZ_C} cy={CZ_C} r={b.outer} fill="none" stroke={`url(#${id('brass')})`} strokeWidth="2.4" />
      <circle cx={CZ_C} cy={CZ_C} r={b.inner} fill="none" stroke="#140a02" strokeWidth="4.4" />
      <circle cx={CZ_C} cy={CZ_C} r={b.inner} fill="none" stroke={`url(#${id('brass')})`} strokeWidth="2.4" />
      <path d={teeth.outer} fill={P.brass.base} stroke="#1a0e03" strokeWidth="1.1" strokeLinejoin="round" />
      <path d={teeth.inner} fill={P.brass.deep} stroke="#1a0e03" strokeWidth="1.1" strokeLinejoin="round" />
      <g className={styles.streaks} fill="none" strokeLinecap="round">
        {streaks.map((s, i) => <circle key={i} cx={CZ_C} cy={CZ_C} r={s.r} stroke={i % 2 ? t.rim : P.brass.light} strokeWidth={6 + (i % 3) * 3} strokeDasharray={s.dash} opacity={s.o} />)}
      </g>
    </svg>
  );
});

/** Fixed parts: back plate (channels), rim with spoke lamps and its inward teeth. */
const BackArt = memo(function BackArt({ uid }: { uid: string }) {
  const id = (n: string) => `${uid}b${n}`;
  return (
    <svg className={styles.layerSvg} viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id('back')} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1a1008" /><stop offset=".9" stopColor="#0a0603" /><stop offset="1" stopColor="#000" />
        </radialGradient>
      </defs>
      <circle cx={CZ_C} cy={CZ_C} r={CZ_RIM_R} fill={`url(#${id('back')})`} />
      {CZ_BOUNDS.map((r) => <circle key={r} cx={CZ_C} cy={CZ_C} r={r} fill="none" stroke="#000" strokeWidth="12" opacity=".85" />)}
    </svg>
  );
});
const RimArt = memo(function RimArt({ uid }: { uid: string }) {
  const id = (n: string) => `${uid}m${n}`;
  const r0 = CZ_BOUNDS[CZ_RINGS]!;
  const lampR = (r0 + CZ_RIM_R) / 2 + 1;
  return (
    <svg className={styles.layerSvg} viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id('rim')} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse">
          <stop offset={r2(r0 / 500)} stopColor={P.brass.dark} />
          <stop offset={r2((r0 + 6) / 500)} stopColor={P.brass.light} />
          <stop offset={r2((r0 + 13) / 500)} stopColor={P.brass.base} />
          <stop offset={r2((CZ_RIM_R - 3) / 500)} stopColor={P.brass.hi} />
          <stop offset="1" stopColor={P.brass.dark} />
        </radialGradient>
      </defs>
      <path d={gearTeethPath(r0 + 5, r0 - 4, 7.5, CZ_SLICE_DEG / 2 + 3.75)} fill={P.brass.base} stroke="#1a0e03" strokeWidth="1.1" />
      <path d={annulusPath(r0 + 4, CZ_RIM_R)} fill={`url(#${id('rim')})`} fillRule="evenodd" stroke="#1a0e03" strokeWidth="2" />
      {Array.from({ length: 48 }, (_, i) => {
        if (i % 4 === 0) return null;
        const a = i * 7.5, p = polar(r0 + 9, a), q = polar(CZ_RIM_R - 5, a);
        return <path key={i} d={`M${r2(p.x)} ${r2(p.y)}L${r2(q.x)} ${r2(q.y)}`} stroke={P.brass.dark} strokeWidth="1.4" opacity=".7" />;
      })}
      {Array.from({ length: CZ_SLICES }, (_, s) => { const p = polar(lampR, sliceAngle(s)); return <circle key={s} cx={r2(p.x)} cy={r2(p.y)} r="9" fill="#120a04" stroke={P.brass.hi} strokeWidth="1.6" />; })}
    </svg>
  );
});

/* ------------------------------------------------------------------ hub */
interface HubHandle { set(value: number, reason: 'spin' | 'respin' | 'set'): Promise<void> }
const DIGIT_ROWS = 20;
function digitsOf(v: number) { return String(Math.max(0, Math.min(999, Math.round(v)))).split('').map(Number); }
const Hub = memo(function Hub({ initial, uid, ref }: { initial: number; uid: string; ref: Ref<HubHandle> }) {
  const [digits, setDigits] = useState(() => digitsOf(initial));
  const colRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pos = useRef<number[]>(digitsOf(initial));
  const teethRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const id = (n: string) => `${uid}h${n}`;

  const place = useCallback((i: number, p: number, animate: number, easing = 'cubic-bezier(.3,1.5,.45,1)') => {
    const el = colRefs.current[i];
    if (!el) return;
    const to = `translateY(${-(p * 100) / DIGIT_ROWS}%)`;
    if (animate > 0) el.animate([{ transform: el.style.transform || to }, { transform: to }], { duration: animate, easing, fill: 'none' });
    el.style.transform = to;
  }, []);

  useImperativeHandle(ref, () => ({
    async set(value, reason) {
      const next = digitsOf(value);
      const reduced = prefersReduced();
      const grew = next.length !== pos.current.length;
      if (grew) {
        // re-seat the columns at their old digits (right aligned), then roll
        const old = pos.current.map((p) => p % 10);
        const padded = [...Array(Math.max(0, next.length - old.length)).fill(0), ...old].slice(-next.length);
        flushSync(() => setDigits(next));
        pos.current = padded;
        padded.forEach((p, i) => place(i, p, 0));
      }
      const dur = reduced ? 0 : reason === 'respin' ? 520 : 760;
      next.forEach((d, i) => {
        const cur = pos.current[i]!;
        const steps = (d - (cur % 10) + 10) % 10;
        if (!steps && !(reason === 'set')) return;
        const target = cur + (steps || 0);
        place(i, target, dur + i * 40);
        pos.current[i] = target;
        if (target >= 10) window.setTimeout(() => { if (pos.current[i] === target) { pos.current[i] = target - 10; place(i, target - 10, 0); } }, dur + i * 40 + 30);
      });
      if (!reduced && reason === 'respin') {
        // the escapement: the hub's tooth ring steps one tooth and the window kicks
        angle.current += 15;
        teethRef.current?.animate([{ transform: `rotate(${angle.current - 15}deg)` }, { transform: `rotate(${angle.current + 2}deg)`, offset: 0.4 }, { transform: `rotate(${angle.current}deg)` }], { duration: 360, easing: 'cubic-bezier(.3,0,.3,1)' });
        if (teethRef.current) teethRef.current.style.transform = `rotate(${angle.current}deg)`;
        windowRef.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.22 }, { transform: 'scale(.97)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' });
      } else if (!reduced && reason === 'spin') {
        windowRef.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: 600, easing: 'ease-out' });
      }
      await wait(dur + next.length * 40);
    },
  }), [place]);

  useEffect(() => { pos.current.forEach((p, i) => place(i, p, 0)); }, [digits.length, place]);

  const hubBox = CZ_HUB_R + 12;
  const box = { left: `${((CZ_C - hubBox) / 10)}%`, top: `${((CZ_C - hubBox) / 10)}%`, width: `${(hubBox * 2) / 10}%`, height: `${(hubBox * 2) / 10}%` };
  const vb = `${CZ_C - hubBox} ${CZ_C - hubBox} ${hubBox * 2} ${hubBox * 2}`;
  return (
    <div className={styles.hub} style={box} data-digits={digits.length}>
      <div ref={teethRef} className={styles.hubTeeth}>
        <svg viewBox={vb} aria-hidden="true" focusable="false">
          <path d={gearTeethPath(CZ_HUB_R - 2, CZ_HUB_R + 9, 15, 7.5, 0.5)} fill={P.brass.base} stroke="#1a0e03" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </div>
      <svg className={styles.hubFace} viewBox={vb} aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={id('face')} cx=".4" cy=".32" r=".75"><stop offset="0" stopColor={P.brass.hi} /><stop offset=".35" stopColor={P.brass.light} /><stop offset=".75" stopColor={P.brass.base} /><stop offset="1" stopColor={P.brass.deep} /></radialGradient>
          <radialGradient id={id('enamel')} cx=".42" cy=".36" r=".7"><stop offset="0" stopColor={P.turq.light} /><stop offset=".6" stopColor={P.turq.base} /><stop offset="1" stopColor={P.turq.dark} /></radialGradient>
        </defs>
        <circle cx={CZ_C} cy={CZ_C} r={CZ_HUB_R} fill={`url(#${id('face')})`} stroke="#1a0e03" strokeWidth="3" />
        <circle cx={CZ_C} cy={CZ_C} r={CZ_HUB_R - 9} fill={`url(#${id('enamel')})`} stroke="#1a0e03" strokeWidth="2" />
        {Array.from({ length: 12 }, (_, i) => { const p = polar(CZ_HUB_R - 15.5, i * 30); return <circle key={i} cx={r2(p.x)} cy={r2(p.y)} r={i % 3 === 0 ? 3.4 : 2.2} fill={i % 3 === 0 ? P.verm.base : P.ivory.hi} stroke="#1a0e03" strokeWidth=".8" />; })}
        <circle cx={CZ_C} cy={CZ_C} r={CZ_HUB_R - 22} fill={`url(#${id('face')})`} stroke="#1a0e03" strokeWidth="2" />
        <path d={`M${CZ_C - 60} ${CZ_C - 30}Q${CZ_C - 40} ${CZ_C - 64} ${CZ_C} ${CZ_C - 70}`} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".5" />
      </svg>
      <div ref={windowRef} className={styles.hubWindow} role="status" aria-live="polite" aria-label={`Göbek çarpanı ×${digits.join('')}`}>
        <span className={styles.hubX}>×</span>
        {digits.map((_, i) => (
          <span key={`${digits.length}-${i}`} className={styles.drum}>
            <span ref={(el) => { colRefs.current[i] = el as HTMLDivElement | null; }} className={styles.drumStrip}>
              {Array.from({ length: DIGIT_ROWS }, (_, n) => <span key={n}>{n % 10}</span>)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ overlay plates */
function Plate({ ring, slice, symbol, kind, fresh, uid }: { ring: number; slice: number; symbol: CezeriSymbol; kind: 'held' | 'pinned' | 'lift'; fresh?: boolean; uid: string }) {
  const { box, style } = wedgeStyle(ring, slice, 8);
  const sym = symbolBox(ring, slice);
  // symbol box relative to the plate box
  const sb = { left: czPct(((sym.x - box.x) / box.w) * 100), top: czPct(((sym.y - box.y) / box.h) * 100), width: czPct((sym.size / box.w) * 100), height: czPct((sym.size / box.h) * 100) };
  const d = slicePath(ring, slice, 1.5);
  const inner = slicePath(ring, slice, 9);
  const gold = kind === 'pinned';
  // clamp jaws: short brass bars on both radial sides near the inner and outer corners, plus corner bolts
  const bnd = ringBand(ring);
  const c = sliceAngle(slice);
  const L = bnd.outer - bnd.inner;
  const jaws: string[] = [];
  const bolts: Array<readonly [number, number]> = [];
  for (const side of [-1, 1]) {
    for (const [f0, f1] of [[0.1, 0.34], [0.66, 0.9]] as const) {
      const r0 = bnd.inner + L * f0, r1 = bnd.inner + L * f1;
      const a0 = c + side * (CZ_SLICE_DEG / 2 - 286 / r0), a1 = c + side * (CZ_SLICE_DEG / 2 - 286 / r1);
      const p0 = polar(r0, a0), p1 = polar(r1, a1);
      jaws.push(`M${r2(p0.x)} ${r2(p0.y)}L${r2(p1.x)} ${r2(p1.y)}`);
    }
    for (const f of [0.06, 0.94]) { const r = bnd.inner + L * f; const p = polar(r, c + side * (CZ_SLICE_DEG / 2 - 560 / r)); bolts.push([r2(p.x), r2(p.y)]); }
  }
  return (
    <div className={styles.plate} style={style} data-kind={kind} data-fresh={fresh ? '' : undefined} role="gridcell" aria-label={`${CEZERI_SYMBOL_LABELS[symbol]}${gold ? ', kalıcı joker' : ', kilitli'}`}>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className={styles.plateSvg} aria-hidden="true" focusable="false">
        <path d={d} fill="none" stroke={gold ? '#ffcf5a' : '#5ff0e0'} strokeWidth="16" opacity=".35" />
        <path d={d} fill={gold ? 'url(#' + uid + 'pinFill)' : 'url(#' + uid + 'heldFill)'} stroke="#140a02" strokeWidth="8" />
        <path d={d} fill="none" stroke={`url(#${uid}rimFill)`} strokeWidth="4.6" />
        <path d={inner} fill="none" stroke={gold ? '#fff2b0' : P.turq.hi} strokeWidth="1.6" strokeDasharray="6 5" opacity=".75" />
        <path d={jaws.join('')} stroke="#140a02" strokeWidth="13" strokeLinecap="round" />
        <path d={jaws.join('')} stroke={gold ? P.brass.hi : P.brass.light} strokeWidth="7.4" strokeLinecap="round" />
        <path d={jaws.join('')} stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".55" />
        {bolts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.6" fill={P.brass.hi} stroke="#140a02" strokeWidth="1.4" />)}
      </svg>
      <div className={styles.plateGlow} />
      <div className={styles.plateSym} style={sb}><CezeriSymbolUse symbol={symbol} /></div>
    </div>
  );
}

/* ------------------------------------------------------------------ board */
function toSlices(b: EngineBoard | CezeriBoardSlices): CezeriBoardSlices { return b.map((r) => r.slice()); }

export function CezeriBoard({ initial, hubValue = 1, mood = 'base', className, style, ref, label = 'Cezeri çarkları' }: CezeriBoardProps) {
  const uid = 'czb';
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const hubRef = useRef<HubHandle>(null);
  const [slices, setSlices] = useState<CezeriBoardSlices>(() => toSlices(initial));
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false, false]);
  const [held, setHeld] = useState<Map<number, CezeriSymbol>>(new Map());
  const [lifting, setLifting] = useState<Map<number, CezeriSymbol>>(new Map());
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [pinned, setPinnedState] = useState<Set<number>>(new Set());
  const [freshPins, setFreshPins] = useState<Set<number>>(new Set());
  const [wins, setWins] = useState<Set<number>>(new Set());
  const [lamps, setLamps] = useState<Set<number>>(new Set());
  const [vessels, setVessels] = useState<Set<number>>(new Set());
  const slicesRef = useRef(slices);
  slicesRef.current = slices;
  const heldRef = useRef(held);
  heldRef.current = held;
  const timers = useRef(new Set<number>());
  const later = useCallback((ms: number, fn: () => void) => { const t = window.setTimeout(() => { timers.current.delete(t); fn(); }, Math.max(0, ms)); timers.current.add(t); }, []);
  useEffect(() => () => { for (const t of timers.current) window.clearTimeout(t); }, []);

  const setRing = useCallback((ring: number, next: readonly CezeriSymbol[]) => {
    flushSync(() => setSlices((cur) => { const out = cur.map((r) => r.slice()); out[ring] = next.slice(); return out; }));
  }, []);

  useImperativeHandle(ref, () => ({
    get element() { return rootRef.current; },
    setBoard(b) { setSlices(toSlices(b)); },
    async rotate(targets, opts = {}) {
      const speed = opts.speed ?? 1;
      const reduced = prefersReduced();
      const stagger = opts.stagger ?? 210 * speed;
      if (reduced) {
        for (const t of targets) setRing(t.ring, t.slices);
        for (const t of targets) { opts.onRingStop?.(t.ring); }
        await wait(120);
        return;
      }
      let longest = 0;
      for (const t of targets) {
        const ring = t.ring;
        const plan = cezeriSpinPlan({ ring, cruiseMs: 380 + ring * stagger / Math.max(speed, 0.2), slices: 6 + ring, ticks: 3, speed });
        const ringEl = ringRefs.current[ring];
        const cells = Array.from({ length: CZ_SLICES }, (_, s) => cellRefs.current[key(ring, s)]).filter(Boolean) as HTMLDivElement[];
        ringEl?.animate(plan.upKeyframes, { duration: plan.upMs, fill: 'forwards' });
        cells.forEach((c) => c.animate(plan.upCounter, { duration: plan.upMs, fill: 'forwards' }));
        later(plan.upMs * 0.35, () => flushSync(() => setSpinning((s) => { const n = s.slice(); n[ring] = true; return n; })));
        later(plan.upMs * 0.55, () => setRing(ring, Array.from({ length: CZ_SLICES }, filler)));
        later(plan.upMs, () => {
          setRing(ring, t.slices);
          ringEl?.getAnimations().forEach((a) => a.cancel());
          cells.forEach((c) => c.getAnimations().forEach((a) => a.cancel()));
          ringEl?.animate(plan.settleKeyframes, { duration: plan.settleMs, fill: 'forwards' });
          cells.forEach((c) => c.animate(plan.settleCounter, { duration: plan.settleMs, fill: 'forwards' }));
        });
        later(plan.upMs + plan.settleMs * 0.32, () => setSpinning((s) => { const n = s.slice(); n[ring] = false; return n; }));
        plan.ticks.forEach((ms, i) => later(ms, () => opts.onTick?.(ring, i, i === plan.ticks.length - 1)));
        later(plan.total + 10, () => {
          ringEl?.getAnimations().forEach((a) => a.cancel());
          cells.forEach((c) => c.getAnimations().forEach((a) => a.cancel()));
          opts.onRingStop?.(ring);
        });
        longest = Math.max(longest, plan.total + 20);
      }
      await wait(longest);
    },
    showWin(cells, spoke) {
      setWins((w) => { const n = new Set(w); for (const [r, s] of cells) n.add(key(r, s)); return n; });
      if (spoke !== undefined) setLamps((l) => new Set(l).add(spoke));
    },
    clearWins() { setWins(new Set()); setLamps(new Set()); },
    async lock(newHeld) {
      const cur = slicesRef.current;
      const add = new Map(heldRef.current);
      const fr = new Set<number>();
      for (const [r, s] of newHeld) { const k = key(r, s); if (!add.has(k)) { add.set(k, cur[r]![s]!); fr.add(k); } }
      flushSync(() => { setHeld(add); setFresh(fr); });
      await wait(prefersReduced() ? 30 : 380);
      setFresh(new Set());
    },
    async release() {
      const was = heldRef.current;
      if (!was.size) return;
      flushSync(() => { setLifting(new Map(was)); setHeld(new Map()); });
      await wait(prefersReduced() ? 30 : 420);
      setLifting(new Map());
    },
    setPinned(wilds, freshW) {
      setPinnedState(new Set(wilds.map(([r, s]) => key(r, s))));
      if (freshW?.length) {
        setFreshPins(new Set(freshW.map(([r, s]) => key(r, s))));
        later(700, () => setFreshPins(new Set()));
      }
    },
    hub(value, reason = 'set') { return hubRef.current?.set(value, reason) ?? Promise.resolve(); },
    jolt(strength = 1) {
      if (prefersReduced()) return;
      ringRefs.current.forEach((el, ring) => {
        const d = ringDirection(ring) * 1.4 * strength;
        el?.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${-d}deg)`, offset: 0.25 }, { transform: `rotate(${d * 0.4}deg)`, offset: 0.6 }, { transform: 'rotate(0deg)' }], { duration: 260, easing: 'ease-out', composite: 'add' });
      });
      rootRef.current?.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${1.5 * strength}px, ${2.5 * strength}px)`, offset: 0.2 }, { transform: `translate(${-1 * strength}px, ${-1.2 * strength}px)`, offset: 0.55 }, { transform: 'translate(0,0)' }], { duration: 280, easing: 'ease-out' });
    },
    showVessels(cells) { setVessels(new Set((cells ?? []).map(([r, s]) => key(r, s)))); },
  }), [later, setRing]);

  const pinnedList = useMemo(() => [...pinned], [pinned]);
  return (
    <div ref={rootRef} className={`${styles.board} ${className ?? ''}`} style={style} data-mood={mood} role="grid" aria-label={label}>
      <BackArt uid={uid} />
      {Array.from({ length: CZ_RINGS }, (_, ring) => (
        <div key={ring} ref={(el) => { ringRefs.current[ring] = el; }} className={styles.ring} data-ring={ring} data-spin={spinning[ring] ? '' : undefined} role="row" aria-label={`Halka ${ring + 1}`}>
          <RingArt ring={ring} uid={uid} />
          {slices[ring]!.map((sym, s) => {
            const k = key(ring, s);
            const under = held.has(k) || pinned.has(k);
            return (
              <div key={s} ref={(el) => { cellRefs.current[k] = el; }} className={styles.cell} style={cellStyle(ring, s)}
                role="gridcell" aria-label={CEZERI_SYMBOL_LABELS[sym]} aria-hidden={under || undefined}
                data-under={under ? '' : undefined} data-win={wins.has(k) ? '' : undefined} data-vessel={vessels.has(k) ? '' : undefined}>
                <div className={styles.cellArt}><CezeriSymbolUse symbol={sym} /></div>
              </div>
            );
          })}
        </div>
      ))}
      <div className={styles.overlay}>
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={`${uid}heldFill`} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse"><stop offset=".15" stopColor="#2a9a9a" /><stop offset=".55" stopColor="#127078" /><stop offset="1" stopColor="#063a40" /></radialGradient>
            <linearGradient id={`${uid}rimFill`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fffbe0" /><stop offset=".35" stopColor="#ffe07a" /><stop offset=".7" stopColor="#d9a441" /><stop offset="1" stopColor="#8f5a17" /></linearGradient>
            <radialGradient id={`${uid}pinFill`} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse"><stop offset=".15" stopColor="#b8801c" /><stop offset=".55" stopColor="#7a4e0c" /><stop offset="1" stopColor="#3a2204" /></radialGradient>
          </defs>
        </svg>
        {[...lifting].map(([k, sym]) => <Plate key={`l${k}`} ring={Math.floor(k / CZ_SLICES)} slice={k % CZ_SLICES} symbol={sym} kind="lift" uid={uid} />)}
        {[...held].map(([k, sym]) => pinned.has(k) ? null : <Plate key={`h${k}`} ring={Math.floor(k / CZ_SLICES)} slice={k % CZ_SLICES} symbol={sym} kind="held" fresh={fresh.has(k)} uid={uid} />)}
        {pinnedList.map((k) => <Plate key={`p${k}`} ring={Math.floor(k / CZ_SLICES)} slice={k % CZ_SLICES} symbol="gear" kind="pinned" fresh={freshPins.has(k)} uid={uid} />)}
        {[...wins].map((k) => {
          const ring = Math.floor(k / CZ_SLICES), s = k % CZ_SLICES;
          const { box, style: st } = wedgeStyle(ring, s, 10);
          return (
            <div key={`w${k}`} className={styles.winGlow} style={st}>
              <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} aria-hidden="true" focusable="false">
                <path d={slicePath(ring, s, 1)} fill="none" stroke="#ffb43a" strokeWidth="22" opacity=".45" />
                <path d={slicePath(ring, s, 1)} fill="rgba(255,214,110,.28)" stroke="#fff2b0" strokeWidth="6" />
              </svg>
            </div>
          );
        })}
      </div>
      <RimArt uid={uid} />
      <div className={styles.lamps} aria-hidden="true">
        {Array.from({ length: CZ_SLICES }, (_, s) => {
          const p = polar((CZ_BOUNDS[CZ_RINGS]! + CZ_RIM_R) / 2 + 1, sliceAngle(s));
          return <span key={s} className={styles.lamp} data-on={lamps.has(s) ? '' : undefined} style={{ left: czPct(p.x / 10), top: czPct(p.y / 10) }} />;
        })}
      </div>
      <Hub initial={hubValue} uid={uid} ref={hubRef} />
      <div className={styles.glass} aria-hidden="true" />
    </div>
  );
}
