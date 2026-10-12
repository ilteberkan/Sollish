'use client';

import { useEffect, useId, useImperativeHandle, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import styles from './scene.module.css';
import { StormWeather, type FxPoint, type StormMood } from './weather';

/* "Fırtına Tahtı" backdrop: a Hattuşa-inspired citadel at stormy dusk. Layers (back → front):
   sky gradient · far clouds · mid clouds · mountains · citadel + sacred bulls ·
   Lion Gate (cyclopean masonry, parabolic arch, two carved lion protomes, braziers, wet paving) ·
   lightning light overlay · mood overlays · vignette · weather canvas (rain, embers, sheet
   lightning) · children · front-FX canvas (hurled bolts, sparks, flash). Only two canvases: in
   software compositing every full-screen layer is blended each frame, so layers are kept few. All art is inline SVG generated from fixed seeds (SSR-stable). Clouds drift and
   the pointer parallax use compositor-only transforms on HTML wrappers; static SVG never repaints.
   The board's gate opening is tuned with CSS vars on the scene: --gate-x (default 50%). */

export type { StormMood };
export interface StormSceneHandle {
  /** Bolt between two client (viewport) points, drawn above children. */
  strike(fromClient: FxPoint, toClient: FxPoint, intensity?: number): void;
  flash(intensity?: number): void;
  skyStrike(intensity?: number): void;
  celebrate(amount?: number): void;
  readonly weather: StormWeather | null;
}
export interface StormSceneProps {
  mood?: StormMood;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Pointer parallax on fine pointers (default true). */
  parallax?: boolean;
  ref?: Ref<StormSceneHandle>;
}

/* ------------------------------------------------------------------ deterministic helpers */
function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const f1 = (n: number) => Math.round(n * 10) / 10;
const poly = (pts: Array<[number, number]>) => `M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}Z`;
type Stop = readonly [number, string, number?];
const stops = (s: readonly Stop[]) => s.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />);

/* clouds: rows of overlapping puffs on a 1600x400 strip that tiles horizontally */
interface Puff { x: number; y: number; r: number }
function cloudPuffs(seed: number, banks: Array<{ y: number; n: number; r: [number, number]; spread: number }>): Puff[] {
  const r = rng(seed);
  const out: Puff[] = [];
  for (const b of banks) {
    for (let i = 0; i < b.n; i++) {
      const x = (i / b.n) * 1600 + r() * (1600 / b.n);
      const rad = b.r[0] + r() * (b.r[1] - b.r[0]);
      const y = b.y + (r() - 0.5) * b.spread - rad * 0.35;
      for (const dx of [-1600, 0, 1600]) {
        const xx = x + dx;
        if (xx + rad > -10 && xx - rad < 1610) out.push({ x: f1(xx), y: f1(y), r: f1(rad) });
      }
    }
  }
  return out;
}
const CLOUDS = {
  far: cloudPuffs(7, [{ y: 70, n: 9, r: [110, 170], spread: 50 }, { y: 190, n: 11, r: [70, 120], spread: 50 }]),
  mid: cloudPuffs(19, [{ y: 170, n: 8, r: [80, 140], spread: 70 }, { y: 270, n: 10, r: [50, 90], spread: 40 }]),
};

/* ridge lines */
function ridge(seed: number, base: number, amp: number, step: number, peaks: Array<[number, number, number]> = []) {
  const r = rng(seed);
  const pts: Array<[number, number]> = [];
  let v = 0;
  for (let x = -20; x <= 1620; x += step) {
    v = v * 0.6 + (r() - 0.5) * amp;
    let y = base + v;
    for (const [px, ph, pw] of peaks) y -= ph * Math.exp(-(((x - px) / pw) ** 2));
    pts.push([x, y]);
  }
  return pts;
}
const FAR_RIDGE = ridge(3, 480, 50, 26, [[330, 70, 160], [1160, 100, 200], [760, 36, 120]]);
const MID_RIDGE = ridge(9, 560, 36, 22, [[200, 110, 170], [1360, 130, 190]]);
const ridgeFill = (pts: Array<[number, number]>) => `M-20 900L${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}L1620 900Z`;
const ridgeLine = (pts: Array<[number, number]>) => `M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}`;
const ridgeY = (pts: Array<[number, number]>, x: number) => {
  for (let i = 1; i < pts.length; i++) if (pts[i]![0] >= x) { const [x0, y0] = pts[i - 1]!; const [x1, y1] = pts[i]!; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return pts[pts.length - 1]![1];
};

/* citadel walls along the mid ridge: wall strip + projecting towers + merlons */
function citadel(x0: number, x1: number, seed: number) {
  const r = rng(seed);
  const wall: string[] = [];
  const towers: Array<{ x: number; y: number; w: number; h: number }> = [];
  const lights: Array<[number, number]> = [];
  let x = x0;
  while (x < x1) {
    const y = ridgeY(MID_RIDGE, x + 30) + 6;
    wall.push(poly([[x, y + 20], [x, y - 44], [x + 64, y - 46], [x + 64, y + 24]]));
    if (r() < 0.75) {
      const w = 30 + r() * 12, h = 64 + r() * 30;
      towers.push({ x: x + 50, y: y - 46, w, h });
      if (r() < 0.6) lights.push([x + 50 + w / 2, y - 46 - h * 0.55]);
    }
    x += 64;
  }
  return { wall, towers, lights };
}
const CIT_L = citadel(-20, 470, 5);
const CIT_R = citadel(1100, 1620, 13);

/* cyclopean masonry: jittered shared-vertex grid → tightly fitted polygonal blocks */
interface Stone { d: string; tone: number; top: string; bot: string }
function masonry(x0: number, y0: number, x1: number, y1: number, cw: number, rh: number, seed: number): Stone[] {
  const r = rng(seed);
  const rows = Math.ceil((y1 - y0) / rh);
  const cols = Math.ceil((x1 - x0) / cw) + 1;
  const P: Array<Array<[number, number]>> = [];
  for (let j = 0; j <= rows; j++) {
    const row: Array<[number, number]> = [];
    const shift = j % 2 ? cw * 0.5 : 0;
    for (let i = 0; i <= cols; i++) {
      const edgeY = j === 0 || j === rows;
      row.push([x0 + i * cw - shift + (r() - 0.5) * cw * 0.55, y0 + j * rh + (edgeY ? 0 : (r() - 0.5) * rh * 0.5)]);
    }
    P.push(row);
  }
  const out: Stone[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // vertical seams are not shared between offset rows → take top two from row j, bottom two from row j+1 (polygonal 5-6 sided)
      const a = P[j]![i]!, b = P[j]![i + 1]!;
      const c = P[j + 1]![i + 1]!, d = P[j + 1]![i]!;
      const mid: [number, number] = [(b[0] + c[0]) / 2 + (r() - 0.5) * cw * 0.25, (b[1] + c[1]) / 2];
      const mid2: [number, number] = [(a[0] + d[0]) / 2 + (r() - 0.5) * cw * 0.25, (a[1] + d[1]) / 2];
      const pts: Array<[number, number]> = [a, b, mid, c, d, mid2];
      const cx = pts.reduce((s, p) => s + p[0], 0) / 6, cy = pts.reduce((s, p) => s + p[1], 0) / 6;
      const ins = pts.map(([x, y]) => [cx + (x - cx) * 0.95 - 0.6, cy + (y - cy) * 0.93 - 0.6] as [number, number]);
      out.push({
        d: poly(ins),
        tone: Math.floor(r() * 5),
        top: `M${f1(ins[5]![0] + 1.5)} ${f1(ins[5]![1])}L${f1(ins[0]![0] + 1.5)} ${f1(ins[0]![1] + 1.6)}L${f1(ins[1]![0])} ${f1(ins[1]![1] + 1.6)}`,
        bot: `M${f1(ins[2]![0] - 1.5)} ${f1(ins[2]![1])}L${f1(ins[3]![0] - 1.5)} ${f1(ins[3]![1] - 1.6)}L${f1(ins[4]![0])} ${f1(ins[4]![1] - 1.6)}`,
      });
    }
  }
  return out;
}
const STONE_TONES = ['#625a50', '#6e6357', '#575047', '#776b5e', '#5e554b'];

/* gate geometry (1600x900) */
const ARCH_TOP = 330;
const ARCH_HALF = 372;
const archX = (y: number, side: -1 | 1, shrink = 0) => 800 + side * (ARCH_HALF - shrink) * Math.sqrt(Math.max(0, (y - ARCH_TOP - shrink * 0.9) / (800 - ARCH_TOP - shrink * 0.9)));
const archPath = (shrink = 0) => {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 28; i++) { const y = 800 - ((800 - ARCH_TOP - shrink * 0.9) * i) / 28; pts.push([archX(y, -1, shrink), y]); }
  for (let i = 27; i >= 0; i--) { const y = 800 - ((800 - ARCH_TOP - shrink * 0.9) * i) / 28; pts.push([archX(y, 1, shrink), y]); }
  return pts;
};
const ARCH = archPath(0);
const ARCH_IN = archPath(30);
const ARCH_D = poly(ARCH);
const ARCH_IN_D = poly(ARCH_IN);
const MERLON = (x: number, y: number, w = 22, h = 20) => `M${x} ${y}V${y - h + w / 2}A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y - h + w / 2}V${y}Z`;
const merlons = (x0: number, x1: number, y: number, w = 22, gap = 12, h = 20) => {
  let d = '';
  for (let x = x0; x + w <= x1 + 0.5; x += w + gap) d += MERLON(f1(x), y, w, h);
  return d;
};
const GATE_STONES = masonry(200, 254, 1400, 800, 74, 50, 23);
const WALL_L = masonry(-10, 520, 230, 800, 70, 48, 31);
const WALL_R = masonry(1370, 520, 1610, 800, 70, 48, 37);

/* lion mane tufts (local lion coords, head centre 128,118) */
const MANE = (() => {
  const out: Array<{ d: string; inner: boolean }> = [];
  const c: [number, number] = [134, 122];
  const ring = (n: number, r0: number, r1: number, off: number, inner: boolean) => {
    for (let i = 0; i < n; i++) {
      const t = ((i + off) / n) * Math.PI * 2;
      const w = (Math.PI / n) * 1.25;
      const p = (a: number, rr: number): [number, number] => [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr * 1.08];
      const tip = p(t + w * 0.35, r1);
      const a0 = p(t - w, r0), a1 = p(t + w, r0), q0 = p(t - w * 0.35, r1 * 0.96), q1 = p(t + w * 0.9, r1 * 0.82);
      out.push({ d: `M${f1(a0[0])} ${f1(a0[1])}Q${f1(q0[0])} ${f1(q0[1])} ${f1(tip[0])} ${f1(tip[1])}Q${f1(q1[0])} ${f1(q1[1])} ${f1(a1[0])} ${f1(a1[1])}Z`, inner });
    }
  };
  ring(17, 70, 124, 0, false);
  ring(15, 56, 98, 0.5, true);
  return out;
})();

const BULL = 'M8 54C6 44 10 36 18 32C40 26 70 28 96 26C112 22 124 16 136 20C144 22 150 26 154 30C160 36 166 44 168 52C168 56 164 58 160 57C154 56 150 58 146 62C142 70 138 74 134 76L136 98H130L127 80L124 98H118L116 78C100 82 76 82 60 78L58 98H52L48 82L44 98H38C36 86 32 70 26 62C22 60 18 62 16 70L14 84C12 86 10 84 11 80L12 64C12 58 10 56 8 54Z';
const BULL_HORNS = 'M146 26C136 12 144 0 160 0C152 6 150 14 154 24ZM154 28C160 10 174 6 184 10C172 14 164 20 160 30Z';

/* ------------------------------------------------------------------ sub-art */
function Stones({ list }: { list: Stone[] }) {
  return (
    <>
      {list.map((s, i) => <path key={i} d={s.d} fill={STONE_TONES[s.tone]} />)}
      <path d={list.map((s) => s.top).join('')} fill="none" stroke="#a9c6cc" strokeWidth="2.2" strokeLinejoin="round" opacity=".26" />
      <path d={list.map((s) => s.bot).join('')} fill="none" stroke="#0e0b09" strokeWidth="3" strokeLinejoin="round" opacity=".55" />
    </>
  );
}

/* Cloud strips are baked ONCE into bitmaps (SVG string → canvas → PNG blob) and drift as a
   repeating background. Drawing the filtered SVG directly made every newly exposed tile of the
   moving layer re-run feTurbulence/feDisplacementMap (~50 ms per tile in software raster). */
type CloudTone = 'far' | 'mid';
const CLOUD_PAL: Record<CloudTone, { top: string; mid: string; bot: string; hi: string; hiA: number; under: string; underA: number }> = {
  far: { top: '#557d94', mid: '#2a4458', bot: '#16263a', hi: '#a6d4e6', hiA: 0.3, under: '#d89a5c', underA: 0.22 },
  mid: { top: '#40637a', mid: '#1e344a', bot: '#0e1a2a', hi: '#8cc2d8', hiA: 0.34, under: '#e0a060', underA: 0.3 },
};
function cloudSvg(tone: CloudTone, w: number, h: number) {
  const P = CLOUD_PAL[tone];
  const puffs = CLOUDS[tone];
  const st = (o: number, c: string, a = 1) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`;
  let body = '';
  for (const p of puffs) body += `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="url(#g)"/>`;
  for (const p of puffs) body += `<circle cx="${f1(p.x - p.r * 0.1)}" cy="${f1(p.y - p.r * 0.16)}" r="${f1(p.r * 0.86)}" fill="url(#v)"/>`;
  puffs.forEach((p, i) => { if (i % 3 === 0) body += `<ellipse cx="${p.x}" cy="${f1(p.y + p.r * 0.7)}" rx="${f1(p.r * 1.3)}" ry="${f1(p.r * 0.42)}" fill="url(#u)"/>`; });
  puffs.forEach((p, i) => { if (i % 3 === 1) body += `<circle cx="${f1(p.x + p.r * 0.3)}" cy="${f1(p.y + p.r * 0.32)}" r="${f1(p.r * 0.48)}" fill="${P.bot}" opacity=".5"/>`; });
  const seed = tone === 'far' ? 3 : tone === 'mid' ? 8 : 13;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1600 400" preserveAspectRatio="none"><defs>`
    + `<linearGradient id="g" x1="0" y1="0" x2="0" y2="400" gradientUnits="userSpaceOnUse">${st(0, P.top)}${st(0.45, P.mid)}${st(1, P.bot)}</linearGradient>`
    + `<radialGradient id="u" cx="0.5" cy="0.2" r="0.6">${st(0, P.under, P.underA)}${st(1, P.under, 0)}</radialGradient>`
    + `<radialGradient id="v" cx="0.42" cy="0.3" r="0.7">${st(0, P.hi, P.hiA * 1.6)}${st(0.45, P.hi, P.hiA * 0.5)}${st(1, P.hi, 0)}</radialGradient>`
    + `<filter id="f" x="-5%" y="-20%" width="110%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.026" numOctaves="3" seed="${seed}" stitchTiles="stitch" result="n"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" result="d"/><feGaussianBlur in="d" stdDeviation="${tone === 'far' ? 4 : 2.6}"/></filter>`
    + `</defs><g filter="url(#f)">${body}</g></svg>`;
}
async function bakeCloud(tone: CloudTone, cssH: number): Promise<string | null> {
  const dpr = Math.min(1.5, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const h = Math.max(32, Math.round(cssH * dpr));
  const w = h * 4;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cloudSvg(tone, w, h))}`;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  return blob ? URL.createObjectURL(blob) : null;
}

function Lion({ k, side }: { k: (n: string) => string; side: 'l' | 'r' }) {
  const url = (n: string) => `url(#${k(n)})`;
  const tr = side === 'l' ? 'translate(176 330)' : 'translate(1424 330) scale(-1 1)';
  return (
    <g transform={tr}>
      {/* jamb monolith the lion is carved from */}
      <path d="M-26 470L-30 10L0 -20H236L268 12L270 470Z" fill={url('slab')} stroke="#0e0b09" strokeWidth="4" strokeLinejoin="round" />
      <path d="M-28 12L2 -18H234L266 14" fill="none" stroke="#b6cfd4" strokeWidth="2.6" opacity=".34" />
      <path d="M-30 10H268" stroke="#0e0b09" strokeWidth="2" opacity=".5" />
      <path d="M-30 200L-6 196M240 160L266 166M244 300L268 296M-28 360L0 366" stroke="#0e0b09" strokeWidth="2.4" opacity=".6" />
      <path d="M262 40L270 470" stroke="#0e0b09" strokeWidth="8" opacity=".35" />
      {/* far foreleg */}
      <path d="M150 300C146 344 148 388 156 418L148 426C142 432 148 440 158 440H210C218 440 218 430 210 426L202 420C200 380 202 340 204 300Z" fill={url('stoneDk')} stroke="#120f0c" strokeWidth="3" />
      {/* chest */}
      <path d="M56 190C34 236 34 296 54 336L82 372H196C212 328 220 276 210 222C198 204 180 194 160 192Z" fill={url('lionStone')} stroke="#120f0c" strokeWidth="3" />
      <path d="M70 250C90 262 120 264 150 254M66 286C92 300 128 302 160 290M74 322C98 334 132 334 164 322" fill="none" stroke="#2a231d" strokeWidth="3" opacity=".7" />
      <path d="M70 248C90 260 120 262 150 252M66 284C92 298 128 300 160 288" fill="none" stroke="#a89680" strokeWidth="1.4" opacity=".35" />
      <path d="M70 196C96 214 150 214 182 196C176 222 150 236 120 236C96 236 78 222 70 196Z" fill="#000" opacity=".35" />
      {/* near foreleg + paw */}
      <path d="M62 300C56 344 58 384 66 414L56 422C46 430 50 442 62 442H136C146 442 148 430 138 424L126 416C126 380 130 340 134 300Z" fill={url('lionStone')} stroke="#120f0c" strokeWidth="3" />
      <path d="M78 424C80 432 80 438 78 442M98 422C100 432 100 438 98 442M118 422C120 432 120 438 118 442" stroke="#1e1915" strokeWidth="3" />
      <path d="M78 330C76 360 78 390 84 410" fill="none" stroke="#a89680" strokeWidth="2" opacity=".35" />
      {/* mane */}
      {MANE.map((m, i) => <path key={i} d={m.d} fill={m.inner ? url('lionStone') : url('stoneDk')} stroke="#120f0c" strokeWidth="2.4" strokeLinejoin="round" />)}
      {MANE.filter((m) => m.inner).map((m, i) => <path key={`r${i}`} d={m.d} fill="none" stroke="#bfae96" strokeWidth="1.2" opacity=".22" />)}
      {/* ear */}
      <path d="M168 52C176 36 196 36 200 52C196 62 182 66 170 62Z" fill={url('lionStone')} stroke="#120f0c" strokeWidth="2.4" />
      {/* face */}
      <path d="M66 66C84 50 128 44 160 58C182 68 192 96 188 126C186 150 174 176 154 192C136 206 108 210 86 204C64 198 46 182 40 160C34 140 36 118 44 98C50 84 56 74 66 66Z" fill={url('lionStone')} stroke="#120f0c" strokeWidth="3" />
      <path d="M66 66C84 50 128 44 160 58C182 68 192 96 188 126C186 150 174 176 154 192C136 206 108 210 86 204C64 198 46 182 40 160C34 140 36 118 44 98C50 84 56 74 66 66Z" fill={url('faceVol')} />
      <path d="M150 64C176 76 186 104 182 132" fill="none" stroke="#9cdcff" strokeWidth="2.4" opacity=".32" />
      {/* brow ridge */}
      <path d="M52 94C70 80 96 80 112 90C124 82 148 78 168 88L164 100C148 92 130 94 116 104C100 94 74 94 58 104Z" fill={url('stoneDk')} stroke="#120f0c" strokeWidth="2" />
      <path d="M56 92C72 82 94 82 110 90M118 88C134 80 152 80 166 88" fill="none" stroke="#c0ae94" strokeWidth="1.6" opacity=".4" />
      {/* eyes (inlaid; glow in feature mood) */}
      <path d="M66 108C72 101 86 101 92 108C86 113 72 113 66 108Z" fill="#14100c" />
      <path d="M122 106C130 97 148 97 156 106C148 113 130 113 122 106Z" fill="#14100c" />
      <g className={styles.lionEye}>
        <path d="M68 108C73 103 85 103 90 108C85 111.5 73 111.5 68 108Z" fill="#7fe8ff" />
        <path d="M124 106C131 99 147 99 154 106C147 111 131 111 124 106Z" fill="#7fe8ff" />
        <circle cx="79" cy="108" r="12" fill={url('eyeHalo')} />
        <circle cx="139" cy="105" r="15" fill={url('eyeHalo')} />
      </g>
      <circle cx="80" cy="107.5" r="2" fill="#c9b48e" opacity=".6" />
      <circle cx="140" cy="105" r="2.4" fill="#c9b48e" opacity=".6" />
      {/* nose */}
      <path d="M96 106C94 122 86 132 76 138C70 142 68 150 74 154C84 158 100 156 110 150C116 146 116 138 112 132C106 124 104 114 104 106Z" fill={url('lionStone')} stroke="#120f0c" strokeWidth="2" />
      <path d="M70 142C78 135 100 135 108 143C102 151 80 153 70 142Z" fill="#221c17" />
      <path d="M100 110C100 120 104 128 108 134" fill="none" stroke="#c4b296" strokeWidth="1.8" opacity=".45" />
      {/* open mouth */}
      <path d="M46 166C62 176 104 180 138 166C134 190 114 208 90 208C68 206 52 190 46 166Z" fill="#0d0a08" stroke="#120f0c" strokeWidth="2.4" />
      <path d="M64 192C78 184 102 184 116 190C106 202 78 204 64 192Z" fill="#3a2620" />
      <path d="M58 170L64 188L70 172ZM124 168L118 186L112 170ZM76 204L80 190L86 205ZM104 204L102 190L96 205Z" fill="#b6a893" stroke="#1a1410" strokeWidth="1" />
      <ellipse cx="74" cy="160" rx="16" ry="8" fill={url('lionStone')} stroke="#120f0c" strokeWidth="1.6" />
      <ellipse cx="116" cy="158" rx="18" ry="8" fill={url('lionStone')} stroke="#120f0c" strokeWidth="1.6" />
      {[[68, 158], [76, 162], [110, 156], [120, 160], [128, 156]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.2" fill="#221c17" />)}
      {/* cracks + weathering */}
      <path d="M150 140L162 156L158 170M70 230L84 244M180 320L170 340L176 354" fill="none" stroke="#17130f" strokeWidth="1.6" opacity=".8" />
      {/* warm under-light from the brazier */}
      <ellipse cx={side === 'l' ? 20 : 20} cy="380" rx="150" ry="170" fill={url('warm')} />
    </g>
  );
}

function Brazier({ x, y, k }: { x: number; y: number; k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  return (
    <g>
      <ellipse cx={x} cy={y + 168} rx="70" ry="10" fill="#000" opacity=".5" />
      <path d={`M${x - 8} ${y + 26}L${x - 44} ${y + 166}M${x + 8} ${y + 26}L${x + 44} ${y + 166}M${x} ${y + 28}V${y + 160}`} stroke="#140c05" strokeWidth="9" strokeLinecap="round" />
      <path d={`M${x - 8} ${y + 26}L${x - 44} ${y + 166}M${x + 8} ${y + 26}L${x + 44} ${y + 166}M${x} ${y + 28}V${y + 160}`} stroke={url('bronzeS')} strokeWidth="5" strokeLinecap="round" />
      <path d={`M${x - 30} ${y + 100}H${x + 30}`} stroke={url('bronzeS')} strokeWidth="4" />
      <path d={`M${x - 52} ${y}C${x - 48} ${y + 26} ${x - 26} ${y + 36} ${x} ${y + 36}C${x + 26} ${y + 36} ${x + 48} ${y + 26} ${x + 52} ${y}Z`} fill={url('bronzeS')} stroke="#140c05" strokeWidth="3" />
      <ellipse cx={x} cy={y} rx="52" ry="9" fill="#2a1406" stroke="#140c05" strokeWidth="2.4" />
      <ellipse cx={x} cy={y - 1} rx="40" ry="6" fill="#ff9a3c" opacity=".8" />
      <path d={`M${x - 44} ${y + 12}C${x - 20} ${y + 22} ${x + 20} ${y + 22} ${x + 44} ${y + 12}`} fill="none" stroke="#ffd59a" strokeWidth="1.6" opacity=".6" />
      {[-36, -12, 12, 36].map((dx) => <circle key={dx} cx={x + dx} cy={y + 20 - Math.abs(dx) * 0.2} r="2.6" fill="#ffe2a8" opacity=".7" />)}
    </g>
  );
}

const BRAZIERS: Array<[number, number]> = [[132, 628], [1468, 628]];
const RIPPLES: Array<[number, number, number]> = [[22, 92, 0], [38, 95, 1.3], [64, 91, 0.6], [80, 96, 2.1], [52, 97, 3]];

/* ------------------------------------------------------------------ component */
export function StormScene({ mood = 'base', children, className, style, parallax = true, ref }: StormSceneProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `ss${uid}${n}`;
  const url = (n: string) => `url(#${k(n)})`;
  const rootRef = useRef<HTMLDivElement>(null);
  const rainRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const litRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const flameRefs = useRef<Array<HTMLDivElement | null>>([]);
  const trackRefs = useRef<Record<CloudTone, HTMLDivElement | null>>({ far: null, mid: null });
  const weatherRef = useRef<StormWeather | null>(null);
  const moodRef = useRef(mood);

  useEffect(() => {
    const host = rootRef.current, rain = rainRef.current;
    if (!host || !rain) return;
    const lit = litRef.current;
    const w = new StormWeather({
      host, rain, front: frontRef.current, mood: moodRef.current,
      onFlash: (i) => { lit?.animate([{ opacity: Math.min(1, i) }, { opacity: 0 }], { duration: 520 + i * 300, easing: 'cubic-bezier(.2,.7,.3,1)' }); },
      onScreenFlash: (i, color) => {
        const el = flashRef.current;
        if (!el) return;
        el.style.background = `rgb(${color})`;
        el.animate([{ opacity: i * 0.5 }, { opacity: 0 }], { duration: 300, easing: 'ease-out' });
      },
    });
    weatherRef.current = w;
    const place = () => {
      const hb = host.getBoundingClientRect();
      w.setEmitters(flameRefs.current.filter(Boolean).map((el) => { const r = el!.getBoundingClientRect(); return { x: r.left - hb.left + r.width / 2, y: r.top - hb.top + r.height * 0.75 }; }));
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    ro?.observe(host);
    return () => { ro?.disconnect(); w.destroy(); weatherRef.current = null; };
  }, []);

  useEffect(() => { moodRef.current = mood; weatherRef.current?.setMood(mood); }, [mood]);

  /* bake cloud bitmaps (again only when a band's height changes by >15%) */
  useEffect(() => {
    const urls: string[] = [];
    const baked: Partial<Record<CloudTone, number>> = {};
    let alive = true;
    const run = () => {
      (Object.keys(trackRefs.current) as CloudTone[]).forEach((tone) => {
        const el = trackRefs.current[tone];
        if (!el) return;
        const hgt = el.clientHeight;
        const prev = baked[tone];
        if (!hgt || (prev && Math.abs(prev - hgt) / prev < 0.15)) return;
        baked[tone] = hgt;
        void bakeCloud(tone, hgt).then((u) => {
          if (!u) return;
          if (!alive) { URL.revokeObjectURL(u); return; }
          urls.push(u);
          el.style.backgroundImage = `url(${u})`;
          el.dataset.ready = '1';
        });
      });
    };
    run();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null;
    if (rootRef.current) ro?.observe(rootRef.current);
    return () => { alive = false; ro?.disconnect(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

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
    strike: (a, b, i) => weatherRef.current?.strike(a, b, i),
    flash: (i) => weatherRef.current?.flash(i),
    skyStrike: (i) => weatherRef.current?.skyStrike(i),
    celebrate: (n) => weatherRef.current?.celebrate(n),
    get weather() { return weatherRef.current; },
  }), []);

  /* The static backdrop never depends on props (mood lives on the root attribute), so it is built once:
     a parent that re-renders the scene with new children (a game screen) does not re-reconcile ~400 SVG nodes. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const back = useMemo(() => (
        <div className={styles.back} aria-hidden="true">
          {/* sky */}
          <svg className={styles.full} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" focusable="false">
            <defs>
              <linearGradient id={k('sky')} x1="0" y1="0" x2="0" y2="900" gradientUnits="userSpaceOnUse">{stops([[0, '#081428'], [0.18, '#10263e'], [0.34, '#1a4660'], [0.45, '#2f6676'], [0.505, '#748270'], [0.55, '#dc9554'], [0.6, '#8c5634'], [1, '#26180f']])}</linearGradient>
              <radialGradient id={k('sun')} cx="1060" cy="500" r="560" gradientUnits="userSpaceOnUse">{stops([[0, '#ffb466', 0.62], [0.3, '#d97a3c', 0.24], [1, '#d97a3c', 0]])}</radialGradient>
              <radialGradient id={k('storm')} cx="360" cy="140" r="620" gradientUnits="userSpaceOnUse">{stops([[0, '#2f8fb0', 0.22], [1, '#2f8fb0', 0]])}</radialGradient>
            </defs>
            <rect width="1600" height="900" fill={url('sky')} />
            <rect width="1600" height="900" fill={url('sun')} />
            <rect width="1600" height="900" fill={url('storm')} />
          </svg>
          <div className={`${styles.band} ${styles.bandFar}`}><div ref={(el) => { trackRefs.current.far = el; }} className={styles.track} /></div>
          <div className={`${styles.band} ${styles.bandMid}`}><div ref={(el) => { trackRefs.current.mid = el; }} className={styles.track} /></div>
  
          <div className={styles.moodDark} />
          {/* mountains */}
          <div className={`${styles.layer} ${styles.pMount}`}>
            <svg className={styles.full} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" focusable="false">
              <defs>
                <linearGradient id={k('far')} x1="0" y1="360" x2="0" y2="620" gradientUnits="userSpaceOnUse">{stops([[0, '#2c5164'], [1, '#162a38']])}</linearGradient>
                <linearGradient id={k('haze')} x1="0" y1="420" x2="0" y2="700" gradientUnits="userSpaceOnUse">{stops([[0, '#c88650', 0], [0.55, '#c88650', 0.16], [1, '#3a3a40', 0.3]])}</linearGradient>
                <linearGradient id={k('mid')} x1="0" y1="420" x2="0" y2="800" gradientUnits="userSpaceOnUse">{stops([[0, '#1a3448'], [1, '#0a141e']])}</linearGradient>
              </defs>
              <path d={ridgeFill(FAR_RIDGE)} fill={url('far')} />
              <path d={ridgeLine(FAR_RIDGE)} fill="none" stroke="#e7a464" strokeWidth="2" opacity=".42" />
              <rect y="400" width="1600" height="500" fill={url('haze')} />
              <path d={ridgeFill(MID_RIDGE)} fill={url('mid')} />
              <path d={ridgeLine(MID_RIDGE)} fill="none" stroke="#7fc4d8" strokeWidth="1.6" opacity=".22" />
            </svg>
          </div>
  
          {/* citadel + sacred bulls */}
          <div className={`${styles.layer} ${styles.pCit}`}>
            <svg className={styles.full} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" focusable="false">
              <defs>
                <radialGradient id={k('torch')}>{stops([[0, '#ffd08a', 0.9], [0.3, '#ff9a3c', 0.4], [1, '#ff9a3c', 0]])}</radialGradient>
              </defs>
              {[CIT_L, CIT_R].map((c, ci) => (
                <g key={ci}>
                  {c.wall.map((d, i) => <path key={i} d={d} fill="#0c1923" />)}
                  {c.towers.map((t, i) => (
                    <g key={i}>
                      <rect x={f1(t.x)} y={f1(t.y - t.h)} width={f1(t.w)} height={f1(t.h + 30)} fill="#0e1d28" />
                      <path d={merlons(f1(t.x - 2), f1(t.x + t.w + 2), f1(t.y - t.h), 7, 3.4, 8)} fill="#0e1d28" />
                      <path d={`M${f1(t.x)} ${f1(t.y - t.h)}H${f1(t.x + t.w)}`} stroke="#c88a52" strokeWidth="1.4" opacity=".5" />
                      <path d={`M${f1(t.x + t.w)} ${f1(t.y - t.h)}V${f1(t.y)}`} stroke="#6fb6cc" strokeWidth="1.2" opacity=".25" />
                    </g>
                  ))}
                  {c.lights.map(([x, y], i) => (
                    <g key={`l${i}`}>
                      <circle cx={f1(x)} cy={f1(y)} r="14" fill={url('torch')} />
                      <rect x={f1(x - 2)} y={f1(y - 3)} width="4" height="6" fill="#ffd08a" />
                    </g>
                  ))}
                </g>
              ))}
              {/* palace blocks on the upper citadel */}
              <g fill="#0f1f2a">
                <path d="M1180 450V392H1270V370H1350V450Z" />
                <path d="M1120 460V418H1190V460Z" />
              </g>
              <path d="M1180 392H1270M1270 370H1350" stroke="#c88a52" strokeWidth="1.6" opacity=".55" />
              {[[1200, 412], [1226, 412], [1290, 392], [1316, 392], [1140, 434]].map(([x, y], i) => <rect key={i} x={x} y={y} width="7" height="11" fill={i % 2 ? '#ffb15a' : '#1c2c38'} opacity={i % 2 ? 0.85 : 1} />)}
              {/* bulls Şeri & Hurri on the crags */}
              <path d="M40 420C64 370 120 356 168 370C198 382 214 414 220 460H40Z" fill="#0c1923" />
              <path d="M1384 404C1408 358 1466 346 1512 360C1542 374 1556 404 1562 448H1384Z" fill="#0c1923" />
              <path d="M64 386C90 366 130 362 160 372M1410 372C1440 352 1480 350 1508 360" fill="none" stroke="#c88a52" strokeWidth="1.6" opacity=".5" />
              <g transform="translate(56 292) scale(0.9)">
                <path d={BULL} fill="#08121a" />
                <path d={BULL_HORNS} fill="#08121a" />
                <path d="M18 32C40 26 70 28 96 26C112 22 124 16 136 20C144 22 150 26 154 30C160 36 166 44 168 52" fill="none" stroke="#e7a464" strokeWidth="2.2" opacity=".7" />
                <path d="M146 26C136 12 144 0 160 0M154 28C160 10 174 6 184 10" fill="none" stroke="#e7a464" strokeWidth="1.6" opacity=".7" />
              </g>
              <g transform="translate(1554 276) scale(-0.9 0.9)">
                <path d={BULL} fill="#08121a" />
                <path d={BULL_HORNS} fill="#08121a" />
                <path d="M18 32C40 26 70 28 96 26C112 22 124 16 136 20C144 22 150 26 154 30C160 36 166 44 168 52" fill="none" stroke="#8fd8ee" strokeWidth="2.2" opacity=".6" />
                <path d="M146 26C136 12 144 0 160 0M154 28C160 10 174 6 184 10" fill="none" stroke="#8fd8ee" strokeWidth="1.6" opacity=".6" />
              </g>
            </svg>
          </div>
  
          {/* Lion Gate */}
          <div className={`${styles.gateWrap} ${styles.pGate}`}>
            <div className={styles.gate}>
              <svg className={styles.full} viewBox="0 0 1600 900" focusable="false">
                <defs>
                  <linearGradient id={k('ground')} x1="0" y1="790" x2="0" y2="900" gradientUnits="userSpaceOnUse">{stops([[0, '#1a2026'], [0.3, '#10161b'], [1, '#06080a']])}</linearGradient>
                  <linearGradient id={k('sheen')} x1="0" y1="790" x2="0" y2="900" gradientUnits="userSpaceOnUse">{stops([[0, '#5aa6c4', 0.28], [0.4, '#5aa6c4', 0.06], [1, '#5aa6c4', 0]])}</linearGradient>
                  <linearGradient id={k('reflW')} x1="0" y1="0" x2="0" y2="1">{stops([[0, '#ff9a3c', 0.55], [1, '#ff9a3c', 0]])}</linearGradient>
                  <linearGradient id={k('shadeTop')} x1="0" y1="250" x2="0" y2="800" gradientUnits="userSpaceOnUse">{stops([[0, '#0b1824', 0.35], [0.6, '#0b1824', 0.12], [1, '#2a1406', 0.25]])}</linearGradient>
                  <linearGradient id={k('void')} x1="0" y1="340" x2="0" y2="800" gradientUnits="userSpaceOnUse">{stops([[0, '#0a1622'], [0.5, '#1c2630'], [0.82, '#5a3a22'], [1, '#c07a3a']])}</linearGradient>
                  <linearGradient id={k('lionStone')} x1="0" y1="0" x2="1" y2="1">{stops([[0, '#b09e86'], [0.4, '#7d6f5f'], [1, '#433a32']])}</linearGradient>
                  <linearGradient id={k('slab')} x1="0" y1="0" x2="1" y2="1">{stops([[0, '#6c6155'], [0.5, '#51473e'], [1, '#2e2722']])}</linearGradient>
                  <linearGradient id={k('stoneDk')} x1="0" y1="0" x2="1" y2="1">{stops([[0, '#6a5e50'], [1, '#2e2722']])}</linearGradient>
                  <linearGradient id={k('bronzeS')} x1="0" y1="0" x2="1" y2="0">{stops([[0, '#3a1d06'], [0.35, '#b97a34'], [0.5, '#ffe0a0'], [0.65, '#c4863c'], [1, '#3a1d06']])}</linearGradient>
                  <radialGradient id={k('faceVol')} cx="0.32" cy="0.28" r="0.85">{stops([[0, '#fff2d8', 0.28], [0.45, '#fff2d8', 0], [0.75, '#000', 0.12], [1, '#000', 0.38]])}</radialGradient>
                  <radialGradient id={k('vig')} cx="800" cy="420" r="980" gradientUnits="userSpaceOnUse" gradientTransform="translate(800 420) scale(1 0.72) translate(-800 -420)">{stops([[0.5, '#02050a', 0], [0.8, '#02050a', 0.4], [1, '#02050a', 0.72]])}</radialGradient>
                  <radialGradient id={k('warm')}>{stops([[0, '#ff8a3a', 0.42], [0.5, '#ff8a3a', 0.12], [1, '#ff8a3a', 0]])}</radialGradient>
                  <radialGradient id={k('eyeHalo')}>{stops([[0, '#bff6ff', 0.9], [1, '#2fb6ff', 0]])}</radialGradient>
                  <radialGradient id={k('fireGlow')}>{stops([[0, '#ffb35a', 0.6], [0.4, '#ff7a2a', 0.2], [1, '#ff7a2a', 0]])}</radialGradient>
                  <clipPath id={k('gateClip')}><path d={`M200 800V256H446V286H1154V256H1400V800Z${ARCH_D}`} clipRule="evenodd" /></clipPath>
                  <pattern id={k('grain')} width="9" height="9" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="3" r=".9" fill="#000" opacity=".22" />
                    <circle cx="6.5" cy="7" r=".7" fill="#fff" opacity=".07" />
                    <circle cx="7" cy="1.5" r=".6" fill="#000" opacity=".16" />
                  </pattern>
                </defs>
                <g>
                {/* side walls */}
                {[WALL_L, WALL_R].map((ws, wi) => (
                  <g key={wi}>
                    <rect x={wi ? 1370 : -10} y="520" width="240" height="280" fill="#16120f" />
                    <Stones list={ws} />
                    <path d={merlons(wi ? 1374 : -6, wi ? 1610 : 226, 522, 26, 14, 24)} fill="#4a423b" />
                    <path d={wi ? 'M1370 522H1610' : 'M-10 522H230'} stroke="#a8c4cc" strokeWidth="2" opacity=".28" />
                  </g>
                ))}
                {/* tower + arch block */}
                <g clipPath={url('gateClip')}>
                  <rect x="200" y="250" width="1200" height="550" fill="#15110e" />
                  <Stones list={GATE_STONES} />
                  <rect x="446" y="250" width="708" height="550" fill="#0b0f14" opacity=".42" />
                  <rect x="200" y="250" width="1200" height="550" fill={url('shadeTop')} />
                  <path d="M446 256V800M1154 256V800" stroke="#0c0a08" strokeWidth="8" opacity=".6" />
                  <path d="M440 256V800" stroke="#a6c8d2" strokeWidth="2" opacity=".18" />
                  <path d="M210 300C214 420 208 560 214 700M1390 320C1386 460 1392 600 1386 760M300 280C306 360 302 440 306 500M1300 270C1296 350 1300 420 1296 480" stroke="#9cc8d4" strokeWidth="3" opacity=".08" strokeLinecap="round" />
                </g>
                <path d={merlons(198, 448, 256, 28, 16, 26)} fill="#5a5047" />
                <path d={merlons(1152, 1402, 256, 28, 16, 26)} fill="#5a5047" />
                <path d={merlons(452, 1150, 286, 24, 16, 22)} fill="#463e37" />
                <path d="M198 256H448M1152 256H1402" stroke="#a8c4cc" strokeWidth="2" opacity=".3" />
                {/* arch reveal + void */}
                <path d={ARCH_D} fill="#1c1814" />
                <path d={ARCH_IN_D} fill={url('void')} />
                <path d="M560 800V620H640V590H720V640H800V570H880V630H960V600H1040V800Z" fill="#141c24" opacity=".85" />
                {[[600, 660], [690, 620], [770, 680], [850, 600], [930, 650], [1000, 630]].map(([x, y], i) => <rect key={i} x={x} y={y} width="9" height="14" fill="#ffb15a" opacity=".75" />)}
                <path d={ARCH_D} fill="none" stroke="#0c0a08" strokeWidth="5" />
                <path d={poly(ARCH.slice(29))} fill="none" stroke="#9cc2cc" strokeWidth="2" opacity=".25" />
                {/* lion protomes */}
                <Lion k={k} side="l" />
                <Lion k={k} side="r" />
                <rect x="-10" y="250" width="1620" height="550" fill={url('grain')} />
                </g>
                {/* ground */}
                <rect y="790" width="1600" height="110" fill={url('ground')} />
                <rect y="790" width="1600" height="110" fill={url('sheen')} />
                <path d="M0 812H1600M0 842H1600M0 880H1600" stroke="#030405" strokeWidth="2" opacity=".7" />
                {[-700, -460, -240, -80, 80, 240, 460, 700, 980, -980].map((dx) => <path key={dx} d={`M${800 + dx * 0.55} 790L${800 + dx * 1.35} 900`} stroke="#030405" strokeWidth="2" opacity=".55" />)}
                {/* reflections */}
                <ellipse cx="800" cy="830" rx="380" ry="26" fill="#1f3442" opacity=".35" />
                {BRAZIERS.map(([x], i) => <rect key={i} x={x - 34} y="796" width="68" height="104" fill={url('reflW')} />)}
                {BRAZIERS.map(([x], i) => <ellipse key={`e${i}`} cx={x} cy="804" rx="120" ry="12" fill="#ff9a3c" opacity=".22" />)}
                <path d="M300 860C420 850 560 852 700 858M900 866C1040 856 1180 856 1320 864M180 828C260 822 340 822 420 826M1200 826C1290 820 1370 820 1440 826" stroke="#8fd0e6" strokeWidth="2" opacity=".22" strokeLinecap="round" />
                <rect x="210" y="800" width="230" height="60" fill="#5b5046" opacity=".12" />
                <rect x="1160" y="800" width="230" height="60" fill="#5b5046" opacity=".12" />
                {BRAZIERS.map(([x, y], i) => <Brazier key={i} x={x} y={y} k={k} />)}
                {/* vignette baked into this static layer (a separate full-screen overlay costs a
                    whole extra blend per frame under software compositing) */}
                <rect x="-200" y="-200" width="2000" height="1300" fill={url('vig')} />
              </svg>
              {BRAZIERS.map(([x, y], i) => (
                <div key={i} ref={(el) => { flameRefs.current[i] = el; }} className={styles.flame} style={{ left: `${(x / 1600) * 100}%`, top: `${(y / 900) * 100}%` }}>
                  <svg className={styles.fl1} viewBox="0 0 60 100" focusable="false"><path d="M30 100C8 100 2 82 8 64C12 52 18 46 16 30C26 38 28 48 28 54C32 40 38 24 34 2C48 16 56 36 54 58C58 52 60 46 58 38C66 56 64 100 30 100Z" /></svg>
                  <svg className={styles.fl2} viewBox="0 0 60 100" focusable="false"><path d="M30 100C14 100 10 86 14 74C18 64 24 58 24 46C30 54 32 62 32 68C36 58 40 48 38 32C48 46 52 62 48 76C52 72 54 68 54 62C58 78 52 100 30 100Z" /></svg>
                  <svg className={styles.fl3} viewBox="0 0 60 100" focusable="false"><path d="M30 100C20 100 18 92 20 84C22 78 26 74 27 66C31 72 33 78 33 82C36 76 38 70 37 62C44 72 46 84 42 92C40 98 36 100 30 100Z" /></svg>
                </div>
              ))}
              {BRAZIERS.map(([x, y], i) => <span key={`g${i}`} className={styles.fireGlow} style={{ left: `${(x / 1600) * 100}%`, top: `${((y - 30) / 900) * 100}%` }} />)}
              {RIPPLES.map(([x, y, d], i) => <span key={i} className={styles.ripple} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} />)}
            </div>
          </div>
  
          <div ref={litRef} className={styles.lit} />
          <div className={styles.rays}><div className={styles.raysInner} /></div>
          <canvas ref={rainRef} className={styles.canvas} />
        </div>
  ), []);

  return (
    <div ref={rootRef} className={`${styles.root} ${className ?? ''}`} data-mood={mood} style={style}>
      {back}
      <div className={styles.content}>{children}</div>
      <canvas ref={frontRef} className={`${styles.canvas} ${styles.front}`} aria-hidden="true" />
      <div ref={flashRef} className={styles.flash} aria-hidden="true" />
    </div>
  );
}
