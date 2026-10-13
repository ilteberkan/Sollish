'use client';

import { useEffect, useId, useImperativeHandle, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { ebruRng, marblePattern, type EbruMood, type MarbleStyle } from './water';
import styles from './scene.module.css';

/* "Mürekkep Bahçesi" backdrop: a marbling artist's atelier at dusk. Layers (back → front):
   plaster wall + lamp light · arched window (dusk sky, a city of domes, crescent, lattice) · light shaft ·
   shelf with glazed ink bowls (çanak), ox-gall bottles and a jar of horsehair brushes on rose stems ·
   hanging brass oil lamp (flickering glow) · two drying lines with freshly marbled sheets swaying ·
   walnut work table with a resting comb, awl and rose petals · mood washes · vignette · children.
   Everything is code-drawn. The 16:9 stage covers the root (container query units) so HTML layers and the
   SVG share one coordinate space. The sheets are marbled with the water engine's maths and painted once
   into small canvases after mount (SSR shows plain paper). Only transform / opacity animate; the pointer
   parallax moves whole layers (fine pointers only, never under reduced motion). */

export type { EbruMood };
export interface EbruSceneHandle {
  /** Briefly brighten the lamp (e.g. on a win). */
  glow(intensity?: number): void;
}
export interface EbruSceneProps {
  mood?: EbruMood;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  parallax?: boolean;
  ref?: Ref<EbruSceneHandle>;
}

const f1 = (n: number) => Math.round(n * 10) / 10;
type Stop = readonly [number, string, number?];
const stops = (s: readonly Stop[]) => s.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />);

/* drying lines and sheets (stage units 1600 × 900) */
const ROPES = [
  { x0: -20, y0: 60, x1: 1620, y1: 84, sag: 70 },
  { x0: -20, y0: 196, x1: 1620, y1: 176, sag: 54 },
];
const ropeY = (r: (typeof ROPES)[number], x: number) => {
  const t = (x - r.x0) / (r.x1 - r.x0);
  return r.y0 + (r.y1 - r.y0) * t + r.sag * 4 * t * (1 - t);
};
interface Sheet { x: number; rope: number; w: number; h: number; style: MarbleStyle; seed: number; colors: readonly string[]; tilt: number; delay: number }
const PAL = {
  sultan: ['#e0283c', '#f2bf3c', '#1d3a8a', '#fff1d6', '#22c9c0'],
  sea: ['#22c9c0', '#3d6cf0', '#fff1d6', '#0b2c6a', '#f2bf3c'],
  rose: ['#ee79ad', '#fff1d6', '#9a2c63', '#f2bf3c', '#2fb164'],
  earth: ['#c8701f', '#fff1d6', '#4a2a10', '#e0283c', '#f2bf3c'],
  night: ['#1d3a8a', '#fff1d6', '#8a6cff', '#22c9c0', '#e0283c'],
};
const SHEETS: Sheet[] = [
  { x: 70, rope: 0, w: 130, h: 172, style: 'battal', seed: 3, colors: PAL.sultan, tilt: -2, delay: 0 },
  { x: 250, rope: 0, w: 120, h: 160, style: 'gelgit', seed: 8, colors: PAL.sea, tilt: 1.5, delay: -1.3 },
  { x: 560, rope: 0, w: 128, h: 168, style: 'tarakli', seed: 13, colors: PAL.rose, tilt: -1, delay: -2.1 },
  { x: 920, rope: 0, w: 124, h: 164, style: 'sal', seed: 21, colors: PAL.earth, tilt: 2, delay: -0.7 },
  { x: 1300, rope: 0, w: 132, h: 176, style: 'hatip', seed: 34, colors: ['#fff1d6', '#e0283c', '#f2bf3c', '#22c9c0', '#1d3a8a', '#ee79ad'], tilt: -1.6, delay: -2.8 },
  { x: 1470, rope: 0, w: 118, h: 156, style: 'battal', seed: 55, colors: PAL.night, tilt: 1, delay: -1.8 },
  { x: 140, rope: 1, w: 110, h: 146, style: 'tarakli', seed: 89, colors: PAL.night, tilt: 1.2, delay: -0.4 },
  { x: 1380, rope: 1, w: 112, h: 150, style: 'gelgit', seed: 144, colors: PAL.sultan, tilt: -1.4, delay: -2.4 },
];

/* skyline seen through the window (window space 0..260 × 0..500) */
const SKY = (() => {
  const r = ebruRng(17);
  const parts: string[] = [];
  let x = -10;
  while (x < 270) {
    const w = 16 + r() * 28, h = 18 + r() * 40;
    const base = 432;
    if (r() < 0.45) {
      // domed building
      parts.push(`M${f1(x)} ${base}V${f1(base - h)}H${f1(x + w)}V${base}Z`);
      parts.push(`M${f1(x + w * 0.1)} ${f1(base - h)}A${f1(w * 0.4)} ${f1(w * 0.42)} 0 0 1 ${f1(x + w * 0.9)} ${f1(base - h)}Z`);
    } else parts.push(`M${f1(x)} ${base}V${f1(base - h * 0.7)}L${f1(x + w / 2)} ${f1(base - h * 0.9)}L${f1(x + w)} ${f1(base - h * 0.7)}V${base}Z`);
    x += w * (0.7 + r() * 0.4);
  }
  // a great dome with two minarets
  parts.push('M70 432V372H190V432Z', 'M78 372A52 50 0 0 1 182 372Z', 'M126 322V310L130 300L134 310V322Z');
  parts.push('M46 432V300L50 268L54 300V432Z', 'M206 432V292L210 258L214 292V432Z');
  parts.push('M42 330H58V336H42Z', 'M202 322H218V328H202Z');
  return parts.join('');
})();
const STARS = (() => { const r = ebruRng(5); return Array.from({ length: 18 }, () => [f1(10 + r() * 240), f1(40 + r() * 230), f1(0.5 + r() * 1.3)] as const); })();
const MOTES = (() => { const r = ebruRng(29); return Array.from({ length: 14 }, (_, i) => ({ x: f1(60 + r() * 30), y: f1(20 + r() * 60), d: f1(-r() * 12), s: f1(2 + r() * 3), i })); })();

/* one marbled sheet painted into a canvas once (client only) */
function SheetCanvas({ sheet }: { sheet: Sheet }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let alive = true;
    const paint = () => {
      if (!alive) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const s = 2;
      c.width = sheet.w * s; c.height = sheet.h * s;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.fillStyle = '#f6ecd4';
      ctx.fillRect(0, 0, sheet.w, sheet.h);
      const polys = marblePattern({ seed: sheet.seed, width: sheet.w, height: sheet.h, style: sheet.style, colors: sheet.colors, drops: sheet.style === 'hatip' ? 14 : 22 });
      for (const p of polys) { ctx.fillStyle = p.fill; ctx.fill(new Path2D(p.d)); }
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#fff8ea';
      ctx.lineWidth = 0.5;
      for (const p of polys) ctx.stroke(new Path2D(p.d));
      ctx.globalAlpha = 1;
    };
    // paint off the critical path
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(paint, { timeout: 500 }); else window.setTimeout(paint, 60);
    return () => { alive = false; };
  }, [sheet]);
  return <canvas ref={ref} className={styles.sheetCanvas} width={2} height={2} />;
}

export function EbruScene({ mood = 'base', children, className, style, parallax = true, ref }: EbruSceneProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `esc${uid}${n}`;
  const url = (n: string) => `url(#${k(n)})`;
  const rootRef = useRef<HTMLDivElement>(null);
  const lampRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = rootRef.current;
    if (!parallax || !host || typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0, px = 0, py = 0;
    const onMove = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth) * 2 - 1;
      py = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; host.style.setProperty('--px', px.toFixed(3)); host.style.setProperty('--py', py.toFixed(3)); });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, [parallax]);

  useImperativeHandle(ref, () => ({
    glow: (i = 1) => { lampRef.current?.animate([{ opacity: Math.min(1, 0.4 + i * 0.6) }, { opacity: 0 }], { duration: 900 + i * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }); },
  }), []);

  // the static backdrop never depends on props (mood lives on the root attribute): built once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const back = useMemo(() => (
    <div className={styles.back} aria-hidden="true">
      <div className={styles.stage}>
        {/* wall, window, shaft */}
        <svg className={styles.full} viewBox="0 0 1600 900" focusable="false">
          <defs>
            <linearGradient id={k('wall')} x1="0" y1="0" x2="0" y2="900" gradientUnits="userSpaceOnUse">{stops([[0, '#1a0f24'], [0.35, '#2e1a2c'], [0.7, '#4a2a26'], [1, '#2a160e']])}</linearGradient>
            <radialGradient id={k('lampL')} cx="1340" cy="330" r="760" gradientUnits="userSpaceOnUse">{stops([[0, '#ffb466', 0.55], [0.35, '#e07a3c', 0.22], [1, '#e07a3c', 0]])}</radialGradient>
            <radialGradient id={k('winL')} cx="300" cy="420" r="560" gradientUnits="userSpaceOnUse">{stops([[0, '#ff9a6a', 0.2], [0.5, '#8a4a8a', 0.1], [1, '#8a4a8a', 0]])}</radialGradient>
            <linearGradient id={k('sky')} x1="0" y1="0" x2="0" y2="500" gradientUnits="userSpaceOnUse">{stops([[0, '#121446'], [0.38, '#3a2468'], [0.62, '#a23e6a'], [0.8, '#f07a4a'], [0.9, '#ffc06a'], [1, '#ffe2a0']])}</linearGradient>
            <linearGradient id={k('frameW')} x1="0" y1="0" x2="1" y2="0">{stops([[0, '#2a140a'], [0.5, '#5a3218'], [1, '#2a140a']])}</linearGradient>
            <linearGradient id={k('shaft')} x1="0" y1="0" x2="1" y2="1">{stops([[0, '#ffc890', 0.22], [1, '#ffc890', 0]])}</linearGradient>
            <pattern id={k('plaster')} width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="8" cy="10" r="1.2" fill="#000" opacity=".12" /><circle cx="28" cy="30" r="1" fill="#fff" opacity=".04" /><circle cx="33" cy="6" r=".8" fill="#000" opacity=".1" />
              <path d="M2 24Q10 22 16 26" stroke="#000" strokeWidth=".8" opacity=".07" fill="none" />
            </pattern>
            <clipPath id={k('winClip')}><path d="M0 500V150Q0 40 130 0Q260 40 260 150V500Z" /></clipPath>
          </defs>
          <rect width="1600" height="900" fill={url('wall')} />
          <rect width="1600" height="900" fill={url('plaster')} />
          <rect width="1600" height="900" fill={url('lampL')} />
          <rect width="1600" height="900" fill={url('winL')} />
          {/* çini frieze along the wall */}
          <g opacity=".5">
            <rect x="0" y="560" width="1600" height="26" fill="#123a5a" />
            {Array.from({ length: 41 }, (_, i) => <path key={i} d={`M${i * 40} 573l10 -10l10 10l-10 10Z`} fill="#e9dfc6" opacity=".55" />)}
            {Array.from({ length: 41 }, (_, i) => <circle key={i} cx={i * 40 + 30} cy="573" r="3" fill="#c42a34" />)}
          </g>
          {/* arched window */}
          <g transform="translate(170 120)">
            <path d="M-26 520V150Q-26 20 130 -28Q286 20 286 150V520Z" fill="#1a0c06" />
            <path d="M-18 516V150Q-18 26 130 -18Q278 26 278 150V516Z" fill={url('frameW')} />
            <g clipPath={url('winClip')}>
              <rect width="260" height="500" fill={url('sky')} />
              {STARS.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#fff6e0" opacity=".8" />)}
              <path d="M196 96A26 26 0 1 0 214 140A20 20 0 1 1 196 96Z" fill="#fff1c4" />
              <path d={SKY} fill="#1a0e2a" />
              <path d="M0 432H260V500H0Z" fill="#120a1e" />
              {[[60, 404], [110, 396], [150, 410], [196, 400], [228, 414]].map(([x, y], i) => <rect key={i} x={x} y={y} width="4" height="6" fill="#ffc46a" opacity=".85" />)}
            </g>
            {/* lattice */}
            <g fill="none" stroke="#2a140a" strokeWidth="7">
              <path d="M130 -6V500M0 250H260M0 380H260" />
              <path d="M30 150Q30 60 130 18Q230 60 230 150" />
            </g>
            <g fill="none" stroke="#7a4a24" strokeWidth="1.6" opacity=".7">
              <path d="M127 -4V500M0 247H260M0 377H260" />
            </g>
            <rect x="-34" y="516" width="328" height="20" rx="4" fill="#3a1e0e" />
            <rect x="-34" y="516" width="328" height="4" fill="#8a5a30" opacity=".6" />
            {/* sill: a bottle and a bowl */}
            <path d="M14 516V470Q14 460 22 456V438H34V456Q42 460 42 470V516Z" fill="#2a6a5a" opacity=".85" />
            <path d="M20 470V510" stroke="#bff0e0" strokeWidth="2" opacity=".5" />
            <ellipse cx="230" cy="500" rx="34" ry="9" fill="#e9dfc6" />
            <path d="M196 500Q198 516 230 518Q262 516 264 500Z" fill="#d9cfb0" />
            <ellipse cx="230" cy="500" rx="27" ry="6" fill="#c42a34" />
          </g>
          {/* light shaft from the window */}
          <path d="M210 260L440 230L1080 900H360Z" fill={url('shaft')} />
          {/* rope anchors */}
          {ROPES.map((r, i) => <path key={i} d={`M${r.x0} ${r.y0}Q${(r.x0 + r.x1) / 2} ${f1((r.y0 + r.y1) / 2 + r.sag * 2)} ${r.x1} ${r.y1}`} fill="none" stroke="#c8a676" strokeWidth="2.4" opacity=".75" />)}
        </svg>

        {/* shelf, ink bowls, brushes, lamp (one layer) */}
        <div className={`${styles.layer} ${styles.pShelf}`}>
          <svg className={styles.full} viewBox="0 0 1600 900" focusable="false">
            <defs>
              <linearGradient id={k('plank')} x1="0" y1="0" x2="0" y2="1">{stops([[0, '#8a5228'], [0.4, '#5a3014'], [1, '#2a1406']])}</linearGradient>
              <linearGradient id={k('glaze')} x1="0" y1="0" x2="1" y2="0">{stops([[0, '#bdb4a0'], [0.35, '#fffaf0'], [0.7, '#e6dcc4'], [1, '#8a826e']])}</linearGradient>
              <linearGradient id={k('brassL')} x1="0" y1="0" x2="1" y2="0">{stops([[0, '#5a3204'], [0.4, '#f2c05a'], [0.55, '#fff2c0'], [1, '#6a3c06']])}</linearGradient>
              <radialGradient id={k('flame')} cx="0.5" cy="0.7" r="0.6">{stops([[0, '#fffbe6'], [0.4, '#ffd36a'], [1, '#ff7a2a', 0]])}</radialGradient>
              <linearGradient id={k('glass')} x1="0" y1="0" x2="1" y2="0">{stops([[0, '#1a3a3a', 0.9], [0.4, '#4a8a7a', 0.8], [0.6, '#9ad0c0', 0.7], [1, '#143030', 0.9]])}</linearGradient>
            </defs>
            {/* shelf */}
            <path d="M1150 452H1600V472H1150Z" fill={url('plank')} />
            <path d="M1150 452H1600" stroke="#c88a52" strokeWidth="2" opacity=".6" />
            <path d="M1190 472L1190 520L1230 472ZM1520 472L1520 520L1560 472Z" fill="#3a1e0c" />
            {/* glazed ink bowls (çanak) with pigment */}
            {(['#e0283c', '#f2bf3c', '#22c9c0', '#3d6cf0', '#2fb164', '#ee79ad'] as const).map((c, i) => {
              const x = 1180 + i * 52 + (i > 2 ? 30 : 0), w = 22 + (i % 2) * 4;
              return (
                <g key={c}>
                  <path d={`M${x - w} 432Q${x - w + 2} 452 ${x} 452Q${x + w - 2} 452 ${x + w} 432Z`} fill={url('glaze')} />
                  <path d={`M${x - w * 0.7} 442Q${x} 448 ${x + w * 0.7} 442`} fill="none" stroke="#1d3a8a" strokeWidth="2.4" opacity=".7" />
                  <ellipse cx={x} cy="432" rx={w} ry="5.5" fill="#f6efe0" />
                  <ellipse cx={x} cy="432.5" rx={w - 3.5} ry="3.6" fill={c} />
                  <ellipse cx={x - w * 0.3} cy="431.6" rx={w * 0.25} ry="1.2" fill="#fff" opacity=".5" />
                </g>
              );
            })}
            {/* ox-gall bottles */}
            <path d="M1352 452V402Q1352 392 1360 388V364H1372V388Q1380 392 1380 402V452Z" fill={url('glass')} />
            <rect x="1356" y="414" width="20" height="16" fill="#e9dfc6" opacity=".85" />
            <path d="M1358 400V446" stroke="#d8fff0" strokeWidth="2" opacity=".45" />
            {/* brush jar with horsehair brushes on rose stems */}
            <g>
              {[-22, -10, 2, 14, 26].map((a, i) => {
                const rad = (a * Math.PI) / 180;
                const x0 = 1500, y0 = 420, len = 150 + (i % 2) * 20;
                const x1 = x0 + Math.sin(rad) * len, y1 = y0 - Math.cos(rad) * len;
                return (
                  <g key={a}>
                    <path d={`M${x0} ${y0}Q${f1((x0 + x1) / 2 + 6)} ${f1((y0 + y1) / 2)} ${f1(x1)} ${f1(y1)}`} fill="none" stroke="#4a2a14" strokeWidth="4" strokeLinecap="round" />
                    <path d={`M${x0} ${y0}Q${f1((x0 + x1) / 2 + 6)} ${f1((y0 + y1) / 2)} ${f1(x1)} ${f1(y1)}`} fill="none" stroke="#7a9a4a" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
                    {[0.3, 0.55, 0.78].map((t) => <circle key={t} cx={f1(x0 + (x1 - x0) * t + 2.6)} cy={f1(y0 + (y1 - y0) * t)} r="1.6" fill="#3a1a0a" />)}
                    <g transform={`translate(${f1(x1)} ${f1(y1)}) rotate(${a})`}>
                      <path d="M-6 6Q-9 -14 0 -30Q9 -14 6 6Z" fill="#efe2c4" />
                      <path d="M-3 4Q-4 -12 0 -26M3 4Q4 -12 0 -24" stroke="#bfa880" strokeWidth=".8" fill="none" />
                      <rect x="-6.5" y="2" width="13" height="5" rx="1.5" fill="#c42a34" />
                    </g>
                  </g>
                );
              })}
              <path d="M1472 452V406Q1472 396 1482 394H1518Q1528 396 1528 406V452Z" fill={url('glaze')} />
              <path d="M1478 420Q1500 428 1522 420M1478 436Q1500 444 1522 436" fill="none" stroke="#1d3a8a" strokeWidth="2.6" opacity=".7" />
            </g>
            {/* hanging brass oil lamp */}
            <g>
              <path d="M1340 0V250" stroke="#6a4a24" strokeWidth="2" strokeDasharray="6 4" />
              <path d="M1300 290Q1340 250 1380 290" fill="none" stroke={url('brassL')} strokeWidth="4" />
              <path d="M1296 292Q1300 320 1340 324Q1380 320 1384 292Z" fill={url('brassL')} stroke="#3a2002" strokeWidth="1.4" />
              <path d="M1318 324L1340 352L1362 324" fill={url('brassL')} stroke="#3a2002" strokeWidth="1.2" />
              <ellipse cx="1340" cy="292" rx="44" ry="7" fill="#3a2002" />
              <path d="M1340 284Q1326 266 1340 240Q1354 266 1340 284Z" fill={url('flame')} />
            </g>
          </svg>
          <div ref={lampRef} className={styles.lampFlash} />
          <div className={styles.lampGlow} />
        </div>

        {/* drying lines with marbled sheets (each sheet its own compositor layer) */}
        <div className={`${styles.layer} ${styles.pSheets}`}>
          {SHEETS.map((s, i) => {
            const r = ROPES[s.rope]!;
            const y = ropeY(r, s.x + s.w / 2);
            return (
              <div key={i} className={styles.sheet} style={{ left: `${(s.x / 1600) * 100}%`, top: `${(y / 900) * 100}%`, width: `${(s.w / 1600) * 100}%`, height: `${(s.h / 900) * 100}%`, '--tilt': `${s.tilt}deg`, animationDelay: `${s.delay}s` } as CSSProperties}>
                <SheetCanvas sheet={s} />
                <span className={styles.peg} style={{ left: '8%' }} />
                <span className={styles.peg} style={{ right: '8%' }} />
              </div>
            );
          })}
        </div>

        {/* work table */}
        <div className={`${styles.layer} ${styles.pTable}`}>
          <svg className={styles.full} viewBox="0 0 1600 900" focusable="false">
            <defs>
              <linearGradient id={k('table')} x1="0" y1="770" x2="0" y2="900" gradientUnits="userSpaceOnUse">{stops([[0, '#6a3a1a'], [0.12, '#4a2610'], [1, '#160a04']])}</linearGradient>
              <linearGradient id={k('combG')} x1="0" y1="0" x2="0" y2="1">{stops([[0, '#fff2b0'], [0.5, '#e0a030'], [1, '#6a3c06']])}</linearGradient>
              <radialGradient id={k('vig')} cx="800" cy="440" r="980" gradientUnits="userSpaceOnUse" gradientTransform="translate(800 440) scale(1 0.72) translate(-800 -440)">{stops([[0.45, '#05020a', 0], [0.8, '#05020a', 0.45], [1, '#05020a', 0.8]])}</radialGradient>
            </defs>
            <path d="M-20 780Q800 760 1620 780V920H-20Z" fill={url('table')} />
            <path d="M-20 780Q800 760 1620 780" stroke="#c88a52" strokeWidth="2.4" opacity=".5" fill="none" />
            {[810, 836, 868].map((y, i) => <path key={y} d={`M-20 ${y}Q${400 + i * 90} ${y - 6} 800 ${y + 2}T1620 ${y - 2}`} fill="none" stroke="#1a0a04" strokeWidth="1.6" opacity=".5" />)}
            {/* resting comb (left) */}
            <g transform="translate(110 790) rotate(-8)">
              <rect x="0" y="0" width="200" height="16" rx="6" fill={url('combG')} stroke="#3a2002" strokeWidth="1.4" />
              {Array.from({ length: 18 }, (_, i) => <path key={i} d={`M${8 + i * 10.6} 16V44`} stroke={url('combG')} strokeWidth="3" strokeLinecap="round" />)}
            </g>
            {/* awl (right) */}
            <g transform="translate(1230 808) rotate(10)">
              <rect x="0" y="-6" width="90" height="12" rx="5" fill="#8a2a1c" stroke="#2a0806" strokeWidth="1.2" />
              <rect x="88" y="-5" width="12" height="10" rx="2" fill="#d8a040" />
              <path d="M100 -2L170 0L100 2Z" fill="#d8dce4" />
            </g>
            {/* rose petals */}
            {[[420, 830, 20], [470, 846, -30], [1130, 840, 60], [1180, 826, 10], [1500, 852, -40]].map(([x, y, a], i) => (
              <path key={i} d="M0 0Q10 -12 20 0Q10 9 0 0Z" fill={i % 2 ? '#e0283c' : '#ee79ad'} opacity=".85" transform={`translate(${x} ${y}) rotate(${a})`} />
            ))}
            <rect x="-200" y="-200" width="2000" height="1300" fill={url('vig')} />
          </svg>
        </div>

        {/* lamp-lit dust motes */}
        <div className={styles.motes}>
          {MOTES.map((m) => <span key={m.i} style={{ left: `${m.x}%`, top: `${m.y}%`, width: m.s, height: m.s, animationDelay: `${m.d}s` }} />)}
        </div>
        <div className={styles.moodFeature} />
        <div className={styles.moodBig} />
      </div>
    </div>
  ), []);

  return (
    <div ref={rootRef} className={`${styles.root} ${className ?? ''}`} data-mood={mood} style={style}>
      {back}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
