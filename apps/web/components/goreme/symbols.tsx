'use client';

import { memo, useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import styles from './symbols.module.css';

/* Göreme: Şafak Balonları — symbol art. Hand-authored, original SVG (viewBox 100 × 100); Cappadocian geography and
   craft only (no religious buildings, no real people, nothing traced from another game).

   ─── Public API (used by the game screen) ──────────────────────────────────────────────────────────────────────────
     type GoremeSymbolId     = 'h1'…'h4' | 'l1'…'l5' | 'balloon' | 'sun'
     type GoremeSymbolState  = 'idle' | 'win' | 'land' | 'dim'

     <GoremeSymbol symbol="balloon" multiplier={5} size={1.3} state="land" />
        symbol      required. The cell symbol.
        state       'idle' (default; balloons bob, the sun's rays turn) · 'win' (pulse + glow halo, loops) ·
                    'land' (one-shot landing: drop-and-squash, balloons float down, the sun flares in) · 'dim' (faded,
                    for non-winning cells while wins are shown).
        multiplier  balloon only: ×1…×25 badge. It also picks the envelope colourway (goremeBalloonTier):
                    ×1–2 madder · ×3–5 turquoise · ×6–12 plum · ×13–25 royal gold.
        size        balloon only (any symbol accepts it): visual scale relative to the cell, default 1. Merged balloons
                    use goremeMergedSize(n) (1.18 for two, up to 1.45). The cell keeps its box; the art overflows it.
        sprite      draw through <GoremeSymbolSprites/> (mount once per page) instead of inline SVG. Use it on boards.
        className / style / label (aria-label; default GOREME_SYMBOL_LABELS[symbol], hidden when omitted on purpose).
     The component fills its parent (width/height 100 %); give the parent the cell size.
     Restart a one-shot 'land' by changing the React key.

     <GoremeSymbolArt symbol tier? px? />   bare art (paytable, info pages); no states.
     GOREME_SYMBOLS, GOREME_SYMBOL_LABELS, GOREME_SYMBOL_GLOW, GR_PALETTE, goremeBalloonTier, goremeMergedSize,
     GOREME_BALLOON_ENVELOPE (path, for FX silhouettes).
   ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

   Highs  h1 Peri Bacası (basalt-capped tuff cone with a little cut door) · h2 Güvercinlik (rounded cliff with rows of
          pigeon holes framed in lime-white and red-ochre paint) · h3 Avanos Çömleği (red-clay jug with a painted
          shoulder band) · h4 Kilim Atı (blocky kilim horse on a stepped indigo medallion)
   Lows   five kilim "eye" motifs; each differs in hue, lightness AND silhouette so they read in greyscale:
          l1 madder diamond · l2 indigo hexagon · l3 green triangle · l4 saffron ram's horn · l5 plum four-lobe
   Wild   balloon: hot-air balloon whose envelope carries invented kilim bands; colourway by multiplier tier
   Scatter sun: the dawn sun rising behind a ridge of fairy chimneys inside a gold ring of stepped rays
   Shared rules: key light from the upper left, warm ink edge, one cheap feDropShadow per symbol, no blur filters.
   Only transform / opacity animate (symbols.module.css). */

export type GoremeSymbolId = 'h1' | 'h2' | 'h3' | 'h4' | 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'balloon' | 'sun';
export type GoremeSymbolState = 'idle' | 'win' | 'land' | 'dim';
export type GoremeBalloonTier = 0 | 1 | 2 | 3;

export const GOREME_SYMBOLS: readonly GoremeSymbolId[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5', 'balloon', 'sun'];
export const GOREME_SYMBOL_LABELS: Record<GoremeSymbolId, string> = {
  h1: 'Peri Bacası',
  h2: 'Güvercinlik',
  h3: 'Avanos Çömleği',
  h4: 'Kilim Atı',
  l1: 'Al Göz',
  l2: 'Çivit Göz',
  l3: 'Yeşil Göz',
  l4: 'Sarı Koçboynuzu',
  l5: 'Mor Yonca',
  balloon: 'Balon (joker)',
  sun: 'Şafak Güneşi (dağılım)',
};

/** Palette shared by symbols, scene, frame, logo, sky band and FX. */
export const GR_PALETTE = {
  tuff: { hi: '#fff6ea', light: '#f7dfc4', base: '#e6bb98', deep: '#b9805e', dark: '#6c3e2e' },
  rose: { hi: '#ffe2d6', light: '#f3bfae', base: '#d78f7c', deep: '#9a5448', dark: '#4e2420' },
  basalt: { hi: '#a78a80', light: '#7a5e56', base: '#55403a', deep: '#33241f', dark: '#1a110e' },
  clay: { hi: '#ffd2ae', light: '#ea8c5c', base: '#c4552f', deep: '#84301a', dark: '#3e1408' },
  madder: { hi: '#ffb8a6', light: '#ec5e4e', base: '#bc2c30', deep: '#76141e', dark: '#38080f' },
  indigo: { hi: '#c4d0ff', light: '#6278d6', base: '#2f429a', deep: '#19235c', dark: '#0a0e2c' },
  saffron: { hi: '#fff6c8', light: '#ffd65e', base: '#f2a622', deep: '#a86210', dark: '#4a2604' },
  turq: { hi: '#d6fff6', light: '#62e2d2', base: '#1fa9a5', deep: '#0c6567', dark: '#04302e' },
  leaf: { hi: '#e8ffd4', light: '#a4e274', base: '#4fa83b', deep: '#24641e', dark: '#0c2c0a' },
  plum: { hi: '#f4e2ff', light: '#c78ce9', base: '#8b4dc2', deep: '#4f2382', dark: '#200c3a' },
  cream: '#fff7e8',
  sky: { night: '#2c2357', violet: '#5b4a9c', lilac: '#a184c8', rose: '#e79fa6', peach: '#f8bc94', gold: '#ffdc92' },
  ink: '#2a1216',
} as const;
const P = GR_PALETTE;
const INK = P.ink;

/** Win-glow colour per symbol (halo, burst particles). */
export const GOREME_SYMBOL_GLOW: Record<GoremeSymbolId, string> = {
  h1: '#ffd8b0', h2: '#ffc6b4', h3: '#ff9a68', h4: '#ffd65e',
  l1: '#ff7a6a', l2: '#8aa2ff', l3: '#a4e274', l4: '#ffe07a', l5: '#d6a2ff',
  balloon: '#ffe6a0', sun: '#fff0a8',
};

export const goremeBalloonTier = (multiplier = 1): GoremeBalloonTier => (multiplier >= 13 ? 3 : multiplier >= 6 ? 2 : multiplier >= 3 ? 1 : 0);
/** Visual scale for a balloon made of `parts` merged balloons (1 → 1, 2 → 1.18, 3 → 1.3, ≥4 → 1.45). */
export const goremeMergedSize = (parts: number) => (parts <= 1 ? 1 : parts === 2 ? 1.18 : parts === 3 ? 1.3 : 1.45);

/* ---------- helpers ---------- */
type K = (n: string) => string;
type Stop = readonly [number, string, number?];
const stopEls = (s: readonly Stop[]) => s.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />);
function LG({ id, x1 = 0, y1 = 0, x2 = 0, y2 = 1, s }: { id: string; x1?: number; y1?: number; x2?: number; y2?: number; s: readonly Stop[] }) {
  return <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>{stopEls(s)}</linearGradient>;
}
function RG({ id, cx = 0.5, cy = 0.5, r = 0.5, fx, fy, s }: { id: string; cx?: number; cy?: number; r?: number; fx?: number; fy?: number; s: readonly Stop[] }) {
  return <radialGradient id={id} cx={cx} cy={cy} r={r} fx={fx ?? cx} fy={fy ?? cy}>{stopEls(s)}</radialGradient>;
}
const n1 = (n: number) => Math.round(n * 100) / 100;
const aura = (k: K, color: string, o = 0.5) => <RG id={k('aura')} s={[[0.25, color, o], [0.65, color, o * 0.3], [1, color, 0]]} />;
/** Diamond (rhombus) path. */
export const grDiamond = (cx: number, cy: number, rx: number, ry = rx) => `M${n1(cx)} ${n1(cy - ry)}L${n1(cx + rx)} ${n1(cy)}L${n1(cx)} ${n1(cy + ry)}L${n1(cx - rx)} ${n1(cy)}Z`;
/** Stepped (kilim) diamond outline: a diamond whose edges are stairs of `n` steps. */
export function grSteppedDiamond(cx: number, cy: number, r: number, n: number) {
  const s = r / n;
  let d = `M${n1(cx)} ${n1(cy - r)}`;
  const quad = (sx: number, sy: number) => { for (let i = 0; i < n; i++) d += `h${n1(sx * s)}v${n1(sy * s)}`; };
  quad(1, 1); // top → right: steps go right then down
  for (let i = 0; i < n; i++) d += `v${n1(s)}h${n1(-s)}`; // right → bottom
  for (let i = 0; i < n; i++) d += `h${n1(-s)}v${n1(-s)}`; // bottom → left
  for (let i = 0; i < n; i++) d += `v${n1(-s)}h${n1(s)}`; // left → top
  return `${d}Z`;
}
/** A kilim "eye": cream diamond with a dark pupil and a light ring. */
function Eye({ cx, cy, r, pupil = INK }: { cx: number; cy: number; r: number; pupil?: string }) {
  return (
    <g>
      <path d={grDiamond(cx, cy, r * 1.25, r * 1.25)} fill={INK} />
      <path d={grDiamond(cx, cy, r, r)} fill={P.cream} />
      <path d={grDiamond(cx, cy, r * 0.5, r * 0.5)} fill={pupil} />
      <circle cx={cx - r * 0.12} cy={cy - r * 0.16} r={r * 0.13} fill="#fff" />
    </g>
  );
}

/* ---------- h1 · Peri Bacası ---------- */
function PeriBacasi({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const T = P.tuff;
  return (
    <>
      <defs>
        {aura(k, '#ffc89a', 0.6)}
        <LG id={k('cone')} x1={0} y1={0} x2={1} y2={0} s={[[0, T.hi], [0.35, T.light], [0.7, T.base], [1, T.deep]]} />
        <LG id={k('cone2')} x1={0} y1={0} x2={1} y2={0} s={[[0, P.rose.light], [0.6, P.rose.base], [1, P.rose.deep]]} />
        <RG id={k('cap')} cx={0.32} cy={0.3} r={0.8} s={[[0, P.basalt.hi], [0.35, P.basalt.light], [0.8, P.basalt.base], [1, P.basalt.deep]]} />
        <LG id={k('ground')} s={[[0, T.base], [1, T.deep]]} />
        <LG id={k('bal')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.madder.light], [1, P.madder.deep]]} />
      </defs>
      <circle cx="50" cy="54" r="48" fill={u('aura')} />
      {/* tiny balloon far behind */}
      <g opacity=".9">
        <path d="M84 8C89 8 92 11.4 92 15.6C92 19.6 88.4 22 86.4 24H81.6C79.6 22 76 19.6 76 15.6C76 11.4 79 8 84 8Z" fill={u('bal')} stroke={INK} strokeWidth="1" />
        <path d="M78 13.6H90M77 17.4H91" stroke={P.saffron.light} strokeWidth="1.3" />
        <rect x="82.2" y="25.6" width="3.6" height="3" rx=".6" fill={P.basalt.light} stroke={INK} strokeWidth=".7" />
      </g>
      {/* second, shorter chimney behind (rose tuff) */}
      <path d="M10 94C12 82 15 70 18 58C19 54 20 52 21 50H31C32 52 33 54 34 58C36 70 38 82 40 94Z" fill={u('cone2')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 51C14 45 19 41 26 41C33 41 38 45 38 51C33 53.4 19 53.4 14 51Z" fill={u('cap')} stroke={INK} strokeWidth="1.8" />
      {/* main chimney */}
      <path d="M27 94C31 80 35 64 39 46C40.2 40 41.4 35 42.6 32H57.4C58.6 35 59.8 40 61 46C65 64 69 80 73 94Z" fill={u('cone')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      {/* erosion grooves and strata */}
      <path d="M46 36C45 52 43 70 40 90M54 38C55 54 57 72 60 90M50 44V92" stroke={T.deep} strokeWidth="1.3" opacity=".55" fill="none" strokeLinecap="round" />
      <path d="M36 62Q50 66 64 62M33 76Q50 81 67 76" stroke={T.deep} strokeWidth="1.2" opacity=".45" fill="none" />
      <path d="M44 38C42 54 39 72 35 90" stroke="#fff" strokeWidth="2.4" opacity=".55" fill="none" strokeLinecap="round" />
      {/* shadow under the cap */}
      <path d="M41.4 33.4C46 36 54 36 58.6 33.4L60 40C54 42 46 42 40 40Z" fill={T.dark} opacity=".35" />
      {/* basalt cap */}
      <path d="M28 32C28 20 38 11 50 11C62 11 72 20 72 32C65 36 35 36 28 32Z" fill={u('cap')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M33 26C35 19 41 15 48 14" stroke="#fff" strokeWidth="2" opacity=".45" fill="none" strokeLinecap="round" />
      <path d="M30 31Q50 36 70 31" stroke={P.basalt.hi} strokeWidth="1" opacity=".6" fill="none" />
      {/* cut doorway and window */}
      <path d="M46 92V82C46 78.6 54 78.6 54 82V92Z" fill={T.dark} stroke={INK} strokeWidth="1.2" />
      <path d="M48 58V54C48 52.4 52 52.4 52 54V58Z" fill={T.dark} stroke={INK} strokeWidth="1" />
      <path d="M22 66V63C22 61.6 25 61.6 25 63V66Z" fill={P.rose.dark} />
      {/* ground */}
      <path d="M2 96C14 88 30 90 50 90C70 90 86 88 98 96Z" fill={u('ground')} stroke={INK} strokeWidth="1.6" />
    </>
  );
}

/* ---------- h2 · Güvercinlik ---------- */
function Guvercinlik({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const R = P.rose;
  const hole = (x: number, y: number, w = 5.4, h = 7) => `M${n1(x - w / 2)} ${n1(y + h / 2)}V${n1(y - h / 2 + w / 2)}A${n1(w / 2)} ${n1(w / 2)} 0 0 1 ${n1(x + w / 2)} ${n1(y - h / 2 + w / 2)}V${n1(y + h / 2)}Z`;
  const rows: Array<{ y: number; xs: number[] }> = [
    { y: 36, xs: [38, 50, 62] },
    { y: 54, xs: [26, 38, 50, 62, 74] },
    { y: 72, xs: [20, 32, 44, 56, 68, 80] },
  ];
  return (
    <>
      <defs>
        {aura(k, '#ffb8a0', 0.55)}
        <LG id={k('rock')} x1={0} y1={0} x2={1} y2={0.6} s={[[0, R.hi], [0.3, R.light], [0.7, R.base], [1, R.deep]]} />
        <LG id={k('shade')} x1={0} y1={0} x2={0} y2={1} s={[[0, '#fff', 0.25], [0.5, '#fff', 0], [1, R.dark, 0.35]]} />
      </defs>
      <circle cx="50" cy="54" r="48" fill={u('aura')} />
      <path d="M6 95C6 70 10 48 19 33C26 21 37 13 50 13C64 13 75 21 82 34C90 49 94 70 94 95Z" fill={u('rock')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M6 95C6 70 10 48 19 33C26 21 37 13 50 13C64 13 75 21 82 34C90 49 94 70 94 95Z" fill={u('shade')} />
      {/* painted bands: lime white with red-ochre teeth, one per row */}
      {rows.map((row, i) => {
        const x0 = row.xs[0]! - 7, x1 = row.xs[row.xs.length - 1]! + 7, y = row.y - 7.6;
        let teeth = '';
        for (let x = x0; x < x1 - 1; x += 4) teeth += `M${n1(x)} ${n1(y + 2.6)}l2 -2.6l2 2.6z`;
        return (
          <g key={i}>
            <rect x={x0} y={y - 1.6} width={x1 - x0} height={4.2} rx="1" fill="#fffaf0" opacity=".92" />
            <path d={teeth} fill={P.madder.base} />
            {row.xs.map((x) => (
              <g key={x}>
                <path d={hole(x, row.y, 7.6, 9.6)} fill="#fffaf0" opacity=".9" />
                <path d={hole(x, row.y + 0.6, 4.6, 7)} fill={R.dark} stroke={INK} strokeWidth=".9" />
                <circle cx={x} cy={row.y + 5.6} r=".9" fill={P.madder.base} />
              </g>
            ))}
          </g>
        );
      })}
      {/* cracks and a highlight on the lit flank */}
      <path d="M24 40C20 54 17 72 16 90M82 46C85 60 87 76 88 90" stroke={R.deep} strokeWidth="1.2" fill="none" opacity=".5" />
      <path d="M22 36C27 26 35 19 44 16.4" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".6" />
      {/* the pigeon */}
      <g transform="translate(72 18)">
        <path d="M0 6C3 2 7 1 10 3C13 -1 18 -2 22 0C17 1 14 4 13 7C11 9 6 10 2 9Z" fill="#fff" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        <circle cx="3.6" cy="5" r=".7" fill={INK} />
        <path d="M0 6L-2.6 6.6L0 7.2" fill={P.saffron.base} />
      </g>
      <path d="M4 96C20 92 34 93 50 93C66 93 80 92 96 96Z" fill={R.deep} stroke={INK} strokeWidth="1.4" />
    </>
  );
}

/* ---------- h3 · Avanos Çömleği ---------- */
function Comlek({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const C = P.clay;
  let zig = 'M24 49';
  for (let x = 24, up = true; x <= 76; x += 4, up = !up) zig += `L${x} ${up ? 45.6 : 52}`;
  return (
    <>
      <defs>
        {aura(k, '#ff9a60', 0.55)}
        <RG id={k('body')} cx={0.34} cy={0.36} r={0.75} s={[[0, C.hi], [0.25, C.light], [0.7, C.base], [1, C.deep]]} />
        <LG id={k('neck')} x1={0} y1={0} x2={1} y2={0} s={[[0, C.light], [0.5, C.base], [1, C.deep]]} />
        <LG id={k('band')} s={[[0, '#fff8ea'], [1, '#f1dcc0']]} />
      </defs>
      <circle cx="50" cy="56" r="47" fill={u('aura')} />
      {/* handle (behind the body edge) */}
      <path d="M59 26C76 22 86 34 80 56" fill="none" stroke={INK} strokeWidth="9.6" strokeLinecap="round" />
      <path d="M59 26C76 22 86 34 80 56" fill="none" stroke={C.base} strokeWidth="6.4" strokeLinecap="round" />
      <path d="M62 25C73 23.4 80 30 80 40" fill="none" stroke={C.hi} strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
      {/* body */}
      <path d="M50 95C29 95 17 82 17 64C17 49 28 39 38 35L40 25.6C36 24 33 21 34.4 16H65.6C67 21 64 24 60 25.6L62 35C72 39 83 49 83 64C83 82 71 95 50 95Z" fill={u('body')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M40 25.6L38 35C42 33.6 58 33.6 62 35L60 25.6C55 27 45 27 40 25.6Z" fill={u('neck')} opacity=".9" />
      {/* lip */}
      <ellipse cx="50" cy="16" rx="15.6" ry="3.6" fill={C.deep} stroke={INK} strokeWidth="1.8" />
      <ellipse cx="50" cy="15.4" rx="11" ry="2" fill={C.dark} />
      <path d="M37 19.6Q50 23 63 19.6" stroke={C.hi} strokeWidth="1.2" fill="none" opacity=".7" />
      {/* painted shoulder band */}
      <path d="M21.6 44C30 41 70 41 78.4 44L80 55C70 52 30 52 20 55Z" fill={u('band')} stroke={C.deep} strokeWidth="1" />
      <path d={zig} fill="none" stroke={P.indigo.base} strokeWidth="1.8" strokeLinejoin="round" />
      {[28, 36, 44, 52, 60, 68].map((x) => <circle key={x} cx={x + 2} cy={49} r="1.3" fill={P.madder.base} />)}
      {/* lower painted rings and dots */}
      <path d="M22 70Q50 75 78 70M25 76Q50 81 75 76" stroke="#fff3df" strokeWidth="1.8" fill="none" opacity=".85" />
      {[32, 42, 50, 58, 68].map((x) => <path key={x} d={grDiamond(x, 73.6 + (x === 50 ? 0.6 : 0), 1.9)} fill="#fff3df" opacity=".9" />)}
      <path d="M30 88Q50 94 70 88" stroke={C.dark} strokeWidth="1.6" fill="none" opacity=".45" />
      {/* glints */}
      <path d="M26 58C26 50 30 44.6 34 42" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".55" />
      <circle cx="28" cy="64" r="1.8" fill="#fff" opacity=".6" />
    </>
  );
}

/* ---------- h4 · Kilim Atı ---------- */
const HORSE = 'M24 40L30 30L33 23L35.6 28L39 27L43 33L45 44H66L71 47L74 52L78 50L80 54L76 58L77 66L73 62L72 72H68V62H63V74H59V62H48V74H44V62H40V72H36V58L34 50L30 46L25 47L21 45Z';
function KilimAti({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const I = P.indigo, M = P.madder, S = P.saffron;
  return (
    <>
      <defs>
        {aura(k, '#ffd65e', 0.5)}
        <RG id={k('field')} cx={0.4} cy={0.35} r={0.75} s={[[0, I.light], [0.55, I.base], [1, I.deep]]} />
        <LG id={k('rim')} x1={0} y1={0} x2={1} y2={1} s={[[0, M.hi], [0.35, M.light], [1, M.deep]]} />
        <LG id={k('horse')} x1={0} y1={0} x2={0.4} y2={1} s={[[0, '#fffbe8'], [0.4, S.hi], [1, S.light]]} />
      </defs>
      <circle cx="50" cy="50" r="49" fill={u('aura')} />
      <path d={grSteppedDiamond(50, 50, 47, 7)} fill={u('rim')} stroke={INK} strokeWidth="2" strokeLinejoin="miter" />
      <path d={grSteppedDiamond(50, 50, 40, 6)} fill={S.base} stroke={INK} strokeWidth="1.2" />
      <path d={grDiamond(50, 50, 36)} fill={u('field')} stroke={INK} strokeWidth="1.4" />
      {/* small kilim hooks in the field corners */}
      {[[50, 22], [50, 80], [24, 52], [78, 40]].map(([x, y], i) => <path key={i} d={grDiamond(x!, y!, 3.2)} fill={M.light} stroke={INK} strokeWidth=".8" />)}
      {/* the horse: ink offset, body, saddle cloth, mane teeth, eye */}
      <path d={HORSE} fill={INK} transform="translate(1.2 1.6)" />
      <path d={HORSE} fill={u('horse')} stroke={INK} strokeWidth="1.6" strokeLinejoin="miter" />
      <path d="M48 44H62V54H48Z" fill={M.base} stroke={INK} strokeWidth="1.2" />
      <path d={grDiamond(55, 49, 3.6, 3.6)} fill={S.light} />
      <path d="M48 44h2v-2h2v2h2v-2h2v2h2v-2h2v2h2" fill="none" stroke={M.deep} strokeWidth="1" />
      <path d="M35.6 28L37.4 31L39.6 30.4L41 34L43 35" fill="none" stroke={M.base} strokeWidth="2.4" strokeLinejoin="miter" />
      <rect x="29.4" y="33" width="2.6" height="2.6" fill={INK} />
      <path d="M36 72H40M44 74H48M59 74H63M68 72H72" stroke={M.base} strokeWidth="2.4" />
    </>
  );
}

/* ---------- lows · kilim eyes ---------- */
function LowShape({ k, pal, d, eye, rimInset, extra }: { k: K; pal: { hi: string; light: string; base: string; deep: string; dark: string }; d: string; eye: [number, number, number]; rimInset?: string; extra?: ReactNode }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        {aura(k, pal.light, 0.45)}
        <RG id={k('g')} cx={0.36} cy={0.3} r={0.8} s={[[0, pal.hi], [0.3, pal.light], [0.75, pal.base], [1, pal.deep]]} />
      </defs>
      <circle cx="50" cy="52" r="48" fill={u('aura')} />
      <path d={d} fill={u('g')} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      {rimInset && <path d={rimInset} fill="none" stroke={P.cream} strokeWidth="2.2" strokeLinejoin="round" opacity=".9" />}
      {extra}
      <Eye cx={eye[0]} cy={eye[1]} r={eye[2]} pupil={pal.dark} />
    </>
  );
}
function hexPath(cx: number, cy: number, r: number) {
  let d = '';
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; d += `${i ? 'L' : 'M'}${n1(cx + Math.cos(a) * r)} ${n1(cy + Math.sin(a) * r)}`; }
  return `${d}Z`;
}
function lobes(cx: number, cy: number, r: number, off: number) {
  // four-lobed quatrefoil: four arcs around the centre
  const p = [[cx, cy - off], [cx + off, cy], [cx, cy + off], [cx - off, cy]] as const;
  const t = r * 0.7071;
  return `M${n1(p[0][0] - t)} ${n1(p[0][1] + t * 0.3)}A${r} ${r} 0 1 1 ${n1(p[1][0] - t * 0.3)} ${n1(p[1][1] - t)}`
    + `A${r} ${r} 0 1 1 ${n1(p[2][0] + t)} ${n1(p[2][1] - t * 0.3)}`
    + `A${r} ${r} 0 1 1 ${n1(p[3][0] + t * 0.3)} ${n1(p[3][1] + t)}`
    + `A${r} ${r} 0 1 1 ${n1(p[0][0] - t)} ${n1(p[0][1] + t * 0.3)}Z`;
}
const L1 = ({ k }: { k: K }) => (
  <LowShape k={k} pal={P.madder} d={grSteppedDiamond(50, 50, 44, 5)} rimInset={grDiamond(50, 50, 30)} eye={[50, 50, 11]}
    extra={<>{[[50, 20], [80, 50], [50, 80], [20, 50]].map(([x, y], i) => <path key={i} d={grDiamond(x!, y!, 3.4)} fill={P.cream} />)}<path d="M30 30Q38 22 46 18" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".55" /></>} />
);
const L2 = ({ k }: { k: K }) => (
  <LowShape k={k} pal={P.indigo} d={hexPath(50, 50, 44)} rimInset={hexPath(50, 50, 34)} eye={[50, 50, 12]}
    extra={<>{Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i + Math.PI / 6; return <path key={i} d={grDiamond(50 + Math.cos(a) * 25, 50 + Math.sin(a) * 25, 2.8)} fill={P.saffron.light} />; })}<path d="M22 34Q28 24 38 20" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".5" /></>} />
);
const L3 = ({ k }: { k: K }) => (
  <LowShape k={k} pal={P.leaf} d="M50 6C52 6 53.4 7 54.4 8.8L94 84C95.6 87.4 93.6 91 89.6 91H10.4C6.4 91 4.4 87.4 6 84L45.6 8.8C46.6 7 48 6 50 6Z" rimInset="M50 24L80 81H20Z" eye={[50, 62, 11]}
    extra={<>{[[34, 84.6], [50, 84.6], [66, 84.6]].map(([x, y], i) => <path key={i} d={`M${x! - 4} ${y}l4 -4.4l4 4.4z`} fill={P.cream} opacity=".9" />)}<path d="M40 22L28 46" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".55" /></>} />
);
function L4({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const S = P.saffron;
  const HORN = 'M26 30C14 30 13 46 25 47C34 47.6 37 40 37 34V58C37 76 63 76 63 58V34C63 40 66 47.6 75 47C87 46 86 30 74 30';
  return (
    <>
      <defs>
        {aura(k, S.light, 0.45)}
        <LG id={k('g')} x1={0} y1={0} x2={0.5} y2={1} s={[[0, S.hi], [0.35, S.light], [1, S.base]]} />
      </defs>
      <circle cx="50" cy="52" r="48" fill={u('aura')} />
      <path d={grDiamond(50, 56, 30, 34)} fill={S.deep} opacity=".28" />
      <path d={HORN} fill="none" stroke={INK} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
      <path d={HORN} fill="none" stroke={u('g')} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d={HORN} fill="none" stroke={S.deep} strokeWidth="2" strokeLinecap="round" strokeDasharray="2 5" opacity=".7" />
      <path d="M26 26C20 26 16 30 16 35" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
      <Eye cx={50} cy={50} r={9.6} pupil={S.dark} />
      <path d="M50 76L46 82H54Z" fill={P.madder.base} stroke={INK} strokeWidth="1" />
    </>
  );
}
const L5 = ({ k }: { k: K }) => (
  <LowShape k={k} pal={P.plum} d={lobes(50, 50, 21, 24)} rimInset={grSteppedDiamond(50, 50, 22, 3)} eye={[50, 50, 10]}
    extra={<>{[[50, 17], [83, 50], [50, 83], [17, 50]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.4" fill={P.cream} stroke={INK} strokeWidth="1" />)}<path d="M28 22Q34 14 44 14" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".55" /></>} />
);

/* ---------- wild · balloon ---------- */
export const GOREME_BALLOON_ENVELOPE = 'M50 4C74 4 91 20 91 41C91 56 80 66 69 73.6L61 79.4H39L31 73.6C20 66 9 56 9 41C9 20 26 4 50 4Z';
const TIERS: ReadonlyArray<{ base: [string, string, string]; band: [string, string]; motif: string; dot: string; aura: string }> = [
  { base: [P.madder.light, P.madder.base, P.madder.deep], band: ['#fff8ea', '#ecd8bc'], motif: P.indigo.base, dot: P.saffron.light, aura: '#ffb08a' },
  { base: [P.turq.light, P.turq.base, P.turq.deep], band: [P.saffron.hi, P.saffron.light], motif: P.madder.base, dot: '#fff8ea', aura: '#7ff0e0' },
  { base: [P.plum.light, P.plum.base, P.plum.deep], band: [P.saffron.light, P.saffron.base], motif: P.turq.deep, dot: P.turq.hi, aura: '#d6a2ff' },
  { base: [P.saffron.hi, P.saffron.light, P.saffron.base], band: [P.madder.light, P.madder.base], motif: P.indigo.deep, dot: '#fff8ea', aura: '#ffe080' },
];
function Balloon({ k, tier = 0 }: { k: K; tier?: GoremeBalloonTier }) {
  const u = (n: string) => `url(#${k(n)})`;
  const t = TIERS[tier]!;
  const gores = [-3, -2, -1, 1, 2, 3].map((g) => `M50 4Q${n1(50 + g * 14)} 40 ${n1(50 + g * 3.3)} 79`).join('');
  let zig = 'M6 27';
  for (let x = 6, up = true; x <= 94; x += 5, up = !up) zig += `L${x} ${up ? 23 : 30}`;
  let teeth = '';
  for (let x = 14; x < 86; x += 6) teeth += `M${x} 58l3 5l3 -5z`;
  return (
    <>
      <defs>
        {aura(k, t.aura, 0.5)}
        <RG id={k('env')} cx={0.36} cy={0.28} r={0.8} s={[[0, t.base[0]], [0.5, t.base[1]], [1, t.base[2]]]} />
        <LG id={k('band')} s={[[0, t.band[0]], [1, t.band[1]]]} />
        <RG id={k('shine')} cx={0.34} cy={0.24} r={0.42} s={[[0, '#fff', 0.7], [0.5, '#fff', 0.18], [1, '#fff', 0]]} />
        <RG id={k('rim')} cx={0.4} cy={0.36} r={0.62} s={[[0.7, '#000', 0], [1, '#1a0610', 0.45]]} />
        <LG id={k('basket')} s={[[0, '#d8a06a'], [1, '#7a4422']]} />
        <RG id={k('fire')} cx={0.5} cy={0.8} r={0.6} s={[[0, '#fffbe0'], [0.4, '#ffd65e'], [1, '#ff6a2a', 0]]} />
        <clipPath id={k('clip')}><path d={GOREME_BALLOON_ENVELOPE} /></clipPath>
      </defs>
      <circle cx="50" cy="44" r="50" fill={u('aura')} />
      {/* ropes and basket */}
      <path d="M40 80L41.4 86.4M60 80L58.6 86.4M45 81L46 86.4M55 81L54 86.4" stroke={INK} strokeWidth="1" />
      <path d="M40.4 86.4H59.6L58 96H42Z" fill={u('basket')} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M41 89.6H59M41.6 92.8H58.4M45 86.4V96M50 86.4V96M55 86.4V96" stroke="#5a2e14" strokeWidth=".8" opacity=".7" />
      <rect x="39.4" y="85" width="21.2" height="2.6" rx="1.2" fill="#a86a3a" stroke={INK} strokeWidth="1" />
      {/* burner flame (flickers via CSS) */}
      <g className={styles.flame}><path d="M50 74C53 77.6 53.6 80.4 50 83C46.4 80.4 47 77.6 50 74Z" fill={u('fire')} /></g>
      {/* envelope */}
      <path d={GOREME_BALLOON_ENVELOPE} fill={u('env')} />
      <g clipPath={u('clip')}>
        {/* crown */}
        <path d="M30 13C36 7 43 5 50 5C57 5 64 7 70 13Z" fill={u('band')} />
        <path d="M34 12.6L38 9.4L42 12.6L46 9.4L50 12.6L54 9.4L58 12.6L62 9.4L66 12.6" fill="none" stroke={t.motif} strokeWidth="1.6" />
        {/* zigzag band */}
        <rect x="0" y="20" width="100" height="13" fill={u('band')} />
        <path d={zig} fill="none" stroke={t.motif} strokeWidth="2.4" strokeLinejoin="miter" />
        {/* equator band with stepped eyes */}
        <rect x="0" y="37" width="100" height="16" fill={t.motif} />
        <rect x="0" y="38.4" width="100" height="1.4" fill={t.dot} opacity=".9" />
        <rect x="0" y="50.2" width="100" height="1.4" fill={t.dot} opacity=".9" />
        {[14, 32, 50, 68, 86].map((x) => (
          <g key={x}>
            <path d={grSteppedDiamond(x, 45, 6.4, 2)} fill={u('band')} />
            <path d={grDiamond(x, 45, 2.6)} fill={t.base[2]} />
          </g>
        ))}
        {[23, 41, 59, 77].map((x) => <path key={x} d={grDiamond(x, 45, 1.8)} fill={t.dot} />)}
        {/* teeth band */}
        <path d={teeth} fill={u('band')} />
        <rect x="0" y="66" width="100" height="3" fill={u('band')} opacity=".85" />
        {/* gores, sphere shading and shine */}
        <path d={gores} fill="none" stroke="#1a0610" strokeWidth="1" opacity=".35" />
        <rect x="0" y="0" width="100" height="82" fill={u('rim')} />
        <ellipse cx="34" cy="24" rx="20" ry="16" fill={u('shine')} />
      </g>
      <path d={GOREME_BALLOON_ENVELOPE} fill="none" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M39 79.4H61L58.6 82H41.4Z" fill={t.base[2]} stroke={INK} strokeWidth="1.2" />
      {tier === 3 && <path d="M50 0L52 4.4L50 3.6L48 4.4Z M44 1.6L45.4 4.6M56 1.6L54.6 4.6" fill="#fff8d0" stroke="#fff8d0" strokeWidth="1" />}
    </>
  );
}

/* ---------- scatter · Şafak Güneşi ---------- */
function Sun({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const S = P.saffron;
  const rays: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const long = i % 2 === 0;
    const r0 = 30, r1 = long ? 47 : 40, w = long ? 0.13 : 0.1;
    const p = (r: number, da: number) => `${n1(50 + Math.cos(a + da) * r)} ${n1(50 + Math.sin(a + da) * r)}`;
    // stepped (kilim) ray: wide base, a notch, a point
    rays.push(long ? `M${p(r0, -w)}L${p(r0 + 8, -w * 0.8)}L${p(r0 + 8, -w * 0.5)}L${p(r1, 0)}L${p(r0 + 8, w * 0.5)}L${p(r0 + 8, w * 0.8)}L${p(r0, w)}Z` : `M${p(r0, -w)}L${p(r1, 0)}L${p(r0, w)}Z`);
  }
  let ring = '';
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ring += grDiamond(50 + Math.cos(a) * 21.4, 50 + Math.sin(a) * 21.4, 2.2); }
  return (
    <>
      <defs>
        {aura(k, '#ffcf6a', 0.7)}
        <LG id={k('ray')} x1={0} y1={0} x2={1} y2={1} s={[[0, S.hi], [0.45, S.light], [1, S.deep]]} />
        <RG id={k('disc')} cx={0.42} cy={0.36} r={0.7} s={[[0, '#fffdf0'], [0.35, S.hi], [0.7, S.light], [1, '#f08a2a']]} />
        <LG id={k('dawn')} s={[[0, '#ffb38a'], [0.55, '#e7869a'], [1, '#8a5aa8']]} />
        <LG id={k('ridge')} s={[[0, '#6a4a8e'], [1, '#2c2357']]} />
        <clipPath id={k('dclip')}><circle cx="50" cy="50" r="27" /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="50" fill={u('aura')} />
      <g className={styles.sunRays}>
        {rays.map((d, i) => <path key={i} d={d} fill={u('ray')} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />)}
      </g>
      <circle cx="50" cy="50" r="29.6" fill={S.deep} stroke={INK} strokeWidth="2" />
      <g clipPath={`url(#${k('dclip')})`}>
        <rect x="20" y="20" width="60" height="60" fill={u('dawn')} />
        <circle cx="50" cy="58" r="20" fill={u('disc')} />
        <path d={ring} fill="#fff6d6" opacity=".55" />
        {/* horizon ridge with fairy chimneys */}
        <path d="M20 80V66L26 64L28 58C29 56 31 56 32 58L34 64L40 66L44 60C45 58 47 58 48 60L50 66L56 67L60 56C61 53.6 63 53.6 64 56L67 66L74 64L80 66V80Z" fill={u('ridge')} />
        <path d="M27 58.4C27 56.6 29 55.4 30 55.4C31 55.4 33 56.6 33 58.4ZM58.6 56C58.6 53.4 61 52 62 52C63 52 65.4 53.4 65.4 56ZM43 60.4C43 58.6 45 57.6 46 57.6C47 57.6 49 58.6 49 60.4Z" fill="#1c1640" />
        {/* tiny balloons rising */}
        <path d="M36 38C38 38 39.4 39.4 39.4 41.2C39.4 43 37.6 44 37 44.6H35C34.4 44 32.6 43 32.6 41.2C32.6 39.4 34 38 36 38Z" fill={P.madder.base} stroke={INK} strokeWidth=".6" />
        <path d="M67 32C68.4 32 69.4 33 69.4 34.2C69.4 35.4 68.2 36.2 67.8 36.6H66.2C65.8 36.2 64.6 35.4 64.6 34.2C64.6 33 65.6 32 67 32Z" fill={P.turq.base} stroke={INK} strokeWidth=".5" />
      </g>
      <circle cx="50" cy="50" r="27" fill="none" stroke="#fff6d6" strokeWidth="1.4" opacity=".8" />
      <path d="M30 40Q34 28 46 24" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".6" />
    </>
  );
}

/* ---------- registry and shells ---------- */
const ART: Record<Exclude<GoremeSymbolId, 'balloon'>, (props: { k: K }) => ReactNode> = {
  h1: PeriBacasi, h2: Guvercinlik, h3: Comlek, h4: KilimAti, l1: L1, l2: L2, l3: L3, l4: L4, l5: L5, sun: Sun,
};
/** Optical size per symbol (lows read a touch smaller than highs). */
const SCALE: Partial<Record<GoremeSymbolId, number>> = { l1: 0.84, l2: 0.84, l3: 0.86, l4: 0.86, l5: 0.84, balloon: 0.98 };

function Shell({ k, children, px, className, scale = 1 }: { k: K; children: ReactNode; px?: number | string; className?: string; scale?: number }) {
  const dim = px === undefined ? '100%' : typeof px === 'number' ? `${px}px` : px;
  return (
    <svg viewBox="0 0 100 100" width={dim} height={dim} className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={k('shadow')} x="-15%" y="-15%" width="130%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.4" stdDeviation="1.6" floodColor="#1a0612" floodOpacity=".55" />
        </filter>
      </defs>
      <g filter={`url(#${k('shadow')})`}>{scale === 1 ? children : <g transform={`translate(50 50) scale(${scale}) translate(-50 -50)`}>{children}</g>}</g>
    </svg>
  );
}

/** Bare symbol art (paytable, info pages, sprites). `tier` applies to the balloon only. */
export function GoremeSymbolArt({ symbol, tier = 0, px, className }: { symbol: GoremeSymbolId; tier?: GoremeBalloonTier; px?: number | string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k: K = (n) => `grs${uid}${n}`;
  if (symbol === 'balloon') return <Shell k={k} px={px} className={className} scale={SCALE.balloon}><Balloon k={k} tier={tier} /></Shell>;
  const Art = ART[symbol];
  return <Shell k={k} px={px} className={className} scale={SCALE[symbol]}><Art k={k} /></Shell>;
}

const spriteId = (symbol: GoremeSymbolId, tier: GoremeBalloonTier) => (symbol === 'balloon' ? `grs-balloon-${tier}` : `grs-${symbol}`);
/** Every symbol (and the four balloon colourways) drawn once into a hidden SVG. Mount once per page before sprite symbols. */
export const GoremeSymbolSprites = memo(function GoremeSymbolSprites() {
  const all: Array<[GoremeSymbolId, GoremeBalloonTier]> = [...GOREME_SYMBOLS.filter((s) => s !== 'balloon').map((s) => [s, 0] as [GoremeSymbolId, GoremeBalloonTier]), ['balloon', 0], ['balloon', 1], ['balloon', 2], ['balloon', 3]];
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        {all.map(([s, t]) => <symbol key={spriteId(s, t)} id={spriteId(s, t)} viewBox="0 0 100 100" overflow="visible"><GoremeSymbolArt symbol={s} tier={t} px={100} /></symbol>)}
      </defs>
    </svg>
  );
});

export interface GoremeSymbolProps {
  symbol: GoremeSymbolId;
  state?: GoremeSymbolState;
  /** Balloon multiplier (×1…×25): badge + envelope colourway. Ignored for other symbols. */
  multiplier?: number;
  /** Visual scale relative to the cell (merged balloons: goremeMergedSize(n)). Default 1. */
  size?: number;
  /** Use the sprite sheet (<GoremeSymbolSprites/> must be mounted). */
  sprite?: boolean;
  className?: string;
  style?: CSSProperties;
  /** aria-label; defaults to the Turkish symbol name. Pass null to hide from assistive tech. */
  label?: string | null;
}
const tierBadge = ['t0', 't1', 't2', 't3'] as const;

/** A board cell symbol with states. Fills its parent. */
export const GoremeSymbol = memo(function GoremeSymbol({ symbol, state = 'idle', multiplier, size = 1, sprite = false, className, style, label }: GoremeSymbolProps) {
  const isBalloon = symbol === 'balloon';
  const mult = isBalloon ? Math.max(1, Math.min(25, Math.round(multiplier ?? 1))) : undefined;
  const tier = goremeBalloonTier(mult);
  const name = label === undefined ? `${GOREME_SYMBOL_LABELS[symbol]}${mult ? ` ×${mult}` : ''}` : label;
  return (
    <div
      className={`${styles.sym} ${className ?? ''}`}
      data-symbol={symbol}
      data-state={state}
      data-merged={size > 1.01 ? '' : undefined}
      style={{ ...style, ['--gs-scale' as string]: String(size), ['--gs-glow' as string]: GOREME_SYMBOL_GLOW[symbol] }}
      role={name ? 'img' : undefined}
      aria-label={name ?? undefined}
      aria-hidden={name ? undefined : true}
    >
      <div className={styles.scaler}>
        <div className={styles.halo} aria-hidden="true" />
        <div className={styles.body}>
          {sprite
            ? <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}><use href={`#${spriteId(symbol, tier)}`} /></svg>
            : <GoremeSymbolArt symbol={symbol} tier={tier} />}
        </div>
        {isBalloon && <span className={styles.badge} data-tier={tierBadge[tier]} aria-hidden="true"><small>×</small>{mult}</span>}
      </div>
    </div>
  );
});
