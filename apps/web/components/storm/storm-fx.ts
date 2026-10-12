/* Tarhun effects: one overlay <canvas> for every particle (stone shards, electric sparks, rings, gold coins and
   bronze discs for the celebrations) plus a DOM layer for floating amounts and orb flights. Presentation only.
   Particle randomness uses Math.random on purpose: it is cosmetic and never touches the round. The loop only runs
   while particles live, and it stops while the document is hidden (rAF does not fire there). */

/** Shard/spark palettes per symbol: stone body, lit edge, spark colour. */
export const STORM_SYMBOL_COLORS: Record<string, readonly string[]> = {
  h1: ['#d9a548', '#ffe6a3', '#fff4d0'],
  h2: ['#b9c4cc', '#e8f4ff', '#8fe1ff'],
  h3: ['#c88b3c', '#ffd88a', '#fff0c4'],
  h4: ['#e3a83a', '#ffe28c', '#fff6c8'],
  l1: ['#2f5fd0', '#8fb4ff', '#c9ddff'],
  l2: ['#d0452e', '#ff9a7c', '#ffd2b8'],
  l3: ['#e3a020', '#ffd36a', '#fff0b8'],
  l4: ['#2f9a63', '#8ee6b4', '#d4ffe6'],
  l5: ['#2a2f3c', '#7f8aa6', '#9fe6ff'],
  scatter: ['#ffd36b', '#fff4c8', '#9fe6ff'],
  orb: ['#9fe6ff', '#ffffff', '#c9b8ff'],
};
/** Celebration palettes per level (1 Büyük … 4 Efsane, 5 Azami). */
export const STORM_CELEBRATION_COLORS: Record<number, readonly string[]> = {
  1: ['#ffd36b', '#ffe9a8', '#e8a640', '#fff6d8'],
  2: ['#7fdcff', '#c9f1ff', '#3aa8ff', '#ffe6a3'],
  3: ['#58e6c0', '#b8ffe8', '#21b38e', '#ffe6a3'],
  4: ['#c7a2ff', '#eadcff', '#8a5cff', '#ffd36b'],
  5: ['#ffffff', '#fff1b8', '#9fe6ff', '#ff9b7a', '#c7a2ff'],
};

type Shape = 0 | 1 | 2 | 3 | 4 | 5; // shard, spark streak, glint, ring, coin, bronze disc
interface Particle {
  x: number; y: number; vx: number; vy: number; g: number; drag: number;
  rot: number; vr: number; size: number; color: string; alt?: string; shape: Shape;
  life: number; max: number; grow: number; sides?: number;
}
interface Emitter { rate: number; carry: number; until: number; spawn: () => void }
const MAX_PARTICLES = 700;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pickOf = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;

export class StormFx {
  private ctx: CanvasRenderingContext2D | null;
  private particles: Particle[] = [];
  private emitters: Emitter[] = [];
  private frame = 0;
  private last = 0;
  private width = 0;
  private height = 0;
  private observer: ResizeObserver | null = null;
  private disposed = false;
  /** Fewer particles (Ayarlar → "Efektleri azalt", reduced motion). */
  lite = false;
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
  private resize() {
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(1.5, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    this.width = rect.width; this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  private add(p: Particle) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
    if (!this.frame && !this.disposed) { this.last = performance.now(); this.frame = requestAnimationFrame(this.tick); }
  }
  private n(count: number) { return Math.max(1, Math.round(this.lite ? count * 0.35 : count)); }

  /** A winning symbol shatters: angular stone shards with lit edges, a puff of electric sparks, a ring. */
  shatter(x: number, y: number, colors: readonly string[], cell: number) {
    const s = cell / 70;
    for (let i = 0, n = this.n(11); i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(160, 460) * s;
      this.add({ x: x + Math.cos(a) * cell * 0.14, y: y + Math.sin(a) * cell * 0.14, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200 * s, g: 1500 * s, drag: 1.2,
        rot: rand(0, 6.28), vr: rand(-14, 14), size: rand(4, 10) * s, color: i % 3 === 0 ? colors[1]! : colors[0]!, alt: '#1a120a', shape: 0,
        life: 0, max: rand(0.55, 0.95), grow: 0, sides: 3 + (i % 3) });
    }
    for (let i = 0, n = this.n(9); i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(260, 620) * s;
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 300 * s, drag: 3.2, rot: 0, vr: 0, size: rand(1.2, 2.2) * s, color: colors[2] ?? '#fff', shape: 1, life: 0, max: rand(0.25, 0.5), grow: 0 });
    }
    this.add({ x, y, vx: 0, vy: 0, g: 0, drag: 0, rot: 0, vr: 0, size: cell * 0.25, color: colors[1] ?? '#fff', shape: 3, life: 0, max: 0.34, grow: cell * 0.36 });
  }
  /** Electric impact (lightning on an orb, scatter flare). */
  sparks(x: number, y: number, radius: number, count = 14, color = '#bff3ff') {
    for (let i = 0, n = this.n(count); i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(200, 560) * (radius / 50);
      this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 200, drag: 3.6, rot: 0, vr: 0, size: rand(1.2, 2.4), color, shape: 1, life: 0, max: rand(0.22, 0.5), grow: 0 });
    }
    for (let i = 0, n = this.n(5); i < n; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0, radius * 0.6);
      this.add({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: 0, vy: rand(-40, -10), g: 0, drag: 1, rot: rand(0, 1), vr: rand(-1, 1), size: rand(5, 11), color: '#ffffff', shape: 2, life: 0, max: rand(0.35, 0.7), grow: 0 });
    }
  }
  ring(x: number, y: number, radius: number, color: string, life = 0.6) {
    this.add({ x, y, vx: 0, vy: 0, g: 0, drag: 0, rot: 0, vr: 0, size: radius * 0.2, color, shape: 3, life: 0, max: life, grow: radius * 1.6 });
  }
  glints(x: number, y: number, radius: number, count = 8, color = '#fff4c8') {
    for (let i = 0, n = this.n(count); i < n; i++) {
      const a = rand(0, Math.PI * 2), r = rand(0, radius);
      this.add({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: rand(-20, 20), vy: rand(-60, -10), g: 0, drag: 1, rot: rand(0, 1), vr: rand(-1, 1), size: rand(5, 12), color, shape: 2, life: 0, max: rand(0.5, 1.1), grow: 0 });
    }
  }
  private dropPiece(colors: readonly string[], speed: number) {
    const coin = Math.random() < 0.6;
    this.add({ x: rand(-10, this.width + 10), y: rand(-60, -14), vx: rand(-40, 40), vy: rand(120, 260) * speed, g: 520 * speed, drag: 0.35,
      rot: rand(0, 6.28), vr: rand(-7, 7), size: coin ? rand(8, 14) : rand(9, 15), color: coin ? '#ffcf4a' : pickOf(colors), alt: coin ? '#a8661a' : '#3a2410', shape: coin ? 4 : 5,
      life: 0, max: rand(2.2, 3.4), grow: 0 });
  }
  /** Celebration rain for `seconds`; level 1..5 sets density and palette (calling again replaces it). */
  rain(level: number, seconds: number) {
    const colors = STORM_CELEBRATION_COLORS[level] ?? STORM_CELEBRATION_COLORS[1]!;
    const rate = [0, 20, 34, 52, 74, 96][Math.max(1, Math.min(5, level))]! * Math.min(1, Math.max(0.45, this.width / 760)) * (this.lite ? 0.35 : 1);
    const speed = 1 + level * 0.08;
    this.emitters = [{ rate, carry: 0, until: performance.now() + seconds * 1000, spawn: () => this.dropPiece(colors, speed) }];
    if (!this.frame && !this.disposed) { this.last = performance.now(); this.frame = requestAnimationFrame(this.tick); }
  }
  stopRain() { this.emitters = []; }
  /** Tier-up burst: coins and bronze discs shoot up from the bottom edge. */
  fountain(level: number) {
    const colors = STORM_CELEBRATION_COLORS[level] ?? STORM_CELEBRATION_COLORS[1]!;
    const n = this.n(Math.round((22 + level * 18) * Math.min(1, Math.max(0.5, this.width / 760))));
    for (let i = 0; i < n; i++) {
      const coin = i % 2 === 0;
      this.add({ x: this.width * rand(0.15, 0.85), y: this.height + 10, vx: rand(-260, 260), vy: -rand(620, 1080) * Math.min(1.25, this.height / 640 + 0.35),
        g: 1150, drag: 0.5, rot: rand(0, 6.28), vr: rand(-10, 10), size: coin ? rand(9, 15) : rand(10, 16), color: coin ? '#ffcf4a' : pickOf(colors),
        alt: coin ? '#a8661a' : '#3a2410', shape: coin ? 4 : 5, life: -rand(0, 0.25), max: rand(1.7, 2.5), grow: 0 });
    }
  }
  /** Floating amount label rising from (x, y). */
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
  /** Orb flight along an arc from a cell to the multiplier meter (host-relative points). */
  fly(source: Element, from: { x: number; y: number; w: number }, to: { x: number; y: number }, dur: number, className: string) {
    const el = document.createElement('div');
    el.className = className;
    el.style.width = `${from.w}px`; el.style.height = `${from.w}px`;
    el.style.left = `${from.x - from.w / 2}px`; el.style.top = `${from.y - from.w / 2}px`;
    el.appendChild(source.cloneNode(true));
    this.layer.appendChild(el);
    const dx = to.x - from.x, dy = to.y - from.y;
    const lift = Math.min(150, Math.abs(dx) * 0.35 + 60);
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 10; i++) {
      const p = i / 10, e = p * p * (3 - 2 * p);
      const x = dx * e, y = dy * e - Math.sin(Math.PI * p) * lift;
      const s = 1 + Math.sin(Math.PI * p) * 0.3 - p * 0.55;
      frames.push({ transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`, opacity: i === 10 ? 0.2 : 1 });
    }
    const anim = el.animate(frames, { duration: Math.max(60, dur), easing: 'linear', fill: 'both' });
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
      for (const e of this.emitters) { e.carry += e.rate * dt; while (e.carry >= 1) { e.carry -= 1; e.spawn(); } }
    }
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life < 0) { alive.push(p); continue; }
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const t = p.life / p.max;
      ctx.globalAlpha = Math.max(0, t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      if (p.shape === 3) {
        const r = p.size + p.grow * (1 - (1 - t) * (1 - t));
        ctx.globalAlpha = Math.max(0, (1 - t) * 0.75);
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.8, 4 * (1 - t));
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.shape === 1) {
        // spark streak along its velocity
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      } else if (p.shape === 2) {
        const r = p.size * (t < 0.3 ? t / 0.3 : 1 - ((t - 0.3) / 0.7) * 0.6);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r * 0.18, -r * 0.18); ctx.lineTo(r, 0); ctx.lineTo(r * 0.18, r * 0.18);
        ctx.lineTo(0, r); ctx.lineTo(-r * 0.18, r * 0.18); ctx.lineTo(-r, 0); ctx.lineTo(-r * 0.18, -r * 0.18); ctx.closePath();
        ctx.fill(); ctx.restore();
      } else if (p.shape === 4) {
        const flip = Math.cos(p.rot * 1.3), w = Math.max(0.12, Math.abs(flip)) * p.size, h = p.size;
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.fillStyle = p.alt ?? '#a8661a';
        ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = flip > 0 ? p.color : '#e9a93a';
        ctx.beginPath(); ctx.ellipse(0, 0, w * 0.78, h * 0.78, 0, 0, Math.PI * 2); ctx.fill();
        // stamped bolt on the face
        if (flip > 0.35) { ctx.strokeStyle = '#8a5214'; ctx.lineWidth = Math.max(1, h * 0.14); ctx.beginPath(); ctx.moveTo(w * 0.15, -h * 0.5); ctx.lineTo(-w * 0.2, 0); ctx.lineTo(w * 0.2, 0); ctx.lineTo(-w * 0.15, h * 0.5); ctx.stroke(); }
        ctx.restore();
      } else if (p.shape === 5) {
        // bronze disc with a coloured enamel core (celebration palette)
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        const sx = Math.max(0.2, Math.abs(Math.cos(p.rot * 0.9)));
        ctx.scale(sx, 1);
        ctx.fillStyle = '#c4863c'; ctx.beginPath(); ctx.arc(0, 0, p.size * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, p.size * 0.38, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        // stone shard: irregular polygon with a lit edge
        const sides = p.sides ?? 4, r = p.size;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; const rr = r * (i % 2 ? 0.62 : 1); if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,240,200,.55)'; ctx.lineWidth = Math.max(0.6, r * 0.18);
        ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(Math.cos(Math.PI * 2 / sides) * r * 0.62, Math.sin(Math.PI * 2 / sides) * r * 0.62); ctx.stroke();
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
