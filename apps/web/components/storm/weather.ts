/* Fırtına Tahtı weather FX: one engine, one requestAnimationFrame loop, up to three canvases.
     sky   – behind the near clouds: cloud flicker (sheet lightning) and distant bolts
     rain  – in front of the scene, behind the board: rain streaks with wind, splashes, embers
     front – above the board: hurled bolts (procedural, branching), impact sparks, screen flash
   Presentation only: it never reads or changes a round. Randomness is Math.random on purpose.
   Particle counts are capped, canvases are devicePixelRatio aware (capped), the loop stops while
   the document is hidden, and under reduced motion nothing animates (static rain, a short static
   bolt for strikes, no flashes). Each canvas is only cleared/redrawn when it has something on it. */

export type StormMood = 'base' | 'feature' | 'bigwin';
export interface FxPoint { x: number; y: number }

export interface StormWeatherOptions {
  host: HTMLElement;
  rain: HTMLCanvasElement;
  sky?: HTMLCanvasElement | null;
  front?: HTMLCanvasElement | null;
  mood?: StormMood;
  /** Force reduced motion (defaults to the media query). */
  reducedMotion?: boolean;
  /** Called with 0..1 whenever lightning lights the scene (sky flicker or strike). */
  onFlash?: (intensity: number) => void;
}

interface MoodCfg { rain: number; wind: number; speed: number; skyEvery: [number, number]; embers: number; gold: number; rainAlpha: number }
const MOODS: Record<StormMood, MoodCfg> = {
  base: { rain: 230, wind: 0.2, speed: 1, skyEvery: [5.5, 11], embers: 2.2, gold: 0, rainAlpha: 1 },
  feature: { rain: 520, wind: 0.34, speed: 1.25, skyEvery: [1.6, 4.2], embers: 4.5, gold: 0, rainAlpha: 1.15 },
  bigwin: { rain: 140, wind: 0.14, speed: 0.9, skyEvery: [1.2, 3], embers: 9, gold: 1, rainAlpha: 0.75 },
};
const MAX_DROPS = 640;
const MAX_EMBERS = 180;
const MAX_SPLASH = 70;
const MAX_SPARKS = 220;
const REF_AREA = 1440 * 900;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Bolt {
  main: number[]; // flat x,y
  branches: number[][];
  from: FxPoint; to: FxPoint;
  born: number; life: number; intensity: number; restrikes: number[]; front: boolean; width: number;
}
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hue: number }
interface Ember { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; phase: number; gold: boolean }
interface Splash { x: number; y: number; life: number; max: number; size: number }
interface Glow { x: number; y: number; r: number; born: number; life: number; pulses: number[]; intensity: number }

/* midpoint displacement: returns flat array of points */
function jagged(a: FxPoint, b: FxPoint, rough: number, depth: number): number[] {
  let pts = [a.x, a.y, b.x, b.y];
  let disp = Math.hypot(b.x - a.x, b.y - a.y) * rough;
  for (let d = 0; d < depth; d++) {
    const next: number[] = [];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x1 = pts[i]!, y1 = pts[i + 1]!, x2 = pts[i + 2]!, y2 = pts[i + 3]!;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const off = (Math.random() - 0.5) * disp;
      next.push(x1, y1, mx + (-(y2 - y1) / len) * off, my + ((x2 - x1) / len) * off);
    }
    next.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
    pts = next;
    disp *= 0.52;
  }
  return pts;
}

function makeBolt(from: FxPoint, to: FxPoint, intensity: number, now: number, front: boolean): Bolt {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const depth = len > 500 ? 7 : len > 200 ? 6 : 5;
  const main = jagged(from, to, 0.2, depth);
  const branches: number[][] = [];
  const nb = Math.round(2 + intensity * 4);
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  for (let i = 0; i < nb; i++) {
    const idx = 2 * Math.floor(rand(0.15, 0.8) * (main.length / 2));
    const sx = main[idx]!, sy = main[idx + 1]!;
    const a = ang + (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.95);
    const bl = len * rand(0.12, 0.32);
    branches.push(jagged({ x: sx, y: sy }, { x: sx + Math.cos(a) * bl, y: sy + Math.sin(a) * bl }, 0.28, Math.max(3, depth - 2)));
  }
  return { main, branches, from, to, born: now, life: 0.42 + intensity * 0.18, intensity, restrikes: [0.09, 0.2], front, width: front ? 1 : 0.6 };
}

function strokePoly(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.stroke();
}

export class StormWeather {
  private readonly host: HTMLElement;
  private readonly rainCanvas: HTMLCanvasElement;
  private readonly skyCanvas: HTMLCanvasElement | null;
  private readonly frontCanvas: HTMLCanvasElement | null;
  private readonly rainCtx: CanvasRenderingContext2D | null;
  private readonly skyCtx: CanvasRenderingContext2D | null;
  private readonly frontCtx: CanvasRenderingContext2D | null;
  private readonly onFlash?: (intensity: number) => void;
  private mood: StormMood;
  private cfg: MoodCfg;
  private reduced: boolean;
  private w = 0;
  private h = 0;
  /* rain as struct-of-arrays */
  private dx = new Float32Array(MAX_DROPS);
  private dy = new Float32Array(MAX_DROPS);
  private dl = new Float32Array(MAX_DROPS);
  private dv = new Float32Array(MAX_DROPS);
  private dz = new Uint8Array(MAX_DROPS);
  private drops = 0;
  private embers: Ember[] = [];
  private splashes: Splash[] = [];
  private sparks: Spark[] = [];
  private bolts: Bolt[] = [];
  private glows: Glow[] = [];
  private emitters: FxPoint[] = [];
  private emberDebt = 0;
  private flashA = 0;
  private flashColor = '200,236,255';
  private nextSky = 0;
  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private disposed = false;
  private skyDirty = false;
  private frontDirty = false;
  private observer: ResizeObserver | null = null;
  private mq: MediaQueryList | null = null;
  private frames: number[] = [];
  private staticTimer = 0;

  constructor(opts: StormWeatherOptions) {
    this.host = opts.host;
    this.rainCanvas = opts.rain;
    this.skyCanvas = opts.sky ?? null;
    this.frontCanvas = opts.front ?? null;
    this.rainCtx = this.rainCanvas.getContext('2d');
    this.skyCtx = this.skyCanvas?.getContext('2d') ?? null;
    this.frontCtx = this.frontCanvas?.getContext('2d') ?? null;
    this.onFlash = opts.onFlash;
    this.mood = opts.mood ?? 'base';
    this.cfg = MOODS[this.mood];
    this.mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = opts.reducedMotion ?? !!this.mq?.matches;
    this.mq?.addEventListener('change', this.onMotionPref);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.host);
    }
    this.nextSky = rand(1, 3);
    this.start();
  }

  /* ---------------- public API ---------------- */
  setMood(mood: StormMood) {
    if (mood === this.mood) return;
    this.mood = mood;
    this.cfg = MOODS[mood];
    this.fillDrops();
    this.nextSky = Math.min(this.nextSky, this.time + 0.4);
    if (this.reduced) this.drawStatic();
  }
  /** Brazier / ember sources in host-relative CSS px. */
  setEmitters(points: FxPoint[]) { this.emitters = points.slice(0, 8); }
  /** Convert a client (viewport) point to host-relative px. */
  toLocal(p: FxPoint): FxPoint { const r = this.host.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; }
  /** Hurl a bolt between two CLIENT (viewport) points, e.g. the character's bolt tip and a board
      cell centre. Draws on the front canvas (falls back to rain). */
  strike(fromClient: FxPoint, toClient: FxPoint, intensity = 1) {
    const r = this.host.getBoundingClientRect();
    const from = { x: fromClient.x - r.left, y: fromClient.y - r.top };
    const to = { x: toClient.x - r.left, y: toClient.y - r.top };
    const k = Math.max(0.2, Math.min(2, intensity));
    if (this.reduced) { this.staticBolt(from, to, k); return; }
    this.bolts.push(makeBolt(from, to, k, this.time, true));
    this.burst(to, k);
    this.flash(0.22 + 0.25 * Math.min(1, k));
    this.frontDirty = true;
    this.ensureRunning();
  }
  /** Brief full-screen flash (ignored under reduced motion). */
  flash(intensity = 0.5, color = '200,236,255') {
    if (this.reduced) return;
    this.flashA = Math.max(this.flashA, Math.min(0.85, intensity));
    this.flashColor = color;
    this.onFlash?.(Math.min(1, intensity * 1.6));
    this.frontDirty = true;
  }
  /** Sheet lightning + optional distant bolt in the sky band. */
  skyStrike(intensity = 1) {
    if (this.reduced) return;
    const x = rand(this.w * 0.08, this.w * 0.92);
    const y = rand(this.h * 0.06, this.h * 0.26);
    const pulses = intensity > 0.7 ? [0, 0.08, 0.22] : [0, 0.12];
    this.glows.push({ x, y, r: rand(0.22, 0.38) * Math.max(this.w, this.h), born: this.time, life: 0.55, pulses, intensity });
    if (Math.random() < 0.55 + intensity * 0.3) {
      const tx = x + rand(-0.12, 0.12) * this.w;
      const ty = this.h * (this.skyCtx ? rand(0.42, 0.6) : rand(0.26, 0.4));
      this.bolts.push(makeBolt({ x, y }, { x: tx, y: ty }, 0.5 * intensity, this.time, false));
    }
    this.onFlash?.(0.35 + 0.45 * intensity);
    this.skyDirty = true;
  }
  /** Gold ember fountain for big wins. */
  celebrate(amount = 1) {
    if (this.reduced) return;
    const n = Math.round(60 * amount);
    for (let i = 0; i < n && this.embers.length < MAX_EMBERS; i++) {
      this.embers.push({ x: rand(0, this.w), y: this.h + rand(0, 40), vx: rand(-20, 20), vy: rand(-260, -120), life: 0, max: rand(1.6, 3.2), size: rand(1.4, 3.4), phase: rand(0, 6.28), gold: true });
    }
  }
  get stats() {
    const f = this.frames;
    let sum = 0, worst = 0;
    for (let i = 1; i < f.length; i++) { const d = f[i]! - f[i - 1]!; sum += d; worst = Math.max(worst, d); }
    const avg = f.length > 1 ? sum / (f.length - 1) : 0;
    return { fps: avg ? 1000 / avg : 0, avgMs: avg, worstMs: worst, drops: this.drops, embers: this.embers.length, bolts: this.bolts.length, sparks: this.sparks.length };
  }
  destroy() {
    this.disposed = true;
    this.stop();
    window.clearTimeout(this.staticTimer);
    this.observer?.disconnect();
    this.mq?.removeEventListener('change', this.onMotionPref);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /* ---------------- lifecycle ---------------- */
  private onVisibility = () => { if (document.hidden) this.stop(); else this.start(); };
  private onMotionPref = () => { this.reduced = !!this.mq?.matches; this.stop(); this.start(); };
  private start() {
    if (this.disposed) return;
    if (this.reduced) { this.drawStatic(); return; }
    if (this.running || (typeof document !== 'undefined' && document.hidden)) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  private ensureRunning() { if (!this.running) this.start(); }
  private stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    const dprRaw = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const size = (c: HTMLCanvasElement | null, ctx: CanvasRenderingContext2D | null, cap: number) => {
      if (!c || !ctx) return;
      const dpr = Math.min(cap, dprRaw);
      c.width = Math.max(1, Math.round(this.w * dpr));
      c.height = Math.max(1, Math.round(this.h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size(this.rainCanvas, this.rainCtx, 1);
    size(this.skyCanvas, this.skyCtx, 1);
    size(this.frontCanvas, this.frontCtx, 2);
    this.fillDrops();
    this.skyDirty = this.frontDirty = true;
    if (this.reduced) this.drawStatic();
  }

  private targetDrops() {
    const area = Math.min(2.2, (this.w * this.h) / REF_AREA);
    return Math.min(MAX_DROPS, Math.round(this.cfg.rain * Math.max(0.35, area)));
  }
  private seedDrop(i: number, anywhere: boolean) {
    const z = Math.random() < 0.45 ? 0 : Math.random() < 0.65 ? 1 : 2; // far, mid, near
    this.dz[i] = z;
    this.dl[i] = (z === 0 ? rand(8, 14) : z === 1 ? rand(14, 22) : rand(24, 38)) * (this.h / 900 + 0.4);
    this.dv[i] = (z === 0 ? rand(520, 640) : z === 1 ? rand(760, 900) : rand(1050, 1300)) * (this.h / 900 * 0.5 + 0.5);
    this.dx[i] = rand(-0.1 * this.w, this.w * 1.15);
    this.dy[i] = anywhere ? rand(-this.h * 0.1, this.h) : rand(-this.h * 0.25, -10);
  }
  private fillDrops() {
    const n = this.targetDrops();
    for (let i = this.drops; i < n; i++) this.seedDrop(i, true);
    this.drops = n;
  }

  /* ---------------- frame ---------------- */
  private tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.frames.push(now);
    if (this.frames.length > 120) this.frames.shift();
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private update(dt: number) {
    const c = this.cfg;
    /* rain */
    const wind = c.wind;
    for (let i = 0; i < this.drops; i++) {
      const v = this.dv[i]! * c.speed;
      this.dy[i] = this.dy[i]! + v * dt;
      this.dx[i] = this.dx[i]! - v * wind * dt;
      if (this.dy[i]! > this.h + 40 || this.dx[i]! < -60) {
        if (this.dz[i] === 2 && this.splashes.length < MAX_SPLASH && Math.random() < 0.7) {
          this.splashes.push({ x: this.dx[i]!, y: this.h * rand(0.88, 0.995), life: 0, max: rand(0.18, 0.32), size: rand(3, 7) });
        }
        this.seedDrop(i, false);
      }
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) { const s = this.splashes[i]!; s.life += dt; if (s.life >= s.max) this.splashes.splice(i, 1); }
    /* embers */
    if (this.emitters.length) {
      this.emberDebt += c.embers * this.emitters.length * dt;
      while (this.emberDebt >= 1 && this.embers.length < MAX_EMBERS) {
        this.emberDebt -= 1;
        const e = this.emitters[Math.floor(Math.random() * this.emitters.length)]!;
        this.embers.push({ x: e.x + rand(-10, 10), y: e.y + rand(-6, 4), vx: rand(-14, 14), vy: rand(-110, -50), life: 0, max: rand(1.2, 2.6), size: rand(1, 2.4), phase: rand(0, 6.28), gold: c.gold > 0 && Math.random() < 0.5 });
      }
      if (this.emberDebt > 4) this.emberDebt = 0;
    }
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i]!;
      e.life += dt;
      e.phase += dt * 4;
      e.vx += (Math.sin(e.phase) * 26 - wind * 60) * dt;
      e.vy -= 8 * dt;
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.life >= e.max) this.embers.splice(i, 1);
    }
    /* sparks */
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.life += dt; s.vy += 900 * dt; s.vx *= 1 - 2.2 * dt; s.vy *= 1 - 1.2 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.life >= s.max) this.sparks.splice(i, 1);
    }
    /* lightning lifetimes */
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      const age = this.time - b.born;
      if (b.restrikes.length && age >= b.restrikes[0]!) {
        b.restrikes.shift();
        const fresh = makeBolt(b.from, b.to, b.intensity, b.born, b.front);
        b.main = fresh.main; b.branches = fresh.branches.slice(0, Math.max(1, b.branches.length - 1));
        if (b.front) this.flash(0.12 * b.intensity);
      }
      if (age >= b.life) { this.bolts.splice(i, 1); if (b.front) this.frontDirty = true; else this.skyDirty = true; }
    }
    for (let i = this.glows.length - 1; i >= 0; i--) if (this.time - this.glows[i]!.born >= this.glows[i]!.life) { this.glows.splice(i, 1); this.skyDirty = true; }
    this.flashA = Math.max(0, this.flashA - dt * 3.2);
    /* scheduled sky lightning */
    if (this.time >= this.nextSky) {
      this.skyStrike(this.mood === 'base' ? rand(0.4, 0.9) : rand(0.7, 1.2));
      this.nextSky = this.time + rand(c.skyEvery[0], c.skyEvery[1]);
    }
  }

  private draw() {
    this.drawRain();
    if (this.skyCtx && (this.skyDirty || this.glows.length || this.bolts.some((b) => !b.front))) this.drawSky(this.skyCtx, true);
    else if (!this.skyCtx && this.rainCtx && (this.glows.length || this.bolts.some((b) => !b.front))) this.drawSky(this.rainCtx, false);
    if (this.frontDirty || this.flashA > 0 || this.sparks.length || this.bolts.some((b) => b.front)) this.drawFront();
  }

  private drawRain() {
    const ctx = this.rainCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    const c = this.cfg;
    const wind = c.wind;
    const alphas = [0.16, 0.24, 0.34];
    const widths = [0.8, 1.1, 1.6];
    ctx.lineCap = 'round';
    for (let z = 0; z < 3; z++) {
      ctx.beginPath();
      for (let i = 0; i < this.drops; i++) {
        if (this.dz[i] !== z) continue;
        const x = this.dx[i]!, y = this.dy[i]!, l = this.dl[i]!;
        ctx.moveTo(x, y);
        ctx.lineTo(x + l * wind, y - l);
      }
      ctx.strokeStyle = `rgba(190,226,255,${Math.min(0.6, alphas[z]! * c.rainAlpha)})`;
      ctx.lineWidth = widths[z]!;
      ctx.stroke();
    }
    if (this.splashes.length) {
      ctx.beginPath();
      for (const s of this.splashes) {
        const k = s.life / s.max;
        const r = s.size * (0.4 + k);
        ctx.moveTo(s.x - r, s.y);
        ctx.quadraticCurveTo(s.x, s.y - r * 0.9 * (1 - k), s.x + r, s.y);
      }
      ctx.strokeStyle = 'rgba(200,232,255,0.32)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (this.embers.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const e of this.embers) {
        const k = e.life / e.max;
        const a = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * (0.6 + 0.4 * Math.sin(e.phase * 3));
        ctx.fillStyle = e.gold ? `rgba(255,214,120,${a.toFixed(3)})` : `rgba(255,${Math.round(150 - k * 70)},60,${a.toFixed(3)})`;
        const s = e.size * (1 - k * 0.5);
        ctx.beginPath();
        ctx.arc(e.x, e.y, s, 0, Math.PI * 2);
        ctx.fill();
        if (e.size > 1.8) {
          ctx.fillStyle = `rgba(255,170,80,${(a * 0.16).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, s * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawSky(ctx: CanvasRenderingContext2D, clear: boolean) {
    this.skyDirty = false;
    if (clear) ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    for (const g of this.glows) {
      const age = this.time - g.born;
      let a = 0;
      for (const p of g.pulses) { const t = age - p; if (t >= 0) a = Math.max(a, Math.exp(-t * 14) * (t < 0.03 ? t / 0.03 : 1)); }
      a *= g.intensity;
      if (a < 0.01) continue;
      const grd = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
      grd.addColorStop(0, `rgba(210,240,255,${(0.55 * a).toFixed(3)})`);
      grd.addColorStop(0.35, `rgba(120,190,255,${(0.22 * a).toFixed(3)})`);
      grd.addColorStop(1, 'rgba(60,120,220,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
    }
    for (const b of this.bolts) if (!b.front) this.renderBolt(ctx, b);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawFront() {
    const ctx = this.frontCtx ?? this.rainCtx;
    if (!ctx) return;
    this.frontDirty = false;
    if (ctx !== this.rainCtx) ctx.clearRect(0, 0, this.w, this.h);
    if (this.flashA > 0.005) {
      ctx.fillStyle = `rgba(${this.flashColor},${(this.flashA * 0.55).toFixed(3)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bolts) if (b.front) this.renderBolt(ctx, b);
    if (this.sparks.length) {
      for (const s of this.sparks) {
        const k = 1 - s.life / s.max;
        ctx.strokeStyle = s.hue ? `rgba(255,220,140,${k.toFixed(3)})` : `rgba(190,245,255,${k.toFixed(3)})`;
        ctx.lineWidth = s.size;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * 0.02, s.y - s.vy * 0.02);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private renderBolt(ctx: CanvasRenderingContext2D, b: Bolt) {
    const age = this.time - b.born;
    const k = Math.max(0, 1 - age / b.life);
    const flick = 0.65 + 0.35 * Math.sin(age * 90);
    const a = k * flick;
    const w = b.width * (0.8 + b.intensity * 0.4);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const pass = (lw: number, color: string, alpha: number, branches: boolean) => {
      ctx.strokeStyle = `rgba(${color},${Math.min(1, alpha * a).toFixed(3)})`;
      ctx.lineWidth = lw * w;
      strokePoly(ctx, b.main);
      if (branches) { ctx.lineWidth = lw * w * 0.55; for (const br of b.branches) strokePoly(ctx, br); }
    };
    pass(26, '60,150,255', 0.08, false);
    pass(12, '90,200,255', 0.22, true);
    pass(5, '170,235,255', 0.6, true);
    pass(2, '255,255,255', 1, true);
    if (b.front) {
      const r = 70 * w * (0.6 + k);
      const g = ctx.createRadialGradient(b.to.x, b.to.y, 0, b.to.x, b.to.y, r);
      g.addColorStop(0, `rgba(235,252,255,${(0.9 * a).toFixed(3)})`);
      g.addColorStop(0.3, `rgba(120,210,255,${(0.45 * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(40,120,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(b.to.x - r, b.to.y - r, r * 2, r * 2);
      const r2 = 46 * w * (0.6 + k);
      const g2 = ctx.createRadialGradient(b.from.x, b.from.y, 0, b.from.x, b.from.y, r2);
      g2.addColorStop(0, `rgba(235,252,255,${(0.7 * a).toFixed(3)})`);
      g2.addColorStop(1, 'rgba(60,160,255,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(b.from.x - r2, b.from.y - r2, r2 * 2, r2 * 2);
    }
  }

  private burst(p: FxPoint, k: number) {
    const n = Math.round(18 + 22 * Math.min(1.5, k));
    for (let i = 0; i < n && this.sparks.length < MAX_SPARKS; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(120, 520) * (0.7 + k * 0.3);
      this.sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0, max: rand(0.25, 0.7), size: rand(1, 2.4), hue: Math.random() < 0.3 ? 1 : 0 });
    }
  }

  /* ---------------- reduced motion ---------------- */
  private drawStatic() {
    const ctx = this.rainCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    this.skyCtx?.clearRect(0, 0, this.w, this.h);
    this.frontCtx?.clearRect(0, 0, this.w, this.h);
    const n = Math.round(this.targetDrops() * 0.45);
    const wind = this.cfg.wind;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = ((i * 7919) % 1000) / 1000 * this.w * 1.1;
      const y = ((i * 104729) % 1000) / 1000 * this.h;
      const l = 10 + ((i * 31) % 18);
      ctx.moveTo(x, y);
      ctx.lineTo(x + l * wind, y - l);
    }
    ctx.strokeStyle = 'rgba(190,226,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  private staticBolt(from: FxPoint, to: FxPoint, k: number) {
    const ctx = this.frontCtx ?? this.rainCtx;
    if (!ctx) return;
    const b = makeBolt(from, to, k, 0, true);
    b.born = this.time; b.life = 1;
    if (ctx !== this.rainCtx) ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    this.renderBolt(ctx, b);
    ctx.globalCompositeOperation = 'source-over';
    window.clearTimeout(this.staticTimer);
    this.staticTimer = window.setTimeout(() => (ctx === this.rainCtx ? this.drawStatic() : ctx.clearRect(0, 0, this.w, this.h)), 320);
  }
}
