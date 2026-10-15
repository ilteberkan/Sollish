/* Cezeri: Zamanın Çarkları — canvas FX engine.

   One 2D canvas over the board host draws the short-lived mechanical/water effects; the board itself (rings,
   clamps, hub drums) is DOM and animates on the compositor. Effects:
     lock()       brass sparks + white clank flash + steam puffs where clamps slam onto slices
     hubTick()    the signature moment: shock ring off the hub, radial sparks, four steam vents, a gold flash and a
                  rising "+1" — pair it with board.hub(v, 'respin') and board.jolt()
     spokeBeam()  a beam of light traced from the hub outward along a winning spoke, flashing at every cell
     falcon()     the automaton falcon flies in on a spline, drops golden gears on the given slices and leaves
     scatter()    vessel halos and water arcs leaping from vessel to vessel, splashing on landing
     awaken()     big win: rotating gold rays from the hub, gear confetti, two cymbal shock rings
     steam() / spray() / sparksAt() building blocks, plus idle brass glints on the rim
   All coordinates are board units (1000 × 1000, see geometry.ts) mapped onto the board element's rect inside
   the host, so the canvas can spill sparks over the frame.

   Presentation only; Math.random is cosmetic. Wall-clock time: every effect is a pure function of
   (now - born), so a slow frame or a hidden tab never desynchronises it. The loop runs only while something is
   alive and stops while the document is hidden; every promise resolves on a timer. Reduced motion: no
   particles, promises resolve almost at once (falcon drops still call onDrop in order). Counts are capped;
   the canvas is devicePixelRatio aware (≤ 2). */

import { CZ_BOUNDS, CZ_HUB_R, CZ_RIM_R, CZ_RINGS, cezeriBoardLayout, polar, sliceAngle, symbolCircle, type CzLayout, type CzPoint } from './geometry';

// Canvas `ctx.font` does not resolve CSS custom properties, so read the Barlow family from the page once.
let fontFamily: string | null = null;
function canvasFontFamily(): string {
  if (fontFamily === null) {
    const fam = typeof document !== 'undefined' ? getComputedStyle(document.body).getPropertyValue('--font-barlow').trim() : '';
    fontFamily = `${fam ? `${fam}, ` : ''}'Arial Narrow', system-ui, sans-serif`;
  }
  return fontFamily;
}


export type CezeriMood = 'base' | 'feature' | 'bigwin';
export type CezeriFxPos = readonly [ring: number, slice: number];
export interface CezeriFxOptions {
  /** The element the canvas covers (canvas is absolutely positioned to fill it). */
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The board square (CezeriBoard element); defaults to the whole host. */
  board?: HTMLElement | null;
  mood?: CezeriMood;
  reducedMotion?: boolean;
  /** Idle brass glints on the rim (default true). */
  idle?: boolean;
}
export interface CezeriFxStats { fps: number; avgMs: number; worstMs: number; drawMs: number; drawWorstMs: number; particles: number; running: boolean }

type Kind = 'spark' | 'ember' | 'steam' | 'drop' | 'gear' | 'glint';
interface Particle { kind: Kind; x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; color: string; g: number; drag: number; rot: number; vr: number }
interface Ring { x: number; y: number; born: number; life: number; r0: number; r1: number; color: string; width: number; alpha: number }
interface Flash { x: number; y: number; born: number; life: number; r: number; color: string; alpha: number }
interface Beam { a: CzPoint; b: CzPoint; born: number; travel: number; life: number; color: string; width: number }
interface Arc { a: CzPoint; b: CzPoint; lift: number; born: number; travel: number; life: number }
interface TextFx { text: string; x: number; y: number; born: number; life: number; size: number; color: string }
interface Halo { x: number; y: number; born: number; until: number; r: number; color: string }
interface Rays { born: number; life: number; alpha: number }
interface Falcon { pts: CzPoint[]; born: number; segMs: number[]; total: number; size: number }

const MAX_PARTICLES = 700;
const MAX_RINGS = 40;
const MAX_FLASHES = 60;
const BRASS_SPARK = ['#fff6d0', '#ffe28a', '#ffc04a', '#ff9a2a'];
const WATER = ['#ffffff', '#d8fff8', '#7fe8dc', '#3fd0d8'];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function catmull(p0: CzPoint, p1: CzPoint, p2: CzPoint, p3: CzPoint, t: number): CzPoint {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

export class CezeriFx {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private board: HTMLElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private mood: CezeriMood;
  private reduced: boolean;
  private idle: boolean;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private L: CzLayout = cezeriBoardLayout(1);
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private beams: Beam[] = [];
  private arcs: Arc[] = [];
  private texts: TextFx[] = [];
  private halos: Halo[] = [];
  private rays: Rays | null = null;
  private falcons: Falcon[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private gearSprite: HTMLCanvasElement | null = null;
  private raf = 0;
  private running = false;
  private disposed = false;
  private observer: ResizeObserver | null = null;
  private mq: MediaQueryList | null = null;
  private timers = new Set<number>();
  private frames: number[] = [];
  private drawTimes: number[] = [];
  private last = 0;

  constructor(o: CezeriFxOptions) {
    this.host = o.host;
    this.canvas = o.canvas;
    this.board = o.board ?? null;
    this.ctx = this.canvas.getContext('2d');
    this.mood = o.mood ?? 'base';
    this.idle = o.idle ?? true;
    this.mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = o.reducedMotion ?? !!this.mq?.matches;
    this.mq?.addEventListener('change', this.onMotion);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.host);
      if (this.board) this.observer.observe(this.board);
    }
    this.scheduleGlint(1200);
  }

  /* ================================================================ public API */
  setMood(m: CezeriMood) { this.mood = m; }
  setBoard(el: HTMLElement | null) { if (this.board && this.observer) this.observer.unobserve(this.board); this.board = el; if (el) this.observer?.observe(el); this.resize(); }
  get layout(): CzLayout { return this.L; }
  get stats(): CezeriFxStats {
    const n = this.frames.length;
    const avg = n ? this.frames.reduce((a, b) => a + b, 0) / n : 0;
    const dn = this.drawTimes.length;
    return {
      fps: avg ? 1000 / avg : 0, avgMs: avg, worstMs: n ? Math.max(...this.frames) : 0,
      drawMs: dn ? this.drawTimes.reduce((a, b) => a + b, 0) / dn : 0, drawWorstMs: dn ? Math.max(...this.drawTimes) : 0,
      particles: this.parts.length, running: this.running,
    };
  }
  /** Centre (board units) of the symbol of (ring, slice) at rest. */
  cell(ring: number, slice: number): CzPoint { return polar(symbolCircle(ring).rc, sliceAngle(slice)); }

  /** A burst of brass sparks at a board point. */
  sparksAt(p: CzPoint, n = 14, power = 1, colors: readonly string[] = BRASS_SPARK) {
    if (this.reduced) return;
    const now = this.now();
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(140, 520) * power;
      this.push({ kind: i % 3 ? 'spark' : 'ember', x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80 * power, born: now + rand(0, 0.04), life: rand(0.35, 0.8), size: rand(2, 4.5), color: pick(colors), g: 900, drag: 2.2, rot: 0, vr: 0 });
    }
    this.kick();
  }
  /** Steam puffs from a point toward clock angle `deg`. */
  steam(p: CzPoint, deg = 0, n = 6, power = 1) {
    if (this.reduced) return;
    const now = this.now();
    const a0 = ((deg - 90) * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const a = a0 + rand(-0.45, 0.45), v = rand(60, 170) * power;
      this.push({ kind: 'steam', x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, born: now + i * 0.03, life: rand(0.9, 1.6), size: rand(18, 34) * power, color: this.mood === 'feature' ? '#d8fff8' : '#fff4e6', g: -40, drag: 1.4, rot: 0, vr: 0 });
    }
    this.kick();
  }
  /** Water spray (droplets with gravity). */
  spray(p: CzPoint, deg = 0, n = 16, power = 1) {
    if (this.reduced) return;
    const now = this.now();
    const a0 = ((deg - 90) * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const a = a0 + rand(-0.6, 0.6), v = rand(160, 420) * power;
      this.push({ kind: 'drop', x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: now + rand(0, 0.05), life: rand(0.5, 0.9), size: rand(2.2, 4.6), color: pick(WATER), g: 1100, drag: 0.6, rot: 0, vr: 0 });
    }
    this.kick();
  }
  /** Dişli Kilidi: clamps slam onto cells. */
  lock(cells: readonly CezeriFxPos[], opts: { duration?: number } = {}): Promise<void> {
    const dur = opts.duration ?? 520;
    if (this.reduced || !cells.length) return this.after(this.reduced ? 30 : 0);
    const now = this.now();
    cells.forEach(([r, s], i) => {
      const c = this.cell(r, s);
      this.later(i * 40, () => {
        this.sparksAt(c, Math.max(6, Math.round(16 / Math.sqrt(cells.length))), 1);
        this.addFlash({ x: c.x, y: c.y, born: this.now(), life: 0.32, r: 70, color: '#fff2c8', alpha: 0.95 });
        this.addRing({ x: c.x, y: c.y, born: this.now(), life: 0.4, r0: 30, r1: 74, color: '#ffe7a0', width: 5, alpha: 0.9 });
        if (i % 2 === 0) this.steam(c, sliceAngle(s), 3, 0.6);
      });
    });
    void now;
    return this.after(dur + cells.length * 40);
  }
  /** The +1 tick of the hub counter: the viral moment. */
  hubTick(value?: number, opts: { duration?: number; label?: string } = {}): Promise<void> {
    const dur = opts.duration ?? 900;
    if (this.reduced) return this.after(30);
    const now = this.now();
    const c = { x: 500, y: 500 };
    this.addFlash({ x: 500, y: 500, born: now, life: 0.55, r: CZ_HUB_R * 3.4, color: '#ffe7a0', alpha: 1 });
    this.addFlash({ x: 500, y: 500, born: now, life: 0.25, r: CZ_HUB_R * 1.6, color: '#ffffff', alpha: 1 });
    // the escapement teeth light up one by one around the hub
    for (let i = 0; i < 24; i++) {
      const p = polar(CZ_HUB_R + 10, i * 15);
      this.addFlashLater(i * 12, { x: p.x, y: p.y, life: 0.32, r: 26, color: '#fff2c0', alpha: 0.9 });
    }
    this.addRing({ x: 500, y: 500, born: now, life: 0.55, r0: CZ_HUB_R, r1: CZ_HUB_R * 2.9, color: '#fff2c0', width: 10, alpha: 0.95 });
    this.addRing({ x: 500, y: 500, born: now + 0.08, life: 0.7, r0: CZ_HUB_R, r1: CZ_BOUNDS[2]!, color: '#ffb84a', width: 5, alpha: 0.7 });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + rand(-0.05, 0.05), v = rand(380, 760);
      const x = 500 + Math.cos(a) * CZ_HUB_R, y = 500 + Math.sin(a) * CZ_HUB_R;
      this.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: now, life: rand(0.35, 0.65), size: rand(2.4, 4.4), color: pick(BRASS_SPARK), g: 300, drag: 2.6, rot: 0, vr: 0 });
    }
    for (const deg of [45, 135, 225, 315]) this.steam(polar(CZ_HUB_R + 6, deg), deg, 4, 0.8);
    this.texts.push({ text: opts.label ?? '+1', x: c.x, y: c.y - CZ_HUB_R - 46, born: now + 0.05, life: 1.05, size: 118, color: '#ffe7a0' });
    void value;
    this.kick();
    return this.after(dur);
  }
  /** Light traced from the hub outward along `spoke` through `length` cells. Resolves when the trace is done. */
  spokeBeam(spoke: number, length = 3, opts: { color?: string; duration?: number; startRing?: number } = {}): Promise<void> {
    const dur = (opts.duration ?? 720) / 1000;
    if (this.reduced) return this.after(30);
    const now = this.now();
    const deg = sliceAngle(spoke);
    const start = opts.startRing ? CZ_BOUNDS[opts.startRing]! : CZ_HUB_R;
    const endRing = Math.min(CZ_RINGS - 1, (opts.startRing ?? 0) + length - 1);
    const a = polar(start, deg), b = polar(CZ_BOUNDS[endRing + 1]! - 4, deg);
    const color = opts.color ?? '#ffd66e';
    const travel = dur * 0.6;
    this.beams.push({ a, b, born: now, travel, life: dur + 0.5, color, width: 30 });
    for (let r = opts.startRing ?? 0; r <= endRing; r++) {
      const c = this.cell(r, spoke);
      const t = (symbolCircle(r).rc - start) / Math.max(1, CZ_BOUNDS[endRing + 1]! - 4 - start);
      this.later(t * travel * 1000, () => {
        this.addFlash({ x: c.x, y: c.y, born: this.now(), life: 0.45, r: 95, color, alpha: 0.85 });
        this.sparksAt(c, 8, 0.7);
      });
    }
    this.later(travel * 1000, () => {
      this.addRing({ x: b.x, y: b.y, born: this.now(), life: 0.45, r0: 10, r1: 70, color: '#fff2c0', width: 6, alpha: 0.9 });
      this.sparksAt(b, 12, 0.9);
    });
    this.kick();
    return this.after(dur * 1000);
  }
  /** The automaton falcon flies in and drops golden gears on `slices` of `ring`; onDrop(i) when gear i lands. */
  falcon(ring: number, slices: readonly number[], opts: { onDrop?: (i: number, slice: number) => void; duration?: number } = {}): Promise<void> {
    if (this.reduced || !slices.length) {
      slices.forEach((s, i) => opts.onDrop?.(i, s));
      return this.after(30);
    }
    const now = this.now();
    // host-space entry/exit in board units (the canvas may extend beyond the board)
    const pad = 260;
    const ordered = [...slices].sort((x, y) => sliceAngle(x) - sliceAngle(y));
    const over = ordered.map((s) => { const c = this.cell(ring, s); return { x: c.x, y: c.y - 120 }; });
    const pts: CzPoint[] = [{ x: -pad - 200, y: -pad }, { x: -pad, y: -pad * 0.4 }, ...over, { x: 1000 + pad, y: -pad * 0.5 }, { x: 1000 + pad + 200, y: -pad }];
    const segMs: number[] = [];
    for (let i = 1; i < pts.length - 2; i++) {
      const d = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
      segMs.push(Math.max(260, d * 1.15));
    }
    const total = segMs.reduce((a, b) => a + b, 0);
    this.falcons.push({ pts, born: now, segMs, total, size: 190 });
    // drop times: when the falcon passes over each target (end of segment i, i = 0..)
    let t = 0;
    ordered.forEach((s, i) => {
      t += segMs[i]!;
      const at = t;
      const c = this.cell(ring, s);
      this.later(at - 40, () => {
        // the gear falls from the talons
        const n = this.now();
        this.push({ kind: 'gear', x: c.x, y: c.y - 110, vx: 0, vy: 380, born: n, life: 0.28, size: 46, color: '#ffd66e', g: 1600, drag: 0, rot: rand(0, 6), vr: 9 });
      });
      this.later(at + 240, () => {
        this.addFlash({ x: c.x, y: c.y, born: this.now(), life: 0.5, r: 110, color: '#ffe7a0', alpha: 1 });
        this.addRing({ x: c.x, y: c.y, born: this.now(), life: 0.5, r0: 20, r1: 90, color: '#fff2c0', width: 6, alpha: 0.9 });
        this.sparksAt(c, 16, 1.1);
        opts.onDrop?.(i, s);
      });
    });
    this.kick();
    return this.after(Math.max(total, t + 400) + 120);
  }
  /** Vessel halos and water arcs from vessel to vessel. Halos stay until clearScatter() or `hold` ms. */
  scatter(cells: readonly CezeriFxPos[], opts: { hold?: number; arcMs?: number } = {}): Promise<void> {
    if (this.reduced || !cells.length) return this.after(30);
    const now = this.now();
    const hold = (opts.hold ?? 2600) / 1000;
    const pts = [...cells].sort((a, b) => sliceAngle(a[1]) - sliceAngle(b[1]) || a[0] - b[0]).map(([r, s]) => this.cell(r, s));
    for (const p of pts) this.halos.push({ x: p.x, y: p.y, born: now, until: now + hold, r: 120, color: '#5ff0e0' });
    const arcMs = opts.arcMs ?? 520;
    for (let i = 0; i < pts.length - 1 + (pts.length > 2 ? 1 : 0); i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      this.later(i * arcMs * 0.75, () => {
        this.arcs.push({ a, b, lift: Math.min(260, 80 + d * 0.4), born: this.now(), travel: arcMs / 1000, life: arcMs / 1000 + 0.6 });
        this.spray(a, 0, 8, 0.6);
        this.later(arcMs, () => { this.spray(b, 0, 14, 0.8); this.addRing({ x: b.x, y: b.y, born: this.now(), life: 0.5, r0: 20, r1: 80, color: '#d8fff8', width: 4, alpha: 0.8 }); });
      });
    }
    this.kick();
    return this.after(Math.max(800, (pts.length * 0.75 + 0.5) * arcMs));
  }
  clearScatter() { this.halos = []; }
  /** Big win: the automata awaken (rays, gear confetti, cymbal rings). */
  awaken(intensity = 1, opts: { duration?: number } = {}): Promise<void> {
    const dur = (opts.duration ?? 3200) / 1000;
    if (this.reduced) return this.after(30);
    const now = this.now();
    this.rays = { born: now, life: dur, alpha: Math.min(1, 0.55 + intensity * 0.35) };
    const burst = (delay: number, n: number) => this.later(delay, () => {
      const t = this.now();
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), v = rand(300, 900) * (0.7 + intensity * 0.3);
        this.push({ kind: 'gear', x: 500, y: 500, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 260, born: t + rand(0, 0.1), life: rand(1.4, 2.4), size: rand(16, 34), color: '#ffd66e', g: 700, drag: 0.9, rot: rand(0, 6), vr: rand(-8, 8) });
      }
      this.sparksAt({ x: 500, y: 500 }, 26, 1.6);
    });
    burst(0, Math.round(34 * intensity));
    burst(900, Math.round(22 * intensity));
    const cymbal = (delay: number, side: number) => this.later(delay, () => {
      const t = this.now();
      const x = 500 + side * 420, y = 160;
      this.addFlash({ x, y, born: t, life: 0.5, r: 260, color: '#fff6dc', alpha: 0.9 });
      for (let k = 0; k < 3; k++) this.addRing({ x, y, born: t + k * 0.07, life: 0.7, r0: 40, r1: 360 + k * 80, color: k ? '#ffd66e' : '#ffffff', width: 8 - k * 2, alpha: 0.85 });
    });
    cymbal(500, -1);
    cymbal(1500, 1);
    this.addFlash({ x: 500, y: 500, born: now, life: 0.8, r: 520, color: '#ffe7a0', alpha: 0.9 });
    this.kick();
    return this.after(dur * 1000);
  }
  destroy() {
    this.disposed = true;
    this.stop();
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    this.observer?.disconnect();
    this.mq?.removeEventListener('change', this.onMotion);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /* ================================================================ internals */
  private now() { return performance.now() / 1000; }
  private after(ms: number) { return new Promise<void>((res) => this.later(ms, res)); }
  private later(ms: number, fn: () => void) {
    const t = window.setTimeout(() => { this.timers.delete(t); if (!this.disposed) fn(); }, Math.max(0, ms));
    this.timers.add(t);
  }
  private push(p: Particle) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.splice(0, this.parts.length - MAX_PARTICLES + 1);
    this.parts.push(p);
  }
  private addRing(r: Ring) { if (this.reduced) return; if (this.rings.length >= MAX_RINGS) this.rings.shift(); this.rings.push(r); this.kick(); }
  private addFlashLater(ms: number, f: Omit<Flash, 'born'>) { this.later(ms, () => this.addFlash({ ...f, born: this.now() })); }
  private addFlash(f: Flash) { if (this.reduced) return; if (this.flashes.length >= MAX_FLASHES) this.flashes.shift(); this.flashes.push(f); this.kick(); }
  private scheduleGlint(ms: number) {
    this.later(ms, () => {
      if (this.idle && !this.reduced && document.visibilityState === 'visible') {
        const deg = rand(0, 360), r = pick([CZ_RIM_R - 8, CZ_BOUNDS[1]!, CZ_BOUNDS[2]!, CZ_BOUNDS[3]!, CZ_HUB_R]);
        const p = polar(r, deg);
        this.push({ kind: 'glint', x: p.x, y: p.y, vx: 0, vy: 0, born: this.now(), life: 0.9, size: rand(14, 24), color: '#fffbe6', g: 0, drag: 0, rot: 0, vr: 0 });
        this.kick();
      }
      this.scheduleGlint(rand(900, 2600) * (this.mood === 'base' ? 1 : 0.6));
    });
  }
  private onMotion = () => { this.reduced = !!this.mq?.matches; if (this.reduced) this.clearAll(); };
  private onVisibility = () => { if (document.visibilityState === 'hidden') this.stop(); else this.kick(); };
  private clearAll() { this.parts = []; this.rings = []; this.flashes = []; this.beams = []; this.arcs = []; this.texts = []; this.halos = []; this.rays = null; this.falcons = []; this.draw(this.now()); }
  private resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    const b = this.board?.getBoundingClientRect();
    if (b && b.width > 0) this.L = cezeriBoardLayout(b.width, b.left - r.left, b.top - r.top);
    else { const s = Math.min(this.w, this.h); this.L = cezeriBoardLayout(s, (this.w - s) / 2, (this.h - s) / 2); }
    this.kick();
  }
  private kick() {
    if (this.running || this.disposed || typeof document === 'undefined' || document.visibilityState === 'hidden') return;
    this.running = true;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }
  private stop() { this.running = false; cancelAnimationFrame(this.raf); }
  private frame = (ts: number) => {
    if (!this.running) return;
    if (this.last) { this.frames.push(ts - this.last); if (this.frames.length > 90) this.frames.shift(); }
    this.last = ts;
    const t0 = performance.now();
    const alive = this.draw(this.now());
    this.drawTimes.push(performance.now() - t0);
    if (this.drawTimes.length > 90) this.drawTimes.shift();
    if (alive) this.raf = requestAnimationFrame(this.frame);
    else { this.running = false; }
  };
  private sprite(color: string): HTMLCanvasElement {
    let s = this.sprites.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, color); grd.addColorStop(0.25, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 1; g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    // soften the hot core into the falloff
    const grd2 = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd2.addColorStop(0, 'rgba(255,255,255,0.9)'); grd2.addColorStop(0.18, 'rgba(255,255,255,0)');
    g.fillStyle = grd2; g.fillRect(0, 0, 64, 64);
    this.sprites.set(color, s);
    return s;
  }
  private gear(): HTMLCanvasElement {
    if (this.gearSprite) return this.gearSprite;
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d')!;
    g.translate(32, 32);
    const n = 10;
    g.beginPath();
    for (let i = 0; i < n * 4; i++) {
      const a = (i / (n * 4)) * Math.PI * 2;
      const r = i % 4 < 2 ? 30 : 23;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    const grd = g.createLinearGradient(-30, -30, 30, 30);
    grd.addColorStop(0, '#fffbe0'); grd.addColorStop(0.35, '#ffd66e'); grd.addColorStop(0.7, '#c07a14'); grd.addColorStop(1, '#5a3204');
    g.fillStyle = grd; g.fill();
    g.lineWidth = 2.4; g.strokeStyle = '#2a1602'; g.stroke();
    g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.fillStyle = '#d42a3a'; g.fill(); g.stroke();
    g.beginPath(); g.arc(-3, -3, 3, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.8)'; g.fill();
    this.gearSprite = s;
    return s;
  }
  /** Draws one frame; returns whether anything is still alive. */
  private draw(now: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const L = this.L, k = L.scale;
    const X = (x: number) => L.cx + (x - 500) * k, Y = (y: number) => L.cy + (y - 500) * k;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    let alive = false;

    // rotating rays (big win) under everything
    if (this.rays) {
      const r = this.rays, t = (now - r.born) / r.life;
      if (t >= 1) this.rays = null;
      else if (t >= 0) {
        alive = true;
        const a = r.alpha * Math.min(1, t * 6) * (1 - easeInOut(clamp01((t - 0.7) / 0.3)));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(X(500), Y(500));
        ctx.rotate(now * 0.35);
        const R = Math.max(this.w, this.h);
        for (let i = 0; i < 16; i++) {
          ctx.rotate((Math.PI * 2) / 16);
          const grd = ctx.createLinearGradient(0, 0, R, 0);
          grd.addColorStop(0, `rgba(255,220,120,${(0.32 * a).toFixed(3)})`);
          grd.addColorStop(1, 'rgba(255,180,60,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, -R * (i % 2 ? 0.06 : 0.1)); ctx.lineTo(R, R * (i % 2 ? 0.06 : 0.1)); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }
    // scatter halos
    if (this.halos.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.halos = this.halos.filter((h) => now < h.until + 0.5);
      for (const h of this.halos) {
        alive = true;
        const fade = now > h.until ? 1 - (now - h.until) / 0.5 : Math.min(1, (now - h.born) * 3);
        const pulse = 0.75 + 0.25 * Math.sin((now - h.born) * 5);
        const r = h.r * k * (0.9 + 0.1 * pulse);
        ctx.globalAlpha = Math.max(0, fade) * pulse;
        ctx.drawImage(this.sprite(h.color), X(h.x) - r, Y(h.y) - r, r * 2, r * 2);
      }
      ctx.restore();
    }
    // beams
    if (this.beams.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      this.beams = this.beams.filter((b) => now - b.born < b.life);
      for (const b of this.beams) {
        alive = true;
        const t = now - b.born;
        const head = easeOut(clamp01(t / b.travel));
        const fade = 1 - clamp01((t - b.travel) / (b.life - b.travel));
        const ax = X(b.a.x), ay = Y(b.a.y);
        const hx = ax + (X(b.b.x) - ax) * head, hy = ay + (Y(b.b.y) - ay) * head;
        const grd = ctx.createLinearGradient(ax, ay, hx, hy);
        grd.addColorStop(0, 'rgba(255,200,90,0)');
        grd.addColorStop(0.6, `rgba(255,214,110,${(0.55 * fade).toFixed(3)})`);
        grd.addColorStop(1, `rgba(255,246,210,${(0.95 * fade).toFixed(3)})`);
        ctx.strokeStyle = grd;
        ctx.lineWidth = b.width * k * (1 + 0.4 * (1 - fade));
        ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = Math.max(1.5, b.width * k * 0.22);
        ctx.strokeStyle = `rgba(255,255,240,${(0.95 * fade).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();
        if (head < 1) { const r = 70 * k; ctx.drawImage(this.sprite('#fff2c0'), hx - r, hy - r, r * 2, r * 2); }
      }
      ctx.restore();
    }
    // water arcs
    if (this.arcs.length) {
      ctx.save();
      ctx.lineCap = 'round';
      this.arcs = this.arcs.filter((a) => now - a.born < a.life);
      for (const a of this.arcs) {
        alive = true;
        const t = now - a.born;
        const head = easeInOut(clamp01(t / a.travel));
        const tail = clamp01((t - a.travel * 0.55) / (a.life - a.travel * 0.55));
        const mx = (a.a.x + a.b.x) / 2, my = Math.min(a.a.y, a.b.y) - a.lift;
        const at = (u: number) => ({ x: (1 - u) * (1 - u) * a.a.x + 2 * (1 - u) * u * mx + u * u * a.b.x, y: (1 - u) * (1 - u) * a.a.y + 2 * (1 - u) * u * my + u * u * a.b.y });
        const steps = 22;
        for (const [w, col, al] of [[16, '#3fd0d8', 0.35], [7, '#d8fff8', 0.9], [2.4, '#ffffff', 1]] as const) {
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const u = tail + (head - tail) * (i / steps);
            const p = at(u);
            if (i) ctx.lineTo(X(p.x), Y(p.y)); else ctx.moveTo(X(p.x), Y(p.y));
          }
          ctx.globalAlpha = al * (1 - tail * 0.6);
          ctx.strokeStyle = col;
          ctx.lineWidth = w * k;
          ctx.stroke();
        }
        // droplets riding the arc
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 6; i++) {
          const u = head - i * 0.05 - 0.02;
          if (u < tail || u < 0) continue;
          const p = at(u);
          ctx.globalAlpha = 0.85;
          ctx.beginPath(); ctx.arc(X(p.x) + Math.sin(i * 7.1 + now * 9) * 4 * k, Y(p.y) + Math.cos(i * 5.3) * 5 * k, (3.2 - i * 0.35) * k * 1.6, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }
    // flashes
    if (this.flashes.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.flashes = this.flashes.filter((f) => now - f.born < f.life);
      for (const f of this.flashes) {
        const t = (now - f.born) / f.life;
        if (t < 0) { alive = true; continue; }
        alive = true;
        const r = f.r * k * (0.6 + 0.5 * easeOut(t));
        ctx.globalAlpha = f.alpha * (1 - t) * (1 - t);
        ctx.drawImage(this.sprite(f.color), X(f.x) - r, Y(f.y) - r, r * 2, r * 2);
      }
      ctx.restore();
    }
    // shock rings
    if (this.rings.length) {
      ctx.save();
      this.rings = this.rings.filter((r) => now - r.born < r.life);
      for (const r of this.rings) {
        const t = (now - r.born) / r.life;
        if (t < 0) { alive = true; continue; }
        alive = true;
        const rad = (r.r0 + (r.r1 - r.r0) * easeOut(t)) * k;
        ctx.globalAlpha = r.alpha * (1 - t);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(1, r.width * k * (1 - t * 0.6));
        ctx.beginPath(); ctx.arc(X(r.x), Y(r.y), rad, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    // particles
    if (this.parts.length) {
      const keep: Particle[] = [];
      for (const p of this.parts) {
        const t = now - p.born;
        if (t > p.life) continue;
        keep.push(p);
        alive = true;
        if (t < 0) continue;
        // closed-form motion with linear drag: x = x0 + v (1 - e^-dt) / d, gravity integrated plainly
        const e = p.drag ? (1 - Math.exp(-p.drag * t)) / p.drag : t;
        const x = p.x + p.vx * e;
        const y = p.y + p.vy * e + 0.5 * p.g * t * t * (p.drag ? 1 / (1 + p.drag * t * 0.5) : 1);
        const u = t / p.life;
        const px = X(x), py = Y(y);
        switch (p.kind) {
          case 'spark': {
            const vx = p.vx * Math.exp(-p.drag * t), vy = p.vy * Math.exp(-p.drag * t) + p.g * t * 0.6;
            const len = Math.min(26, Math.hypot(vx, vy) * 0.025) * k + 1;
            const ang = Math.atan2(vy, vx);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 1 - u;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = Math.max(1, p.size * k * (1 - u * 0.5));
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.cos(ang) * len * 3, py - Math.sin(ang) * len * 3); ctx.stroke();
            break;
          }
          case 'ember': {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = (1 - u) * 0.9;
            const r = p.size * 4 * k;
            ctx.drawImage(this.sprite(p.color), px - r, py - r, r * 2, r * 2);
            break;
          }
          case 'glint': {
            ctx.globalCompositeOperation = 'lighter';
            const a = Math.sin(u * Math.PI);
            ctx.globalAlpha = a;
            const r = p.size * k * (0.6 + a * 0.6);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.moveTo(px, py - r); ctx.quadraticCurveTo(px, py, px + r, py); ctx.quadraticCurveTo(px, py, px, py + r); ctx.quadraticCurveTo(px, py, px - r, py); ctx.quadraticCurveTo(px, py, px, py - r);
            ctx.fill();
            const g = r * 1.4;
            ctx.globalAlpha = a * 0.6;
            ctx.drawImage(this.sprite('#ffe7a0'), px - g, py - g, g * 2, g * 2);
            break;
          }
          case 'steam': {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 0.32 * Math.sin(Math.min(1, u * 1.4) * Math.PI) * (this.mood === 'feature' ? 1.1 : 1);
            const r = p.size * k * (0.6 + u * 1.6);
            ctx.drawImage(this.sprite(p.color), px - r, py - r, r * 2, r * 2);
            break;
          }
          case 'drop': {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1 - u * u;
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, p.size * k * 1.4), 0, Math.PI * 2); ctx.fill();
            break;
          }
          case 'gear': {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = Math.min(1, (1 - u) * 3);
            const r = p.size * k;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(p.rot + p.vr * t);
            ctx.drawImage(this.gear(), -r, -r, r * 2, r * 2);
            ctx.restore();
            break;
          }
        }
      }
      this.parts = keep;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // falcon(s)
    if (this.falcons.length) {
      this.falcons = this.falcons.filter((f) => (now - f.born) * 1000 < f.total + 50);
      for (const f of this.falcons) {
        alive = true;
        let ms = (now - f.born) * 1000;
        let seg = 0;
        while (seg < f.segMs.length - 1 && ms > f.segMs[seg]!) { ms -= f.segMs[seg]!; seg++; }
        const u = clamp01(ms / f.segMs[seg]!);
        const i = seg + 1;
        const p = catmull(f.pts[i - 1]!, f.pts[i]!, f.pts[i + 1]!, f.pts[i + 2]!, u);
        const q = catmull(f.pts[i - 1]!, f.pts[i]!, f.pts[i + 1]!, f.pts[i + 2]!, Math.min(1, u + 0.02));
        this.drawFalcon(ctx, X(p.x), Y(p.y), f.size * k, Math.atan2(q.y - p.y, q.x - p.x), now);
      }
    }
    // floating texts (+1)
    if (this.texts.length) {
      this.texts = this.texts.filter((t) => now - t.born < t.life);
      for (const tx of this.texts) {
        const t = (now - tx.born) / tx.life;
        if (t < 0) { alive = true; continue; }
        alive = true;
        const s = tx.size * k * (t < 0.18 ? 0.5 + (t / 0.18) * 0.75 : 1.25 - (t - 0.18) * 0.3);
        ctx.save();
        ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        ctx.font = `600 ${Math.round(s)}px ${canvasFontFamily()}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const x = X(tx.x), y = Y(tx.y) - easeOut(t) * 60 * k;
        ctx.lineWidth = Math.max(3, s * 0.14);
        ctx.strokeStyle = '#2a1402';
        ctx.lineJoin = 'round';
        ctx.strokeText(tx.text, x, y);
        const grd = ctx.createLinearGradient(0, y - s / 2, 0, y + s / 2);
        grd.addColorStop(0, '#fffbe6'); grd.addColorStop(0.45, '#ffe07a'); grd.addColorStop(1, '#d08a1e');
        ctx.fillStyle = grd;
        ctx.fillText(tx.text, x, y);
        ctx.restore();
      }
    }
    return alive;
  }
  /** Brass automaton falcon seen from above (procedural): body along its heading, wings flap by foreshortening. */
  private drawFalcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, heading: number, now: number) {
    const flap = Math.sin(now * 13);
    const span = 0.55 + 0.45 * Math.abs(flap); // wing length seen from above
    const sweep = flap * 0.12;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    const s = size / 100;
    ctx.scale(s, s);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45;
    ctx.drawImage(this.sprite('#ffd66e'), -80, -80, 160, 160);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const brass = ctx.createLinearGradient(-40, -70, 30, 60);
    brass.addColorStop(0, '#fff4c4'); brass.addColorStop(0.3, '#f6d27a'); brass.addColorStop(0.65, '#d9a441'); brass.addColorStop(1, '#6a3c08');
    const tq = ctx.createLinearGradient(0, -40, 0, 40);
    tq.addColorStop(0, '#7fe8dc'); tq.addColorStop(0.5, '#1fb3ab'); tq.addColorStop(1, '#0b6b70');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const ink = '#1a0d05';
    const wing = (side: number) => {
      ctx.save();
      ctx.rotate(side * sweep);
      ctx.scale(1, side * span);
      ctx.beginPath();
      ctx.moveTo(10, -6);
      ctx.bezierCurveTo(18, -30, 8, -58, -6, -76);
      const fingers = [[-12, -70], [-15, -80], [-21, -70], [-25, -77], [-30, -64], [-35, -68], [-37, -54]];
      for (const [fx, fy] of fingers) ctx.lineTo(fx!, fy!);
      ctx.bezierCurveTo(-34, -36, -28, -18, -20, -6);
      ctx.closePath();
      ctx.fillStyle = brass; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = ink; ctx.stroke();
      // turquoise covert band and feather lines
      ctx.beginPath();
      ctx.moveTo(8, -10); ctx.bezierCurveTo(12, -26, 6, -40, -2, -50); ctx.lineTo(-16, -44); ctx.bezierCurveTo(-14, -30, -12, -18, -10, -8); ctx.closePath();
      ctx.fillStyle = tq; ctx.fill(); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 5; i++) { ctx.moveTo(-12 - i * 4.5, -10 - i * 2); ctx.lineTo(-14 - i * 5, -52 - i * 3); }
      ctx.strokeStyle = 'rgba(74,42,8,.85)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = '#5a3204';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(2 - i * 4, -16 - i * 9, 1.6, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    };
    // the gear it carries (under the body)
    ctx.save(); ctx.rotate(now * 4); ctx.drawImage(this.gear(), -14, -14, 28, 28); ctx.restore();
    // tail fan
    ctx.beginPath();
    ctx.moveTo(-24, -6); ctx.lineTo(-58, -16); ctx.quadraticCurveTo(-66, 0, -58, 16); ctx.lineTo(-24, 6); ctx.closePath();
    ctx.fillStyle = brass; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = ink; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(-60, 0); ctx.moveTo(-28, -3); ctx.lineTo(-58, -10); ctx.moveTo(-28, 3); ctx.lineTo(-58, 10);
    ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(74,42,8,.85)'; ctx.stroke();
    wing(-1);
    wing(1);
    // body + head
    ctx.beginPath(); ctx.ellipse(2, 0, 30, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = brass; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = ink; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, 18, 5, 0, 0, Math.PI * 2); ctx.fillStyle = tq; ctx.fill();
    ctx.beginPath(); ctx.arc(32, 0, 10, 0, Math.PI * 2); ctx.fillStyle = brass; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(40, -4); ctx.quadraticCurveTo(52, 0, 40, 5); ctx.closePath(); ctx.fillStyle = '#4a2a08'; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#d6302c';
    ctx.beginPath(); ctx.arc(35, -5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(35, 5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-2, -5, 16, 2.4, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
    ctx.restore();
  }
}
