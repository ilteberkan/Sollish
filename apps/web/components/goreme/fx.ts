/* Göreme: Şafak Balonları — canvas particle helpers.

   One canvas over the board (or the whole scene). Coordinates are CSS px relative to `root`; use goremePointOf() to
   turn an element (a cell, the sky band medallion, the scene sun) into a point. Effects:
     flame(x, y)          burner puff: a warm glow, rising fire motes and a few embers (a balloon lifts)
     mergeBurst(x, y)     two balloons become one: shock ring, kilim-diamond confetti, sparks, a ×N pop
     moorSparkle(x, y)    a balloon moors in the sky band: gold four-point sparkles and a soft ring
     sunRays(x, y)        the dawn sun (scatter / feature start): rays fan out and turn, with a flash
   Presentation only; Math.random is cosmetic and never touches a result. Wall-clock time: every effect is a pure
   function of (now − born), so slow frames or hidden tabs never desynchronise it; the loop runs only while something
   is alive and stops while the document is hidden. Every method returns a promise that resolves on a timer when the
   effect ends. Reduced motion: nothing is drawn and promises resolve at once. Counts are capped. */

export interface GoremeFxOptions {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  reducedMotion?: boolean;
}
type Kind = 'fire' | 'ember' | 'spark' | 'diamond' | 'star';
interface Particle { kind: Kind; x: number; y: number; vx: number; vy: number; born: number; life: number; size: number; color: string; g: number; drag: number; rot: number; vr: number }
interface Ring { x: number; y: number; born: number; life: number; r0: number; r1: number; color: string; width: number }
interface Flash { x: number; y: number; born: number; life: number; r: number; color: string; alpha: number }
interface Rays { x: number; y: number; born: number; life: number; r: number; n: number; intensity: number }
interface Pop { x: number; y: number; born: number; life: number; text: string; size: number }

const MAX_PARTICLES = 500;
const FIRE = ['#fffbe0', '#ffe28a', '#ffb84a', '#ff7a2a'];
const GOLD = ['#fff7d6', '#ffe28a', '#ffd65e', '#f2a622'];
const KILIM = ['#bc2c30', '#ffd65e', '#2f429a', '#1fa9a5', '#fff7e8', '#8b4dc2'];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Root-relative point at fractions (fx, fy) of an element's box. */
export function goremePointOf(root: HTMLElement, el: Element, fx = 0.5, fy = 0.5): { x: number; y: number } {
  const r = el.getBoundingClientRect(), o = root.getBoundingClientRect();
  return { x: r.left - o.left + r.width * fx, y: r.top - o.top + r.height * fy };
}

export class GoremeFx {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private reduced: boolean;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private raf = 0;
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private rays: Rays[] = [];
  private pops: Pop[] = [];
  private readonly ro: ResizeObserver | null;
  private readonly onVis = () => { if (document.hidden) this.stop(); else this.kick(); };

  constructor(o: GoremeFxOptions) {
    this.root = o.root;
    this.canvas = o.canvas;
    this.ctx = o.canvas.getContext('2d');
    this.reduced = o.reducedMotion ?? (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(this.root);
    document.addEventListener('visibilitychange', this.onVis);
    this.resize();
  }
  setReducedMotion(v: boolean) { this.reduced = v; if (v) this.clear(); }
  resize() {
    const r = this.root.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }
  get particleCount() { return this.parts.length; }

  /** Burner puff in a balloon's throat (x, y). `power` 1 = normal lift; `scale` ≈ cell size / 90. A warm glow (no white
   * flash) and fire motes that rise into the envelope, with a few embers falling below the basket. */
  flame(x: number, y: number, { power = 1, scale = 1 }: { power?: number; scale?: number } = {}): Promise<void> {
    if (this.reduced) return Promise.resolve();
    const now = performance.now(), k = Math.max(0.5, Math.min(1.6, scale));
    this.flashes.push({ x, y: y - 6 * k, born: now, life: 320 + 120 * power, r: 22 * power * k, color: '#ffb84a', alpha: 0.55 });
    const n = Math.round(16 * power);
    for (let i = 0; i < n; i++) this.add({ kind: 'fire', x: x + rand(-3, 3) * k, y, vx: rand(-0.025, 0.025) * k, vy: rand(-0.2, -0.1) * power * k, born: now + rand(0, 160), life: rand(300, 520), size: rand(2.4, 5) * power * k, color: pick(FIRE), g: 0, drag: 0.994, rot: 0, vr: 0 });
    for (let i = 0; i < 4 * power; i++) this.add({ kind: 'ember', x: x + rand(-4, 4) * k, y: y + 6 * k, vx: rand(-0.05, 0.05), vy: rand(0.02, 0.08), born: now + rand(60, 200), life: rand(600, 900), size: rand(1, 1.8), color: pick(FIRE), g: 0.0002, drag: 0.995, rot: 0, vr: 0 });
    this.kick();
    return wait(900);
  }

  /** Two balloons merge at (x, y). `scale` ≈ cell size / 100. */
  mergeBurst(x: number, y: number, { multiplier, scale = 1, popOffset = 0 }: { multiplier?: number; scale?: number; popOffset?: number } = {}): Promise<void> {
    if (this.reduced) return Promise.resolve();
    const now = performance.now();
    this.flashes.push({ x, y, born: now, life: 420, r: 80 * scale, color: '#fff2c0', alpha: 1 });
    this.rings.push({ x, y, born: now, life: 620, r0: 10 * scale, r1: 120 * scale, color: '#fff4c0', width: 6 * scale });
    this.rings.push({ x, y, born: now + 90, life: 720, r0: 8 * scale, r1: 90 * scale, color: '#ffb84a', width: 3 * scale });
    for (let i = 0; i < 34; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.18, 0.5) * scale;
      this.add({ kind: 'diamond', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.1 * scale, born: now, life: rand(900, 1500), size: rand(4, 8) * scale, color: pick(KILIM), g: 0.00045 * scale, drag: 0.985, rot: rand(0, Math.PI), vr: rand(-0.012, 0.012) });
    }
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.35, 0.8) * scale;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: now, life: rand(300, 560), size: rand(1.4, 2.6) * scale, color: pick(GOLD), g: 0, drag: 0.97, rot: 0, vr: 0 });
    }
    if (multiplier !== undefined) this.pops.push({ x, y: y - popOffset, born: now + 120, life: 1100, text: `×${multiplier}`, size: 40 * scale });
    this.kick();
    return wait(1400);
  }

  /** A balloon moors in the sky band at (x, y). */
  moorSparkle(x: number, y: number, { scale = 1 }: { scale?: number } = {}): Promise<void> {
    if (this.reduced) return Promise.resolve();
    const now = performance.now();
    this.rings.push({ x, y, born: now, life: 700, r0: 6 * scale, r1: 56 * scale, color: '#ffe8a0', width: 3 * scale });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand(-0.2, 0.2), s = rand(0.05, 0.16) * scale;
      this.add({ kind: 'star', x: x + Math.cos(a) * 10 * scale, y: y + Math.sin(a) * 10 * scale, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.03, born: now + rand(0, 200), life: rand(600, 1000), size: rand(4, 9) * scale, color: pick(GOLD), g: 0, drag: 0.99, rot: rand(0, 1), vr: rand(-0.004, 0.004) });
    }
    this.kick();
    return wait(1100);
  }

  /** Dawn-sun rays from (x, y). `intensity` 1 = scatter landing, 2 = feature start. */
  sunRays(x: number, y: number, { intensity = 1, duration = 1800 }: { intensity?: number; duration?: number } = {}): Promise<void> {
    if (this.reduced) return Promise.resolve();
    const now = performance.now();
    const r = Math.hypot(this.w, this.h) * (0.35 + 0.25 * intensity);
    this.rays.push({ x, y, born: now, life: duration, r, n: 18, intensity });
    this.flashes.push({ x, y, born: now, life: 600, r: 90 * intensity, color: '#fff6d0', alpha: 0.95 });
    for (let i = 0; i < 18 * intensity; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.06, 0.2);
      this.add({ kind: 'star', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: now + rand(0, 300), life: rand(800, 1400), size: rand(4, 10), color: pick(GOLD), g: 0, drag: 0.995, rot: 0, vr: rand(-0.004, 0.004) });
    }
    this.kick();
    return wait(duration);
  }

  clear() { this.parts = []; this.rings = []; this.flashes = []; this.rays = []; this.pops = []; this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  destroy() { this.stop(); this.clear(); this.ro?.disconnect(); document.removeEventListener('visibilitychange', this.onVis); }

  private add(p: Particle) { if (this.parts.length < MAX_PARTICLES) this.parts.push(p); }
  private kick() { if (!this.raf && !document.hidden) this.raf = requestAnimationFrame(this.frame); }
  private stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  private alive() { return this.parts.length + this.rings.length + this.flashes.length + this.rays.length + this.pops.length > 0; }

  private readonly frame = (now: number) => {
    this.raf = 0;
    const c = this.ctx;
    if (!c) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    this.drawRays(c, now);
    this.drawFlashes(c, now);
    this.drawRings(c, now);
    this.drawParticles(c, now);
    this.drawPops(c, now);
    if (this.alive()) this.kick();
  };

  private drawRays(c: CanvasRenderingContext2D, now: number) {
    this.rays = this.rays.filter((r) => now - r.born < r.life);
    for (const r of this.rays) {
      const t = (now - r.born) / r.life;
      const a = Math.sin(Math.PI * clamp01(t)) * 0.55 * Math.min(1.4, r.intensity);
      const reach = r.r * easeOut(clamp01(t * 2));
      const turn = t * 0.5;
      c.save();
      c.translate(r.x, r.y);
      c.rotate(turn);
      c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(0, 0, 0, 0, 0, reach);
      g.addColorStop(0, `rgba(255,246,208,${a})`);
      g.addColorStop(0.5, `rgba(255,214,130,${a * 0.45})`);
      g.addColorStop(1, 'rgba(255,190,110,0)');
      c.fillStyle = g;
      c.beginPath();
      for (let i = 0; i < r.n; i++) {
        const a0 = (i / r.n) * Math.PI * 2, w = (i % 2 ? 0.05 : 0.09);
        c.moveTo(0, 0);
        c.lineTo(Math.cos(a0 - w) * reach, Math.sin(a0 - w) * reach);
        c.lineTo(Math.cos(a0 + w) * reach, Math.sin(a0 + w) * reach);
        c.closePath();
      }
      c.fill();
      c.restore();
    }
  }
  private drawFlashes(c: CanvasRenderingContext2D, now: number) {
    this.flashes = this.flashes.filter((f) => now - f.born < f.life);
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const t = (now - f.born) / f.life;
      if (t < 0) continue;
      const r = f.r * (0.6 + 0.6 * easeOut(t));
      const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, hexA(f.color, f.alpha * (1 - t)));
      g.addColorStop(1, hexA(f.color, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(f.x, f.y, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  private drawRings(c: CanvasRenderingContext2D, now: number) {
    this.rings = this.rings.filter((r) => now - r.born < r.life);
    for (const r of this.rings) {
      const t = (now - r.born) / r.life;
      if (t < 0) continue;
      c.strokeStyle = hexA(r.color, 1 - t);
      c.lineWidth = r.width * (1 - t * 0.7);
      c.beginPath(); c.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * easeOut(t), 0, Math.PI * 2); c.stroke();
    }
  }
  private drawParticles(c: CanvasRenderingContext2D, now: number) {
    const keep: Particle[] = [];
    for (const p of this.parts) {
      const age = now - p.born;
      if (age > p.life) continue;
      keep.push(p);
      if (age < 0) continue;
      // closed-form motion with drag (geometric series) and gravity: position is a function of age only
      const steps = age / 16.67, k = p.drag === 1 ? steps : (1 - p.drag ** steps) / (1 - p.drag);
      const x = p.x + p.vx * 16.67 * k, y = p.y + p.vy * 16.67 * k + 0.5 * p.g * age * age;
      const t = age / p.life, a = 1 - t;
      switch (p.kind) {
        case 'fire': {
          const r = p.size * (1 - t * 0.6);
          const g = c.createRadialGradient(x, y, 0, x, y, r * 2);
          g.addColorStop(0, hexA(p.color, 0.9 * a));
          g.addColorStop(1, hexA(p.color, 0));
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 2, 0, Math.PI * 2); c.fill();
          c.globalCompositeOperation = 'source-over';
          break;
        }
        case 'ember':
          c.fillStyle = hexA(p.color, a); c.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size); break;
        case 'spark': {
          const vx = p.vx * p.drag ** steps, vy = p.vy * p.drag ** steps;
          c.strokeStyle = hexA(p.color, a); c.lineWidth = p.size; c.lineCap = 'round';
          c.beginPath(); c.moveTo(x, y); c.lineTo(x - vx * 40, y - vy * 40); c.stroke();
          break;
        }
        case 'diamond': {
          const rot = p.rot + p.vr * age, s = p.size;
          c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, Math.abs(Math.cos(rot * 2)) * 0.7 + 0.3);
          c.fillStyle = hexA(p.color, Math.min(1, a * 1.6));
          c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.7, 0); c.lineTo(0, s); c.lineTo(-s * 0.7, 0); c.closePath(); c.fill();
          c.strokeStyle = `rgba(42,18,22,${0.6 * a})`; c.lineWidth = 1; c.stroke();
          c.restore();
          break;
        }
        case 'star': {
          const tw = 0.6 + 0.4 * Math.sin(age / 70 + p.rot * 10);
          const s = p.size * (t < 0.2 ? t / 0.2 : 1) * tw, q = s * 0.2;
          c.save(); c.translate(x, y); c.rotate(p.vr * age);
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = hexA(p.color, a);
          c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(q, -q, s, 0); c.quadraticCurveTo(q, q, 0, s); c.quadraticCurveTo(-q, q, -s, 0); c.quadraticCurveTo(-q, -q, 0, -s); c.fill();
          c.restore();
          break;
        }
      }
    }
    this.parts = keep;
  }
  private drawPops(c: CanvasRenderingContext2D, now: number) {
    this.pops = this.pops.filter((p) => now - p.born < p.life);
    for (const p of this.pops) {
      const t = (now - p.born) / p.life;
      if (t < 0) continue;
      const s = t < 0.25 ? 0.6 + 0.7 * easeOut(t / 0.25) : 1.3 - 0.3 * clamp01((t - 0.25) / 0.2);
      const a = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      c.save();
      c.translate(p.x, p.y - 30 * t);
      c.scale(s, s);
      c.globalAlpha = a;
      c.font = `900 ${p.size}px Barlow, 'Arial Narrow', system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineJoin = 'round'; c.lineWidth = p.size * 0.16; c.strokeStyle = '#3a1604'; c.strokeText(p.text, 0, 0);
      const g = c.createLinearGradient(0, -p.size / 2, 0, p.size / 2);
      g.addColorStop(0, '#fffbe6'); g.addColorStop(0.5, '#ffd65e'); g.addColorStop(1, '#f2a622');
      c.fillStyle = g; c.fillText(p.text, 0, 0);
      c.restore();
    }
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a < 0 ? 0 : a > 1 ? 1 : a})`;
}
