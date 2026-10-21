'use client';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { damlaDropAt, type DamlaEvent, type DamlaTimeline } from '@/lib/damla-timeline';
import { GOLD, TWILIGHT, basinSize, drawDrop, drawParticle, drawRipple, drawTerraces, latticeToPx, terraceLayout, type Particle, type Ripple, type TerraceLayout } from './terraces';
import styles from './damla-game.module.css';

/** One drop on the board. Its own presentation clock starts at −delay (hidden until 0) and advances with the frames;
 * a hidden tab gets no frames, so the drop simply waits. Events fire once, in order. */
export interface BoardDrop {
  key: number;
  timeline: DamlaTimeline;
  /** Lattice x per row (damlaLatticeXs). */
  xs: readonly number[];
  delay: number;
  ghost?: boolean;
  onEvent: (event: DamlaEvent) => void;
}
export interface DamlaBoardHandle {
  launch: (drop: BoardDrop) => void;
  /** Stops every drop without firing its remaining events (unmount, replay cancel). */
  clear: () => void;
  /** The signature moment: all terraces flash gold. */
  gold: () => void;
  element: HTMLDivElement | null;
}
export interface BoardPool { text: string; aria: string }
interface Live { drop: BoardDrop; clock: number; next: number; lastY: number; done: boolean }

/** Pool colour by distance from the centre (0 centre … 1 edge): aqua → turquoise → jade → amber → coral → gold. */
const RAMP: Array<[number, [number, number, number]]> = [
  [0, [64, 128, 140]], [0.25, [38, 178, 190]], [0.5, [72, 196, 150]], [0.7, [226, 190, 84]], [0.86, [240, 128, 72]], [1, [255, 92, 112]],
];
export function poolColor(d: number, goldEdge: boolean): string {
  if (goldEdge && d >= 0.999) return 'rgb(255, 205, 70)';
  for (let i = 1; i < RAMP.length; i++) {
    const [b, cb] = RAMP[i]!, [a, ca] = RAMP[i - 1]!;
    if (d <= b) { const t = (d - a) / (b - a); return `rgb(${ca.map((c, j) => Math.round(c + (cb[j]! - c) * t)).join(', ')})`; }
  }
  return 'rgb(255, 92, 112)';
}
const MAX_STEP = 64;

export const DamlaBoard = memo(forwardRef<DamlaBoardHandle, { rows: number; pools: BoardPool[]; goldEdge: boolean; label: string; reduced: boolean; lite: boolean; poolsLabel: string }>(function DamlaBoard({ rows, pools, goldEdge, label, reduced, lite, poolsLabel }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const goldCanvas = useRef<HTMLCanvasElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);
  const poolRow = useRef<HTMLOListElement>(null);
  const layout = useRef<TerraceLayout | null>(null);
  const drops = useRef<Live[]>([]);
  const ripples = useRef<Ripple[]>([]);
  const particles = useRef<Particle[]>([]);
  const frame = useRef(0);
  const last = useRef<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const opts = useRef({ reduced, lite });
  opts.current = { reduced, lite };
  const poolH = size ? Math.max(28, Math.min(46, (size.w / (rows + 1)) * 1.25)) : 36;

  /* ---------------------------------------------------------------- static art per size and rows */
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]!.contentRect;
      setSize(s => (s && Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: Math.round(r.width), h: Math.round(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!size || size.w < 40 || size.h < 40) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const l = terraceLayout(size.w, size.h, rows, poolH);
    layout.current = l;
    for (const [canvas, palette] of [[bg.current, TWILIGHT], [goldCanvas.current, GOLD]] as const) {
      if (!canvas) continue;
      canvas.width = Math.round(size.w * dpr); canvas.height = Math.round(size.h * dpr);
      const ctx = canvas.getContext('2d'); if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawTerraces(ctx, l, palette);
    }
    const f = fx.current;
    if (f) { f.width = Math.round(size.w * dpr); f.height = Math.round(size.h * dpr); f.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const row = poolRow.current;
    if (row) { row.style.width = `${l.dx * (rows + 1)}px`; row.style.height = `${poolH}px`; row.style.left = `${l.cx - (l.dx * (rows + 1)) / 2}px`; }
    draw(performance.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, rows, poolH]);

  /* ---------------------------------------------------------------- frame loop */
  const hitPool = useCallback((slot: number, tier: number, signature: boolean) => {
    const el = poolRow.current?.children[slot] as HTMLElement | undefined;
    if (!el) return;
    el.setAttribute('data-hit', '');
    window.setTimeout(() => el.removeAttribute('data-hit'), signature ? 2600 : 900);
    if (opts.current.reduced) return;
    const lift = 1 + Math.min(0.3, 0.08 + tier * 0.05);
    el.animate([{ transform: 'translateY(0) scale(1)' }, { transform: `translateY(${-3 - tier}px) scale(${lift})`, offset: 0.25 }, { transform: 'translateY(0) scale(1)' }], { duration: 520 + tier * 80, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  }, []);

  const draw = useCallback((now: number) => {
    const canvas = fx.current, l = layout.current;
    if (!canvas || !l) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, l.width, l.height);
    const { ry } = basinSize(l);
    ripples.current = ripples.current.filter(r => now - r.born < r.life);
    for (const r of ripples.current) drawRipple(ctx, r, now, ry);
    particles.current = particles.current.filter(p => now - p.born < p.life);
    for (const p of particles.current) drawParticle(ctx, p, now);
    const size = Math.max(4, Math.min(11, Math.min(l.dx, l.dy) * 0.3));
    for (const live of drops.current) {
      if (live.done || live.clock < 0) continue;
      const s = damlaDropAt(live.drop.timeline, live.drop.xs, live.clock);
      if (s.phase === 'pool' && s.squash <= 0) continue;
      const [x, y] = latticeToPx(l, s.x, s.y);
      const vy = (s.y - live.lastY) * 6;
      live.lastY = s.y;
      drawDrop(ctx, x, y - size * 0.6, size, { vy, squash: s.squash, ghost: live.drop.ghost, gold: false });
    }
  }, []);

  const splash = useCallback((x: number, y: number, now: number, power: number, gold = false) => {
    const l = layout.current; if (!l) return;
    const { lite, reduced } = opts.current;
    ripples.current.push({ x, y, born: now, life: reduced ? 380 : 620, scale: 0.8 + power * 0.35, gold });
    if (lite || reduced) return;
    const n = 3 + Math.round(power * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (1.1 + (0.8 * i) / Math.max(1, n - 1)) + (Math.random() - 0.5) * 0.3;
      const v = (60 + Math.random() * 90) * (0.7 + power * 0.3) * Math.min(1.4, l.dx / 30);
      particles.current.push({ x, y: y - 1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: now, life: 380 + Math.random() * 260, size: 0.9 + Math.random() * 1.3 * Math.min(1.5, l.dx / 24), gold });
    }
  }, []);

  const tick = useCallback((now: number) => {
    const dt = last.current === null ? 0 : Math.min(MAX_STEP, Math.max(0, now - last.current));
    last.current = now;
    const l = layout.current;
    for (const live of drops.current) {
      if (live.done) continue;
      live.clock += dt;
      const events = live.drop.timeline.events;
      while (live.next < events.length && events[live.next]!.at <= live.clock) {
        const event = events[live.next++]!;
        if (l && event.type === 'splash') { const [x, y] = latticeToPx(l, event.x, event.terrace); splash(x, y, now, 0.4); }
        if (l && event.type === 'land') {
          const [x, y] = latticeToPx(l, event.x, l.rows);
          splash(x, y - l.poolH * 0.3, now, 1 + event.tier * 0.5, event.signature);
          if (event.tier >= 4 && !opts.current.lite) for (let k = 0; k < 3; k++) splash(x + (Math.random() - 0.5) * l.dx, y - l.poolH * 0.4, now + k * 90, 1.2, event.signature);
          hitPool(event.slot, event.tier, event.signature);
        }
        try { live.drop.onEvent(event); } catch { /* presentation callback errors never stop the board */ }
        if (event.type === 'end') live.done = true;
      }
    }
    drops.current = drops.current.filter(d => !d.done || d.clock < d.drop.timeline.landAt + 200);
    draw(now);
    const active = drops.current.some(d => !d.done) || ripples.current.length > 0 || particles.current.length > 0;
    if (active) frame.current = requestAnimationFrame(tick); else { frame.current = 0; last.current = null; }
  }, [draw, hitPool, splash]);

  const ensureLoop = useCallback(() => {
    if (!frame.current) { last.current = null; frame.current = requestAnimationFrame(tick); }
  }, [tick]);

  useImperativeHandle(ref, () => ({
    launch: drop => {
      drops.current.push({ drop, clock: -Math.max(0, drop.delay), next: 0, lastY: -1.2, done: false });
      ensureLoop();
    },
    clear: () => { drops.current = []; ripples.current = []; particles.current = []; draw(performance.now()); },
    gold: () => {
      const canvas = goldCanvas.current, el = wrap.current;
      if (!canvas || !el) return;
      el.setAttribute('data-gold', '');
      window.setTimeout(() => el.removeAttribute('data-gold'), 2600);
      if (opts.current.reduced) { canvas.animate([{ opacity: 0 }, { opacity: 0.85, offset: 0.2 }, { opacity: 0.85, offset: 0.7 }, { opacity: 0 }], { duration: 2200 }); return; }
      canvas.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.55, offset: 0.3 }, { opacity: 1, offset: 0.45 }, { opacity: 0.9, offset: 0.75 }, { opacity: 0 }], { duration: 2600, easing: 'ease-out' });
    },
    get element() { return wrap.current; },
  }), [draw, ensureLoop]);

  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; drops.current = []; }, []);
  // a changed mode (rows) clears leftover ripples (drops never outlive a mode: the selector is locked while they fly)
  useEffect(() => { ripples.current = []; particles.current = []; }, [rows]);

  return (
    <div ref={wrap} className={styles.board} role="group" aria-label={label} data-rows={rows}>
      <canvas ref={bg} className={styles.boardCanvas} aria-hidden="true" />
      <canvas ref={goldCanvas} className={`${styles.boardCanvas} ${styles.goldCanvas}`} aria-hidden="true" />
      <canvas ref={fx} className={`${styles.boardCanvas} ${styles.fxCanvas}`} aria-hidden="true" />
      <ol ref={poolRow} className={styles.pools} aria-label={poolsLabel} style={{ '--pool-font': `${Math.max(8, Math.min(14, (size ? size.w / (rows + 1) : 30) * 0.36))}px` } as CSSProperties}>
        {pools.map((pool, k) => {
          const d = Math.abs(k - rows / 2) / (rows / 2);
          return (
            <li key={`${rows}-${k}`} className={styles.pool} data-testid={`damla-pool-${k}`} data-edge={d >= 0.999 || undefined}
              style={{ '--pool': poolColor(d, goldEdge) } as CSSProperties} aria-label={pool.aria}>
              <span className={styles.poolWater} aria-hidden="true" />
              <span className={styles.poolLabel} aria-hidden="true">{pool.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}));
