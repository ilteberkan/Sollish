/* Asena: Yıldız Kurdu — canvas FX engine.

   Two canvases share one wall-clock loop:
     sky    behind the scene silhouettes: cached starfield, twinkles, three aurora curtains that react to wins,
            shooting stars, the constellation "sky echo" (the same shape drawn large in the sky behind the board),
            and the sky gate of a big win. Drawn at ≤ 1.25 dpr and ~30 fps while idle, 60 fps while anything reacts.
     front  over the frame: constellation tracers / node flashes / multiplier text, cluster bursts into stars,
            wolf-walk dust and stardust, moon halos and tease, star flights to the sky map, Ergenekon cracks and
            embers, howl waves, the star shower of a big win.
   Coordinates are CSS px relative to the `root` element (both canvases cover it); board units (600 × 600) map onto
   the board element's rect, so effects line up with cells at any size.

   Presentation only; Math.random is cosmetic. Wall-clock time: every effect is a pure function of (now − born),
   so a slow frame or a hidden tab never desynchronises it. The loop stops while the document is hidden; every
   promise resolves on a timer. Reduced motion: no particles or motion, the sky is drawn once (aurora frozen,
   echoes drawn complete) and promises resolve almost at once. Counts are capped (MAX_*). */

import { AS_CELL, AS_UNITS, type AsPoint, type AsPos, type AsenaConstellationPlan } from './geometry';

export type AsenaMood = 'base' | 'feature' | 'bigwin';
export interface AsenaFxOptions {
  /** Element both canvases cover (scene root or lab stage). */
  root: HTMLElement;
  /** Front canvas (over the board). */
  front: HTMLCanvasElement;
  /** Sky canvas (behind the scene silhouettes). Optional. */
  sky?: HTMLCanvasElement | null;
  /** Echo canvas (above the silhouettes, under the board) for the sky echo; falls back to the sky canvas. */
  echo?: HTMLCanvasElement | null;
  /** The AsenaBoard element. */
  board?: HTMLElement | null;
  mood?: AsenaMood;
  reducedMotion?: boolean;
  /** Ambient sky motion (aurora, twinkles, shooting stars). Default true. */
  ambient?: boolean;
}
export interface AsenaFxStats { fps: number; avgMs: number; worstMs: number; drawMs: number; drawWorstMs: number; skyMs: number; particles: number; running: boolean }

type Kind = 'star' | 'spark' | 'dust' | 'mote' | 'ember' | 'fall';
interface Particle { kind: Kind; x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; color: string; g: number; drag: number; rot: number; vr: number }
interface Ring { x: number; y: number; born: number; life: number; r0: number; r1: number; color: string; width: number; alpha: number; a0?: number; a1?: number }
interface Flash { x: number; y: number; born: number; life: number; r: number; color: string; alpha: number }
interface TextFx { text: string; sub?: string; x: number; y: number; born: number; life: number; size: number; tone: 'gold' | 'ice' }
interface Halo { x: number; y: number; born: number; until: number; r: number; tease: boolean }
interface Tracer { ax: number; ay: number; bx: number; by: number; born: number; dur: number; color: string }
interface Echo { plan: AsenaConstellationPlan; born: number; hold: number; persist: boolean; residual: number; fadeAt: number | null }
interface Flyer { ax: number; ay: number; bx: number; by: number; lift: number; born: number; dur: number; color: string }
interface Crack { x: number; y: number; born: number; life: number; lines: Array<Array<[number, number]>>; power: number }
interface Gate { born: number; life: number; intensity: number }
interface Shooting { x: number; y: number; vx: number; vy: number; born: number; life: number }

const MAX_PARTICLES = 650;
const MAX_RINGS = 48;
const MAX_FLASHES = 70;
const ICE = ['#ffffff', '#e6f4ff', '#bfe6ff', '#8fd0ff'];
const GOLD = ['#fff7d6', '#ffe28a', '#ffc04a', '#ff9a3a'];
const DUST = ['#c8b8a0', '#a89a8a', '#d8d0c8'];
const EMBER = ['#fff2c0', '#ffb84a', '#ff7a2a', '#ff4a1a'];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const LINK_GAP = 31;

export class AsenaFx {
  private readonly root: HTMLElement;
  private readonly front: HTMLCanvasElement;
  private sky: HTMLCanvasElement | null;
  private board: HTMLElement | null;
  private readonly fctx: CanvasRenderingContext2D | null;
  private sctx: CanvasRenderingContext2D | null;
  private echoCanvas: HTMLCanvasElement | null;
  private ectx: CanvasRenderingContext2D | null;
  private mood: AsenaMood;
  private reduced: boolean;
  private ambient: boolean;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private sdpr = 1;
  private bx = 0;
  private by = 0;
  private bs = 1;
  private font = 'system-ui, sans-serif';
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private texts: TextFx[] = [];
  private halos: Halo[] = [];
  private tracers: Tracer[] = [];
  private echoes: Echo[] = [];
  private flyers: Flyer[] = [];
  private cracks: Crack[] = [];
  private gate: Gate | null = null;
  private shooting: Shooting[] = [];
  private boost: Array<{ born: number; life: number; amount: number }> = [];
  private storm = 0;
  private stormUntil = 0;
  private sprites = new Map<string, HTMLCanvasElement>();
  private auroraSprites = new Map<string, HTMLCanvasElement>();
  private starLayer: HTMLCanvasElement | null = null;
  private twinkles: Array<[number, number, number, number]> = [];
  private raf = 0;
  private running = false;
  private disposed = false;
  private observer: ResizeObserver | null = null;
  private mq: MediaQueryList | null = null;
  private timers = new Set<number>();
  private frames: number[] = [];
  private drawTimes: number[] = [];
  private skyTimes: number[] = [];
  private last = 0;
  private lastSky = 0;
  private skyDirty = true;
  private epoch = performance.now() / 1000;

  constructor(o: AsenaFxOptions) {
    this.root = o.root;
    this.front = o.front;
    this.sky = o.sky ?? null;
    this.board = o.board ?? null;
    this.fctx = this.front.getContext('2d');
    this.sctx = this.sky?.getContext('2d') ?? null;
    this.echoCanvas = o.echo ?? null;
    this.ectx = this.echoCanvas?.getContext('2d') ?? null;
    this.mood = o.mood ?? 'base';
    this.ambient = o.ambient ?? true;
    this.mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = o.reducedMotion ?? !!this.mq?.matches;
    this.mq?.addEventListener('change', this.onMotion);
    document.addEventListener('visibilitychange', this.onVisibility);
    const fam = getComputedStyle(document.body).getPropertyValue('--font-barlow').trim();
    if (fam) this.font = `${fam}, 'Arial Narrow', system-ui, sans-serif`;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.root);
      if (this.board) this.observer.observe(this.board);
    }
    this.scheduleShooting(4000);
  }

  /* ================================================================ public API */
  setMood(m: AsenaMood) { this.mood = m; this.skyDirty = true; this.kick(); }
  setBoard(el: HTMLElement | null) { if (this.board && this.observer) this.observer.unobserve(this.board); this.board = el; if (el) this.observer?.observe(el); this.resize(); }
  setSky(el: HTMLCanvasElement | null) { this.sky = el; this.sctx = el?.getContext('2d') ?? null; this.resize(); }
  get stats(): AsenaFxStats {
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const f = avg(this.frames);
    return { fps: f ? 1000 / f : 0, avgMs: f, worstMs: this.frames.length ? Math.max(...this.frames) : 0, drawMs: avg(this.drawTimes), drawWorstMs: this.drawTimes.length ? Math.max(...this.drawTimes) : 0, skyMs: avg(this.skyTimes), particles: this.parts.length, running: this.running };
  }
  /** Root-relative px of a board point (board units). */
  toPx(p: AsPoint): AsPoint { const k = this.bs / AS_UNITS; return { x: this.bx + p.x * k, y: this.by + p.y * k }; }
  /** Root-relative px of a cell centre. */
  cell(col: number, row: number): AsPoint { return this.toPx({ x: col * AS_CELL + AS_CELL / 2, y: row * AS_CELL + AS_CELL / 2 }); }
  /** Root-relative px of an element's centre (sky-map tiles, scene points). */
  centerOf(el: Element | null): AsPoint | null {
    if (!el) return null;
    const r = el.getBoundingClientRect(), o = this.root.getBoundingClientRect();
    return { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top };
  }
  /** Board side in px (cell = /6). */
  get boardSize() { return this.bs; }

  /** The aurora brightens and quickens for a moment (wins react: amount 0.2 small … 1.5 big). */
  pulse(amount = 0.5, ms = 2200) { if (this.reduced) return; this.boost.push({ born: this.now(), life: ms / 1000, amount }); if (this.boost.length > 8) this.boost.shift(); this.kick(); }

  /** Small glints over winning cells and an aurora pulse scaled by the win. */
  clusterWin(cells: readonly AsPos[], color = '#bfe6ff', size = 1) {
    if (this.reduced || !cells.length) return;
    const now = this.now(), k = this.bs / 600;
    cells.forEach(([c, r], i) => {
      const p = this.cell(c, r);
      if (i % 2 === 0) this.addFlash({ x: p.x, y: p.y, born: now + i * 0.012, life: 0.5, r: 70 * k, color, alpha: 0.55 });
      for (let j = 0; j < 2; j++) this.push({ kind: 'star', x: p.x + rand(-30, 30) * k, y: p.y + rand(-30, 30) * k, vx: rand(-20, 20), vy: rand(-60, -20), born: now + rand(0, 0.3), life: rand(0.6, 1.1), size: rand(6, 11) * k, color: pick(ICE), g: 0, drag: 1, rot: 0, vr: 0 });
    });
    this.pulse(Math.min(1.2, 0.18 + size * 0.12));
  }

  /** The signature moment: the constellation is traced star to star over its cells (tracers + node flashes, in sync with
   * board.constellation(plan)), echoes large in the sky, then announces its multiplier. Resolves when the trace and the
   * announcement are done. `persist` keeps a faint echo in the sky (Ergenekon feature) until clearEcho(). */
  constellation(plan: AsenaConstellationPlan, opts: { persist?: boolean; label?: boolean; echo?: boolean } = {}): Promise<void> {
    const echo = opts.echo ?? true;
    if (echo && (this.sky || this.echoCanvas)) { this.echoes.push({ plan, born: this.now(), hold: 1.6, persist: !!opts.persist, residual: 0.2, fadeAt: null }); if (this.echoes.length > 8) this.echoes.shift(); this.skyDirty = true; }
    if (this.reduced) { this.kick(); return this.after(60); }
    const now = this.now(), k = this.bs / 600;
    for (const e of plan.edges) {
      const a = this.cell(e.a[0], e.a[1]), b = this.cell(e.b[0], e.b[1]);
      const L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, g = LINK_GAP * k;
      this.tracers.push({ ax: a.x + ux * g, ay: a.y + uy * g, bx: b.x - ux * g, by: b.y - uy * g, born: now + e.start / 1000, dur: Math.max(0.06, e.dur / 1000), color: '#dff2ff' });
    }
    plan.nodes.forEach(([c, r], i) => {
      const p = this.cell(c, r), t = plan.nodeAt[i]! / 1000, last = i === plan.nodes.length - 1;
      this.later(t * 1000, () => {
        const n = this.now();
        this.addFlash({ x: p.x, y: p.y, born: n, life: 0.55, r: (last ? 120 : 90) * k, color: last ? '#ffe7a0' : '#cfe8ff', alpha: 0.95 });
        this.addRing({ x: p.x, y: p.y, born: n, life: 0.5, r0: 20 * k, r1: 64 * k, color: '#ffffff', width: 3 * k + 1, alpha: 0.9 });
        this.burstAt(p, 7, 0.8, ICE);
      });
    });
    const c = this.toPx(plan.center);
    const endMs = plan.duration;
    this.later(endMs, () => {
      const n = this.now();
      this.addFlash({ x: c.x, y: c.y, born: n, life: 0.7, r: 260 * k, color: '#cfe8ff', alpha: 0.7 });
      this.addRing({ x: c.x, y: c.y, born: n, life: 0.7, r0: 40 * k, r1: 330 * k, color: '#e6f4ff', width: 5 * k + 1, alpha: 0.8 });
      if (opts.label ?? true) this.texts.push({ text: `×${plan.multiplier}`, sub: plan.name.toLocaleUpperCase('tr'), x: c.x, y: c.y, born: n, life: 1.5, size: (plan.multiplier >= 8 ? 128 : 104) * k, tone: plan.multiplier >= 6 ? 'gold' : 'ice' });
      this.pulse(0.4 + plan.multiplier * 0.08);
    });
    this.kick();
    return this.after(endMs + 650);
  }
  /** Fade out persistent sky echoes (end of the feature). */
  clearEcho() { const n = this.now(); for (const e of this.echoes) if (e.fadeAt === null || e.persist) { e.persist = false; e.fadeAt = n; } this.skyDirty = true; this.kick(); }

  /** Burst cells (AsenaStep.burst positions) into stars rising toward the sky. */
  burst(cells: readonly AsPos[], colors: readonly string[] = ICE): Promise<void> {
    if (this.reduced || !cells.length) return this.after(30);
    const now = this.now(), k = this.bs / 600;
    const per = Math.max(3, Math.min(9, Math.round(110 / cells.length)));
    cells.forEach(([c, r], i) => {
      const p = this.cell(c, r), d = Math.min(0.16, i * 0.012);
      this.addFlash({ x: p.x, y: p.y, born: now + d, life: 0.35, r: 80 * k, color: '#ffffff', alpha: 0.8 });
      for (let j = 0; j < per; j++) {
        const a = rand(-Math.PI, 0) + rand(-0.4, 0.4), v = rand(140, 420) * k * 1.6;
        this.push({ kind: 'star', x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60 * k, born: now + d + rand(0, 0.05), life: rand(0.7, 1.3), size: rand(7, 14) * k, color: pick(colors), g: -160 * k, drag: 2.4, rot: rand(0, 6), vr: rand(-4, 4) });
      }
      if (i % 3 === 0) this.push({ kind: 'spark', x: p.x, y: p.y, vx: rand(-200, 200) * k, vy: rand(-300, -60) * k, born: now + d, life: 0.4, size: 2.2 * k + 0.6, color: '#ffffff', g: 400 * k, drag: 2, rot: 0, vr: 0 });
    });
    this.kick();
    return this.after(420);
  }

  /** The wolf hops from → to (pair with board.wolfWalk, same duration): take-off dust, a stardust arc, landing puff and a
   * footprint sparkle on the new star-trail cell. */
  wolfWalk(from: AsPos, to: AsPos, opts: { duration?: number } = {}): Promise<void> {
    const dur = opts.duration ?? 640;
    if (this.reduced) return this.after(30);
    const now = this.now(), k = this.bs / 600;
    const a = this.cell(from[0], from[1]), b = this.cell(to[0], to[1]);
    const dust = (p: AsPoint, n: number, at: number) => { for (let i = 0; i < n; i++) { const ang = rand(Math.PI * 0.9, Math.PI * 2.1); this.push({ kind: 'dust', x: p.x + rand(-18, 18) * k, y: p.y + 42 * k, vx: Math.cos(ang) * rand(40, 120) * k, vy: Math.sin(ang) * rand(6, 24) * k - 10 * k, born: at + rand(0, 0.05), life: rand(0.5, 0.9), size: rand(8, 15) * k, color: pick(DUST), g: -20 * k, drag: 2, rot: 0, vr: 0 }); } };
    dust(a, 7, now);
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, t = now + u * dur * 0.84 / 1000;
      const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u - Math.sin(u * Math.PI) * 34 * k * (this.bs / 600) * 1.6;
      for (let j = 0; j < 2; j++) this.push({ kind: 'mote', x: x + rand(-10, 10) * k, y: y + rand(-6, 14) * k, vx: rand(-20, 20) * k, vy: rand(-30, 10) * k, born: t, life: rand(0.6, 1.2), size: rand(3, 6) * k + 0.6, color: pick(['#ffffff', '#bff4ff', '#ffe7a0']), g: 30 * k, drag: 1.5, rot: 0, vr: 0 });
    }
    this.later(dur * 0.2, () => { const n = this.now(); this.addFlash({ x: a.x, y: a.y, born: n, life: 0.7, r: 90 * k, color: '#9ff4ff', alpha: 0.8 }); this.burstAt(a, 6, 0.5, ['#ffffff', '#9ff4ff']); });
    this.later(dur * 0.84, () => {
      const n = this.now();
      dust(b, 9, n);
      this.addRing({ x: b.x, y: b.y + 30 * k, born: n, life: 0.45, r0: 10 * k, r1: 70 * k, color: '#ffe7a0', width: 3 * k + 1, alpha: 0.7 });
      this.burstAt(b, 8, 0.7, GOLD);
    });
    this.kick();
    return this.after(dur + 30);
  }

  /** Howl: sound-wave arcs opening upward from `at` (root px; default above the board) and an aurora surge. */
  howl(at?: AsPoint | null, opts: { power?: number } = {}): Promise<void> {
    const power = opts.power ?? 1;
    this.pulse(0.7 * power, 2600);
    if (this.reduced) return this.after(30);
    const p = at ?? { x: this.bx + this.bs / 2, y: this.by - this.bs * 0.04 };
    const k = Math.max(0.6, this.bs / 600);
    for (let i = 0; i < 4; i++) this.later(i * 170, () => this.addRing({ x: p.x, y: p.y, born: this.now(), life: 1.2, r0: 16 * k, r1: (230 + i * 50) * k * power, color: i % 2 ? '#bfe6ff' : '#ffffff', width: (5 - i) * k, alpha: 0.75 - i * 0.1, a0: -Math.PI * 0.86, a1: -Math.PI * 0.14 }));
    this.kick();
    return this.after(1100);
  }

  /** Ay Ata halos on moon cells. `tease` = two moons waiting (fast, small pulse with drifting stardust). */
  moons(cells: readonly AsPos[], opts: { hold?: number; tease?: boolean } = {}): Promise<void> {
    const hold = (opts.hold ?? 2400) / 1000, tease = !!opts.tease;
    if (this.reduced || !cells.length) return this.after(30);
    const now = this.now(), k = this.bs / 600;
    cells.forEach(([c, r], i) => {
      const p = this.cell(c, r);
      this.halos.push({ x: p.x, y: p.y, born: now + i * 0.12, until: now + hold, r: (tease ? 95 : 130) * k, tease });
      if (!tease) this.later(i * 120, () => { const n = this.now(); this.addRing({ x: p.x, y: p.y, born: n, life: 0.7, r0: 30 * k, r1: 150 * k, color: '#e8e8ff', width: 5 * k, alpha: 0.9 }); this.burstAt(p, 10, 1, ['#ffffff', '#e0e0ff', '#c8c8ff']); });
    });
    if (tease) for (let i = 0; i < 24; i++) { const [c, r] = cells[i % cells.length]!, p = this.cell(c, r), a = rand(0, Math.PI * 2), d = rand(80, 160) * k; this.push({ kind: 'mote', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 0.9, vy: -Math.sin(a) * d * 0.9, born: now + rand(0, hold * 0.8), life: 1, size: rand(2.4, 4.4) * k + 0.5, color: '#e8e8ff', g: 0, drag: 0.4, rot: 0, vr: 0 }); }
    if (!tease) this.pulse(0.6);
    this.kick();
    return this.after(tease ? 600 : 1200);
  }
  clearMoons() { this.halos = []; }

  /** A star flies from a board cell or root point to a target (sky-map tile); onArrive when it lands. */
  flyStar(from: AsPos | AsPoint, to: AsPoint, opts: { duration?: number; color?: string; onArrive?: () => void } = {}): Promise<void> {
    const dur = (opts.duration ?? 720) / 1000;
    const a = Array.isArray(from) ? this.cell((from as AsPos)[0], (from as AsPos)[1]) : (from as AsPoint);
    if (this.reduced) { opts.onArrive?.(); return this.after(30); }
    const now = this.now();
    this.flyers.push({ ax: a.x, ay: a.y, bx: to.x, by: to.y, lift: Math.min(220, 60 + Math.hypot(to.x - a.x, to.y - a.y) * 0.3), born: now, dur, color: opts.color ?? '#ffe7a0' });
    this.later(dur * 1000, () => {
      const n = this.now();
      this.addFlash({ x: to.x, y: to.y, born: n, life: 0.6, r: 70, color: opts.color ?? '#ffe7a0', alpha: 1 });
      this.addRing({ x: to.x, y: to.y, born: n, life: 0.5, r0: 6, r1: 46, color: '#ffffff', width: 2.4, alpha: 0.9 });
      this.burstAt(to, 8, 0.45, GOLD);
      opts.onArrive?.();
    });
    this.kick();
    return this.after(dur * 1000 + 60);
  }

  /** Ergenekon: the iron mountain cracks and glows at `at` (root px). level 1 (×2) … 3 (×5) grows the cracks and embers. */
  ergenekon(at: AsPoint, level = 1, opts: { scale?: number } = {}): Promise<void> {
    if (this.reduced) return this.after(30);
    const now = this.now(), s = (opts.scale ?? 1) * (0.8 + level * 0.25);
    const lines: Array<Array<[number, number]>> = [];
    const n = 3 + level * 2;
    for (let i = 0; i < n; i++) {
      let ang = -Math.PI / 2 + rand(-1.3, 1.3), x = 0, y = 0;
      const pts: Array<[number, number]> = [[0, 0]];
      const segs = 4 + Math.floor(rand(0, 3));
      for (let j = 0; j < segs; j++) { ang += rand(-0.6, 0.6); const L = rand(10, 22) * s; x += Math.cos(ang) * L; y += Math.sin(ang) * L * 0.8 + (j > 1 ? 6 * s : 0); pts.push([x, y]); }
      lines.push(pts);
    }
    this.cracks.push({ x: at.x, y: at.y, born: now, life: 2.2 + level * 0.4, lines, power: s });
    this.addFlash({ x: at.x, y: at.y, born: now, life: 0.8, r: 120 * s, color: '#ff9a3a', alpha: 0.95 });
    this.addRing({ x: at.x, y: at.y, born: now, life: 0.8, r0: 10, r1: 150 * s, color: '#ffcf7a', width: 4, alpha: 0.85 });
    for (let i = 0; i < 26 + level * 14; i++) this.push({ kind: 'ember', x: at.x + rand(-30, 30) * s, y: at.y + rand(-10, 20) * s, vx: rand(-60, 60) * s, vy: rand(-220, -60) * s, born: now + rand(0, 0.8), life: rand(0.9, 1.8), size: rand(2.4, 5) * s, color: pick(EMBER), g: -40, drag: 0.9, rot: 0, vr: 0 });
    this.pulse(0.5 + level * 0.25);
    this.kick();
    return this.after(1200);
  }

  /** Big win "Gök kapısı açılır": the sky gate opens over the board, an aurora storm, a star shower and a howl. */
  skyGate(intensity = 1, opts: { duration?: number; howlAt?: AsPoint | null } = {}): Promise<void> {
    const dur = (opts.duration ?? 3800) / 1000;
    if (this.reduced) return this.after(30);
    const now = this.now();
    this.gate = { born: now, life: dur, intensity };
    this.storm = Math.min(1.6, 0.8 + intensity * 0.5);
    this.stormUntil = now + dur;
    const gx = this.bx + this.bs / 2, gy = this.by + this.bs * 0.36;
    this.addFlash({ x: gx, y: gy, born: now + 0.3, life: 1, r: this.bs * 0.9, color: '#e6f4ff', alpha: 0.8 });
    const shower = (delay: number, n: number) => this.later(delay, () => {
      const t = this.now();
      for (let i = 0; i < n; i++) this.push({ kind: 'fall', x: rand(0, this.w), y: rand(-this.h * 0.2, this.h * 0.2), vx: rand(-40, 40), vy: rand(260, 520), born: t + rand(0, 1.4), life: rand(1.4, 2.4), size: rand(8, 18) * Math.max(0.7, this.bs / 700), color: pick(rand(0, 1) > 0.5 ? GOLD : ICE), g: 60, drag: 0.2, rot: rand(0, 6), vr: rand(-3, 3) });
      for (let i = 0; i < 20; i++) { const a = rand(0, Math.PI * 2), v = rand(160, 520); this.push({ kind: 'star', x: gx, y: gy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: t + rand(0, 0.2), life: rand(0.8, 1.4), size: rand(8, 16), color: pick(GOLD), g: 80, drag: 1.4, rot: 0, vr: 0 }); }
    });
    shower(250, Math.round(60 * intensity));
    shower(1300, Math.round(40 * intensity));
    this.later(500, () => void this.howl(opts.howlAt ?? null, { power: 1.3 }));
    this.kick();
    return this.after(dur * 1000);
  }

  /** Floating announcement text (multiplier, "+5 DÖNÜŞ"). */
  announce(text: string, at?: AsPoint | null, opts: { sub?: string; size?: number; tone?: 'gold' | 'ice'; life?: number } = {}) {
    if (this.reduced) return;
    const p = at ?? { x: this.bx + this.bs / 2, y: this.by + this.bs / 2 };
    this.texts.push({ text, sub: opts.sub, x: p.x, y: p.y, born: this.now(), life: (opts.life ?? 1600) / 1000, size: opts.size ?? Math.max(48, this.bs * 0.2), tone: opts.tone ?? 'gold' });
    this.kick();
  }

  /** Repaint the sky now (after layout changes or in reduced motion). */
  redrawSky() { this.skyDirty = true; this.kick(); if (this.reduced) this.drawSky(this.now()); }

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
  private push(p: Particle) { if (this.parts.length >= MAX_PARTICLES) this.parts.splice(0, this.parts.length - MAX_PARTICLES + 1); this.parts.push(p); }
  private addRing(r: Ring) { if (this.reduced) return; if (this.rings.length >= MAX_RINGS) this.rings.shift(); this.rings.push(r); this.kick(); }
  private addFlash(f: Flash) { if (this.reduced) return; if (this.flashes.length >= MAX_FLASHES) this.flashes.shift(); this.flashes.push(f); this.kick(); }
  private burstAt(p: AsPoint, n: number, power: number, colors: readonly string[]) {
    if (this.reduced) return;
    const now = this.now(), k = Math.max(0.5, this.bs / 600);
    for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), v = rand(80, 260) * power * k; this.push({ kind: i % 2 ? 'spark' : 'star', x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: now, life: rand(0.35, 0.8), size: i % 2 ? 1.8 * k + 0.4 : rand(5, 9) * k, color: pick(colors), g: 120 * k, drag: 2.6, rot: 0, vr: 0 }); }
    this.kick();
  }
  private scheduleShooting(ms: number) {
    this.later(ms, () => {
      if (this.ambient && !this.reduced && this.sky && document.visibilityState === 'visible') {
        const fromLeft = Math.random() > 0.5;
        this.shooting.push({ x: fromLeft ? rand(0, this.w * 0.5) : rand(this.w * 0.5, this.w), y: rand(0, this.h * 0.3), vx: (fromLeft ? 1 : -1) * rand(500, 900), vy: rand(160, 320), born: this.now(), life: rand(0.7, 1.1) });
        this.kick();
      }
      this.scheduleShooting(rand(5000, 12000) * (this.mood === 'base' ? 1 : 0.5));
    });
  }
  private onMotion = () => { this.reduced = !!this.mq?.matches; if (this.reduced) { this.parts = []; this.rings = []; this.flashes = []; this.texts = []; this.tracers = []; this.flyers = []; this.cracks = []; this.halos = []; this.gate = null; } this.redrawSky(); };
  private onVisibility = () => { if (document.visibilityState === 'hidden') this.stop(); else { this.skyDirty = true; this.kick(); } };
  private resize() {
    const r = this.root.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(this.w * this.h > 1.3e6 ? 1.5 : 2, window.devicePixelRatio || 1);
    this.sdpr = Math.min(1.25, window.devicePixelRatio || 1);
    this.front.width = Math.round(this.w * this.dpr);
    this.front.height = Math.round(this.h * this.dpr);
    if (this.sky) { this.sky.width = Math.round(this.w * this.sdpr); this.sky.height = Math.round(this.h * this.sdpr); }
    if (this.echoCanvas) { this.echoCanvas.width = Math.round(this.w * this.sdpr); this.echoCanvas.height = Math.round(this.h * this.sdpr); }
    const b = this.board?.getBoundingClientRect();
    if (b && b.width > 0) { this.bx = b.left - r.left; this.by = b.top - r.top; this.bs = b.width; }
    else { const s = Math.min(this.w, this.h) * 0.8; this.bx = (this.w - s) / 2; this.by = (this.h - s) / 2; this.bs = s; }
    this.buildStars();
    this.skyDirty = true;
    this.kick();
    if (this.reduced) this.drawSky(this.now());
  }
  private buildStars() {
    if (!this.sky) return;
    const c = this.starLayer ?? document.createElement('canvas');
    c.width = this.sky.width; c.height = this.sky.height;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const s = this.sdpr;
    let seed = 7;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // milky band: a soft diagonal haze of dust
    g.save();
    g.translate(c.width * 0.5, c.height * 0.3);
    g.rotate(-0.38);
    const band = g.createLinearGradient(0, -c.height * 0.16, 0, c.height * 0.16);
    band.addColorStop(0, 'rgba(120,140,255,0)'); band.addColorStop(0.5, 'rgba(150,160,255,0.09)'); band.addColorStop(1, 'rgba(120,140,255,0)');
    g.fillStyle = band; g.fillRect(-c.width, -c.height * 0.16, c.width * 2, c.height * 0.32);
    for (let i = 0; i < 260; i++) { const x = (r() - 0.5) * c.width * 2, y = (r() - 0.5) * (r() - 0.5) * c.height * 0.5; g.fillStyle = `rgba(220,226,255,${(0.15 + r() * 0.35).toFixed(2)})`; g.fillRect(x, y, s * 0.9, s * 0.9); }
    g.restore();
    const n = Math.round(Math.min(700, Math.max(160, (this.w * this.h) / 1700)));
    for (let i = 0; i < n; i++) {
      const x = r() * c.width, y = Math.pow(r(), 1.35) * c.height * 0.82, big = r();
      const rad = (big > 0.97 ? 1.6 : big > 0.85 ? 1.05 : 0.6) * s;
      g.fillStyle = r() > 0.85 ? '#ffe8c8' : r() > 0.7 ? '#c8d8ff' : '#f2f4ff';
      g.globalAlpha = 0.35 + r() * 0.6;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    this.starLayer = c;
    this.twinkles = Array.from({ length: 46 }, () => [r(), Math.pow(r(), 1.4) * 0.75, r() * Math.PI * 2, 0.6 + r() * 1.8] as [number, number, number, number]);
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
    const now = this.now();
    const t0 = performance.now();
    const frontAlive = this.drawFront(now);
    this.drawTimes.push(performance.now() - t0);
    if (this.drawTimes.length > 90) this.drawTimes.shift();
    // sky: ~30 fps idle, every frame while it reacts
    const reacting = this.skyReacting(now);
    const skyLive = !!(this.sky || this.echoCanvas) && !this.reduced && (this.ambient || reacting);
    if ((this.sky || this.echoCanvas) && (this.skyDirty || (skyLive && (reacting || ts - this.lastSky > 31)))) {
      const s0 = performance.now();
      this.drawSky(now);
      this.skyTimes.push(performance.now() - s0);
      if (this.skyTimes.length > 60) this.skyTimes.shift();
      this.lastSky = ts;
      this.skyDirty = false;
    }
    if (frontAlive || skyLive) this.raf = requestAnimationFrame(this.frame);
    else this.running = false;
  };
  private skyReacting(now: number) { return !!this.gate || this.echoes.some((e) => e.fadeAt === null || now - e.fadeAt < 1) || this.boost.length > 0 || this.shooting.length > 0 || now < this.stormUntil; }
  private sprite(color: string): HTMLCanvasElement {
    let s = this.sprites.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, color); grd.addColorStop(0.22, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const g2 = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    g2.addColorStop(0, 'rgba(255,255,255,0.95)'); g2.addColorStop(0.16, 'rgba(255,255,255,0)');
    g.fillStyle = g2; g.fillRect(0, 0, 64, 64);
    this.sprites.set(color, s);
    return s;
  }
  /** Four-point star sprite (white core, coloured flare). */
  private starSprite(color: string): HTMLCanvasElement {
    const key = `*${color}`;
    let s = this.sprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d')!;
    g.drawImage(this.sprite(color), 16, 16, 32, 32);
    g.translate(32, 32);
    g.fillStyle = color;
    for (const [rx, ry] of [[30, 3.2], [3.2, 30]] as const) { g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.globalAlpha = 0.7; g.fill(); }
    g.globalAlpha = 1; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -14); g.quadraticCurveTo(2, -2, 14, 0); g.quadraticCurveTo(2, 2, 0, 14); g.quadraticCurveTo(-2, 2, -14, 0); g.quadraticCurveTo(-2, -2, 0, -14); g.fill();
    this.sprites.set(key, s);
    return s;
  }
  private auroraSprite(color: string): HTMLCanvasElement {
    let s = this.auroraSprites.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = 8; s.height = 160;
    const g = s.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 160);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.45, color); grd.addColorStop(0.86, color); grd.addColorStop(0.9, '#ffffff'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 1; g.fillStyle = grd; g.fillRect(0, 0, 8, 160);
    // horizontal falloff so strips blend
    g.globalCompositeOperation = 'destination-in';
    const hz = g.createLinearGradient(0, 0, 8, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(0.5, 'rgba(0,0,0,1)'); hz.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hz; g.fillRect(0, 0, 8, 160);
    this.auroraSprites.set(color, s);
    return s;
  }

  /* ---------------------------------------------------------------- sky */
  private drawSky(nowAbs: number) {
    const ctx = this.sctx ?? this.ectx;
    if (!ctx) return;
    const now = this.reduced ? 0 : nowAbs - this.epoch;
    const W = this.w, H = this.h;
    ctx.setTransform(this.sdpr, 0, 0, this.sdpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (this.starLayer && this.sctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.starLayer, 0, 0); ctx.setTransform(this.sdpr, 0, 0, this.sdpr, 0, 0); }
    // boost from wins + storm
    let boost = 0;
    this.boost = this.boost.filter((b) => nowAbs - b.born < b.life);
    for (const b of this.boost) { const t = (nowAbs - b.born) / b.life; boost += b.amount * Math.sin(Math.min(1, t * 4) * Math.PI / 2) * (1 - t); }
    const storm = nowAbs < this.stormUntil ? this.storm * Math.sin(clamp01((this.stormUntil - nowAbs) / 0.8) * Math.PI / 2) : 0;
    // twinkles
    ctx.globalCompositeOperation = 'lighter';
    for (const [fx, fy, ph, sp] of this.twinkles) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * sp + ph)) ** 3;
      const r = 6 + a * 5;
      ctx.globalAlpha = a * 0.9;
      ctx.drawImage(this.starSprite('#cfe0ff'), fx * W - r, fy * H - r, r * 2, r * 2);
    }
    // aurora curtains
    const level = (this.mood === 'feature' ? 0.85 : this.mood === 'bigwin' ? 1.05 : 0.55) + boost * 0.6 + storm;
    const speed = 1 + boost * 1.4 + storm * 2.4;
    const curtains = this.mood === 'feature' || storm > 0.2
      ? [{ y: 0.22, amp: 0.05, h: 0.26, color: '#3fe6ff', a: 0.5, f: 2.1, s: 0.11, ph: 0 }, { y: 0.3, amp: 0.06, h: 0.3, color: '#6dffb4', a: 0.62, f: 1.6, s: 0.08, ph: 2 }, { y: 0.17, amp: 0.04, h: 0.2, color: storm > 0.2 ? '#ff7ad8' : '#a982ff', a: 0.42, f: 2.6, s: 0.14, ph: 4 }]
      : [{ y: 0.24, amp: 0.05, h: 0.24, color: '#45e8c4', a: 0.5, f: 1.8, s: 0.09, ph: 0 }, { y: 0.31, amp: 0.05, h: 0.26, color: '#6dffb4', a: 0.44, f: 1.3, s: 0.07, ph: 2 }, { y: 0.19, amp: 0.035, h: 0.18, color: '#9a84ff', a: 0.3, f: 2.4, s: 0.12, ph: 4 }];
    const n = W < 600 ? 44 : 70;
    const sw = (W * 1.3) / n;
    for (const c of curtains) {
      const spr = this.auroraSprite(c.color);
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), x = -W * 0.15 + u * W * 1.3;
        const tt = now * c.s * speed;
        const base = H * (c.y + c.amp * Math.sin(u * c.f * 3.1 + tt * 3 + c.ph) + c.amp * 0.6 * Math.sin(u * c.f * 7.3 - tt * 5 + c.ph * 1.7));
        const hh = H * c.h * (0.65 + 0.35 * Math.sin(u * 9.1 + tt * 4 + c.ph));
        const shimmer = 0.5 + 0.5 * Math.sin(u * 23 + tt * 11 + c.ph * 3);
        const a = level * c.a * (0.35 + 0.65 * shimmer) * (0.4 + 0.6 * Math.sin(u * Math.PI) ** 0.6);
        if (a <= 0.01) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(spr, x - sw * 0.8, base - hh * 0.86, sw * 2.6, hh);
      }
    }
    // shooting stars
    this.shooting = this.shooting.filter((s) => nowAbs - s.born < s.life);
    for (const s of this.shooting) {
      const t = nowAbs - s.born, u = t / s.life;
      const x = s.x + s.vx * t, y = s.y + s.vy * t;
      const grd = ctx.createLinearGradient(x, y, x - s.vx * 0.18, y - s.vy * 0.18);
      grd.addColorStop(0, `rgba(255,255,255,${(1 - u).toFixed(3)})`); grd.addColorStop(1, 'rgba(160,200,255,0)');
      ctx.globalAlpha = 1; ctx.strokeStyle = grd; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s.vx * 0.18, y - s.vy * 0.18); ctx.stroke();
    }
    // sky gate
    if (this.gate) {
      const g = this.gate, t = (nowAbs - g.born) / g.life;
      if (t >= 1) this.gate = null;
      else if (t >= 0) {
        const gx = this.bx + this.bs / 2, gy = this.by + this.bs * 0.36;
        const open = easeOut(clamp01(t / 0.25)) * (1 - easeInOut(clamp01((t - 0.75) / 0.25)));
        const R = Math.max(W, H) * 1.1;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(now * 0.25);
        for (let i = 0; i < 18; i++) {
          ctx.rotate((Math.PI * 2) / 18);
          const grd = ctx.createLinearGradient(0, 0, R, 0);
          grd.addColorStop(0, `rgba(220,240,255,${(0.28 * open * g.intensity).toFixed(3)})`); grd.addColorStop(1, 'rgba(120,200,255,0)');
          ctx.fillStyle = grd; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, -R * (i % 2 ? 0.05 : 0.09)); ctx.lineTo(R, R * (i % 2 ? 0.05 : 0.09)); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }
    // sky echoes (own canvas above the silhouettes when given)
    this.echoes = this.echoes.filter((e) => e.persist || e.fadeAt === null || nowAbs - e.fadeAt < 1.2);
    const ec = this.ectx ?? ctx;
    if (this.ectx) { ec.setTransform(this.sdpr, 0, 0, this.sdpr, 0, 0); ec.clearRect(0, 0, W, H); ec.globalCompositeOperation = 'lighter'; }
    for (const e of this.echoes) this.drawEcho(ec, e, nowAbs);
    for (const c of [ctx, ec]) { c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
  }
  private drawEcho(ctx: CanvasRenderingContext2D, e: Echo, nowAbs: number) {
    const p = e.plan;
    const ms = this.reduced ? p.duration + 1 : (nowAbs - e.born) * 1000;
    if (e.fadeAt === null && ms > p.duration + e.hold * 1000) e.fadeAt = nowAbs;
    let alpha = 1;
    if (e.fadeAt !== null) { const f = clamp01((nowAbs - e.fadeAt) / 1.2); alpha = e.persist ? 1 - (1 - e.residual) * f : 1 - f; }
    if (this.reduced && e.fadeAt === null) alpha = e.persist ? 0.5 : 0.8;
    // centre over the board, scaled up: the shape fills ~1.3 board heights
    const cellPx = (Math.min(this.bs * 1.6, Math.max(this.h, this.bs) * 0.95)) / Math.max(4, Math.max(p.width, p.height));
    const ox = this.bx + this.bs / 2 - (p.width * cellPx) / 2, oy = this.by + this.bs * 0.44 - (p.height * cellPx) / 2;
    const minC = Math.min(...p.nodes.map(([c]) => c)), minR = Math.min(...p.nodes.map(([, r]) => r));
    const at = ([c, r]: readonly [number, number]) => ({ x: ox + (c - minC + 0.5) * cellPx, y: oy + (r - minR + 0.5) * cellPx });
    ctx.lineCap = 'round';
    for (const ed of p.edges) {
      const u = clamp01((ms - ed.start) / Math.max(1, ed.dur));
      if (u <= 0) continue;
      const a = at(ed.a), b = at(ed.b), hx = a.x + (b.x - a.x) * u, hy = a.y + (b.y - a.y) * u;
      for (const [w, col, al] of [[14, '#4a7aff', 0.22], [5, '#bfe0ff', 0.6], [1.8, '#ffffff', 0.95]] as const) {
        ctx.globalAlpha = al * alpha; ctx.strokeStyle = col; ctx.lineWidth = w * Math.max(0.7, cellPx / 160);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(hx, hy); ctx.stroke();
      }
    }
    p.nodes.forEach((n, i) => {
      if (ms < p.nodeAt[i]!) return;
      const q = at(n), pop = clamp01((ms - p.nodeAt[i]!) / 300), r = cellPx * (0.34 + 0.18 * (1 - pop)) * (i === p.nodes.length - 1 ? 1.3 : 1);
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.starSprite(i === p.nodes.length - 1 ? '#ffe7a0' : '#cfe8ff'), q.x - r, q.y - r, r * 2, r * 2);
    });
  }

  /* ---------------------------------------------------------------- front */
  private drawFront(now: number): boolean {
    const ctx = this.fctx;
    if (!ctx) return false;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    let alive = false;
    const k = this.bs / 600;
    // moon halos
    if (this.halos.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.halos = this.halos.filter((h) => now < h.until + 0.5);
      for (const h of this.halos) {
        alive = true;
        if (now < h.born) continue;
        const fade = now > h.until ? 1 - (now - h.until) / 0.5 : Math.min(1, (now - h.born) * 3);
        const pulse = 0.7 + 0.3 * Math.sin((now - h.born) * (h.tease ? 11 : 5));
        const r = h.r * (0.88 + 0.12 * pulse);
        ctx.globalAlpha = Math.max(0, fade) * pulse;
        ctx.drawImage(this.sprite('#d8d8ff'), h.x - r, h.y - r, r * 2, r * 2);
        ctx.globalAlpha = Math.max(0, fade) * 0.7;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * k + 0.5;
        ctx.setLineDash([4 * k + 1, 9 * k + 2]);
        ctx.lineDashOffset = -now * 40;
        ctx.beginPath(); ctx.arc(h.x, h.y, r * 0.62, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
    // Ergenekon cracks
    if (this.cracks.length) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      this.cracks = this.cracks.filter((c) => now - c.born < c.life);
      for (const c of this.cracks) {
        alive = true;
        const t = (now - c.born) / c.life, grow = easeOut(clamp01(t / 0.3)), fade = 1 - clamp01((t - 0.6) / 0.4);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fade;
        ctx.drawImage(this.sprite('#ff8a2a'), c.x - 90 * c.power, c.y - 70 * c.power, 180 * c.power, 140 * c.power);
        for (const [w, col] of [[7, 'rgba(255,120,40,.45)'], [3, '#ffb84a'], [1.2, '#fff6d0']] as const) {
          ctx.strokeStyle = col; ctx.lineWidth = w * c.power * 0.7;
          for (const line of c.lines) {
            const m = Math.max(1, Math.round(line.length * grow));
            ctx.beginPath(); ctx.moveTo(c.x + line[0]![0], c.y + line[0]![1]);
            for (let i = 1; i < m; i++) ctx.lineTo(c.x + line[i]![0], c.y + line[i]![1]);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
    // tracers (constellation strokes travelling star to star)
    if (this.tracers.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.tracers = this.tracers.filter((tr) => now - tr.born < tr.dur + 0.5);
      for (const tr of this.tracers) {
        alive = true;
        const t = now - tr.born;
        if (t < 0) continue;
        const u = easeInOut(clamp01(t / tr.dur)), fade = 1 - clamp01((t - tr.dur) / 0.5);
        const hx = tr.ax + (tr.bx - tr.ax) * u, hy = tr.ay + (tr.by - tr.ay) * u;
        const tail = Math.max(0, u - 0.35);
        const tx = tr.ax + (tr.bx - tr.ax) * tail, ty = tr.ay + (tr.by - tr.ay) * tail;
        const grd = ctx.createLinearGradient(tx, ty, hx, hy);
        grd.addColorStop(0, 'rgba(140,200,255,0)'); grd.addColorStop(1, `rgba(255,255,255,${(0.95 * fade).toFixed(3)})`);
        ctx.strokeStyle = grd; ctx.lineWidth = 6 * k + 1.5; ctx.lineCap = 'round'; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        if (t < tr.dur) { const r = 34 * k + 6; ctx.drawImage(this.starSprite('#dff2ff'), hx - r, hy - r, r * 2, r * 2); }
      }
      ctx.restore();
    }
    // flying stars
    if (this.flyers.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.flyers = this.flyers.filter((f) => now - f.born < f.dur);
      for (const f of this.flyers) {
        alive = true;
        const u = easeInOut(clamp01((now - f.born) / f.dur));
        const mx = (f.ax + f.bx) / 2, my = Math.min(f.ay, f.by) - f.lift;
        const at = (v: number) => ({ x: (1 - v) * (1 - v) * f.ax + 2 * (1 - v) * v * mx + v * v * f.bx, y: (1 - v) * (1 - v) * f.ay + 2 * (1 - v) * v * my + v * v * f.by });
        for (let i = 0; i < 8; i++) { const p = at(Math.max(0, u - i * 0.025)); const r = (22 - i * 2.2); ctx.globalAlpha = 1 - i / 9; ctx.drawImage(this.sprite(f.color), p.x - r, p.y - r, r * 2, r * 2); }
        const p = at(u);
        ctx.globalAlpha = 1;
        ctx.drawImage(this.starSprite(f.color), p.x - 20, p.y - 20, 40, 40);
      }
      ctx.restore();
    }
    // the sky gate lens over the board (rays are on the sky canvas)
    if (this.gate) {
      const g = this.gate, t = (now - g.born) / g.life;
      if (t >= 0 && t < 1) {
        alive = true;
        const open = easeOut(clamp01(t / 0.25)) * (1 - easeInOut(clamp01((t - 0.72) / 0.28)));
        const gx = this.bx + this.bs / 2, gy = this.by + this.bs * 0.36;
        const gw = this.bs * 0.2 * open, gh = this.bs * 0.5 * (0.7 + 0.3 * open);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.9 * open;
        ctx.drawImage(this.sprite('#9fd0ff'), gx - gw * 3, gy - gh * 1.2, gw * 6, gh * 2.4);
        ctx.drawImage(this.sprite('#ffe7a0'), gx - gw * 1.5, gy - gh, gw * 3, gh * 2);
        ctx.globalAlpha = 0.95 * open;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(gx, gy, Math.max(1, gw * 0.3), gh * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    // flashes
    if (this.flashes.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.flashes = this.flashes.filter((f) => now - f.born < f.life);
      for (const f of this.flashes) {
        alive = true;
        const t = (now - f.born) / f.life;
        if (t < 0) continue;
        const r = f.r * (0.6 + 0.5 * easeOut(t));
        ctx.globalAlpha = f.alpha * (1 - t) * (1 - t);
        ctx.drawImage(this.sprite(f.color), f.x - r, f.y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
    // rings (and howl arcs)
    if (this.rings.length) {
      ctx.save();
      this.rings = this.rings.filter((r) => now - r.born < r.life);
      for (const r of this.rings) {
        alive = true;
        const t = (now - r.born) / r.life;
        if (t < 0) continue;
        const rad = r.r0 + (r.r1 - r.r0) * easeOut(t);
        ctx.globalAlpha = r.alpha * (1 - t);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(1, r.width * (1 - t * 0.6));
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(r.x, r.y, rad, r.a0 ?? 0, r.a1 ?? Math.PI * 2); ctx.stroke();
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
        const e = p.drag ? (1 - Math.exp(-p.drag * t)) / p.drag : t;
        const x = p.x + p.vx * e, y = p.y + p.vy * e + 0.5 * p.g * t * t;
        const u = t / p.life;
        switch (p.kind) {
          case 'star': case 'fall': {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = p.kind === 'fall' ? Math.min(1, (1 - u) * 2) : (1 - u) * (u < 0.1 ? u * 10 : 1);
            const r = p.size * (p.kind === 'fall' ? 1 : 1 - u * 0.4);
            if (p.kind === 'fall') { ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, r * 0.12); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.06, y - (p.vy + p.g * t) * 0.06); ctx.stroke(); }
            ctx.drawImage(this.starSprite(p.color), x - r, y - r, r * 2, r * 2);
            break;
          }
          case 'spark': {
            ctx.globalCompositeOperation = 'lighter';
            const vx = p.vx * Math.exp(-p.drag * t), vy = p.vy * Math.exp(-p.drag * t) + p.g * t;
            ctx.globalAlpha = 1 - u; ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - vx * 0.04, y - vy * 0.04); ctx.stroke();
            break;
          }
          case 'dust': {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 0.2 * Math.sin(Math.min(1, u * 1.3) * Math.PI);
            const r = p.size * (0.6 + u * 1.4);
            ctx.drawImage(this.sprite(p.color), x - r, y - r, r * 2, r * 2);
            break;
          }
          case 'mote': case 'ember': {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = (1 - u) * (0.6 + 0.4 * Math.sin(t * 18 + p.x));
            const r = p.size * 2.6;
            ctx.drawImage(this.sprite(p.color), x - r, y - r, r * 2, r * 2);
            break;
          }
        }
      }
      this.parts = keep;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // texts
    if (this.texts.length) {
      this.texts = this.texts.filter((t) => now - t.born < t.life);
      for (const tx of this.texts) {
        alive = true;
        const t = (now - tx.born) / tx.life;
        const s = tx.size * (t < 0.14 ? 0.4 + (t / 0.14) * 0.75 : 1.15 - (t - 0.14) * 0.15);
        ctx.save();
        ctx.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
        ctx.font = `700 ${Math.round(s)}px ${this.font}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const x = tx.x, y = tx.y - easeOut(t) * s * 0.25;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(this.sprite(tx.tone === 'gold' ? '#ffb84a' : '#6aa8ff'), x - s * 1.6, y - s * 0.9, s * 3.2, s * 1.8);
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, s * 0.12); ctx.strokeStyle = tx.tone === 'gold' ? '#3a1602' : '#06103a';
        ctx.strokeText(tx.text, x, y);
        const grd = ctx.createLinearGradient(0, y - s / 2, 0, y + s / 2);
        if (tx.tone === 'gold') { grd.addColorStop(0, '#fffbe6'); grd.addColorStop(0.5, '#ffd970'); grd.addColorStop(1, '#d0801e'); }
        else { grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.5, '#cfe8ff'); grd.addColorStop(1, '#6aa0ff'); }
        ctx.fillStyle = grd; ctx.fillText(tx.text, x, y);
        if (tx.sub) {
          const ss = Math.round(s * 0.26);
          ctx.font = `600 ${ss}px ${this.font}`;
          ctx.lineWidth = Math.max(2, ss * 0.2);
          ctx.strokeText(tx.sub, x, y + s * 0.62);
          ctx.fillStyle = '#ffffff'; ctx.fillText(tx.sub, x, y + s * 0.62);
        }
        ctx.restore();
      }
    }
    return alive;
  }
}
