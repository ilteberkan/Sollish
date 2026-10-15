'use client';

import { useEffect, useId, useImperativeHandle, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { CZ_ELEPHANT_PATH, CZ_PALETTE as P } from './symbols';
import type { CezeriMood } from './fx';
import styles from './scene.module.css';

/* "Zamanın Çarkları" backdrop: the courtyard of a palace workshop at dusk. Back → front:
   dusk sky with stars and a crescent over a distant citadel hill · an arcade of pointed arches with black
   basalt / cream voussoirs (ablaq), a turquoise star-tile frieze and a niche cornice, the dim workshop seen
   through the arches · two wall gears turning · five hanging glass lamps (flickering glow layers) · the
   elephant clock automaton (left) and the water-clock gate (right), each with moving parts as separate
   compositor layers · stone floor with a turquoise-lined water channel (selsebil) whose light shimmers ·
   mood washes · vignette · children.
   Everything is code-drawn and original. A 16:9 stage covers the root (container query units) so the SVG and
   the HTML layers share coordinates; on portrait screens the two automata step inward and shrink so they
   stay visible. Moods: base (warm lamps), feature (moonlit water, the gate opens, its zodiac turns, fountains
   run), bigwin (gold wash). awaken() makes the elephant clock perform (mahout strikes, falcon flaps, cymbals
   clash, dial spins); strike() is one mallet blow (pair it with the hub +1). Only transform / opacity animate;
   pointer parallax on fine pointers only, never with reduced motion. */

export type { CezeriMood };
export interface CezeriSceneHandle {
  /** Big win: the elephant clock performs for `ms`. */
  awaken(ms?: number): void;
  /** One mallet blow of the mahout (hub +1). */
  strike(): void;
  /** Briefly brighten the lamps. */
  glow(intensity?: number): void;
}
export interface CezeriSceneProps {
  mood?: CezeriMood; children?: ReactNode; className?: string; style?: CSSProperties; parallax?: boolean; ref?: Ref<CezeriSceneHandle>;
  /** Portrait / square hosts (the game on a phone): the two automata sit small in the top corners instead of stepping inward. */
  corners?: boolean;
}

const f1 = (n: number) => Math.round(n * 10) / 10;
type Stop = readonly [number, string, number?];
const stops = (s: readonly Stop[]) => s.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />);
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const starD = (cx: number, cy: number, n: number, r1: number, r0: number, rot = 0) => {
  let d = '';
  for (let i = 0; i < n * 2; i++) { const a = ((rot + (i * 180) / n) * Math.PI) / 180, r = i % 2 ? r0 : r1; d += `${i ? 'L' : 'M'}${f1(cx + Math.sin(a) * r)} ${f1(cy - Math.cos(a) * r)}`; }
  return `${d}Z`;
};
const gearD = (cx: number, cy: number, n: number, r0: number, r1: number) => {
  let d = '';
  for (let i = 0; i < n * 4; i++) { const a = (i / (n * 4)) * Math.PI * 2, r = i % 4 < 2 ? r1 : r0; d += `${i ? 'L' : 'M'}${f1(cx + Math.cos(a) * r)} ${f1(cy + Math.sin(a) * r)}`; }
  return `${d}Z`;
};

/* ---- arcade geometry (stage units 1600 × 900) ---- */
const ARCH_N = 7, ARCH_W = 180, PIER = 42;
const ARCH_X0 = (1600 - (ARCH_N * ARCH_W + (ARCH_N - 1) * PIER)) / 2;
const SPRING = 470, FLOOR = 725, ARCH_R = 153;
const APEX = SPRING - Math.sqrt(ARCH_R ** 2 - (ARCH_R - ARCH_W / 2) ** 2);
const archD = (x0: number, inset = 0) => {
  const x1 = x0 + ARCH_W, xc = x0 + ARCH_W / 2, R = ARCH_R - inset;
  return `M${f1(x0 + inset)} ${FLOOR}V${SPRING}A${R} ${R} 0 0 1 ${f1(xc)} ${f1(APEX + inset)}A${R} ${R} 0 0 1 ${f1(x1 - inset)} ${SPRING}V${FLOOR}Z`;
};
const archOutline = (x0: number, inset = 0) => {
  const x1 = x0 + ARCH_W, xc = x0 + ARCH_W / 2, R = ARCH_R - inset;
  return `M${f1(x0 + inset)} ${SPRING}A${R} ${R} 0 0 1 ${f1(xc)} ${f1(APEX + inset)}A${R} ${R} 0 0 1 ${f1(x1 - inset)} ${SPRING}`;
};
const ARCHES = Array.from({ length: ARCH_N }, (_, i) => ARCH_X0 + i * (ARCH_W + PIER));
const LAMPS = [ARCHES[0]! + ARCH_W / 2, ARCHES[1]! + ARCH_W / 2, ARCHES[3]! + ARCH_W / 2, ARCHES[5]! + ARCH_W / 2, ARCHES[6]! + ARCH_W / 2].map((x, i) => ({ x, y: [380, 352, 330, 352, 380][i]!, d: [0, -0.7, -1.3, -0.4, -1.9][i]! }));
const STARS = (() => { const r = rng(9); return Array.from({ length: 46 }, () => [f1(r() * 1600), f1(r() * 210), f1(0.6 + r() * 1.5), f1(0.4 + r() * 0.6)] as const); })();
const MOTES = (() => { const r = rng(31); return Array.from({ length: 16 }, (_, i) => ({ x: f1(8 + r() * 84), y: f1(30 + r() * 50), d: f1(-r() * 14), s: f1(2 + r() * 3), i })); })();

/* ---------------- elephant clock (local 320 × 560) ---------------- */
function ElephantClockArt({ k }: { k: (n: string) => string }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <svg className={styles.full} viewBox="0 0 320 560" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={k('hide')} cx=".42" cy=".3" r=".8" fx=".36" fy=".2">{stops([[0, P.slate.hi], [0.3, P.slate.light], [0.7, P.slate.base], [1, P.slate.deep]])}</radialGradient>
        <linearGradient id={k('brass')} x1="0" y1="0" x2="0" y2="1">{stops([[0, P.brass.hi], [0.3, P.brass.light], [0.62, P.brass.base], [1, P.brass.dark]])}</linearGradient>
        <linearGradient id={k('brassH')} x1="0" y1="0" x2="1" y2="0">{stops([[0, P.brass.dark], [0.3, P.brass.base], [0.5, P.brass.hi], [0.7, P.brass.base], [1, P.brass.dark]])}</linearGradient>
        <linearGradient id={k('stone')} x1="0" y1="0" x2="1" y2="0">{stops([[0, P.ivory.deep], [0.35, P.ivory.hi], [0.7, P.ivory.base], [1, P.ivory.deep]])}</linearGradient>
        <linearGradient id={k('dome')} x1="0" y1="0" x2="1" y2="1">{stops([[0, P.turq.hi], [0.35, P.turq.light], [0.7, P.turq.base], [1, P.turq.deep]])}</linearGradient>
        <linearGradient id={k('rug')} x1="0" y1="0" x2="0" y2="1">{stops([[0, P.verm.light], [0.45, P.verm.base], [1, P.verm.deep]])}</linearGradient>
        <linearGradient id={k('wood')} x1="0" y1="0" x2="0" y2="1">{stops([[0, '#7a4424'], [1, '#2a120a']])}</linearGradient>
        <linearGradient id={k('lapis')} x1="0" y1="0" x2="0" y2="1">{stops([[0, P.lapis.light], [0.5, P.lapis.base], [1, P.lapis.dark]])}</linearGradient>
      </defs>
      <ellipse cx="160" cy="552" rx="160" ry="10" fill="#000" opacity=".5" />
      {/* plinth */}
      <path d="M8 508H312L304 552H16Z" fill={u('wood')} stroke="#120804" strokeWidth="3" />
      <rect x="14" y="514" width="292" height="16" fill={u('lapis')} stroke="#120804" strokeWidth="1.6" />
      {Array.from({ length: 12 }, (_, i) => <path key={i} d={starD(28 + i * 24, 522, 4, 6, 2.4, 45)} fill={P.ivory.hi} />)}
      <path d="M8 508H312" stroke={P.brass.light} strokeWidth="3" />
      {/* elephant (symbol outline, scaled) */}
      <g transform="translate(-24 192) scale(3.4)">
        <path d="M60 78L61 92.5H69L69.4 79ZM25.6 74.6L26.4 92.5H34L33.4 77Z" fill={P.slate.deep} stroke="#120804" strokeWidth=".9" />
        <path d={CZ_ELEPHANT_PATH} fill={u('hide')} stroke="#120804" strokeWidth=".9" strokeLinejoin="round" />
        <path d="M70.6 51.4C64.6 53.6 62.6 65.4 66.6 71.2C70.4 76 76.8 72.4 77.6 64.4C78 58.2 75.6 52.6 70.6 51.4Z" fill={P.slate.light} stroke="#120804" strokeWidth=".7" />
        <circle cx="84.2" cy="56.2" r="1.3" fill="#120804" />
        <path d="M82.6 71.4C86.6 73.8 91.2 73.6 94.6 70.6C92.4 76.8 86.4 78.4 82.2 75.4Z" fill={P.ivory.hi} stroke="#120804" strokeWidth=".6" />
        <path d="M28.4 49.2H67.2L69.2 66.6Q48.4 71.4 26.8 66.4Z" fill={u('rug')} stroke="#120804" strokeWidth=".7" />
        <path d="M30.6 63.4Q48.4 67.6 66.9 63.6" fill="none" stroke={P.brass.light} strokeWidth="1" />
        <path d="M31.2 52.2H65" stroke={P.turq.light} strokeWidth=".8" />
        {[36, 44, 52, 60].map((x) => <path key={x} d={`M${x} 57.6l2.2-2.2l2.2 2.2l-2.2 2.2Z`} fill={P.brass.light} />)}
        {[30, 37, 44, 51, 58, 65].map((x) => <circle key={x} cx={x + 1} cy="67.6" r=".9" fill={P.brass.light} />)}
        <path d="M89 72L85.4 72.6M88.8 77L85 77.4M88.6 82L85 82" stroke={P.slate.deep} strokeWidth=".5" />
      </g>
      {/* howdah platform + tower (two storeys) */}
      <path d="M78 338H246L250 352H74Z" fill={u('brassH')} stroke="#120804" strokeWidth="2" />
      <path d="M96 338V214H228V338Z" fill={u('stone')} stroke="#120804" strokeWidth="2.4" />
      {[236, 262, 288, 314].map((y) => <rect key={y} x="97" y={y} width="130" height="7" fill={P.slate.deep} opacity=".8" />)}
      {/* lower window with a seated scribe automaton */}
      <path d="M128 336V286Q128 262 162 254Q196 262 196 286V336Z" fill="#1a0c06" stroke={u('brass')} strokeWidth="3" />
      <circle cx="162" cy="292" r="10" fill={u('brass')} stroke="#120804" strokeWidth="1.6" />
      <path d="M150 284Q162 268 174 284Z" fill={P.ivory.hi} stroke="#120804" strokeWidth="1.2" />
      <path d="M146 336V312Q162 300 178 312V336Z" fill={u('lapis')} stroke="#120804" strokeWidth="1.4" />
      <path d="M166 318L186 306" stroke={P.brass.light} strokeWidth="2.4" strokeLinecap="round" />
      {/* upper storey: dial window (the dial itself is a moving layer) */}
      <path d="M90 214H234V200H90Z" fill={u('brassH')} stroke="#120804" strokeWidth="2" />
      <path d="M104 200V116H220V200Z" fill={u('stone')} stroke="#120804" strokeWidth="2.4" />
      <path d="M108 200V122M216 200V122" stroke={P.turq.base} strokeWidth="6" />
      <circle cx="162" cy="160" r="36" fill="#1a0c06" stroke={u('brass')} strokeWidth="5" />
      {/* balcony for the cymbal player */}
      <path d="M222 214H262V222H222Z" fill={u('brassH')} stroke="#120804" strokeWidth="1.6" />
      <path d="M226 222V236M258 222V236" stroke={u('brass')} strokeWidth="3" />
      <path d="M232 214V188Q242 176 252 188V214Z" fill={u('rug')} stroke="#120804" strokeWidth="1.6" />
      <circle cx="242" cy="178" r="8" fill={u('brass')} stroke="#120804" strokeWidth="1.4" />
      <path d="M234 172Q242 160 250 172Z" fill={P.ivory.hi} stroke="#120804" strokeWidth="1" />
      {/* dome */}
      <path d="M98 116H226V104H98Z" fill={u('brassH')} stroke="#120804" strokeWidth="2" />
      <path d="M106 104C106 72 132 52 162 38C192 52 218 72 218 104Z" fill={u('dome')} stroke="#120804" strokeWidth="2.6" />
      <path d="M126 98C126 76 138 62 154 52" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".55" />
      <path d="M134 104V78M162 104V50M190 104V78" stroke={P.turq.deep} strokeWidth="2" opacity=".6" />
      <path d="M162 38V26" stroke="#120804" strokeWidth="3" />
      {/* mahout body on the neck (arm is a moving layer) */}
      <path d="M232 340V306Q244 292 258 304V340Z" fill={u('lapis')} stroke="#120804" strokeWidth="1.8" />
      <circle cx="246" cy="292" r="10" fill={u('brass')} stroke="#120804" strokeWidth="1.6" />
      <path d="M234 288Q246 270 258 288Z" fill={u('rug')} stroke="#120804" strokeWidth="1.2" />
      {/* drum the mahout strikes */}
      <ellipse cx="282" cy="346" rx="16" ry="6" fill={P.ivory.hi} stroke="#120804" strokeWidth="1.6" />
      <path d="M266 346Q268 362 282 363Q296 362 298 346Z" fill={u('brassH')} stroke="#120804" strokeWidth="1.6" />
    </svg>
  );
}
/* ---------------- water-clock gate (local 300 × 560) ---------------- */
function CastleArt({ k }: { k: (n: string) => string }) {
  const u = (n: string) => `url(#${k(n)})`;
  const merl = (x0: number, x1: number, y: number, n: number) => {
    const w = (x1 - x0) / (n * 2 - 1);
    let d = `M${x0} ${y + 14}`;
    for (let i = 0; i < n; i++) { const a = x0 + i * 2 * w; d += `L${f1(a)} ${y}L${f1(a + w)} ${y}L${f1(a + w)} ${y + 14}`; if (i < n - 1) d += `L${f1(a + 2 * w)} ${y + 14}`; }
    return d;
  };
  return (
    <svg className={styles.full} viewBox="0 0 300 560" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={k('stone')} x1="0" y1="0" x2="1" y2="0">{stops([[0, P.ivory.deep], [0.3, P.ivory.hi], [0.75, P.ivory.base], [1, P.ivory.deep]])}</linearGradient>
        <linearGradient id={k('brassH')} x1="0" y1="0" x2="1" y2="0">{stops([[0, P.brass.dark], [0.3, P.brass.base], [0.5, P.brass.hi], [0.7, P.brass.base], [1, P.brass.dark]])}</linearGradient>
        <linearGradient id={k('tile')} x1="0" y1="0" x2="0" y2="1">{stops([[0, P.turq.light], [0.5, P.turq.base], [1, P.turq.deep]])}</linearGradient>
        <linearGradient id={k('water')} x1="0" y1="0" x2="0" y2="1">{stops([[0, P.turq.hi], [0.4, P.turq.light], [1, P.turq.deep]])}</linearGradient>
      </defs>
      <ellipse cx="150" cy="552" rx="150" ry="10" fill="#000" opacity=".5" />
      {/* basin */}
      <path d="M10 510H290L280 552H20Z" fill={u('brassH')} stroke="#120804" strokeWidth="3" />
      <path d="M16 512Q150 500 284 512V522H16Z" fill={u('water')} />
      {/* towers */}
      {[[20, 96], [204, 280]].map(([x0, x1], i) => (
        <g key={i}>
          <path d={`${merl(x0! - 6, x1! + 6, 120, 3)}V510H${x0! - 6}Z`} fill={u('stone')} stroke="#120804" strokeWidth="2.6" />
          {[170, 220, 270, 320, 370, 420, 470].map((y) => <rect key={y} x={x0! - 4} y={y} width={x1! - x0! + 8} height="18" fill={P.slate.deep} opacity=".85" />)}
          <path d={`M${(x0! + x1!) / 2 - 12} 260V226Q${(x0! + x1!) / 2} 208 ${(x0! + x1!) / 2 + 12} 226V260Z`} fill="#1a0c06" stroke={P.brass.light} strokeWidth="2" />
        </g>
      ))}
      {/* body with tile band */}
      <path d={`${merl(92, 208, 240, 5)}V510H92Z`} fill={u('stone')} stroke="#120804" strokeWidth="2.6" />
      <rect x="94" y="300" width="112" height="22" fill={u('tile')} stroke="#120804" strokeWidth="1.4" />
      {Array.from({ length: 6 }, (_, i) => <path key={i} d={starD(104 + i * 18.4, 311, 4, 7, 2.6, 45)} fill={P.ivory.hi} />)}
      {/* gate arch (doors are moving layers) */}
      <path d="M112 510V420Q112 372 150 356Q188 372 188 420V510Z" fill="#0a1a1e" stroke="#120804" strokeWidth="2.6" />
      <path d="M150 380Q156 470 150 506" stroke={P.turq.hi} strokeWidth="5" strokeLinecap="round" opacity=".7" />
      {/* zodiac crown (the disc turns: moving layer) */}
      <circle cx="150" cy="196" r="58" fill={u('brassH')} stroke="#120804" strokeWidth="3" />
      <circle cx="150" cy="196" r="50" fill="#0a0d30" stroke="#120804" strokeWidth="2" />
    </svg>
  );
}

export function CezeriScene({ mood = 'base', children, className, style, parallax = true, corners = false, ref }: CezeriSceneProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `czsc${uid}${n}`;
  const url = (n: string) => `url(#${k(n)})`;
  const rootRef = useRef<HTMLDivElement>(null);
  const lampFlash = useRef<HTMLDivElement>(null);
  const armRef = useRef<HTMLDivElement>(null);
  const awakeTimer = useRef(0);

  useEffect(() => {
    const host = rootRef.current;
    if (!parallax || !host) return;
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
  useEffect(() => () => window.clearTimeout(awakeTimer.current), []);

  useImperativeHandle(ref, () => ({
    awaken(ms = 3600) {
      const host = rootRef.current;
      if (!host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      host.setAttribute('data-awake', '');
      window.clearTimeout(awakeTimer.current);
      awakeTimer.current = window.setTimeout(() => host.removeAttribute('data-awake'), ms);
      lampFlash.current?.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 1400, easing: 'cubic-bezier(.2,.7,.3,1)' });
    },
    strike() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      armRef.current?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-38deg)', offset: 0.45 }, { transform: 'rotate(14deg)', offset: 0.62 }, { transform: 'rotate(0deg)' }], { duration: 520, easing: 'cubic-bezier(.3,0,.3,1)' });
    },
    glow(i = 1) { lampFlash.current?.animate([{ opacity: Math.min(1, 0.35 + i * 0.5) }, { opacity: 0 }], { duration: 900 + i * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }); },
  }), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const back = useMemo(() => (
    <div className={styles.back} aria-hidden="true">
      <div className={styles.stage}>
        <svg className={styles.full} viewBox="0 0 1600 900" focusable="false" preserveAspectRatio="none">
          <defs>
            <linearGradient id={k('sky')} x1="0" y1="0" x2="0" y2="330" gradientUnits="userSpaceOnUse">{stops([[0, '#090a2a'], [0.4, '#1e1650'], [0.7, '#4c2458'], [0.88, '#a8484a'], [1, '#e8925a']])}</linearGradient>
            <linearGradient id={k('wall')} x1="0" y1="240" x2="0" y2="725" gradientUnits="userSpaceOnUse">{stops([[0, '#3e2416'], [0.5, '#5a3420'], [1, '#2e1a0e']])}</linearGradient>
            <radialGradient id={k('lampL')} cx="800" cy="360" r="820" gradientUnits="userSpaceOnUse">{stops([[0, '#ffb466', 0.42], [0.4, '#e07a3c', 0.16], [1, '#e07a3c', 0]])}</radialGradient>
            <linearGradient id={k('inner')} x1="0" y1="300" x2="0" y2="725" gradientUnits="userSpaceOnUse">{stops([[0, '#0e0604'], [0.6, '#1e0e06'], [1, '#2a140a']])}</linearGradient>
            <radialGradient id={k('innerGlow')}>{stops([[0, '#ffae5a', 0.55], [0.5, '#c86a2a', 0.18], [1, '#c86a2a', 0]])}</radialGradient>
            <linearGradient id={k('floor')} x1="0" y1="725" x2="0" y2="900" gradientUnits="userSpaceOnUse">{stops([[0, '#4a2c1a'], [0.3, '#2e1a0e'], [1, '#100804']])}</linearGradient>
            <linearGradient id={k('chan')} x1="0" y1="796" x2="0" y2="836" gradientUnits="userSpaceOnUse">{stops([[0, '#05262e'], [0.5, '#0f5a66'], [1, '#05262e']])}</linearGradient>
            <linearGradient id={k('brassH')} x1="0" y1="0" x2="1" y2="0">{stops([[0, P.brass.dark], [0.3, P.brass.base], [0.5, P.brass.hi], [0.7, P.brass.base], [1, P.brass.dark]])}</linearGradient>
            <pattern id={k('frieze')} width="44" height="44" patternUnits="userSpaceOnUse" y="252">
              <rect width="44" height="44" fill="#0e3a6a" />
              <path d={starD(22, 22, 8, 17, 12)} fill="#1fb3ab" stroke="#efe2c4" strokeWidth="1.2" />
              <circle cx="22" cy="22" r="4" fill="#d6302c" />
              <path d={starD(0, 0, 4, 8, 3, 45)} fill="#efe2c4" /><path d={starD(44, 0, 4, 8, 3, 45)} fill="#efe2c4" /><path d={starD(0, 44, 4, 8, 3, 45)} fill="#efe2c4" /><path d={starD(44, 44, 4, 8, 3, 45)} fill="#efe2c4" />
            </pattern>
            <radialGradient id={k('vig')} cx="800" cy="450" r="980" gradientUnits="userSpaceOnUse" gradientTransform="translate(800 450) scale(1 .72) translate(-800 -450)">{stops([[0.45, '#050208', 0], [0.8, '#050208', 0.5], [1, '#050208', 0.85]])}</radialGradient>
          </defs>
          {/* sky, stars, moon, citadel hill */}
          <rect width="1600" height="420" fill={url('sky')} />
          {STARS.map(([x, y, r, o], i) => <circle key={i} cx={x} cy={y} r={r} fill="#fff6e0" opacity={o} />)}
          <path d="M1318 84A36 36 0 1 0 1348 150A28 28 0 1 1 1318 84Z" fill="#fff1c4" />
          <circle cx="1330" cy="116" r="70" fill="#fff1c4" opacity=".06" />
          <path d="M0 236Q120 188 260 200T520 182Q620 150 700 160L760 120L800 128L840 120L900 160Q1000 150 1100 186T1360 196Q1480 206 1600 230V300H0Z" fill="#1c1030" />
          <path d="M760 120V84L770 76L780 84V120ZM820 120V70L830 58L840 70V120Z" fill="#1c1030" />
          {[[700, 168], [736, 150], [790, 136], [858, 148], [910, 170], [980, 172]].map(([x, y], i) => <rect key={i} x={x} y={y} width="4" height="6" fill="#ffc46a" opacity=".85" />)}
          {/* workshop interior seen through the arches */}
          <rect x="0" y="300" width="1600" height="425" fill={url('inner')} />
          {ARCHES.map((x, i) => <ellipse key={i} cx={x + ARCH_W / 2} cy={560} rx="150" ry="170" fill={url('innerGlow')} opacity={i === 3 ? 1 : 0.75} />)}
          {/* shelves with gears and vessels inside */}
          {ARCHES.map((x, i) => (
            <g key={i} opacity=".55">
              <path d={`M${x + 18} 600H${x + ARCH_W - 18}`} stroke="#3a1e0c" strokeWidth="6" />
              <path d={gearD(x + 60, 566, 9, 22, 30)} fill="#4a2a10" />
              <path d={`M${x + 110} 600V568Q${x + 110} 556 ${x + 122} 552V540H${x + 134}V552Q${x + 146} 556 ${x + 146} 568V600Z`} fill="#3a2a2a" />
              <path d={gearD(x + 132, 650, 7, 14, 20)} fill="#3a200c" />
            </g>
          ))}
          {/* arcade wall with arch openings */}
          <path d={`M0 238H1600V725H0Z${ARCHES.map((x) => archD(x)).join('')}`} fillRule="evenodd" fill={url('wall')} />
          <path d={`M0 238H1600V725H0Z${ARCHES.map((x) => archD(x)).join('')}`} fillRule="evenodd" fill={url('lampL')} />
          {/* ablaq voussoirs + capitals */}
          {ARCHES.map((x, i) => (
            <g key={i}>
              <path d={archOutline(x, -9)} fill="none" stroke="#e9dcbc" strokeWidth="18" />
              <path d={archOutline(x, -9)} fill="none" stroke="#231c18" strokeWidth="18" strokeDasharray="16 16" />
              <path d={archOutline(x, -19)} fill="none" stroke="#120a06" strokeWidth="2" />
              <rect x={x - 8} y={SPRING - 4} width="22" height="14" fill="#d8c8a0" stroke="#2a1a0c" strokeWidth="1.4" />
              <rect x={x + ARCH_W - 14} y={SPRING - 4} width="22" height="14" fill="#d8c8a0" stroke="#2a1a0c" strokeWidth="1.4" />
            </g>
          ))}
          {/* frieze + niche cornice + parapet */}
          <rect x="0" y="252" width="1600" height="44" fill={url('frieze')} />
          <path d="M0 252H1600M0 296H1600" stroke="#efe2c4" strokeWidth="3" />
          <path d="M0 249H1600" stroke={url('brassH')} strokeWidth="3" />
          {Array.from({ length: 50 }, (_, i) => <path key={i} d={`M${i * 32} 324V308Q${i * 32 + 16} 296 ${i * 32 + 32} 308V324Z`} fill={i % 2 ? '#2a1a10' : '#4a3020'} stroke="#160a04" strokeWidth="1.2" />)}
          <path d="M0 324H1600" stroke="#160a04" strokeWidth="3" />
          {Array.from({ length: 40 }, (_, i) => <path key={i} d={`M${i * 40 + 6} 238V222H${i * 40 + 30}V238Z`} fill="#3a2214" stroke="#160a04" strokeWidth="1.4" />)}
          {/* lamp chains */}
          {LAMPS.map((l, i) => <path key={i} d={`M${l.x} 324V${l.y - 26}`} stroke="#8a6a3a" strokeWidth="2" strokeDasharray="5 4" />)}
          {/* lamps (glass bodies) */}
          {LAMPS.map((l, i) => (
            <g key={i}>
              <path d={`M${l.x - 20} ${l.y - 20}H${l.x + 20}L${l.x + 14} ${l.y - 30}H${l.x - 14}Z`} fill={url('brassH')} stroke="#2a1604" strokeWidth="1.2" />
              <path d={`M${l.x - 24} ${l.y - 20}Q${l.x - 30} ${l.y + 14} ${l.x} ${l.y + 22}Q${l.x + 30} ${l.y + 14} ${l.x + 24} ${l.y - 20}Z`} fill="#ffd27a" opacity=".85" stroke="#7a4a14" strokeWidth="1.4" />
              <path d={`M${l.x - 22} ${l.y - 6}Q${l.x} ${l.y + 2} ${l.x + 22} ${l.y - 6}`} stroke="#1fb3ab" strokeWidth="4" fill="none" />
              <circle cx={l.x} cy={l.y + 2} r="6" fill="#fffbe6" />
            </g>
          ))}
          {/* floor */}
          <rect x="0" y="725" width="1600" height="175" fill={url('floor')} />
          <path d="M0 725H1600" stroke="#c88a52" strokeWidth="2" opacity=".5" />
          <g stroke="#0c0604" strokeWidth="1.6" opacity=".55">
            {[742, 764, 852, 884].map((y) => <path key={y} d={`M0 ${y}H1600`} />)}
            {Array.from({ length: 23 }, (_, i) => { const x = -300 + i * 100; return <path key={i} d={`M${f1(800 + (x - 800) * 0.42)} 725L${x} 900`} />; })}
          </g>
          {/* water channel with tiled lips */}
          <rect x="0" y="790" width="1600" height="8" fill="#1fb3ab" />
          <rect x="0" y="834" width="1600" height="8" fill="#1fb3ab" />
          {Array.from({ length: 80 }, (_, i) => <g key={i}><rect x={i * 20 + 9} y="791.5" width="3" height="5" fill="#efe2c4" /><rect x={i * 20 + 9} y="835.5" width="3" height="5" fill="#efe2c4" /></g>)}
          <rect x="0" y="798" width="1600" height="36" fill={url('chan')} />
          <rect x="-200" y="-200" width="2000" height="1300" fill={url('vig')} />
        </svg>
        {/* wall gears (compositor layers) */}
        <div className={`${styles.layer} ${styles.pWall}`}>
          {[[ARCHES[0]! + ARCH_W + PIER / 2, 410, 1], [ARCHES[5]! + ARCH_W + PIER / 2, 410, -1]].map(([x, y, d], i) => (
            <div key={i} className={styles.wallGear} style={{ left: `${(x! / 1600) * 100}%`, top: `${(y! / 900) * 100}%`, animationDirection: d! > 0 ? 'normal' : 'reverse' }}>
              <svg viewBox="-60 -60 120 120" focusable="false"><path d={gearD(0, 0, 14, 46, 57)} fill="#6a4418" stroke="#1a0d05" strokeWidth="3" /><circle r="38" fill="none" stroke="#c48a3a" strokeWidth="3" />{Array.from({ length: 6 }, (_, j) => { const a = (j / 6) * Math.PI * 2; return <circle key={j} cx={f1(Math.cos(a) * 24)} cy={f1(Math.sin(a) * 24)} r="9" fill="#1a0d05" />; })}<circle r="10" fill="#c48a3a" stroke="#1a0d05" strokeWidth="2" /></svg>
            </div>
          ))}
        </div>
        {/* lamp glows */}
        <div className={`${styles.layer} ${styles.pWall}`}>
          {LAMPS.map((l, i) => <span key={i} className={styles.lampGlow} style={{ left: `${(l.x / 1600) * 100}%`, top: `${(l.y / 900) * 100}%`, animationDelay: `${l.d}s` }} />)}
          <div ref={lampFlash} className={styles.lampFlash} />
        </div>
        {/* water shimmer */}
        <div className={styles.channel}><div className={styles.shimmer} /></div>
        {/* automata */}
        <div className={`${styles.layer} ${styles.pProps}`}>
          <div className={styles.elephant}>
            <ElephantClockArt k={k} />
            <div className={styles.dial} style={{ left: `${(126 / 320) * 100}%`, top: `${(124 / 560) * 100}%`, width: `${(72 / 320) * 100}%`, height: `${(72 / 560) * 100}%` }}>
              <svg viewBox="-36 -36 72 72" focusable="false"><circle r="31" fill={P.ivory.hi} stroke="#120804" strokeWidth="2" /><circle r="24" fill="none" stroke={P.lapis.base} strokeWidth="2" />{Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <circle key={i} cx={f1(Math.sin(a) * 27)} cy={f1(-Math.cos(a) * 27)} r={i % 3 === 0 ? 2.6 : 1.6} fill={i % 3 === 0 ? P.verm.base : P.lapis.base} />; })}<path d={starD(0, 0, 8, 16, 7)} fill={P.brass.base} stroke="#120804" strokeWidth="1" /><path d="M0 0V-20" stroke="#120804" strokeWidth="2.6" strokeLinecap="round" /><circle r="4" fill={P.verm.base} stroke="#120804" strokeWidth="1" /></svg>
            </div>
            {/* falcon on the dome */}
            <div className={styles.falconPerch} style={{ left: `${(130 / 320) * 100}%`, top: `${(-6 / 560) * 100}%`, width: `${(64 / 320) * 100}%`, height: `${(40 / 560) * 100}%` }}>
              <svg viewBox="0 0 64 40" focusable="false">
                <path className={styles.wingL} d="M30 22C24 10 12 4 2 6C8 12 14 18 26 26Z" fill={P.brass.base} stroke="#120804" strokeWidth="1.6" />
                <path d="M18 24Q32 14 46 22Q40 32 26 32Z" fill={P.brass.light} stroke="#120804" strokeWidth="1.6" />
                <circle cx="46" cy="20" r="6" fill={P.brass.light} stroke="#120804" strokeWidth="1.4" />
                <path d="M51 18L58 21L51 23Z" fill="#4a2a08" />
                <circle cx="47" cy="19" r="1.4" fill={P.verm.base} />
                <path className={styles.wingR} d="M34 22C40 10 52 4 62 6C56 12 50 18 38 26Z" fill={P.brass.hi} stroke="#120804" strokeWidth="1.6" />
                <path d="M30 32V40M36 32V40" stroke="#120804" strokeWidth="2" />
              </svg>
            </div>
            {/* cymbals */}
            <div className={styles.cymbals} style={{ left: `${(222 / 320) * 100}%`, top: `${(176 / 560) * 100}%`, width: `${(42 / 320) * 100}%`, height: `${(30 / 560) * 100}%` }}>
              <span className={styles.cymL} /><span className={styles.cymR} />
            </div>
            {/* mahout arm with mallet (pivot at the shoulder) */}
            <div ref={armRef} className={styles.arm} style={{ left: `${(248 / 320) * 100}%`, top: `${(296 / 560) * 100}%`, width: `${(46 / 320) * 100}%`, height: `${(46 / 560) * 100}%` }}>
              <svg viewBox="0 0 46 46" focusable="false"><path d="M2 8L22 18L32 6" fill="none" stroke="#120804" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 8L22 18L32 6" fill="none" stroke={P.lapis.base} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /><path d="M32 6L42 40" stroke="#120804" strokeWidth="4" strokeLinecap="round" /><path d="M32 6L42 40" stroke={P.brass.light} strokeWidth="2" strokeLinecap="round" /><circle cx="42" cy="40" r="5" fill={P.brass.base} stroke="#120804" strokeWidth="1.6" /></svg>
            </div>
          </div>
          <div className={styles.castle}>
            <CastleArt k={k} />
            <div className={styles.zodiac} style={{ left: `${(100 / 300) * 100}%`, top: `${(146 / 560) * 100}%`, width: `${(100 / 300) * 100}%`, height: `${(100 / 560) * 100}%` }}>
              <svg viewBox="-50 -50 100 100" focusable="false">{Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <g key={i}><circle cx={f1(Math.sin(a) * 38)} cy={f1(-Math.cos(a) * 38)} r="6" fill={i % 2 ? P.brass.light : '#fff6c8'} stroke="#120804" strokeWidth="1.2" /></g>; })}<path d={starD(0, 0, 12, 28, 14)} fill={P.brass.base} stroke="#120804" strokeWidth="1.4" /><circle r="10" fill={P.verm.base} stroke="#120804" strokeWidth="1.4" /><circle r="44" fill="none" stroke={P.lapis.light} strokeWidth="1.4" strokeDasharray="3 5" /></svg>
            </div>
            <div className={styles.doorL} style={{ left: `${(114 / 300) * 100}%`, top: `${(362 / 560) * 100}%`, width: `${(36 / 300) * 100}%`, height: `${(148 / 560) * 100}%` }} />
            <div className={styles.doorR} style={{ left: `${(150 / 300) * 100}%`, top: `${(362 / 560) * 100}%`, width: `${(36 / 300) * 100}%`, height: `${(148 / 560) * 100}%` }} />
            <div className={styles.jet} style={{ left: `${(136 / 300) * 100}%`, top: `${(420 / 560) * 100}%`, width: `${(28 / 300) * 100}%`, height: `${(92 / 560) * 100}%` }} />
          </div>
        </div>
        <div className={styles.motes}>
          {MOTES.map((m) => <span key={m.i} style={{ left: `${m.x}%`, top: `${m.y}%`, width: m.s, height: m.s, animationDelay: `${m.d}s` }} />)}
        </div>
        <div className={styles.moodFeature} />
        <div className={styles.moodBig} />
      </div>
    </div>
  ), []);

  return (
    <div ref={rootRef} className={`${styles.root} ${className ?? ''}`} data-mood={mood} data-corners={corners ? '' : undefined} style={style}>
      {back}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
