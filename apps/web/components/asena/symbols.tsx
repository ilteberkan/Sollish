import { memo, useId } from 'react';
import type { ReactNode } from 'react';
import type { AsenaSymbol } from '@sollish/protocol';

/* Asena: Yıldız Kurdu symbol art. Hand-authored, original SVG (viewBox 100 × 100), Turkic sky mythology:
     highs  h1 Asena (front wolf head, silver-blue, forehead star) · h2 Kün Ana (gold sun disc with a serene face and
            flame rays) · h3 Gök Kartal (spread-wing eagle, bronze and turquoise) · h4 Doru At (bay horse head in
            profile with a wind-blown gold mane and bronze bridle)
     lows   l1 Firuze Yıldız (four-point turquoise star gem) · l2 Al Yakut (ruby hexagon) · l3 Zümrüt Ok (emerald
            arrowhead) · l4 Ametist Damga (violet pebble with a carved, invented mark)
     wilds  wolf: Gök Kurt, a howling wolf head of light (profile, star-jointed mane) inside a gold notched ring ·
            trail: Yıldız İzi, a paw print made of stars on a cyan stardust glow
     scatter moon: Ay Ata, a silver full-moon face with a long beard of light inside a halo ring (no star-and-crescent
            pairing, deliberately unlike any flag)
   Every silhouette is different (head / spiked disc / wide wings / profile / star / hexagon / arrowhead / round /
   ring / paw / haloed disc) and the lows differ in hue AND lightness, so they read in grayscale and at 48 px.
   Shared rules: key light from the upper left, a hairline ink edge, one cheap feDropShadow per symbol, no blur
   or turbulence filters. Boards draw through <AsenaSymbolSprites/> + <AsenaSymbolUse/> (two DOM nodes per cell). */

export type { AsenaSymbol };

export const ASENA_SYMBOL_LABELS: Record<AsenaSymbol, string> = {
  h1: 'Asena',
  h2: 'Kün Ana',
  h3: 'Gök Kartal',
  h4: 'Doru At',
  l1: 'Firuze Yıldız',
  l2: 'Al Yakut',
  l3: 'Zümrüt Ok',
  l4: 'Ametist Damga',
  wolf: 'Gök Kurt (yürüyen joker)',
  trail: 'Yıldız İzi (joker)',
  moon: 'Ay Ata (dağılım)',
};

/** Palette shared by the board, frame, scene, logo and FX. */
export const AS_PALETTE = {
  silver: { hi: '#ffffff', light: '#dfe8ff', base: '#9db0de', deep: '#4c5c94', dark: '#1a2252' },
  gold: { hi: '#fff7d6', light: '#ffd970', base: '#f2a42a', deep: '#b0560e', dark: '#4e1e04' },
  bronze: { hi: '#ffe4ae', light: '#e2aa5c', base: '#a8692a', deep: '#6a3a12', dark: '#2a1406' },
  turq: { hi: '#d8fff6', light: '#6ff0dc', base: '#1fb8b0', deep: '#0a6a72', dark: '#033034' },
  ruby: { hi: '#ffd6d6', light: '#ff6a70', base: '#d01e3a', deep: '#7a0a22', dark: '#320410' },
  emerald: { hi: '#e2ffd8', light: '#7cf08a', base: '#22b04a', deep: '#0c6028', dark: '#04280f' },
  violet: { hi: '#f0e2ff', light: '#c39cff', base: '#8650dc', deep: '#4a2296', dark: '#1c0a46' },
  moon: { hi: '#ffffff', light: '#f3f1e6', base: '#c9cbe4', deep: '#7c7eac', dark: '#2e305a' },
  night: { hi: '#3c4ca0', light: '#212c70', base: '#121846', deep: '#080c28', dark: '#03050f' },
  felt: { hi: '#e0705a', light: '#b8402f', base: '#86211f', deep: '#4a0c10', dark: '#220406' },
  aurora: { green: '#6dffb4', teal: '#3fe6ff', violet: '#a982ff', pink: '#ff7ad8' },
  ink: '#070a1c',
} as const;
const P = AS_PALETTE;

/** Glow colour per symbol (win highlight, burst stars). */
export const ASENA_SYMBOL_GLOW: Record<AsenaSymbol, string> = {
  h1: '#bcd2ff', h2: '#ffd36a', h3: '#6ff0dc', h4: '#ff9a6a',
  l1: '#6ff0dc', l2: '#ff6a80', l3: '#7cf08a', l4: '#c39cff',
  wolf: '#ffe7a0', trail: '#9ff4ff', moon: '#e8e8ff',
};

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
/** Four-point sparkle star. */
export const asSparkle = (cx: number, cy: number, r: number, pinch = 0.18) => {
  const k = r * pinch;
  return `M${n1(cx)} ${n1(cy - r)}Q${n1(cx + k)} ${n1(cy - k)} ${n1(cx + r)} ${n1(cy)}Q${n1(cx + k)} ${n1(cy + k)} ${n1(cx)} ${n1(cy + r)}Q${n1(cx - k)} ${n1(cy + k)} ${n1(cx - r)} ${n1(cy)}Q${n1(cx - k)} ${n1(cy - k)} ${n1(cx)} ${n1(cy - r)}Z`;
};
const polyStar = (cx: number, cy: number, n: number, r1: number, r0: number, rot = 0) => {
  let d = '';
  for (let i = 0; i < n * 2; i++) { const a = ((rot + (i * 180) / n) * Math.PI) / 180, r = i % 2 ? r0 : r1; d += `${i ? 'L' : 'M'}${n1(cx + Math.sin(a) * r)} ${n1(cy - Math.cos(a) * r)}`; }
  return `${d}Z`;
};
const aura = (k: K, color: string, o = 0.5) => <RG id={k('aura')} s={[[0.3, color, o], [0.68, color, o * 0.3], [1, color, 0]]} />;
const INK = P.ink;

/* ---------- h1 · Asena (front wolf head) ---------- */
export const AS_WOLF_HEAD = 'M50 27C46 27 42.4 28 39.4 30L24 5C20 14 17.2 24 16.4 35C12.4 40 9.4 46 7 53L14 54C10.6 59 8.6 64 8.4 69L17.4 67.4C20.6 75 27 81 35 85.4C40 90 45 95 50 96C55 95 60 90 65 85.4C73 81 79.4 75 82.6 67.4L91.6 69C91.4 64 89.4 59 86 54L93 53C90.6 46 87.6 40 83.6 35C82.8 24 80 14 76 5L60.6 30C57.6 28 54 27 50 27Z';
function Asena({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        {aura(k, '#7fa0ff', 0.55)}
        <RG id={k('fur')} cx={0.4} cy={0.32} r={0.75} s={[[0, P.silver.hi], [0.25, P.silver.light], [0.6, P.silver.base], [1, P.silver.deep]]} />
        <LG id={k('mask')} s={[[0, '#ffffff'], [1, '#c8d6f6']]} />
        <LG id={k('ear')} s={[[0, '#6a4aa8'], [1, '#141a46']]} />
        <RG id={k('eye')} s={[[0, '#fffbe0'], [0.45, '#ffd25a'], [1, '#d07a10']]} />
      </defs>
      <circle cx="50" cy="54" r="48" fill={u('aura')} />
      <path d={AS_WOLF_HEAD} fill={u('fur')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M25 12L36.4 31C31 33 26 36.4 21.4 40.4C21 30 22.2 19.6 25 12ZM75 12L63.6 31C69 33 74 36.4 78.6 40.4C79 30 77.8 19.6 75 12Z" fill={u('ear')} />
      {/* darker saddle over the brow */}
      <path d="M39.4 30C43 34 46.6 36 50 36C53.4 36 57 34 60.6 30C57.6 28 54 27 50 27C46 27 42.4 28 39.4 30Z" fill={P.silver.deep} opacity=".55" />
      <path d="M50 33C45.4 40 41.6 50 39.6 60C35.4 64 30.4 66 25 66C31 74 39 79 43 86C46 90 48 92 50 92C52 92 54 90 57 86C61 79 69 74 75 66C69.6 66 64.6 64 60.4 60C58.4 50 54.6 40 50 33Z" fill={u('mask')} />
      {/* fur tufts */}
      <path d="M14 54L20 52M17.4 67.4L23 63.4M86 54L80 52M82.6 67.4L77 63.4M30 40L35 44M70 40L65 44" stroke={P.silver.deep} strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
      {/* eyes: slanted almonds, gold, dark rims */}
      <path d="M28.4 50.6C33 46 40 46.4 44.6 52.6C40 56.6 33 57 28.4 50.6Z" fill="#0d1236" />
      <path d="M71.6 50.6C67 46 60 46.4 55.4 52.6C60 56.6 67 57 71.6 50.6Z" fill="#0d1236" />
      <path d="M31 51C34.6 48.4 39.4 48.6 42.4 52.2C39.4 54.6 34.6 54.6 31 51Z" fill={u('eye')} />
      <path d="M69 51C65.4 48.4 60.6 48.6 57.6 52.2C60.6 54.6 65.4 54.6 69 51Z" fill={u('eye')} />
      <path d="M37 49.4V54.2M63 49.4V54.2" stroke="#1a0c02" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M27 46.4Q35 42 43 46M73 46.4Q65 42 57 46" fill="none" stroke={P.silver.dark} strokeWidth="2" strokeLinecap="round" />
      {/* nose and mouth */}
      <path d="M43.4 79.6C45.6 76.6 54.4 76.6 56.6 79.6C55.6 84 52.4 86.4 50 86.4C47.6 86.4 44.4 84 43.4 79.6Z" fill="#0b0f26" />
      <path d="M46 78.8Q50 77.6 53 79" stroke="#8a9ad0" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M50 86.4V90M45.4 90.6Q50 93.4 54.6 90.6" fill="none" stroke="#3a467a" strokeWidth="1.5" strokeLinecap="round" />
      {/* forehead star: the sky wolf's mark, with two companion stars */}
      <path d="M50 40.6L44 45.4M50 40.6L56 45.4" stroke={P.gold.light} strokeWidth=".9" opacity=".8" />
      <path d={asSparkle(50, 40.6, 7.4, 0.2)} fill={P.gold.light} stroke={P.gold.deep} strokeWidth=".8" />
      <circle cx="44" cy="45.4" r="1.5" fill={P.gold.hi} /><circle cx="56" cy="45.4" r="1.5" fill={P.gold.hi} />
      <path d="M22 22Q20 30 20.6 36" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".55" fill="none" />
    </>
  );
}

/* ---------- h2 · Kün Ana (sun mother) ---------- */
function KunAna({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const rays: string[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const p = (r: number, da: number) => `${n1(50 + Math.cos(a + da) * r)} ${n1(50 + Math.sin(a + da) * r)}`;
    if (i % 2 === 0) rays.push(`M${p(26, -0.2)}Q${p(40, -0.2)} ${p(48.5, 0.06)}Q${p(39, 0.12)} ${p(26, 0.2)}Z`);
    else rays.push(`M${p(26, -0.14)}L${p(41, 0)}L${p(26, 0.14)}Z`);
  }
  return (
    <>
      <defs>
        {aura(k, '#ffb43a', 0.6)}
        <LG id={k('ray')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.gold.hi], [0.4, P.gold.light], [1, P.gold.deep]]} />
        <RG id={k('disc')} cx={0.42} cy={0.36} r={0.7} s={[[0, '#fffbe6'], [0.3, P.gold.light], [0.75, P.gold.base], [1, P.gold.deep]]} />
      </defs>
      <circle cx="50" cy="50" r="49" fill={u('aura')} />
      <path d={rays.join('')} fill={u('ray')} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="50" cy="50" r="28" fill={u('disc')} stroke={INK} strokeWidth="2.2" />
      <circle cx="50" cy="50" r="24" fill="none" stroke={P.gold.deep} strokeWidth="1.4" strokeDasharray="1.6 3.1" />
      {/* serene face */}
      <path d="M37.4 46.4Q41.6 50.4 45.6 46.4M54.4 46.4Q58.4 50.4 62.6 46.4" fill="none" stroke="#6a2a04" strokeWidth="2" strokeLinecap="round" />
      <path d="M36.4 42Q41 38.6 46 41M54 41Q59 38.6 63.6 42" fill="none" stroke="#8a3a08" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M50 46V56.6Q48.4 57.6 47 57" fill="none" stroke="#8a3a08" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M44 62.4Q50 66.6 56 62.4" fill="none" stroke="#7a2a04" strokeWidth="2" strokeLinecap="round" />
      <circle cx="38.6" cy="56" r="3" fill="#ff7a3a" opacity=".55" /><circle cx="61.4" cy="56" r="3" fill="#ff7a3a" opacity=".55" />
      <path d={polyStar(50, 31.6, 4, 3.6, 1.4)} fill="#fff" opacity=".9" />
      <path d="M33 38Q36 29 45 26" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".7" />
    </>
  );
}

/* ---------- h3 · Gök Kartal (sky eagle) ---------- */
const EAGLE_WING_L = 'M44 40C34 30 20 20 5 11C7 17.4 9.6 21.4 12.6 24.6L7.4 26.6C11.4 30.6 14.6 32.6 18.6 34.6L12.6 37.6C17.6 41.6 22.6 43.6 27.6 44.6L22.6 48.6C28.6 51.6 34.6 52.6 41 53.6Z';
const EAGLE_WING_R = 'M56 40C66 30 80 20 95 11C93 17.4 90.4 21.4 87.4 24.6L92.6 26.6C88.6 30.6 85.4 32.6 81.4 34.6L87.4 37.6C82.4 41.6 77.4 43.6 72.4 44.6L77.4 48.6C71.4 51.6 65.4 52.6 59 53.6Z';
function Kartal({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        {aura(k, '#3fe6d0', 0.5)}
        <LG id={k('wing')} x1={0} y1={0} x2={0.4} y2={1} s={[[0, P.bronze.hi], [0.35, P.bronze.light], [0.75, P.bronze.base], [1, P.bronze.deep]]} />
        <LG id={k('cov')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.turq.hi], [0.4, P.turq.light], [1, P.turq.deep]]} />
        <LG id={k('body')} s={[[0, P.bronze.light], [0.6, P.bronze.base], [1, P.bronze.deep]]} />
        <RG id={k('head')} cx={0.4} cy={0.35} r={0.7} s={[[0, '#ffffff'], [0.5, P.silver.light], [1, P.silver.base]]} />
      </defs>
      <circle cx="50" cy="50" r="48" fill={u('aura')} />
      <path d={EAGLE_WING_L} fill={u('wing')} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d={EAGLE_WING_R} fill={u('wing')} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M44 41C36 34 26 27 15.4 20.4C19 28 27 36.4 42 47Z" fill={u('cov')} stroke={INK} strokeWidth="1" />
      <path d="M56 41C64 34 74 27 84.6 20.4C81 28 73 36.4 58 47Z" fill={u('cov')} stroke={INK} strokeWidth="1" />
      <path d="M17 31L30 37M24 40L35 44M83 31L70 37M76 40L65 44" stroke={P.bronze.deep} strokeWidth="1.4" strokeLinecap="round" />
      {/* tail fan */}
      <path d="M44 70L38 90L44 88L47 95L50 89L53 95L56 88L62 90L56 70Z" fill={u('wing')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      {/* body */}
      <path d="M50 30C57 32 60.6 42 60.6 54C60.6 64 56.6 72 50 74.6C43.4 72 39.4 64 39.4 54C39.4 42 43 32 50 30Z" fill={u('body')} stroke={INK} strokeWidth="2" />
      <path d="M44.6 48L50 52L55.4 48M44 55L50 59L56 55M45 62L50 66L55 62" fill="none" stroke={P.bronze.hi} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity=".85" />
      <path d="M46 74L44 80M54 74L56 80" stroke={P.gold.base} strokeWidth="2.4" strokeLinecap="round" />
      {/* head in profile, beak to the left */}
      <path d="M50 15C56 15 60.4 20 59.6 26.4C58.8 32 54.6 35 50 35C46 35 43 32.4 42 29.4L35 31C36 27 38.4 24.6 42.4 22.6C43.4 18.4 46.4 15 50 15Z" fill={u('head')} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M42.4 22.6L33.4 31.4L42 29.6Z" fill={P.gold.light} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="47.4" cy="23.6" r="2.4" fill={P.gold.base} stroke={INK} strokeWidth="1" />
      <circle cx="47" cy="23.2" r=".8" fill="#fff" />
      <path d="M12 16Q22 20 32 27" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".5" fill="none" />
    </>
  );
}

/* ---------- h4 · Doru At (bay horse) ---------- */
function DoruAt({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        {aura(k, '#ff7a4a', 0.48)}
        <RG id={k('coat')} cx={0.35} cy={0.3} r={0.85} s={[[0, '#ffb07a'], [0.3, '#e0703a'], [0.7, '#a2341a'], [1, '#4a1008']]} />
        <LG id={k('mane')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.gold.hi], [0.45, P.gold.light], [1, P.gold.deep]]} />
      </defs>
      <circle cx="50" cy="52" r="48" fill={u('aura')} />
      {/* mane streaming in the wind behind the crest */}
      <path d="M63 13C78 12 90 22 93 36C97 50 98 70 95 92C91 84 87 78 82 74C88 66 87 56 82 51C85 43 79 35 72 31C75 24 70 17 63 13Z" fill={u('mane')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M90 30Q99 30 99 22Q95 26 88 25ZM94 50Q100 46 99.4 38Q96 44 92 44ZM95 70Q100 64 99 56Q96 62 93 63Z" fill={u('mane')} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      {/* head and neck */}
      <path d="M57 22L59 5L66.4 17C72.4 21.4 78 30 82 42C86 56 89.4 74 91.4 96H57.4C55.4 84 51.4 74 45.4 66.6C39.4 68.6 31.4 70.6 23.6 72C17.6 72 11.6 68 11.6 62C11.6 56 15.6 50 21.6 44C29.6 36 39.6 28 51.6 23Z" fill={u('coat')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M59 5L57 22L62.4 19Z" fill="#4a1008" />
      <path d="M68 20C70 34 72 52 74 64C76 76 78 86 78 96" fill="none" stroke="#5a1408" strokeWidth="2" opacity=".55" />
      {/* blaze */}
      <path d="M44 30C38 36 28 46 20 54C24 52 30 48 36 42C40 38 43 34 44 30Z" fill="#fff4e6" opacity=".85" />
      {/* bridle */}
      <path d="M21 50C25 56 28.6 62 30.6 69M30 67C37.6 55 45.6 41 55.4 25.6M41 30.4C46 33 50 36 54 40" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <path d="M21 50C25 56 28.6 62 30.6 69M30 67C37.6 55 45.6 41 55.4 25.6M41 30.4C46 33 50 36 54 40" fill="none" stroke={P.bronze.light} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="42.6" cy="46" r="4.4" fill={P.bronze.base} stroke={INK} strokeWidth="1.4" />
      <circle cx="42.6" cy="46" r="2" fill={P.turq.light} />
      {/* eye, nostril, mouth */}
      <path d="M44.6 31.4C47.4 29 51.4 29.6 53 32.6C50.4 34.6 47 34.4 44.6 31.4Z" fill="#160402" />
      <circle cx="49.6" cy="31.4" r=".9" fill="#fff" />
      <path d="M16 59.4C17.6 57.4 20.6 57.6 21.4 60C19.4 61.6 17.4 61.4 16 59.4Z" fill="#160402" />
      <path d="M13.6 66Q18 68.4 23 67.6" fill="none" stroke="#2a0804" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M30 36Q38 30 48 26" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".5" fill="none" />
    </>
  );
}

/* ---------- lows: four star gems / rune stones ---------- */
function Firuze({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const T = P.turq;
  return (
    <>
      <defs>{aura(k, T.light, 0.45)}<LG id={k('g')} x1={0} y1={0} x2={1} y2={1} s={[[0, T.hi], [0.4, T.light], [1, T.deep]]} /></defs>
      <circle cx="50" cy="50" r="46" fill={u('aura')} />
      <path d="M50 4L62.4 37.6L96 50L62.4 62.4L50 96L37.6 62.4L4 50L37.6 37.6Z" fill={u('g')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      {/* facets: light on the upper-left halves, dark on the lower-right */}
      <path d="M50 4L37.6 37.6L50 50ZM4 50L37.6 37.6L50 50Z" fill="#fff" opacity=".42" />
      <path d="M50 96L62.4 62.4L50 50ZM96 50L62.4 62.4L50 50Z" fill={T.dark} opacity=".5" />
      <path d="M50 4L62.4 37.6L50 50ZM4 50L37.6 62.4L50 50Z" fill={T.hi} opacity=".12" />
      <path d="M50 18L56 44L82 50L56 56L50 82L44 56L18 50L44 44Z" fill="none" stroke={T.hi} strokeWidth="1.2" opacity=".6" />
      <path d={asSparkle(41, 38, 6)} fill="#fff" />
    </>
  );
}
function Yakut({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const R = P.ruby;
  const hex = (r: number) => Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; return [n1(50 + Math.cos(a) * r), n1(52 + Math.sin(a) * r)] as const; });
  const o = hex(43), t = hex(23);
  const facet = (i: number) => `M${o[i]![0]} ${o[i]![1]}L${o[(i + 1) % 6]![0]} ${o[(i + 1) % 6]![1]}L${t[(i + 1) % 6]![0]} ${t[(i + 1) % 6]![1]}L${t[i]![0]} ${t[i]![1]}Z`;
  const tone = ['#ffffff', R.light, R.deep, R.dark, R.deep, '#ffffff'];
  const op = [0.38, 0.35, 0.5, 0.6, 0.35, 0.22];
  return (
    <>
      <defs>{aura(k, R.light, 0.42)}<LG id={k('g')} x1={0} y1={0} x2={1} y2={1} s={[[0, R.hi], [0.3, R.light], [0.7, R.base], [1, R.deep]]} /><RG id={k('t')} cx={0.38} cy={0.32} r={0.75} s={[[0, '#ffe8ea'], [0.4, R.light], [1, R.base]]} /></defs>
      <circle cx="50" cy="52" r="46" fill={u('aura')} />
      <path d={`M${o.map(([x, y]) => `${x} ${y}`).join('L')}Z`} fill={u('g')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      {o.map((_, i) => <path key={i} d={facet(i)} fill={tone[i]} opacity={op[i]} />)}
      <path d={`M${t.map(([x, y]) => `${x} ${y}`).join('L')}Z`} fill={u('t')} stroke={R.deep} strokeWidth="1.2" />
      <path d={asSparkle(41, 40, 6.4)} fill="#fff" />
    </>
  );
}
function Zumrut({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const E = P.emerald;
  return (
    <>
      <defs>{aura(k, E.light, 0.42)}<LG id={k('g')} x1={0} y1={0} x2={1} y2={1} s={[[0, E.hi], [0.35, E.light], [0.75, E.base], [1, E.deep]]} /></defs>
      <circle cx="50" cy="54" r="46" fill={u('aura')} />
      <path d="M50 5L93 87L50 73L7 87Z" fill={u('g')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M50 5L7 87L50 73Z" fill="#fff" opacity=".3" />
      <path d="M50 5L93 87L50 73Z" fill={E.dark} opacity=".42" />
      <path d="M50 22L50 66M50 66L24 76M50 66L76 76" stroke={E.hi} strokeWidth="1.2" opacity=".55" fill="none" />
      <path d="M50 14L32 50M50 14L68 50" stroke={E.deep} strokeWidth="1.1" opacity=".5" />
      <path d={asSparkle(40, 42, 6)} fill="#fff" />
    </>
  );
}
/** Carved mark (invented): a rhombus eye with a pupil stroke, flanked by two horn hooks, and a base notch. */
const RAM = 'M30 50L50 34L70 50L50 66ZM50 44V56M25 41C18 46 18 54 25 59M75 41C82 46 82 54 75 59M42 76H58';
function Ametist({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const V = P.violet;
  return (
    <>
      <defs>{aura(k, V.light, 0.4)}<RG id={k('g')} cx={0.38} cy={0.32} r={0.78} s={[[0, V.hi], [0.25, V.light], [0.65, V.base], [1, V.dark]]} /></defs>
      <circle cx="50" cy="52" r="47" fill={u('aura')} />
      <path d="M50 8C72 8 90 24 91 47C92 72 74 92 50 92C27 92 9 74 9 51C9 27 28 8 50 8Z" fill={u('g')} stroke={INK} strokeWidth="2.2" />
      {/* carved mark (invented, decorative): ring, staff, chevron and two notches */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={RAM} stroke="#ffffff" strokeWidth="5.4" opacity=".28" transform="translate(0 1.6)" />
        <path d={RAM} stroke={V.dark} strokeWidth="4.6" />
      </g>
      {[[26, 30, 1.4], [72, 70, 1.2], [70, 26, 1], [30, 76, 1.1]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={V.hi} opacity=".7" />)}
      <path d="M22 36Q28 18 46 14" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".55" />
    </>
  );
}

/* ---------- wild · Gök Kurt (walking wolf) ---------- */
export const AS_WOLF_HOWL = 'M27 90C26 72 30 57 39 46L34 23L48 35C55 30 61 26 67 20L83 8L88 12C84 18 79 23 74 27L81 28C74 37 68 45 65 53C63 63 66 76 72 90Z';
function WolfWild({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const notches = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2, r0 = i % 3 === 0 ? 40.4 : 42.4, r1 = 46.4;
    return `M${n1(50 + Math.cos(a) * r0)} ${n1(50 + Math.sin(a) * r0)}L${n1(50 + Math.cos(a) * r1)} ${n1(50 + Math.sin(a) * r1)}`;
  }).join('');
  const joints: Array<[number, number]> = [[34, 84], [36, 66], [42, 48], [56, 36], [80, 12], [66, 60], [64, 82]];
  return (
    <>
      <defs>
        {aura(k, '#ffd36a', 0.65)}
        <RG id={k('disc')} cx={0.5} cy={0.42} r={0.6} s={[[0, '#2a3a8e'], [0.6, P.night.base], [1, P.night.dark]]} />
        <LG id={k('ring')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.gold.hi], [0.35, P.gold.light], [0.7, P.gold.base], [1, P.gold.deep]]} />
        <RG id={k('body')} cx={0.65} cy={0.3} r={0.8} s={[[0, '#ffffff'], [0.45, '#fff2c4'], [1, '#f2b84a']]} />
        <clipPath id={k('clip')}><circle cx="50" cy="50" r="44" /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="50" fill={u('aura')} />
      <circle cx="50" cy="50" r="44.4" fill={u('disc')} />
      {[[22, 24], [34, 16], [78, 18], [84, 64], [16, 40], [62, 86], [40, 88]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 2 ? 0.9 : 1.3} fill="#e8eeff" opacity=".85" />)}
      <g clipPath={`url(#${k('clip')})`}>
        <path d={AS_WOLF_HOWL} fill={u('body')} stroke={P.gold.deep} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M30 62L36 60L31 70L38 68L33 78L40 77M44 46L39 52" fill="none" stroke={P.gold.deep} strokeWidth="1.2" strokeLinejoin="round" opacity=".7" />
        <path d={joints.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')} fill="none" stroke="#fff" strokeWidth=".9" opacity=".75" />
        {joints.map(([x, y], i) => <path key={i} d={asSparkle(x, y, i === 4 ? 4.4 : 3.2)} fill="#fff" />)}
        <path d="M37 29L45.4 36.4L40.4 43Z" fill="#c07a1c" opacity=".55" />
        <path d="M52 34.4L58 31.6" stroke={P.night.base} strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="85.4" cy="10.4" r="2" fill={P.night.base} />
        <path d="M74 27.4L65 33.6M68 44L60 48M64 54L57 57M46 40Q44 50 46 58" fill="none" stroke={P.gold.deep} strokeWidth="1.3" strokeLinecap="round" opacity=".8" />
      </g>
      <circle cx="50" cy="50" r="44.4" fill="none" stroke={u('ring')} strokeWidth="5.4" />
      <circle cx="50" cy="50" r="47.4" fill="none" stroke={INK} strokeWidth="1.6" />
      <circle cx="50" cy="50" r="41.6" fill="none" stroke={INK} strokeWidth="1.2" />
      <path d={notches} stroke={P.gold.deep} strokeWidth="1.5" />
      <path d="M18 26Q28 12 46 8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
    </>
  );
}

/* ---------- wild · Yıldız İzi (star trail paw print) ---------- */
function Trail({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const toes: Array<[number, number, number]> = [[29, 41, -24], [42, 28, -8], [58, 28, 8], [71, 41, 24]];
  return (
    <>
      <defs>
        <RG id={k('dust')} s={[[0, '#bff8ff', 0.65], [0.45, '#3fd0ff', 0.3], [1, '#2060ff', 0]]} />
        <RG id={k('pad')} cx={0.45} cy={0.35} r={0.7} s={[[0, '#ffffff'], [0.4, '#c8faff'], [1, '#3ab8f0']]} />
      </defs>
      <circle cx="50" cy="52" r="48" fill={u('dust')} />
      <circle cx="50" cy="52" r="36" fill="none" stroke="#9ff4ff" strokeWidth="1.2" strokeDasharray="1.4 5.4" opacity=".8" />
      <path d="M50 52C58 52 68 58 70 67C72 76 64 80 58 78C54 77 52 75.6 50 75.6C48 75.6 46 77 42 78C36 80 28 76 30 67C32 58 42 52 50 52Z" fill={u('pad')} stroke="#0a3a6a" strokeWidth="2" />
      {toes.map(([x, y, r], i) => <ellipse key={i} cx={x} cy={y} rx="7.4" ry="9.6" transform={`rotate(${r} ${x} ${y})`} fill={u('pad')} stroke="#0a3a6a" strokeWidth="2" />)}
      {toes.map(([x, y], i) => <path key={i} d={asSparkle(x, y - 1, 4)} fill="#fff" />)}
      <path d={asSparkle(50, 66, 6.4)} fill="#fff" />
      {[[16, 22, 3.4], [86, 24, 2.6], [14, 76, 2.4], [88, 80, 3.2], [50, 10, 2.6]].map(([x, y, r], i) => <path key={i} d={asSparkle(x, y, r)} fill="#dffcff" />)}
    </>
  );
}

/* ---------- scatter · Ay Ata (moon father) ---------- */
function AyAta({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const M = P.moon;
  const beads = Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; return [n1(50 + Math.cos(a) * 45), n1(50 + Math.sin(a) * 45)] as const; });
  return (
    <>
      <defs>
        {aura(k, '#c8c8ff', 0.75)}
        <RG id={k('disc')} cx={0.38} cy={0.32} r={0.75} s={[[0, M.hi], [0.35, M.light], [0.75, M.base], [1, M.deep]]} />
        <RG id={k('shade')} cx={0.95} cy={0.7} r={0.75} s={[[0, '#3a3c7a', 0.55], [0.6, '#3a3c7a', 0.18], [1, '#3a3c7a', 0]]} />
        <LG id={k('beard')} s={[[0, '#ffffff'], [1, '#cfd2f2']]} />
      </defs>
      <circle cx="50" cy="50" r="50" fill={u('aura')} />
      <circle cx="50" cy="50" r="45" fill="none" stroke="#e8e8ff" strokeWidth="1.6" opacity=".9" />
      {beads.map(([x, y], i) => <path key={i} d={asSparkle(x, y, 3.4)} fill="#ffffff" />)}
      <circle cx="50" cy="50" r="36" fill={u('disc')} stroke={INK} strokeWidth="2.2" />
      <circle cx="50" cy="50" r="36" fill={u('shade')} />
      {/* craters */}
      <circle cx="68" cy="34" r="4" fill={M.deep} opacity=".3" /><circle cx="30" cy="64" r="3" fill={M.deep} opacity=".25" /><circle cx="72" cy="58" r="2.4" fill={M.deep} opacity=".3" />
      {/* the old father's face: long brows, closed eyes, nose, flowing beard of light */}
      <path d="M33 39Q40 34 46.6 39M53.4 39Q60 34 67 39" fill="none" stroke={M.dark} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M35.4 45Q40 48.4 44.6 45M55.4 45Q60 48.4 64.6 45" fill="none" stroke={M.dark} strokeWidth="2" strokeLinecap="round" />
      <path d="M50 42V54Q47.6 56 45.6 55" fill="none" stroke={M.deep} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M36 58C40 56 45 57 50 59C55 57 60 56 64 58C64 68 58 78 50 84C42 78 36 68 36 58Z" fill={u('beard')} stroke={M.deep} strokeWidth="1.4" />
      <path d="M43 62Q44 72 50 80M50 61V80M57 62Q56 72 50 80" fill="none" stroke={M.base} strokeWidth="1.2" />
      <path d="M38.6 58Q44 62.4 50 60Q56 62.4 61.4 58" fill="none" stroke={M.deep} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M26 40Q30 24 46 18" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" opacity=".75" />
    </>
  );
}

/* ---------- registry ---------- */
const ART: Record<AsenaSymbol, (props: { k: K }) => ReactNode> = {
  h1: Asena, h2: KunAna, h3: Kartal, h4: DoruAt, l1: Firuze, l2: Yakut, l3: Zumrut, l4: Ametist, wolf: WolfWild, trail: Trail, moon: AyAta,
};
/** Optical size per symbol (lows read a touch smaller than highs). */
const SCALE: Partial<Record<AsenaSymbol, number>> = { l1: 0.86, l2: 0.84, l3: 0.84, l4: 0.82, trail: 0.96 };

function Shell({ k, children, size, className, scale = 1 }: { k: K; children: ReactNode; size?: number | string; className?: string; scale?: number }) {
  const dim = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;
  return (
    <svg viewBox="0 0 100 100" width={dim} height={dim} className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={k('shadow')} x="-15%" y="-15%" width="130%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.4" stdDeviation="1.6" floodColor="#01020a" floodOpacity=".65" />
        </filter>
      </defs>
      <g filter={`url(#${k('shadow')})`}>{scale === 1 ? children : <g transform={`translate(50 50) scale(${scale}) translate(-50 -50)`}>{children}</g>}</g>
    </svg>
  );
}
/** Full symbol art (gallery, paytable, info pages). Boards should use the sprite sheet. */
export function AsenaSymbolArt({ symbol, size, className }: { symbol: AsenaSymbol; size?: number | string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k: K = (n) => `ass${uid}${n}`;
  const Art = ART[symbol];
  return <Shell k={k} size={size} className={className} scale={SCALE[symbol]}><Art k={k} /></Shell>;
}

export const ASENA_SYMBOLS: readonly AsenaSymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'wolf', 'trail', 'moon'];
export const asenaSpriteId = (symbol: AsenaSymbol) => `ass-${symbol}`;

/** Draws every symbol once into a hidden SVG; mount once per page, before any <AsenaSymbolUse/>. */
export const AsenaSymbolSprites = memo(function AsenaSymbolSprites() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        {ASENA_SYMBOLS.map((s) => <symbol key={s} id={asenaSpriteId(s)} viewBox="0 0 100 100" overflow="visible"><AsenaSymbolArt symbol={s} size={100} /></symbol>)}
      </defs>
    </svg>
  );
});
/** Cheap board cell art: two DOM nodes referencing the sprite. */
export const AsenaSymbolUse = memo(function AsenaSymbolUse({ symbol, className }: { symbol: AsenaSymbol; className?: string }) {
  return <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}><use href={`#${asenaSpriteId(symbol)}`} /></svg>;
});
