/* Ebru: Mürekkep Bahçesi — water / marbling FX engine.

   The signature look is real marbling maths, not particles: every pigment patch is a closed polygon
   floating on the water and every effect is a deformation of the whole surface.
     - a drop landing (tıp)        radial push:  |P' - C|² = |P - C|² + (r1² - r0²)   (exact, area preserving)
     - the comb pass (tarak)       horizontal shear per row, the engine's per-row cyclic shifts, interpolated
                                   smoothly between row centres; the field is horizontally periodic exactly
                                   like the grid (a cyclic row shift), so pigment wraps around like symbols do
     - tines / awl (biz)           a moving tip drags the water near it (smooth kernel), which is what
                                   draws the fine feathered lines of taraklı and the hatip flower petals
   Polygons are refined as they stretch (edge splitting, capped) and live in a board space where one cell is
   100 units, so resizing never recomputes anything. The pigment is rasterised into a small offscreen canvas
   only when it changed, then scaled onto the water canvas together with drifting caustics, stain glows,
   ripples and blooms. An optional front canvas (above the symbols) carries the golden comb, tine glints and
   gold-leaf flakes; it is hidden while it has nothing to draw.

   Presentation only: it never reads or changes a round; Math.random is cosmetic on purpose. Animation time
   is the wall clock, so a hidden tab or a slow frame never desynchronises the comb from the symbols (the
   board slides its rows with combRowTiming(), the same curve). The loop stops while the document is hidden
   and every promise still resolves on its timer. Reduced motion: no idle life, every effect jumps to its
   final state and the canvas cross-fades once. Counts are capped; canvases are devicePixelRatio aware. */

import type { EbruColour } from '@sollish/protocol';

export type EbruMood = 'base' | 'feature' | 'bigwin';
export interface EbruCellRef { col: number; row: number }
export interface EbruInkCell extends EbruCellRef { colour: EbruColour }

/* ------------------------------------------------------------------ palette (shared with the SVG art) */
export interface EbruInkPalette { name: string; light: string; base: string; deep: string; edge: string; glow: string }
export const EBRU_INKS: Record<EbruColour, EbruInkPalette> = {
  c1: { name: 'altın varak', light: '#fff4c2', base: '#f2bf3c', deep: '#a8680c', edge: '#4f2c03', glow: '#ffd25a' },
  c2: { name: 'Osmanlı kırmızısı', light: '#ffb3a8', base: '#e0283c', deep: '#8a0c22', edge: '#3a0410', glow: '#ff4b5c' },
  c3: { name: 'firuze', light: '#c4fff6', base: '#22c9c0', deep: '#0b7078', edge: '#032a33', glow: '#38f0e0' },
  c4: { name: 'zümrüt', light: '#c2f7c8', base: '#2fb164', deep: '#0e5c32', edge: '#032514', glow: '#48e58a' },
  c5: { name: 'lacivert', light: '#bcd2ff', base: '#3d6cf0', deep: '#16288a', edge: '#060c3a', glow: '#6c93ff' },
  c6: { name: 'safran', light: '#ffe2a6', base: '#f7901e', deep: '#a3470a', edge: '#421702', glow: '#ffa53c' },
  c7: { name: 'gül', light: '#ffd9ea', base: '#ee79ad', deep: '#9a2c63', edge: '#3f0b26', glow: '#ff8fc0' },
  c8: { name: 'is mürekkebi', light: '#eef1f6', base: '#9aa3b6', deep: '#4a5266', edge: '#171b26', glow: '#c9d2e6' },
};
/** Stain-multiplier colour tiers (×2 … ×256). */
export type EbruStainTier = 0 | 1 | 2 | 3 | 4 | 5;
export function ebruStainTier(value: number): EbruStainTier {
  if (value <= 4) return 0;      // ×2 ×4      firuze
  if (value <= 16) return 1;     // ×8 ×16     zümrüt
  if (value <= 32) return 2;     // ×32        lacivert / mor
  if (value <= 64) return 3;     // ×64        gül
  if (value <= 128) return 4;    // ×128       kızıl
  return 5;                      // ×256       altın varak
}
export const EBRU_STAIN_TIERS: ReadonlyArray<{ light: string; base: string; deep: string; glow: string }> = [
  { light: '#d4fff8', base: '#2fd6c8', deep: '#0b6a72', glow: '#5ff4e6' },
  { light: '#d2ffd6', base: '#3cc46e', deep: '#0f5a30', glow: '#7cf0a0' },
  { light: '#e2d8ff', base: '#8a6cff', deep: '#2c1a8a', glow: '#a890ff' },
  { light: '#ffe0ee', base: '#ff6fae', deep: '#8a1a52', glow: '#ff9cc8' },
  { light: '#ffd2c2', base: '#ff4a2c', deep: '#8a1006', glow: '#ff7a4a' },
  { light: '#ffffff', base: '#ffd768', deep: '#a8680c', glow: '#fff0b0' },
];

/* ------------------------------------------------------------------ comb timing (shared with the board) */
/** CSS easing of a row slide; the canvas evaluates the very same curve. */
export const EBRU_COMB_EASING = 'cubic-bezier(0.6, 0, 0.25, 1)';
const ROW_START = 0.05;
const ROW_STEP = 0.085;
const ROW_SPAN = 0.34;
/** When row `row` slides during a comb pass of `durationMs`: delay and duration in ms plus the easing. */
export function combRowTiming(row: number, durationMs: number) {
  return { delay: durationMs * (ROW_START + row * ROW_STEP), duration: durationMs * ROW_SPAN, easing: EBRU_COMB_EASING };
}
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const d = dsx(t); if (Math.abs(d) < 1e-6) break; t -= (sx(t) - x) / d; t = Math.min(1, Math.max(0, t)); }
    return ((ay * t + by) * t + cy) * t;
  };
}
const combEase = bezier(0.6, 0, 0.25, 1);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => v * v * (3 - 2 * v);
const easeOut = (v: number) => 1 - (1 - v) * (1 - v) * (1 - v);

/* ------------------------------------------------------------------ marbling field (pure, reusable) */
/** Board space: a cell is 100 units, the 7 × 7 grid is 700 × 700, x is periodic over PERIOD. */
export const EBRU_UNITS = 100;
const COLS = 7;
const ROWS = 7;
export interface MarblePoly { x: number[]; y: number[]; color: string; alpha: number; vein: number; born: number; fadeFrom?: number }
export interface MarbleOptions { width?: number; height?: number; maxEdge?: number; maxVerts?: number; periodic?: boolean }

export class MarbleField {
  polys: MarblePoly[] = [];
  readonly width: number;
  readonly height: number;
  maxEdge: number;
  maxVerts: number;
  readonly periodic: boolean;
  verts = 0;
  constructor(opts: MarbleOptions = {}) {
    this.width = opts.width ?? COLS * EBRU_UNITS;
    this.height = opts.height ?? ROWS * EBRU_UNITS;
    this.maxEdge = opts.maxEdge ?? 9;
    this.maxVerts = opts.maxVerts ?? 14000;
    this.periodic = opts.periodic ?? true;
  }
  private dxw(dx: number) {
    if (!this.periodic) return dx;
    const p = this.width;
    return dx - p * Math.round(dx / p);
  }
  /** Adds a drop of radius r0 at (cx, cy); grow it with grow(). */
  addDrop(cx: number, cy: number, r0: number, color: string, alpha = 1, vein = 1, born = 0): MarblePoly {
    this.push(cx, cy, 0, r0);
    const n = Math.max(18, Math.min(96, Math.round((2 * Math.PI * Math.max(r0, 6)) / (this.maxEdge * 0.9))));
    const x: number[] = [], y: number[] = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; x.push(cx + Math.cos(a) * r0); y.push(cy + Math.sin(a) * r0); }
    const p: MarblePoly = { x, y, color, alpha, vein, born };
    this.polys.push(p);
    this.verts += n;
    return p;
  }
  /** Radial push of everything around (cx, cy) as a drop grows from r0 to r1 (exact composition). */
  push(cx: number, cy: number, r0: number, r1: number) {
    const k = r1 * r1 - r0 * r0;
    if (k <= 0) return;
    for (const p of this.polys) {
      const xs = p.x, ys = p.y;
      for (let i = 0; i < xs.length; i++) {
        const dx = this.dxw(xs[i]! - cx), dy = ys[i]! - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) continue;
        const f = Math.sqrt(1 + k / d2) - 1;
        xs[i] = xs[i]! + dx * f;
        ys[i] = ys[i]! + dy * f;
      }
    }
  }
  /** Horizontal shear: x += fn(y). */
  shear(fn: (y: number) => number) {
    for (const p of this.polys) {
      const xs = p.x, ys = p.y;
      for (let i = 0; i < xs.length; i++) xs[i] = xs[i]! + fn(ys[i]!);
    }
  }
  /** A tip at (tx, ty) moving by (mx, my) drags the water within ~sigma of it. */
  drag(tx: number, ty: number, mx: number, my: number, sigma: number) {
    const reach = sigma * 3.2, s2 = sigma * sigma;
    for (const p of this.polys) {
      const xs = p.x, ys = p.y;
      for (let i = 0; i < xs.length; i++) {
        const dy = ys[i]! - ty;
        if (dy > reach || dy < -reach) continue;
        const dx = this.dxw(xs[i]! - tx);
        if (dx > reach || dx < -reach) continue;
        const q = 1 + (dx * dx + dy * dy) / s2;
        const w = 1 / (q * q);
        xs[i] = xs[i]! + mx * w;
        ys[i] = ys[i]! + my * w;
      }
    }
  }
  /** Line tine (Jaffer): points move along direction (ux, uy) by z · u^(d / lambda), d = distance to the line. */
  tine(px: number, py: number, ux: number, uy: number, z: number, lambda: number) {
    const nx = -uy, ny = ux;
    for (const p of this.polys) {
      const xs = p.x, ys = p.y;
      for (let i = 0; i < xs.length; i++) {
        const d = Math.abs(this.dxw(xs[i]! - px) * nx + (ys[i]! - py) * ny);
        const f = z * Math.pow(0.5, d / lambda);
        xs[i] = xs[i]! + ux * f;
        ys[i] = ys[i]! + uy * f;
      }
    }
  }
  /** Splits edges longer than maxEdge (one pass), drops polygons that left the visible band, keeps x in range. */
  refine(marginTop = -140, marginBottom?: number) {
    const bottom = marginBottom ?? this.height + 140;
    const me2 = this.maxEdge * this.maxEdge;
    let total = 0;
    const keep: MarblePoly[] = [];
    for (const p of this.polys) {
      let minY = Infinity, maxY = -Infinity, sumX = 0;
      const n = p.x.length;
      for (let i = 0; i < n; i++) { const y = p.y[i]!; if (y < minY) minY = y; if (y > maxY) maxY = y; sumX += p.x[i]!; }
      if (maxY < marginTop || minY > bottom) { continue; }
      if (this.periodic) {
        const mean = sumX / n;
        const off = Math.floor(mean / this.width) * this.width;
        if (off !== 0) for (let i = 0; i < n; i++) p.x[i] = p.x[i]! - off;
      }
      if (this.verts < this.maxVerts && n < 2400) {
        let split = false;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const dx = p.x[j]! - p.x[i]!, dy = p.y[j]! - p.y[i]!;
          if (dx * dx + dy * dy > me2) { split = true; break; }
        }
        if (split) {
          const nx: number[] = [], ny: number[] = [];
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const x0 = p.x[i]!, y0 = p.y[i]!, x1 = p.x[j]!, y1 = p.y[j]!;
            nx.push(x0); ny.push(y0);
            const dx = x1 - x0, dy = y1 - y0;
            const l2 = dx * dx + dy * dy;
            if (l2 > me2) {
              const parts = Math.min(6, Math.ceil(Math.sqrt(l2 / me2)));
              for (let s = 1; s < parts; s++) { nx.push(x0 + (dx * s) / parts); ny.push(y0 + (dy * s) / parts); }
            }
          }
          p.x = nx; p.y = ny;
        }
      }
      total += p.x.length;
      keep.push(p);
    }
    this.polys = keep;
    this.verts = total;
  }
  /** SVG path data of a polygon (one decimal). */
  static path(p: MarblePoly, sx = 1, sy = 1, ox = 0, oy = 0) {
    const r = (v: number) => Math.round(v * 10) / 10;
    let d = `M${r(p.x[0]! * sx + ox)} ${r(p.y[0]! * sy + oy)}`;
    for (let i = 1; i < p.x.length; i++) d += `L${r(p.x[i]! * sx + ox)} ${r(p.y[i]! * sy + oy)}`;
    return `${d}Z`;
  }
}

/** Deterministic RNG for SSR-stable art (mulberry32). */
export function ebruRng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export type MarbleStyle = 'battal' | 'gelgit' | 'tarakli' | 'sal' | 'hatip';
export interface MarblePatternOptions { seed: number; width: number; height: number; colors: readonly string[]; style?: MarbleStyle; drops?: number; maxEdge?: number }
/** A finished, static marbled sheet as SVG paths (for the backdrop papers and the logo). Deterministic. */
export function marblePattern(o: MarblePatternOptions): Array<{ d: string; fill: string }> {
  const rnd = ebruRng(o.seed);
  const W = o.width, H = o.height;
  const f = new MarbleField({ width: W, height: H, maxEdge: o.maxEdge ?? Math.max(W, H) / 40, maxVerts: 5200, periodic: false });
  const pick = () => o.colors[Math.floor(rnd() * o.colors.length)]!;
  const n = o.drops ?? 26;
  const base = Math.sqrt((W * H) / n) * 0.62;
  for (let i = 0; i < n; i++) {
    const r = base * (0.55 + rnd() * 0.75);
    f.addDrop(rnd() * W, rnd() * H, 1, pick());
    const last = f.polys[f.polys.length - 1]!;
    // grow: push others, then rebuild the new drop as a circle of radius r
    f.push(last.x[0]! - 1, last.y[0]!, 1, r);
    f.refine(-H, H * 2);
  }
  const style = o.style ?? 'battal';
  if (style === 'gelgit' || style === 'tarakli' || style === 'sal') {
    // gelgit: an awl swept back and forth across the sheet
    const passes = style === 'gelgit' ? 7 : 11;
    for (let i = 0; i < passes; i++) {
      const y = ((i + 0.5) / passes) * H;
      const dir = i % 2 ? -1 : 1;
      f.tine(0, y, dir, 0, W * 0.09, H / passes / 3.2);
      f.refine(-H, H * 2);
    }
  }
  if (style === 'tarakli' || style === 'sal') {
    const teeth = style === 'sal' ? 9 : 14;
    for (let i = 0; i < teeth; i++) {
      const x = ((i + 0.5) / teeth) * W;
      f.tine(x, 0, 0, i % 2 && style === 'sal' ? -1 : 1, H * (style === 'sal' ? 0.12 : 0.07), W / teeth / 3.6);
      f.refine(-H, H * 2);
    }
  }
  if (style === 'hatip') {
    const cx = W / 2, cy = H / 2;
    const cols = o.colors;
    for (let i = 0; i < 6; i++) {
      const r = Math.min(W, H) * (0.05 + i * 0.045);
      f.addDrop(cx, cy, 1, cols[i % cols.length]!);
      f.push(cx, cy, 1, r);
    }
    f.refine(-H, H * 2);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
      for (let s = 0; s < 12; s++) {
        const rr = Math.min(W, H) * (0.4 - s * 0.022);
        f.drag(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, -Math.cos(a) * W * 0.018, -Math.sin(a) * W * 0.018, Math.min(W, H) * 0.03);
      }
      f.refine(-H, H * 2);
    }
  }
  return f.polys.map((p) => ({ d: MarbleField.path(p), fill: p.color }));
}

/* ------------------------------------------------------------------ engine */
export interface EbruWaterOptions {
  /** The element the water canvas covers (normally the frame's water well). */
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Optional canvas above the symbols (comb, glints, gold leaf). Falls back to the water canvas. */
  front?: HTMLCanvasElement | null;
  mood?: EbruMood;
  reducedMotion?: boolean;
  /** Idle drops sprinkled on the water (default true). */
  idle?: boolean;
}
export interface EbruCombOptions {
  /** Cyclic shift per row (index = row, positive = toward higher columns), exactly the engine's `shifts`. */
  shifts: readonly number[];
  /** The engine's A (1–3); scales the sway, glints and wake brightness. */
  amplitude?: number;
  /** Total pass duration in ms (default 1700). Use the same value for combRowTiming(). */
  duration?: number;
}
export interface EbruDissolveOptions { duration?: number; intensity?: number }
export interface EbruRect { x: number; y: number; w: number; h: number }

interface Task { start: number; end: number; step: (t: number, prevT: number, now: number) => void; done?: () => void }
interface Ripple { x: number; y: number; born: number; life: number; r: number; color: string; strength: number }
interface Glow { x: number; y: number; born: number; life: number; r: number; color: string; alpha: number }
interface Glint { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; gold: boolean }
interface Leaf { x: number; y: number; vx: number; vy: number; rot: number; vr: number; born: number; life: number; size: number; shade: number }
interface Trail { xs: number[]; ys: number[]; born: number; until: number }
interface CombState {
  start: number; dur: number; shifts: number[]; amp: number; prog: number[]; stainsFrom: number[][] | null;
  trails: Trail[]; endedAt: number; lastY: number; lastX: number;
}

const MAX_POLYS = 120;
const MAX_RIPPLES = 64;
const MAX_GLOWS = 64;
const MAX_GLINTS = 220;
const MAX_LEAVES = 140;
const TEETH = 15;

interface MoodCfg { pigment: number; caustic: number; idleEvery: [number, number]; palette: readonly string[]; tint: string }
const IDLE_BASE = ['#8e1a2c', '#c08a2a', '#0f6a72', '#1e3f9a', '#e9dcc0', '#145a3a', '#7a2a5e', '#b05a1a', '#2a2066', '#e9dcc0', '#1e3f9a'];
const IDLE_FEATURE = ['#d9a23a', '#b4203a', '#1a9a9a', '#b8507e', '#f3e6c8', '#3050c0', '#c86a1a', '#f3e6c8', '#5a2a8a'];
const MOODS: Record<EbruMood, MoodCfg> = {
  base: { pigment: 0.6, caustic: 0.11, idleEvery: [2.6, 4.6], palette: IDLE_BASE, tint: '#0b1638' },
  feature: { pigment: 0.68, caustic: 0.15, idleEvery: [1.6, 3], palette: IDLE_FEATURE, tint: '#1a1240' },
  bigwin: { pigment: 0.8, caustic: 0.18, idleEvery: [1.1, 2], palette: IDLE_FEATURE, tint: '#2a1a10' },
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pickOf = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;

export class EbruWater {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly front: HTMLCanvasElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly fctx: CanvasRenderingContext2D | null;
  private mood: EbruMood;
  private cfg: MoodCfg;
  private reduced: boolean;
  private idle: boolean;
  private field = new MarbleField();
  /* geometry (CSS px, host-relative) */
  private w = 1;
  private h = 1;
  private grid: EbruRect = { x: 0, y: 0, w: 1, h: 1 };
  private gridOverride: EbruRect | null = null;
  private frontOff = { x: 0, y: 0, w: 1, h: 1 };
  private dpr = 1;
  private fdpr = 1;
  /* raster caches */
  private pig: HTMLCanvasElement | null = null;
  private pctx: CanvasRenderingContext2D | null = null;
  private pigScale = 0.5;
  private pigDirty = true;
  private caustic: HTMLCanvasElement | null = null;
  private causticPat: CanvasPattern | null = null;
  private glowSprites = new Map<string, HTMLCanvasElement>();
  private combSprite: HTMLImageElement | null = null;
  private combReady = false;
  /* state */
  private tasks: Task[] = [];
  private ripples: Ripple[] = [];
  private glows: Glow[] = [];
  private glints: Glint[] = [];
  private leaves: Leaf[] = [];
  private stains: number[][] | null = null;
  private stainBorn: number[][] = [];
  private comb: CombState | null = null;
  private trails: Trail[] = [];
  private bloomLevel = 0;
  private bloomTarget = 0;
  private nextIdle = 0;
  private raf = 0;
  private running = false;
  private disposed = false;
  private frontShown = true;
  private observer: ResizeObserver | null = null;
  private mq: MediaQueryList | null = null;
  private frames: number[] = [];
  private drawTimes: number[] = [];
  private last = 0;
  private timers = new Set<number>();
  private fadeUntil = 0;

  constructor(opts: EbruWaterOptions) {
    this.host = opts.host;
    this.canvas = opts.canvas;
    this.front = opts.front ?? null;
    this.ctx = this.canvas.getContext('2d');
    this.fctx = this.front?.getContext('2d') ?? null;
    this.mood = opts.mood ?? 'base';
    this.cfg = MOODS[this.mood];
    this.idle = opts.idle ?? true;
    this.mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = opts.reducedMotion ?? !!this.mq?.matches;
    this.mq?.addEventListener('change', this.onMotionPref);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.seedField();
    this.buildCaustic();
    this.loadComb();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.host);
    }
    this.setFrontVisible(false);
    this.nextIdle = performance.now() / 1000 + 0.8;
    this.start();
  }

  /* ================================================================ public API */
  setMood(mood: EbruMood) {
    if (mood === this.mood) return;
    this.mood = mood;
    this.cfg = MOODS[mood];
    this.bloomTarget = mood === 'bigwin' ? 1 : 0;
    this.pigDirty = true;
    this.kick();
  }
  /** The 7 × 7 grid inside the host in host px (default: the whole host). */
  setGridRect(rect: EbruRect | null) { this.gridOverride = rect; this.resize(); }
  /** Cell centre in host px. */
  cellCenter(col: number, row: number) {
    const cw = this.grid.w / COLS, ch = this.grid.h / ROWS;
    return { x: this.grid.x + (col + 0.5) * cw, y: this.grid.y + (row + 0.5) * ch };
  }
  /** A symbol landing on the water: a soft ring (drop-in / fall). */
  ripple(col: number, row: number, strength = 1, color = '#fff6dc') {
    if (this.reduced) return;
    const now = this.now();
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x: (col + 0.5) * EBRU_UNITS, y: (row + 0.62) * EBRU_UNITS, born: now, life: 0.9 + strength * 0.3, r: 34 + strength * 22, color, strength });
    this.kick();
  }
  /** Many landings, staggered (ms per cell). */
  land(cells: readonly EbruCellRef[], staggerMs = 26, strength = 0.7) {
    if (this.reduced) return;
    cells.slice(0, MAX_RIPPLES).forEach((c, i) => this.later(i * staggerMs, () => this.ripple(c.col, c.row, strength)));
  }
  /** A cluster dissolving into the water: each cell blooms into pigment and is feathered out by tendrils. */
  dissolve(cells: readonly EbruInkCell[], opts: EbruDissolveOptions = {}): Promise<void> {
    const dur = (opts.duration ?? 1100) / 1000;
    const k = opts.intensity ?? 1;
    if (!cells.length) return Promise.resolve();
    const now = this.now();
    // merge large clusters into at most 14 pigment drops (polygons are capped); glows go on every cell
    const step = Math.max(1, Math.ceil(cells.length / 14));
    let sx = 0, sy = 0;
    cells.forEach((c, i) => {
      const x = (c.col + 0.5) * EBRU_UNITS, y = (c.row + 0.5) * EBRU_UNITS;
      sx += x; sy += y;
      const ink = EBRU_INKS[c.colour];
      if (this.glows.length < MAX_GLOWS) this.glows.push({ x, y, born: now + i * 0.012, life: 0.9 * dur + 0.25, r: 95 * k, color: ink.glow, alpha: 0.9 });
      if (i % step === 0) {
        const r1 = (step > 1 ? 70 : 52) * (0.85 + Math.random() * 0.3) * k;
        const delay = (i / cells.length) * 0.18 * dur;
        this.growDrop(x + rand(-12, 12), y + rand(-12, 12), r1, i % (2 * step) === 0 ? ink.base : ink.light, now + delay, 0.75 * dur, 1);
      }
    });
    const cx = sx / cells.length, cy = sy / cells.length;
    // tendrils: a few awl strokes outward from the cluster, feathering the fresh pigment
    if (!this.reduced) {
      const n = Math.min(7, 3 + Math.floor(cells.length / 4));
      for (let i = 0; i < n; i++) {
        const c = cells[Math.floor(Math.random() * cells.length)]!;
        const x0 = (c.col + 0.5) * EBRU_UNITS, y0 = (c.row + 0.5) * EBRU_UNITS;
        const a = Math.atan2(y0 - cy, x0 - cx) + rand(-0.9, 0.9) + (Math.abs(x0 - cx) + Math.abs(y0 - cy) < 1 ? rand(0, 6.28) : 0);
        const len = rand(70, 140) * k;
        this.awl(x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len, now + dur * rand(0.25, 0.45), dur * 0.55, rand(9, 14), 0.8, true);
      }
    }
    this.ripples.push({ x: cx, y: cy, born: now, life: 1.3, r: 120 * k, color: '#fff3d0', strength: 1 });
    return this.settle(dur * 1000);
  }
  /** The wild drop bleeding its ink into the neighbours it recolours. */
  bleed(col: number, row: number, colour: EbruColour, targets: readonly EbruCellRef[] = [], duration = 800): Promise<void> {
    const now = this.now();
    const ink = EBRU_INKS[colour];
    const x = (col + 0.5) * EBRU_UNITS, y = (row + 0.5) * EBRU_UNITS;
    this.glows.push({ x, y, born: now, life: 0.9, r: 150, color: ink.glow, alpha: 0.85 });
    this.growDrop(x, y, 46, ink.light, now, 0.5 * duration / 1000, 1);
    for (const t of targets.slice(0, 4)) {
      const tx = (t.col + 0.5) * EBRU_UNITS, ty = (t.row + 0.5) * EBRU_UNITS;
      this.awl(x, y, tx, ty, now + 0.08, duration / 1000 * 0.6, 16, 1.1, true);
      if (this.glows.length < MAX_GLOWS) this.glows.push({ x: tx, y: ty, born: now + duration / 1000 * 0.45, life: 0.7, r: 90, color: ink.glow, alpha: 0.75 });
    }
    this.ripples.push({ x, y, born: now, life: 1.1, r: 140, color: ink.light, strength: 1 });
    return this.settle(duration);
  }
  /** The comb pass. Resolves when every row has finished sliding (the stain field is then shifted too). */
  combPass(opts: EbruCombOptions): Promise<void> {
    const durMs = opts.duration ?? 1700;
    const shifts = Array.from({ length: ROWS }, (_, r) => Math.round(opts.shifts[r] ?? 0));
    const amp = Math.max(1, Math.min(3, opts.amplitude ?? Math.max(1, ...shifts.map(Math.abs))));
    const now = this.now();
    this.finishComb();
    const dur = durMs / 1000;
    const st: CombState = { start: now, dur, shifts, amp, prog: new Array(ROWS).fill(0), stainsFrom: this.stains ? this.stains.map((c) => c.slice()) : null, trails: [], endedAt: 0, lastY: NaN, lastX: NaN };
    for (let i = 0; i < TEETH; i++) st.trails.push({ xs: [], ys: [], born: now, until: 0 });
    this.comb = st;
    const S = this.shiftAt(shifts);
    // pigment shear task: x += S(y) * 100 * (p(y, t) - p(y, prev))
    const pAt = (y: number, t: number) => {
      const rho = Math.min(ROWS - 1, Math.max(0, y / EBRU_UNITS - 0.5));
      const s = dur * (ROW_START + rho * ROW_STEP);
      return combEase(clamp01((t - s) / (dur * ROW_SPAN)));
    };
    this.tasks.push({
      start: now, end: now + dur,
      step: (t, pt) => {
        const tt = t - now, pp = pt - now;
        this.field.shear((y) => S(y) * EBRU_UNITS * (pAt(y, tt) - pAt(y, pp)));
        for (const tr of [...st.trails, ...this.trails]) for (let i = 0; i < tr.xs.length; i++) tr.xs[i] = tr.xs[i]! + S(tr.ys[i]!) * EBRU_UNITS * (pAt(tr.ys[i]!, tt) - pAt(tr.ys[i]!, pp));
        for (let r = 0; r < ROWS; r++) st.prog[r] = combEase(clamp01((tt - dur * (ROW_START + r * ROW_STEP)) / (dur * ROW_SPAN)));
        if (!this.reduced) this.combTeeth(st, tt, pp, S);
        this.field.refine();
        this.pigDirty = true;
      },
      done: () => {
        st.endedAt = this.now();
        for (const tr of st.trails) { tr.until = st.endedAt + 1.6; this.trails.push(tr); }
        if (this.stains) this.stains = shiftField(st.stainsFrom ?? this.stains, shifts);
        if (this.comb === st) this.comb = null;
      },
    });
    this.kick();
    return this.settle(this.reduced ? Math.min(durMs, 260) : durMs);
  }
  /** Stain field (free spins) as [col][row] values, 0 = none; null hides it. New / grown stains pop in. */
  setStains(field: readonly (readonly number[])[] | null) {
    const now = this.now();
    if (!field) { this.stains = null; this.kick(); return; }
    const prev = this.stains;
    this.stains = field.map((c) => c.slice());
    for (let c = 0; c < COLS; c++) {
      this.stainBorn[c] ??= [];
      for (let r = 0; r < ROWS; r++) {
        const v = this.stains[c]?.[r] ?? 0;
        const was = prev?.[c]?.[r] ?? 0;
        if (v !== was && v > 0) {
          this.stainBorn[c]![r] = now;
          if (!this.reduced && this.glows.length < MAX_GLOWS) {
            const tier = EBRU_STAIN_TIERS[ebruStainTier(v)]!;
            this.glows.push({ x: (c + 0.5) * EBRU_UNITS, y: (r + 0.5) * EBRU_UNITS, born: now, life: 0.8, r: 120, color: tier.glow, alpha: 0.8 });
          }
        }
      }
    }
    this.kick();
  }
  /** Big win: the whole surface blooms into a hatip-style flower ebru. */
  bloom(intensity = 1): Promise<void> {
    const now = this.now();
    const k = Math.max(0.5, Math.min(1.6, intensity));
    const cx = 350, cy = 350;
    const ringCols = ['#f2bf3c', '#e0283c', '#fff3dc', '#22c9c0', '#3d6cf0', '#ee79ad', '#f7901e', '#fff3dc'];
    const rings = 8;
    const t0 = now;
    // concentric drops (each pushes the previous ones outward → rings)
    for (let i = 0; i < rings; i++) this.growDrop(cx, cy, 34 + (rings - i) * 4, ringCols[i]!, t0 + i * 0.11, 0.55, 1);
    // satellite flowers
    const sat = 6;
    for (let s = 0; s < sat; s++) {
      const a = (s / sat) * Math.PI * 2 + Math.PI / 6;
      const x = cx + Math.cos(a) * 255 * k, y = cy + Math.sin(a) * 255 * k;
      for (let i = 0; i < 3; i++) this.growDrop(x, y, 26 - i * 3, ringCols[(s + i * 3) % ringCols.length]!, t0 + 0.35 + s * 0.06 + i * 0.09, 0.4, 1);
    }
    // petals: six awl strokes from outside toward the centre → a six-lobed hatip flower
    const petals = 6;
    for (let p = 0; p < petals; p++) {
      const a = (p / petals) * Math.PI * 2 - Math.PI / 2;
      const r0 = 300 * k, r1 = 70;
      this.awl(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, t0 + 1.25 + p * 0.07, 0.9, 30, 1.25, false);
    }
    // satellite tulips: one pull each from the outer side inward (heart / tulip)
    for (let s = 0; s < sat; s++) {
      const a = (s / sat) * Math.PI * 2 + Math.PI / 6;
      const x = cx + Math.cos(a) * 255 * k, y = cy + Math.sin(a) * 255 * k;
      this.awl(x + Math.cos(a) * 80, y + Math.sin(a) * 80, x - Math.cos(a) * 14, y - Math.sin(a) * 14, t0 + 1.7 + s * 0.05, 0.6, 16, 1.2, false);
    }
    for (let i = 0; i < 4; i++) this.ripples.push({ x: cx, y: cy, born: t0 + i * 0.22, life: 1.8, r: 360, color: i % 2 ? '#ffe7a0' : '#ffffff', strength: 1.4 });
    this.glows.push({ x: cx, y: cy, born: t0, life: 2.2, r: 420, color: '#ffd77a', alpha: 0.75 });
    this.bloomTarget = 1;
    if (!this.reduced) this.goldLeaf(Math.round(90 * k));
    this.later(3400, () => { if (this.mood !== 'bigwin') this.bloomTarget = 0; });
    return this.settle(this.reduced ? 300 : 3000);
  }
  /** Drops a pigment drop now (idle sprinkle; also handy for UI moments). */
  sprinkle(col?: number, row?: number, color?: string) {
    const now = this.now();
    const x = col === undefined ? rand(0, 700) : (col + 0.5) * EBRU_UNITS;
    const y = row === undefined ? rand(20, 680) : (row + 0.5) * EBRU_UNITS;
    const r = rand(24, 54);
    const dur = rand(1.6, 2.4);
    this.growDrop(x, y, r, color ?? pickOf(this.cfg.palette), now, dur, 1);
    // drop into drop: one or two more colours land in the same spot (concentric rings)
    const extra = Math.random() < 0.7 ? (Math.random() < 0.5 ? 2 : 1) : 0;
    for (let i = 1; i <= extra; i++) this.growDrop(x, y, r * (0.62 - i * 0.16), pickOf(this.cfg.palette), now + i * 0.45, dur * 0.8, 1);
    this.ripples.push({ x, y, born: now, life: 1.6, r: 70, color: '#fff6dc', strength: 0.5 });
    this.kick();
  }
  /** Gold-leaf flakes drifting over the water (front canvas). */
  goldLeaf(n = 60) {
    if (this.reduced) return;
    const now = this.now();
    for (let i = 0; i < n && this.leaves.length < MAX_LEAVES; i++) {
      this.leaves.push({ x: rand(-20, 720), y: rand(-160, 0), vx: rand(-20, 20), vy: rand(40, 110), rot: rand(0, 6.28), vr: rand(-3, 3), born: now + rand(0, 1.2), life: rand(2.6, 4.2), size: rand(6, 14), shade: rand(0, 1) });
    }
    this.kick();
  }
  /** Re-seed the water with a fresh battal pattern. */
  reset() { this.field = new MarbleField(); this.seedField(); this.trails = []; this.pigDirty = true; this.kick(); }
  get stats() {
    const f = this.frames;
    let sum = 0, worst = 0;
    for (let i = 1; i < f.length; i++) { const d = f[i]! - f[i - 1]!; sum += d; worst = Math.max(worst, d); }
    const avg = f.length > 1 ? sum / (f.length - 1) : 0;
    const dt = this.drawTimes;
    const drawAvg = dt.length ? dt.reduce((a, b) => a + b, 0) / dt.length : 0;
    return { fps: avg ? 1000 / avg : 0, avgMs: avg, worstMs: worst, drawMs: drawAvg, drawWorstMs: dt.length ? Math.max(...dt) : 0, polys: this.field.polys.length, verts: this.field.verts, ripples: this.ripples.length, glints: this.glints.length, leaves: this.leaves.length, running: this.running };
  }
  destroy() {
    this.disposed = true;
    this.stop();
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    this.observer?.disconnect();
    this.mq?.removeEventListener('change', this.onMotionPref);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /* ================================================================ internals: effects */
  private now() { return performance.now() / 1000; }
  private later(ms: number, fn: () => void) {
    const id = window.setTimeout(() => { this.timers.delete(id); if (!this.disposed) fn(); }, ms);
    this.timers.add(id);
  }
  /** Resolves after ms; first brings every task up to the wall clock (exact even while hidden). */
  private settle(ms: number) {
    return new Promise<void>((resolve) => this.later(ms, () => { this.flush(this.now()); resolve(); }));
  }
  private growDrop(x: number, y: number, r1: number, color: string, start: number, dur: number, alpha: number) {
    let poly: MarblePoly | null = null;
    let r = 0;
    this.tasks.push({
      start, end: start + dur,
      step: (t) => {
        const target = r1 * easeOut(clamp01((t - start) / dur));
        if (!poly) {
          poly = this.field.addDrop(x, y, Math.max(1.5, target), color, alpha, 1, start);
          r = Math.max(1.5, target);
          this.trimPolys();
        } else if (target > r) {
          this.field.push(x, y, r, target);
          r = target;
        }
        this.field.refine();
        this.pigDirty = true;
      },
    });
    this.kick();
  }
  /** An awl / tine tip moving from (x0, y0) to (x1, y1), dragging the water along. */
  private awl(x0: number, y0: number, x1: number, y1: number, start: number, dur: number, sigma: number, gain: number, ease: boolean) {
    this.tasks.push({
      start, end: start + dur,
      step: (t, pt) => {
        const a = ease ? easeOut(clamp01((pt - start) / dur)) : smooth(clamp01((pt - start) / dur));
        const b = ease ? easeOut(clamp01((t - start) / dur)) : smooth(clamp01((t - start) / dur));
        if (b <= a) return;
        // sub-step long moves so the kernel stays smooth
        const dx = (x1 - x0) * (b - a), dy = (y1 - y0) * (b - a);
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (sigma * 0.6)));
        for (let i = 0; i < n; i++) {
          const f = a + ((b - a) * (i + 0.5)) / n;
          this.field.drag(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, (dx / n) * gain, (dy / n) * gain, sigma);
        }
        this.field.refine();
        this.pigDirty = true;
      },
    });
    this.kick();
  }
  private trimPolys() {
    const ps = this.field.polys;
    let alive = 0;
    for (const p of ps) if (p.fadeFrom === undefined) alive++;
    const now = this.now();
    for (let i = 0; i < ps.length && alive > MAX_POLYS; i++) {
      if (ps[i]!.fadeFrom === undefined) { ps[i]!.fadeFrom = now; alive--; }
    }
  }
  /** Teeth: record trails, feather the pigment along their paths, glints at the tips. */
  private combTeeth(st: CombState, tt: number, pp: number, S: (y: number) => number) {
    const y = this.combY(st, tt), py = this.combY(st, pp);
    const sway = (yy: number) => S(yy) * EBRU_UNITS * 0.5 * smooth(clamp01((tt) / (st.dur * 0.25)));
    const x = 350 + sway(Math.max(0, Math.min(700, y)));
    const px = Number.isNaN(st.lastX) ? x : st.lastX;
    st.lastX = x; st.lastY = y;
    const my = (y - py) * 0.32, mx = (x - px) * 0.6;
    for (let i = 0; i < TEETH; i++) {
      const tx = x + (i - (TEETH - 1) / 2) * 50;
      const tr = st.trails[i]!;
      if (y > -30 && y < 730) {
        tr.xs.push(tx); tr.ys.push(y);
        if (tr.xs.length > 140) { tr.xs.shift(); tr.ys.shift(); }
        this.field.drag(tx, y, mx, my, 7);
        if (this.glints.length < MAX_GLINTS && Math.random() < 0.45 * st.amp) {
          this.glints.push({ x: tx + rand(-4, 4), y: y + rand(-3, 3), vx: rand(-30, 30) + mx * 4, vy: rand(-60, 10), born: this.now(), life: rand(0.35, 0.8), size: rand(1, 2.4), gold: Math.random() < 0.7 });
        }
      }
    }
  }
  private combY(st: CombState, t: number) {
    // linear travel: passes row r's centre at its slide's 35 % point
    const tc0 = st.dur * (ROW_START + 0.35 * ROW_SPAN);
    return 50 + ((t - tc0) / (st.dur * ROW_STEP)) * EBRU_UNITS;
  }
  private shiftAt(shifts: readonly number[]) {
    return (y: number) => {
      const rho = y / EBRU_UNITS - 0.5;
      if (rho <= 0) return shifts[0]!;
      if (rho >= ROWS - 1) return shifts[ROWS - 1]!;
      const i = Math.floor(rho), f = smooth(rho - i);
      return shifts[i]! + (shifts[i + 1]! - shifts[i]!) * f;
    };
  }
  private finishComb() {
    if (!this.comb) return;
    this.flush(this.comb.start + this.comb.dur + 0.001);
  }
  /** Advance every task to time t (synchronously). */
  private flush(t: number) {
    const keep: Task[] = [];
    // tasks carry their own previous time
    for (const task of this.tasks) {
      const prev = (task as Task & { _t?: number })._t ?? task.start;
      if (t < task.start) { keep.push(task); continue; }
      const now = Math.min(t, task.end);
      if (now > prev) task.step(now, prev, t);
      (task as Task & { _t?: number })._t = now;
      if (t >= task.end) task.done?.();
      else keep.push(task);
    }
    this.tasks = keep;
  }

  private seedField() {
    const f = this.field;
    const pal = MOODS.base.palette;
    const stone = (x: number, y: number, r: number) => {
      // battal stone: a drop, sometimes with a second colour dropped into it (rings)
      const p = f.addDrop(x, y, 1.5, pickOf(pal), 1, 1, -1);
      f.push(p.x[0]! - 1.5, p.y[0]!, 1.5, r);
      if (Math.random() < 0.55) {
        const q = f.addDrop(x, y, 1.5, pickOf(pal), 1, 1, -1);
        f.push(q.x[0]! - 1.5, q.y[0]!, 1.5, r * rand(0.35, 0.6));
      }
      f.refine();
    };
    for (let i = 0; i < 30; i++) stone(rand(0, 700), rand(-30, 730), rand(46, 92));
    // gelgit: an awl swept back and forth, then a soft wave
    for (let i = 0; i < 5; i++) { f.tine(0, 40 + i * 150, i % 2 ? -1 : 1, 0, 30, 22); f.refine(); }
    f.shear((y) => Math.sin((y / 700) * Math.PI * 2 * 1.5) * 22);
    f.refine();
    for (let i = 0; i < 16; i++) stone(rand(0, 700), rand(0, 700), rand(18, 40));
    this.pigDirty = true;
  }

  /* ================================================================ internals: lifecycle */
  private onVisibility = () => { if (document.hidden) this.stop(); else { this.flush(this.now()); this.start(); } };
  private onMotionPref = () => { this.reduced = !!this.mq?.matches; this.stop(); this.start(); };
  private start() {
    if (this.disposed) return;
    if (this.running || (typeof document !== 'undefined' && document.hidden)) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  /** Wake the loop (reduced motion: draw once and fade). */
  private kick() {
    if (this.reduced) {
      this.flush(this.now() + 60);
      this.fadeUntil = this.now() + 0.35;
    }
    this.start();
  }
  private stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.grid = this.gridOverride ?? { x: 0, y: 0, w: this.w, h: this.h };
    const raw = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.dpr = Math.min(1.5, raw);
    if (this.ctx) {
      this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
    }
    if (this.front && this.fctx) {
      const fr = this.front.getBoundingClientRect();
      this.frontOff = { x: fr.left - r.left, y: fr.top - r.top, w: Math.max(1, fr.width), h: Math.max(1, fr.height) };
      this.fdpr = Math.min(2, raw);
      this.front.width = Math.max(1, Math.round(this.frontOff.w * this.fdpr));
      this.front.height = Math.max(1, Math.round(this.frontOff.h * this.fdpr));
    }
    // pigment raster: about half resolution, capped
    const target = Math.min(420, Math.max(160, this.grid.w * 0.62));
    this.pigScale = target / 700;
    if (!this.pig) { this.pig = document.createElement('canvas'); this.pctx = this.pig.getContext('2d'); }
    this.pig.width = Math.round(700 * this.pigScale);
    this.pig.height = Math.round(700 * this.pigScale);
    this.pigDirty = true;
    this.start();
  }

  private tick = (ms: number) => {
    if (!this.running) return;
    this.frames.push(ms);
    if (this.frames.length > 120) this.frames.shift();
    const t0 = performance.now();
    const now = ms / 1000;
    const dt = Math.min(0.05, Math.max(0.001, (ms - this.last) / 1000));
    this.last = ms;
    this.update(now, dt);
    this.draw(now);
    this.drawTimes.push(performance.now() - t0);
    if (this.drawTimes.length > 120) this.drawTimes.shift();
    if (this.reduced && now > this.fadeUntil && !this.tasks.length) { this.running = false; return; }
    this.raf = requestAnimationFrame(this.tick);
  };

  private update(now: number, dt: number) {
    this.flush(now);
    if (!this.reduced && this.idle && now >= this.nextIdle && !this.comb) {
      this.sprinkle();
      this.nextIdle = now + rand(this.cfg.idleEvery[0], this.cfg.idleEvery[1]);
    }
    // faded-out polygons leave
    const ps = this.field.polys;
    if (ps.some((p) => p.fadeFrom !== undefined && now - p.fadeFrom > 1.4)) {
      this.field.polys = ps.filter((p) => p.fadeFrom === undefined || now - p.fadeFrom <= 1.4);
      this.pigDirty = true;
    } else if (ps.some((p) => p.fadeFrom !== undefined)) this.pigDirty = true;
    this.ripples = this.ripples.filter((r) => now - r.born < r.life);
    this.glows = this.glows.filter((g) => now - g.born < g.life);
    this.trails = this.trails.filter((t) => now < t.until);
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const g = this.glints[i]!;
      if (now - g.born > g.life) { this.glints.splice(i, 1); continue; }
      g.x += g.vx * dt; g.y += g.vy * dt; g.vx *= 1 - 2.4 * dt; g.vy *= 1 - 2.4 * dt;
    }
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i]!;
      if (now < l.born) continue;
      if (now - l.born > l.life) { this.leaves.splice(i, 1); continue; }
      l.rot += l.vr * dt; l.x += (l.vx + Math.sin(l.rot * 0.7) * 30) * dt; l.y += l.vy * dt;
    }
    const bt = this.mood === 'bigwin' ? 1 : this.bloomTarget;
    this.bloomLevel += (bt - this.bloomLevel) * Math.min(1, dt * 2.4);
  }

  /* ================================================================ drawing */
  private draw(now: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.pigDirty) this.renderPigment(now);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const g = this.grid;
    const s = g.w / 700;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x, g.y, g.w, g.h);
    ctx.clip();
    const fade = this.reduced ? clamp01(1 - (this.fadeUntil - now) / 0.35) : 1;
    /* pigment */
    if (this.pig) {
      ctx.globalAlpha = Math.min(1, (this.cfg.pigment + this.bloomLevel * 0.18) * (this.reduced ? 0.6 + 0.4 * fade : 1));
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.pig, g.x, g.y, g.w, g.h);
      ctx.globalAlpha = 1;
    }
    /* caustics: two drifting layers of the same tile (the comb shears them with the water) */
    if (this.causticPat) {
      ctx.globalCompositeOperation = 'lighter';
      const a = this.cfg.caustic + this.bloomLevel * 0.06;
      const t = this.reduced ? 0 : now;
      const layer = (scale: number, ox: number, oy: number, alpha: number) => {
        const pat = this.causticPat!;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pat;
        if (this.comb && !this.reduced) {
          // sheared in bands that follow the sliding rows
          const S = this.shiftAt(this.comb.shifts);
          const bands = 14;
          for (let b = 0; b < bands; b++) {
            const y0 = (b / bands) * 700, y1 = ((b + 1) / bands) * 700;
            const ym = (y0 + y1) / 2;
            const rho = Math.min(ROWS - 1, Math.max(0, ym / EBRU_UNITS - 0.5));
            const tt = now - this.comb.start;
            const p = combEase(clamp01((tt - this.comb.dur * (ROW_START + rho * ROW_STEP)) / (this.comb.dur * ROW_SPAN)));
            const dx = S(ym) * EBRU_UNITS * p * s;
            pat.setTransform(new DOMMatrix([scale, 0, 0, scale, g.x + ox + dx, g.y + oy]));
            ctx.fillRect(g.x, g.y + y0 * s, g.w, (y1 - y0) * s + 0.5);
          }
        } else {
          pat.setTransform(new DOMMatrix([scale, 0, 0, scale, g.x + ox, g.y + oy]));
          ctx.fillRect(g.x, g.y, g.w, g.h);
        }
      };
      const unit = g.w / 256;
      layer(unit * 1.15, (t * 9 * s) % (256 * unit * 1.15), (t * 5 * s) % (256 * unit * 1.15), a);
      layer(unit * 0.8, -((t * 6 * s) % (256 * unit * 0.8)), (t * 11 * s) % (256 * unit * 0.8), a * 0.75);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    /* stains under the cells */
    if (this.stains) this.drawStains(ctx, now, s);
    /* comb wake + trails */
    ctx.globalCompositeOperation = 'lighter';
    this.drawTrails(ctx, now, s);
    /* blooms */
    for (const gl of this.glows) {
      const k = (now - gl.born) / gl.life;
      if (k < 0) continue;
      const a = gl.alpha * (k < 0.18 ? k / 0.18 : 1 - (k - 0.18) / 0.82);
      const sp = this.sprite(gl.color);
      if (!sp || a <= 0.01) continue;
      const r = gl.r * (0.55 + 0.6 * easeOut(Math.min(1, k * 1.4))) * s;
      ctx.globalAlpha = a;
      ctx.drawImage(sp, g.x + gl.x * s - r, g.y + gl.y * s - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    /* ripples */
    for (const rp of this.ripples) {
      const k = (now - rp.born) / rp.life;
      if (k < 0 || k > 1) continue;
      const e = easeOut(k);
      for (let i = 0; i < 2; i++) {
        const kk = Math.max(0, e - i * 0.18);
        if (kk <= 0) continue;
        ctx.strokeStyle = rp.color;
        ctx.globalAlpha = (1 - k) * 0.42 * rp.strength * (i ? 0.55 : 1);
        ctx.lineWidth = Math.max(0.6, (2.2 - k * 1.6) * s * 2.2);
        ctx.beginPath();
        ctx.ellipse(g.x + rp.x * s, g.y + rp.y * s, rp.r * kk * s, rp.r * kk * s * 0.92, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    this.drawFront(now);
  }

  private renderPigment(now: number) {
    const pc = this.pctx, pig = this.pig;
    if (!pc || !pig) return;
    this.pigDirty = false;
    const sc = this.pigScale;
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.clearRect(0, 0, pig.width, pig.height);
    pc.lineJoin = 'round';
    const veinW = Math.max(0.8, 2.2 * sc);
    for (const p of this.field.polys) {
      let a = p.alpha;
      if (p.fadeFrom !== undefined) a *= Math.max(0, 1 - (now - p.fadeFrom) / 1.4);
      if (a <= 0.01) continue;
      let minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < p.x.length; i++) { const x = p.x[i]!; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      const offs = [0];
      if (minX < 0) offs.push(700);
      if (maxX > 700) offs.push(-700);
      if (minX < -700) offs.push(1400);
      if (maxX > 1400) offs.push(-1400);
      pc.globalAlpha = Math.min(1, a);
      pc.fillStyle = p.color;
      pc.strokeStyle = 'rgba(255,246,226,0.62)';
      pc.lineWidth = veinW;
      for (const o of offs) {
        pc.setTransform(sc, 0, 0, sc, o * sc, 0);
        pc.beginPath();
        pc.moveTo(p.x[0]!, p.y[0]!);
        for (let i = 1; i < p.x.length; i++) pc.lineTo(p.x[i]!, p.y[i]!);
        pc.closePath();
        pc.fill();
        pc.setTransform(1, 0, 0, 1, 0, 0);
        pc.stroke();
      }
    }
    pc.globalAlpha = 1;
    pc.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawStains(ctx: CanvasRenderingContext2D, now: number, s: number) {
    const g = this.grid;
    const st = this.comb;
    const field = st?.stainsFrom ?? this.stains!;
    ctx.globalCompositeOperation = 'lighter';
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const v = field[c]?.[r] ?? 0;
      if (!v) continue;
      const tier = ebruStainTier(v);
      const pal = EBRU_STAIN_TIERS[tier]!;
      const born = this.stainBorn[c]?.[r] ?? -10;
      const pop = this.reduced ? 1 : easeOut(clamp01((now - born) / 0.5));
      const pulse = this.reduced ? 1 : 0.86 + 0.14 * Math.sin(now * 2.2 + c * 1.3 + r * 0.7);
      const shift = st ? st.shifts[r]! * st.prog[r]! : 0;
      const xs = [c + shift];
      if (xs[0]! > COLS - 1) xs.push(xs[0]! - COLS);
      if (xs[0]! < 0) xs.push(xs[0]! + COLS);
      const rad = (58 + tier * 9) * s * pop;
      const blot = this.blotSprite(tier);
      const halo = this.sprite(pal.glow);
      for (const cc of xs) {
        const x = g.x + (cc + 0.5) * EBRU_UNITS * s, y = g.y + (r + 0.5) * EBRU_UNITS * s;
        if (halo) { ctx.globalAlpha = 0.42 * pulse * pop; ctx.drawImage(halo, x - rad * 1.5, y - rad * 1.5, rad * 3, rad * 3); }
        if (blot) { ctx.globalAlpha = 0.85 * pop; ctx.drawImage(blot, x - rad, y - rad, rad * 2, rad * 2); }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawTrails(ctx: CanvasRenderingContext2D, now: number, s: number) {
    const g = this.grid;
    const all: Array<[Trail, number]> = [];
    if (this.comb) for (const t of this.comb.trails) all.push([t, 1]);
    for (const t of this.trails) all.push([t, clamp01((t.until - now) / 1.6)]);
    if (!all.length) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const [t, k] of all) {
        if (t.xs.length < 2) continue;
        ctx.strokeStyle = pass ? 'rgba(255,248,225,1)' : 'rgba(255,196,90,1)';
        ctx.globalAlpha = (pass ? 0.34 : 0.16) * k;
        ctx.lineWidth = (pass ? 1.1 : 4.2) * Math.max(0.8, s * 1.6);
        ctx.beginPath();
        ctx.moveTo(g.x + t.xs[0]! * s, g.y + t.ys[0]! * s);
        for (let i = 1; i < t.xs.length; i++) ctx.lineTo(g.x + t.xs[i]! * s, g.y + t.ys[i]! * s);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private setFrontVisible(on: boolean) {
    if (!this.front || this.frontShown === on) return;
    this.frontShown = on;
    this.front.style.visibility = on ? 'visible' : 'hidden';
  }

  private drawFront(now: number) {
    const ctx = this.fctx ?? this.ctx;
    if (!ctx) return;
    const own = ctx === this.fctx;
    const active = !!this.comb || this.glints.length > 0 || this.leaves.length > 0;
    if (own) {
      if (!active && !this.frontShown) return;
      ctx.setTransform(this.fdpr, 0, 0, this.fdpr, 0, 0);
      ctx.clearRect(0, 0, this.frontOff.w, this.frontOff.h);
      this.setFrontVisible(active);
      if (!active) return;
      ctx.translate(-this.frontOff.x, -this.frontOff.y);
    }
    const g = this.grid;
    const s = g.w / 700;
    /* the comb */
    const st = this.comb;
    if (st && !this.reduced && this.combSprite && this.combReady) {
      const tt = now - st.start;
      const y = this.combY(st, tt);
      const S = this.shiftAt(st.shifts);
      const x = 350 + S(Math.max(0, Math.min(700, y))) * EBRU_UNITS * 0.5 * smooth(clamp01(tt / (st.dur * 0.25)));
      const a = clamp01(tt / (st.dur * 0.08)) * clamp01((st.dur - tt) / (st.dur * 0.12));
      const tilt = (S(Math.max(0, Math.min(700, y + 40))) - S(Math.max(0, Math.min(700, y - 40)))) * 0.05;
      // sprite: 840 × 210 art units; tines' tips at y = 196
      const wS = 840 * s * 0.86, hS = 210 * s * 0.86;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(g.x + x * s, g.y + y * s);
      ctx.rotate(Math.max(-0.08, Math.min(0.08, tilt)));
      // soft gold light under the comb
      const halo = this.sprite('#ffd36a');
      if (halo) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.35; ctx.drawImage(halo, -wS * 0.55, -hS * 0.9, wS * 1.1, hS * 1.4); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a; }
      ctx.drawImage(this.combSprite, -wS / 2, -hS * (196 / 210), wS, hS);
      ctx.restore();
    }
    /* glints */
    if (this.glints.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const gl of this.glints) {
        const k = (now - gl.born) / gl.life;
        const a = (1 - k) * 0.95;
        ctx.fillStyle = gl.gold ? `rgba(255,214,120,${a.toFixed(3)})` : `rgba(255,255,255,${a.toFixed(3)})`;
        const r = gl.size * Math.max(0.8, s * 1.4);
        ctx.beginPath();
        ctx.arc(g.x + gl.x * s, g.y + gl.y * s, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    /* gold leaf */
    for (const l of this.leaves) {
      if (now < l.born) continue;
      const k = (now - l.born) / l.life;
      const a = k < 0.1 ? k / 0.1 : k > 0.8 ? (1 - k) / 0.2 : 1;
      const flip = Math.cos(l.rot * 1.7);
      const lum = 0.55 + 0.45 * Math.abs(flip);
      ctx.save();
      ctx.globalAlpha = a * 0.95;
      ctx.translate(g.x + l.x * s, g.y + l.y * s);
      ctx.rotate(l.rot);
      ctx.scale(1, Math.max(0.15, Math.abs(flip)));
      const sz = l.size * s * 1.3;
      ctx.fillStyle = `rgb(${Math.round(255 * lum)},${Math.round((196 + l.shade * 30) * lum)},${Math.round((70 + l.shade * 50) * lum)})`;
      ctx.beginPath();
      ctx.moveTo(-sz, -sz * 0.6); ctx.lineTo(sz * 0.8, -sz * 0.8); ctx.lineTo(sz, sz * 0.5); ctx.lineTo(-sz * 0.6, sz * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (own) ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ================================================================ sprites */
  private sprite(color: string) {
    let c = this.glowSprites.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    if (!g) return null;
    const grd = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    grd.addColorStop(0, hexA(color, 0.9));
    grd.addColorStop(0.3, hexA(color, 0.42));
    grd.addColorStop(0.65, hexA(color, 0.12));
    grd.addColorStop(1, hexA(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 96, 96);
    this.glowSprites.set(color, c);
    return c;
  }
  /** Irregular marbled pigment blot per stain tier (pre-rendered once). */
  private blotSprite(tier: EbruStainTier) {
    const key = `blot${tier}`;
    let c = this.glowSprites.get(key);
    if (c) return c;
    const pal = EBRU_STAIN_TIERS[tier]!;
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (!g) return null;
    const rnd = ebruRng(91 + tier * 17);
    const ring = (r: number, wob: number, fill: string, a: number) => {
      g.beginPath();
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        const rr = r * (1 + wob * Math.sin(t * 3 + tier) * 0.6 + wob * Math.sin(t * 5 + 1.7 + tier * 2) * 0.4);
        const x = 64 + Math.cos(t) * rr, y = 64 + Math.sin(t) * rr;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.globalAlpha = a;
      g.fillStyle = fill;
      g.fill();
    };
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, hexA(pal.light, 0.9));
    grd.addColorStop(0.45, hexA(pal.base, 0.55));
    grd.addColorStop(0.8, hexA(pal.deep, 0.18));
    grd.addColorStop(1, hexA(pal.deep, 0));
    ring(60, 0.08, pal.deep, 0.25);
    g.globalAlpha = 1;
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    ring(40, 0.12, pal.base, 0.28);
    ring(26, 0.1, pal.light, 0.22);
    // a few paper-white veins
    g.globalAlpha = 0.35;
    g.strokeStyle = '#fff8ea';
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      const r0 = 18 + i * 12 + rnd() * 4;
      for (let k = 0; k <= 30; k++) {
        const t = (k / 30) * Math.PI * 2;
        const rr = r0 * (1 + 0.1 * Math.sin(t * 4 + i));
        const x = 64 + Math.cos(t) * rr, y = 64 + Math.sin(t) * rr;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    this.glowSprites.set(key, c);
    return c;
  }
  /** Tileable caustic net: cellular F2 − F1 ridges on a 256 tile (once). */
  private buildCaustic() {
    if (typeof document === 'undefined') return;
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    if (!g) return;
    const rnd = ebruRng(4242);
    const pts: number[] = [];
    const P = 11;
    for (let i = 0; i < P; i++) pts.push(rnd() * N, rnd() * N);
    const img = g.createImageData(N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let f1 = 1e9, f2 = 1e9;
      for (let i = 0; i < P; i++) {
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const dx = pts[2 * i]! + ox * N - x, dy = pts[2 * i + 1]! + oy * N - y;
          const dd = dx * dx + dy * dy;
          if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
        }
      }
      const e = Math.sqrt(f2) - Math.sqrt(f1);
      const v = Math.exp(-e / 3.2) * 0.9 + Math.exp(-e / 12) * 0.18;
      const i4 = (y * N + x) * 4;
      d[i4] = 210; d[i4 + 1] = 240; d[i4 + 2] = 255; d[i4 + 3] = Math.min(255, Math.round(v * 255));
    }
    g.putImageData(img, 0, 0);
    this.caustic = c;
    this.causticPat = this.ctx?.createPattern(c, 'repeat') ?? null;
  }
  private loadComb() {
    if (typeof Image === 'undefined') return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { this.combReady = true; };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(COMB_SVG)}`;
    this.combSprite = img;
  }
}

/** Shift a [col][row] field with the comb's row shifts: new[(c + s) mod 7][r] = old[c][r]. */
export function shiftField(field: readonly (readonly number[])[], shifts: readonly number[]): number[][] {
  const out: number[][] = Array.from({ length: COLS }, () => new Array(ROWS).fill(0));
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    const s = shifts[r] ?? 0;
    out[(((c + s) % COLS) + COLS) % COLS]![r] = field[c]?.[r] ?? 0;
  }
  return out;
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* The FX comb (Altın Tarak) — 840 × 210 art units, tines' tips at y = 196. Original drawing: a gilded spine
   with a rumi-scroll engraving, a turquoise-and-ruby medallion, tulip finials and 15 tapered tines. */
const COMB_SVG = (() => {
  const teeth: string[] = [];
  for (let i = 0; i < 15; i++) {
    const x = 70 + i * 50;
    teeth.push(`<path d="M${x - 5.5} 92L${x - 2.4} 188Q${x} 197 ${x + 2.4} 188L${x + 5.5} 92Z" fill="url(#tg)" stroke="#5a3204" stroke-width="1.6"/>`);
    teeth.push(`<path d="M${x - 2.6} 96L${x - 0.8} 184" stroke="#fff6c8" stroke-width="1.4" stroke-linecap="round" opacity=".85"/>`);
  }
  const scroll: string[] = [];
  for (let i = 0; i < 12; i++) {
    const x = 118 + i * 56;
    if (Math.abs(x - 420) < 70) continue;
    const dir = i % 2 ? -1 : 1;
    scroll.push(`<path d="M${x - 24} 72Q${x - 12} ${72 - 16 * dir} ${x} 72T${x + 24} 72" fill="none" stroke="#6b3a05" stroke-width="2.4" stroke-linecap="round"/>`);
    scroll.push(`<circle cx="${x}" cy="${72 - 8 * dir}" r="3.2" fill="#fff1b8" stroke="#6b3a05" stroke-width="1.2"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 210" width="1680" height="420">
<defs>
<linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe0"/><stop offset=".22" stop-color="#ffe07a"/><stop offset=".55" stop-color="#e8a52a"/><stop offset=".82" stop-color="#9a5a0c"/><stop offset="1" stop-color="#5a3204"/></linearGradient>
<linearGradient id="tg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a4f0a"/><stop offset=".4" stop-color="#ffe9a0"/><stop offset=".6" stop-color="#f2bb46"/><stop offset="1" stop-color="#7a4206"/></linearGradient>
<radialGradient id="tq" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#e6fffb"/><stop offset=".35" stop-color="#3ee0d0"/><stop offset="1" stop-color="#05535a"/></radialGradient>
<radialGradient id="rb" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#ffd8d0"/><stop offset=".4" stop-color="#e8283c"/><stop offset="1" stop-color="#5a0614"/></radialGradient>
</defs>
${teeth.join('')}
<path d="M44 52Q420 30 796 52L806 70Q812 84 800 96Q420 112 40 96Q28 84 34 70Z" fill="url(#sg)" stroke="#4a2803" stroke-width="3"/>
<path d="M52 58Q420 38 788 58" fill="none" stroke="#fffbe6" stroke-width="3" stroke-linecap="round" opacity=".85"/>
<path d="M48 90Q420 104 792 90" fill="none" stroke="#5a3204" stroke-width="2" opacity=".7"/>
${scroll.join('')}
<path d="M10 74Q-2 50 22 34Q30 52 46 56Q30 66 34 84Q18 90 10 74Z" fill="url(#sg)" stroke="#4a2803" stroke-width="2.4"/>
<path d="M830 74Q842 50 818 34Q810 52 794 56Q810 66 806 84Q822 90 830 74Z" fill="url(#sg)" stroke="#4a2803" stroke-width="2.4"/>
<circle cx="24" cy="62" r="6" fill="url(#rb)" stroke="#4a2803" stroke-width="1.4"/><circle cx="816" cy="62" r="6" fill="url(#rb)" stroke="#4a2803" stroke-width="1.4"/>
<path d="M420 6Q470 12 478 64Q470 112 420 120Q370 112 362 64Q370 12 420 6Z" fill="url(#sg)" stroke="#4a2803" stroke-width="3"/>
<path d="M420 20Q456 26 462 64Q456 100 420 106Q384 100 378 64Q384 26 420 20Z" fill="#5a3204"/>
<ellipse cx="420" cy="63" rx="36" ry="38" fill="url(#tq)" stroke="#2a1604" stroke-width="2"/>
<path d="M420 40Q440 52 432 70Q426 82 420 88Q414 82 408 70Q400 52 420 40Z" fill="url(#rb)" stroke="#3a0408" stroke-width="1.6"/>
<path d="M407 48Q412 38 424 40" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>
<path d="M370 30Q360 64 376 100M470 30Q480 64 464 100" fill="none" stroke="#fff3c0" stroke-width="2" opacity=".7"/>
</svg>`;
})();
