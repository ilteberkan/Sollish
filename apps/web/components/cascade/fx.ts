/* Candy Cascade effects: one overlay <canvas> for every particle (candy crumbs, sparkles, rings,
   confetti) plus a DOM layer for floating amounts and crystal flights. Presentation only. Particle
   randomness uses Math.random on purpose: it is cosmetic and never touches the round. */

export const SYMBOL_COLORS: Record<string, readonly string[]> = {
  crown: ['#ff5d8f', '#ffd0de', '#ffe05a'],
  cupcake: ['#31cdb2', '#9bf5da', '#ff7fa9'],
  donut: ['#a47dff', '#e5d4ff', '#ffffff'],
  gumdrop: ['#ff9a3c', '#ffd08a', '#fff4dc'],
  strawberry: ['#ff3b5c', '#ff8aa0', '#7bd35a'],
  blueberry: ['#5b7dff', '#a9bbff', '#2f3fb8'],
  kiwi: ['#8fd14f', '#d8f59a', '#4a2f14'],
  lemon: ['#ffd84a', '#fff3a8', '#ffb21f'],
  cherry: ['#e3284f', '#ff7c95', '#5aa83a'],
  star: ['#ffd36b', '#fff4c8', '#ffb347'],
  crystal: ['#ffe09a', '#ffffff', '#ffb0cf'],
};
const CONFETTI = ['#ff5d8f', '#31cdb2', '#a47dff', '#ff9a3c', '#ffd84a', '#8fd14f', '#5b7dff', '#fff4c8'];

type Shape = 0 | 1 | 2 | 3 | 4 | 5 | 6; // circle, rounded crumb, triangle shard, sparkle, ring, gold coin, wrapped candy
interface Particle {
  x: number; y: number; vx: number; vy: number; g: number; drag: number;
  rot: number; vr: number; size: number; color: string; shape: Shape;
  life: number; max: number; grow: number; fade: boolean;
  /** Second colour (coin rim, candy stripe). */
  alt?: string;
}
/** Continuous particle source (celebration rain). */
interface Emitter { rate: number; carry: number; until: number; spawn: () => void }
/** Celebration palettes per level (1 Büyük … 4 Efsane, 5 Azami): candy colours that rain with the gold coins. */
export const CELEBRATION_COLORS: Record<number, readonly string[]> = {
  1: ['#ffb347', '#ffd36b', '#ff8a3c', '#fff1c4'],
  2: ['#ff5d8f', '#ff9ccc', '#ffd0e6', '#c33aa0'],
  3: ['#31e0c2', '#9bf5da', '#5bd0ff', '#e8fff8'],
  4: ['#a47dff', '#d9c2ff', '#ff7ad9', '#7b5cff'],
  5: ['#ffffff', '#ffe7a6', '#ff5d8f', '#5bd0ff', '#a47dff', '#8dffcf'],
};
const MAX_PARTICLES = 900;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pickOf = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;

export class CascadeFx {
  private ctx: CanvasRenderingContext2D | null;
  private particles: Particle[] = [];
  private emitters: Emitter[] = [];
  private frame = 0;
  private last = 0;
  private width = 0;
  private height = 0;
  private observer: ResizeObserver | null = null;
  private disposed = false;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly layer: HTMLElement, private readonly host: HTMLElement) {
    this.ctx = canvas.getContext('2d');
    this.resize();
    if (typeof ResizeObserver !== 'undefined') { this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); }
  }
  /** Host-relative centre of an element (CSS px). */
  point(el: Element): { x: number; y: number; w: number; h: number } {
    const a = el.getBoundingClientRect(), b = this.host.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2, w: a.width, h: a.height };
  }
  get size() { return { width: this.width, height: this.height }; }
  private resize() {
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    this.width = rect.width; this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  private add(p: Particle) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
    this.wake();
  }
  private wake() {
    if (!this.frame && !this.disposed) { this.last = performance.now(); this.frame = requestAnimationFrame(this.tick); }
  }
  /** One falling gold coin or wrapped candy from above the stage (celebration rain). */
  private dropPiece(colors: readonly string[], speed: number) {
    const coin = Math.random() < 0.45;
    const size = coin ? rand(9, 15) : rand(10, 17);
    this.add({ x: rand(-10, this.width + 10), y: rand(-60, -14), vx: rand(-40, 40), vy: rand(120, 260) * speed, g: 520 * speed, drag: 0.35,
      rot: rand(0, 6.28), vr: rand(-7, 7), size, color: coin ? '#ffcf4a' : pickOf(colors), alt: coin ? '#b8741f' : '#ffffff', shape: coin ? 5 : 6,
      life: 0, max: rand(2.2, 3.4), grow: 0, fade: true });
  }
  /**
   * Celebration rain on the single canvas: candy and gold coins fall from the top for `seconds`. `level` 1..5 sets
   * the density and the palette; calling again replaces the previous rain (tier-up intensifies it).
   */
  rain(level: number, seconds: number) {
    const colors = CELEBRATION_COLORS[level] ?? CELEBRATION_COLORS[1]!;
    // Density per level, scaled down on narrow stages (phones) so the screen stays readable.
    const rate = [0, 22, 38, 58, 84, 110][Math.max(1, Math.min(5, level))]! * Math.min(1, Math.max(0.45, this.width / 760));
    const speed = 1 + level * 0.08;
    this.emitters = [{ rate, carry: 0, until: performance.now() + seconds * 1000, spawn: () => this.dropPiece(colors, speed) }];
    this.wake();
  }
  stopRain() { this.emitters = []; }
  /** Tier-up fountain: coins and candy shoot up from the bottom edge and fall back (count grows with level). */
  fountain(level: number) {
    const colors = CELEBRATION_COLORS[level] ?? CELEBRATION_COLORS[1]!;
    const n = Math.round((26 + level * 22) * Math.min(1, Math.max(0.5, this.width / 760)));
    for (let i = 0; i < n; i++) {
      const coin = i % 2 === 0;
      this.add({ x: this.width * rand(0.15, 0.85), y: this.height + 10, vx: rand(-260, 260), vy: -rand(620, 1080) * Math.min(1.25, this.height / 640 + 0.35),
        g: 1150, drag: 0.5, rot: rand(0, 6.28), vr: rand(-10, 10), size: coin ? rand(10, 16) : rand(11, 18), color: coin ? '#ffcf4a' : pickOf(colors),
        alt: coin ? '#b8741f' : '#ffffff', shape: coin ? 5 : 6, life: -rand(0, 0.25), max: rand(1.7, 2.5), grow: 0, fade: true });
    }
  }
  /** Candy-crumb burst for a popped cell. `scale` is the cell size in px. */
  burst(x: number, y: number, colors: readonly string[], scale: number, count = 14) {
    const s = scale / 60;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), v = rand(140, 420) * s;
      this.add({ x: x + Math.cos(a) * scale * 0.18, y: y + Math.sin(a) * scale * 0.18, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 160 * s, g: 1300 * s, drag: 1.6,
        rot: rand(0, 6.28), vr: rand(-12, 12), size: rand(3, 7.5) * s, color: pickOf(colors), shape: (i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2) as Shape,
        life: 0, max: rand(0.55, 0.95), grow: 0, fade: true });
    }
    for (let i = 0; i < 4; i++) {
      const a = rand(0, Math.PI * 2), v = rand(40, 140) * s;
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0, drag: 2.5, rot: rand(0, 1), vr: rand(-2, 2), size: rand(6, 11) * s, color: '#fff', shape: 3, life: 0, max: rand(0.35, 0.6), grow: 0, fade: true });
    }
    this.add({ x, y, vx: 0, vy: 0, g: 0, drag: 0, rot: 0, vr: 0, size: scale * 0.3, color: colors[1] ?? '#fff', shape: 4, life: 0, max: 0.32, grow: scale * 0.38, fade: true });
  }
  sparkle(x: number, y: number, radius: number, count = 8, color = '#fff4c8') {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0, radius);
      this.add({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: rand(-20, 20), vy: rand(-60, -10), g: 0, drag: 1, rot: rand(0, 1), vr: rand(-1, 1), size: rand(5, 12), color, shape: 3, life: 0, max: rand(0.5, 1.1), grow: 0, fade: true });
    }
  }
  ring(x: number, y: number, radius: number, color: string, life = 0.6) {
    this.add({ x, y, vx: 0, vy: 0, g: 0, drag: 0, rot: 0, vr: 0, size: radius * 0.2, color, shape: 4, life: 0, max: life, grow: radius * 1.6, fade: true });
  }
  /** Candy confetti across the whole stage; tier 1..3 scales the amount. */
  confetti(tier: number, duration = 1.6) {
    const n = 50 + tier * 45;
    for (let i = 0; i < n; i++) {
      const fromLeft = i % 2 === 0;
      this.add({ x: fromLeft ? rand(-10, this.width * 0.2) : rand(this.width * 0.8, this.width + 10), y: rand(this.height * 0.55, this.height * 0.95),
        vx: (fromLeft ? 1 : -1) * rand(120, 420), vy: -rand(520, 980), g: 900, drag: 0.9, rot: rand(0, 6.28), vr: rand(-9, 9), size: rand(5, 10),
        color: pickOf(CONFETTI), shape: (i % 4 === 0 ? 0 : i % 4 === 3 ? 2 : 1) as Shape, life: -rand(0, duration * 0.5), max: rand(1.6, 2.6), grow: 0, fade: true });
    }
  }
  /** Floating amount label, rising from (x, y). */
  label(x: number, y: number, text: string, className: string, dur = 1100) {
    const el = document.createElement('div');
    el.className = className; el.textContent = text;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    this.layer.appendChild(el);
    const anim = el.animate([
      { transform: 'translate(-50%, -50%) translate3d(0, 10px, 0) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%, -50%) translate3d(0, -6px, 0) scale(1.12)', opacity: 1, offset: 0.18 },
      { transform: 'translate(-50%, -50%) translate3d(0, -18px, 0) scale(1)', opacity: 1, offset: 0.6 },
      { transform: 'translate(-50%, -50%) translate3d(0, -46px, 0) scale(.94)', opacity: 0 },
    ], { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    anim.onfinish = () => el.remove(); anim.oncancel = () => el.remove();
  }
  /** Crystal flight along an arc from a cell to the multiplier badge (both host-relative points). */
  fly(source: Element, from: { x: number; y: number; w: number }, to: { x: number; y: number }, delay: number, dur: number, className: string) {
    const el = document.createElement('div');
    el.className = className;
    el.style.width = `${from.w}px`; el.style.height = `${from.w}px`;
    el.style.left = `${from.x - from.w / 2}px`; el.style.top = `${from.y - from.w / 2}px`;
    const svg = source.cloneNode(true) as Element;
    el.appendChild(svg);
    this.layer.appendChild(el);
    const dx = to.x - from.x, dy = to.y - from.y;
    const lift = Math.min(160, Math.abs(dx) * 0.4 + 70);
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 10; i++) {
      const p = i / 10, e = p * p * (3 - 2 * p);
      const x = dx * e, y = dy * e - Math.sin(Math.PI * p) * lift;
      const s = 1 + Math.sin(Math.PI * p) * 0.25 - p * 0.45;
      frames.push({ transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(p * 360).toFixed(0)}deg) scale(${s.toFixed(3)})`, opacity: i === 10 ? 0.2 : 1 });
    }
    const anim = el.animate(frames, { duration: dur, delay, easing: 'linear', fill: 'both' });
    anim.onfinish = () => el.remove(); anim.oncancel = () => el.remove();
  }
  clear() {
    this.particles = [];
    this.emitters = [];
    for (const child of Array.from(this.layer.children)) { for (const anim of child.getAnimations()) anim.cancel(); child.remove(); }
    this.ctx?.clearRect(0, 0, this.width, this.height);
  }
  dispose() {
    this.disposed = true; this.observer?.disconnect(); cancelAnimationFrame(this.frame); this.frame = 0; this.clear();
  }
  private tick = (now: number) => {
    const ctx = this.ctx;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!ctx) { this.particles = []; this.frame = 0; return; }
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.emitters.length) {
      this.emitters = this.emitters.filter(e => now < e.until);
      for (const e of this.emitters) {
        e.carry += e.rate * dt;
        while (e.carry >= 1) { e.carry -= 1; e.spawn(); }
      }
    }
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life < 0) { alive.push(p); continue; }
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const t = p.life / p.max;
      const alpha = p.fade ? (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3) : 1;
      ctx.globalAlpha = Math.max(0, alpha);
      if (p.shape === 4) {
        const r = p.size + p.grow * (1 - (1 - t) * (1 - t));
        ctx.globalAlpha = Math.max(0, (1 - t) * 0.7);
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.8, 4 * (1 - t));
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.shape === 3) {
        const r = p.size * (t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7 * 0.6);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.14, -r * 0.14, r, 0); ctx.quadraticCurveTo(r * 0.14, r * 0.14, 0, r);
        ctx.quadraticCurveTo(-r * 0.14, r * 0.14, -r, 0); ctx.quadraticCurveTo(-r * 0.14, -r * 0.14, 0, -r);
        ctx.fill(); ctx.restore();
      } else if (p.shape === 5) {
        // Gold coin flipping about its vertical axis: width follows cos(rot), rim + face + glint.
        const flip = Math.cos(p.rot * 1.3), w = Math.max(0.12, Math.abs(flip)) * p.size, h = p.size;
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.fillStyle = p.alt ?? '#b8741f';
        ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = flip > 0 ? p.color : '#f2b33a';
        ctx.beginPath(); ctx.ellipse(0, 0, w * 0.8, h * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.beginPath(); ctx.ellipse(-w * 0.25, -h * 0.3, w * 0.22, h * 0.18, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (p.shape === 6) {
        // Wrapped candy: round body, two twisted wrapper ends, a white stripe.
        const s = p.size * 0.55;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(-s * 1.9, -s * 0.7); ctx.lineTo(-s * 1.9, s * 0.7); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(s * 1.9, -s * 0.7); ctx.lineTo(s * 1.9, s * 0.7); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = p.alt ?? '#fff'; ctx.lineWidth = Math.max(1, s * 0.32); ctx.globalAlpha *= 0.85;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.55, -2.2, 0.4); ctx.stroke();
        ctx.restore();
      } else {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
        const s = p.size;
        if (p.shape === 0) { ctx.beginPath(); ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2); ctx.fill(); }
        else if (p.shape === 1) { ctx.fillRect(-s * 0.7, -s * 0.4, s * 1.4, s * 0.8); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-s * 0.6, -s * 0.4, s * 0.9, s * 0.22); }
        else { ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(s * 0.7, s * 0.5); ctx.lineTo(-s * 0.7, s * 0.5); ctx.closePath(); ctx.fill(); }
        ctx.restore();
      }
      alive.push(p);
    }
    ctx.globalAlpha = 1;
    this.particles = alive;
    this.frame = (alive.length || this.emitters.length) && !this.disposed ? requestAnimationFrame(this.tick) : 0;
    if (!this.frame) ctx.clearRect(0, 0, this.width, this.height);
  };
}
