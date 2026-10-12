import { memo, useId } from 'react';
import type { ReactNode } from 'react';
import { STORM_ORB_WEIGHTS, type StormSymbol } from '@sollish/protocol';

/* Tarhun: Fırtına Tahtı symbol art. Original Bronze Age Anatolian storm-god set, hand-authored inline SVG
   (viewBox 100x100). Lighting rule shared by every symbol: warm key light from the upper left, cold storm-blue
   rim light from the lower right. One cheap feDropShadow per symbol, no blur/turbulence filters, so a 30-cell
   board stays cheap. Boards should draw through <StormSymbolSprites/> + <StormSymbolUse/>. */

export type { StormSymbol };

export const STORM_SYMBOL_LABELS: Record<StormSymbol, string> = {
  h1: 'Altın Boğa Ritonu',
  h2: 'Şimşek Baltası',
  h3: 'Aslan Kapısı Madalyonu',
  h4: 'Güneş Kursu',
  l1: 'Lacivert Dalga Taşı',
  l2: 'Akik Kartal Taşı',
  l3: 'Kehribar Güneş Taşı',
  l4: 'Malakit Ağaç Taşı',
  l5: 'Obsidyen Şimşek Taşı',
  scatter: 'Şimşek Mührü',
  orb: 'Fırtına Taşı',
};

export function stormCellLabel(cell: { symbol: StormSymbol; multiplier?: number }) {
  return cell.symbol === 'orb' && cell.multiplier ? `${STORM_SYMBOL_LABELS.orb} ×${cell.multiplier}` : STORM_SYMBOL_LABELS[cell.symbol];
}

export type OrbTier = 'blue' | 'green' | 'violet' | 'crimson' | 'prism';
/** 2–5 blue, 6–15 green, 20–50 violet, 100–250 crimson, 500 white-gold prism. */
export function orbTier(value: number): OrbTier {
  if (value <= 5) return 'blue';
  if (value <= 15) return 'green';
  if (value <= 50) return 'violet';
  if (value <= 250) return 'crimson';
  return 'prism';
}

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
const sparkle = (cx: number, cy: number, r: number) => {
  const k = r * 0.14;
  return `M${n1(cx)} ${n1(cy - r)}Q${n1(cx + k)} ${n1(cy - k)} ${n1(cx + r)} ${n1(cy)}Q${n1(cx + k)} ${n1(cy + k)} ${n1(cx)} ${n1(cy + r)}Q${n1(cx - k)} ${n1(cy + k)} ${n1(cx - r)} ${n1(cy)}Q${n1(cx - k)} ${n1(cy - k)} ${n1(cx)} ${n1(cy - r)}Z`;
};
const smoothClosed = (pts: ReadonlyArray<readonly [number, number]>) => {
  const m = (a: readonly [number, number], b: readonly [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const start = m(pts[pts.length - 1], pts[0]);
  let d = `M${n1(start[0])} ${n1(start[1])}`;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const e = m(p, pts[(i + 1) % pts.length]);
    d += `Q${n1(p[0])} ${n1(p[1])} ${n1(e[0])} ${n1(e[1])}`;
  }
  return `${d}Z`;
};
/** Organic pebble outline: an ellipse whose radius is bent by a few low harmonics. */
const pebble = (cx: number, cy: number, rx: number, ry: number, harm: ReadonlyArray<readonly [number, number, number]>, rot = 0, n = 28) => {
  const pts: Array<readonly [number, number]> = [];
  const cr = Math.cos((rot * Math.PI) / 180);
  const sr = Math.sin((rot * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let f = 1;
    for (const [h, amp, ph] of harm) f += amp * Math.cos(h * a + ph);
    const x = Math.cos(a) * rx * f;
    const y = Math.sin(a) * ry * f;
    pts.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
  }
  return smoothClosed(pts);
};
const pts = (a: ReadonlyArray<readonly [number, number]>) => a.map(([x, y]) => `${n1(x)},${n1(y)}`).join(' ');
const SHEEN = [[0, '#fff', 0.9], [1, '#fff', 0]] as const;
const BRONZE: readonly Stop[] = [[0, '#fff1c4'], [0.22, '#f0c26a'], [0.5, '#c4802c'], [0.78, '#7c4614'], [1, '#4a260a']];
const GOLD: readonly Stop[] = [[0, '#fffbe2'], [0.25, '#ffe27a'], [0.55, '#eeab2e'], [0.8, '#a9640f'], [1, '#6a3a06']];
const INLAY_GOLD: readonly Stop[] = [[0, '#fff7cf'], [0.45, '#ffd25c'], [1, '#c07a14']];

/** Carved groove filled with metal inlay (stroke glyph). */
function Inlay({ d, w, metal, groove, hi = '#fffbe6', fill }: { d: string; w: number; metal: string; groove: string; hi?: string; fill?: boolean }) {
  const common = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <g>
      <path d={d} {...common} fill={fill ? '#fff' : 'none'} stroke="#fff" strokeWidth={w + 2.6} opacity=".16" transform="translate(.5 .9)" />
      <path d={d} {...common} fill={fill ? groove : 'none'} stroke={groove} strokeWidth={w + 2.2} />
      <path d={d} {...common} fill={fill ? metal : 'none'} stroke={metal} strokeWidth={w} />
      <path d={d} fill="none" stroke={hi} strokeWidth={Math.max(0.5, w * 0.28)} strokeLinecap="round" strokeLinejoin="round" opacity=".8" transform="translate(-.35 -.55)" />
    </g>
  );
}
/** Electric bolt: halo, coloured body and white-hot core. */
function Spark({ d, w = 1.6, color = '#6fe3ff', halo = '#2a9dff', o = 1 }: { d: string; w?: number; color?: string; halo?: string; o?: number }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={o}>
      <path d={d} stroke={halo} strokeWidth={w * 4.2} opacity=".22" />
      <path d={d} stroke={color} strokeWidth={w * 1.9} opacity=".9" />
      <path d={d} stroke="#fff" strokeWidth={w * 0.7} />
    </g>
  );
}

/* ---------- h1 · Altın Boğa Ritonu (golden bull-head rhyton) ---------- */
const BULL_HEAD = 'M33.5 32C41 27 59 27 66.5 32C71 41 70.5 52 65.5 61.5C63.2 66 63.4 70 64.6 74.5C66 84 58.5 91 50 91C41.5 91 34 84 35.4 74.5C36.6 70 36.8 66 34.5 61.5C29.5 52 29 41 33.5 32Z';
function Bull({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('aura')} cx={0.5} cy={0.48} r={0.5} s={[[0, '#ffd772', 0.55], [0.6, '#f0a52c', 0.18], [1, '#f0a52c', 0]]} />
        <RG id={k('head')} cx={0.36} cy={0.26} r={0.9} s={[[0, '#fffbe0'], [0.2, '#ffe486'], [0.5, '#f1b23a'], [0.8, '#b06b12'], [1, '#6a3a06']]} />
        <LG id={k('horn')} x1={0} y1={1} x2={0.6} y2={0} s={[[0, '#8a520f'], [0.35, '#e9a930'], [0.7, '#fff0b0'], [1, '#c98a26']]} />
        <LG id={k('cup')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#7a440c'], [0.25, '#f2bf55'], [0.5, '#fff2bf'], [0.75, '#e1a23a'], [1, '#6e3c08']]} />
        <RG id={k('muz')} cx={0.4} cy={0.3} r={0.8} s={[[0, '#fff3c4'], [0.5, '#f4c25a'], [1, '#a8640e']]} />
        <RG id={k('lapis')} cx={0.35} cy={0.3} r={0.8} s={[[0, '#9ec4ff'], [0.4, '#2f63d6'], [1, '#0c1d55']]} />
        <LG id={k('carn')} s={[[0, '#ffb08a'], [0.5, '#e0471f'], [1, '#7a1608']]} />
        <LG id={k('rim')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#7fe7ff', 0], [0.6, '#7fe7ff', 0], [1, '#9ff0ff', 0.95]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <circle cx="50" cy="52" r="49" fill={u('aura')} />
      {/* drinking vessel: a flared cup whose foot is the bull head */}
      <path d="M23 12C25.5 22 32.5 28.5 36 35H64C67.5 28.5 74.5 22 77 12Z" fill={u('cup')} stroke="#5a3006" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M26.2 19.5C36 23 64 23 73.8 19.5" fill="none" stroke="#5a3006" strokeWidth="1" opacity=".75" />
      <path d="M29.6 25.5C38 28.5 62 28.5 70.4 25.5" fill="none" stroke="#5a3006" strokeWidth="1" opacity=".75" />
      <path d="M27.5 21.5L31 25.4L34.5 22.4L38 26.2L41.5 23L45 26.8L48.5 23.4L52 26.8L55.5 23L59 26.2L62.5 22.4L66 25.4L69.5 21.8L72.5 24" fill="none" stroke="#fff3c4" strokeWidth=".9" strokeLinejoin="round" opacity=".9" />
      {[31, 40.5, 50, 59.5, 69].map((x, i) => <circle key={x} cx={x} cy={i === 0 || i === 4 ? 17.2 : 17.9} r="1.4" fill={u('lapis')} stroke="#5a3006" strokeWidth=".5" />)}
      <ellipse cx="50" cy="12" rx="27" ry="6.2" fill={u('cup')} stroke="#5a3006" strokeWidth="1.1" />
      <ellipse cx="50" cy="12.2" rx="23" ry="4.3" fill="#3a1d04" />
      <ellipse cx="50" cy="13.4" rx="18" ry="2.4" fill="#8a4f12" opacity=".75" />
      <path d="M27 14.5C29.5 22 33 27 36.5 31" fill="none" stroke="#fffbe0" strokeWidth="1.6" strokeLinecap="round" opacity=".75" />
      {/* horns */}
      <path d="M35 43C20 47 6 41 3.5 22.5C10 32 20 35.5 34.5 34Z" fill={u('horn')} stroke="#5a3006" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M65 43C80 47 94 41 96.5 22.5C90 32 80 35.5 65.5 34Z" fill={u('horn')} stroke="#5a3006" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M7 29C10 35 17 39.5 26 40" fill="none" stroke="#fff6c8" strokeWidth="1.3" strokeLinecap="round" opacity=".9" />
      <path d="M93 30.5C90 35.5 84 39 76 40" fill="none" stroke="#fff6c8" strokeWidth="1" strokeLinecap="round" opacity=".5" />
      {[[13, 38.6, 15, 34.2], [20, 41.2, 21.2, 36.4], [87, 38.6, 85, 34.2], [80, 41.2, 78.8, 36.4]].map(([a, b, c, d], i) => <path key={i} d={`M${a} ${b}L${c} ${d}`} stroke="#6a3a06" strokeWidth="1" opacity=".6" />)}
      <path d="M3.5 22.5C4.2 26.5 5.4 29.2 7 31.6L9.6 30C7.4 28 5.2 25.6 3.5 22.5Z" fill="#5a3006" opacity=".75" />
      <path d="M96.5 22.5C95.8 26.5 94.6 29.2 93 31.6L90.4 30C92.6 28 94.8 25.6 96.5 22.5Z" fill="#5a3006" opacity=".75" />
      <g transform="translate(50 60) scale(1.18 1.06) translate(-50 -60)">
      {/* ears */}
      <path d="M34 45C25 48.5 17.5 47 13.5 42C19 39.4 27 39.6 34.5 41.5Z" fill={u('head')} stroke="#5a3006" strokeWidth="1" strokeLinejoin="round" />
      <path d="M66 45C75 48.5 82.5 47 86.5 42C81 39.4 73 39.6 65.5 41.5Z" fill={u('head')} stroke="#5a3006" strokeWidth="1" strokeLinejoin="round" />
      <path d="M31 43.5C26 44.3 21 43.8 18 42.3" fill="none" stroke="#8a4f0c" strokeWidth="1.4" strokeLinecap="round" opacity=".7" />
      <path d="M69 43.5C74 44.3 79 43.8 82 42.3" fill="none" stroke="#8a4f0c" strokeWidth="1.4" strokeLinecap="round" opacity=".7" />
      {/* head */}
      <path d={BULL_HEAD} fill={u('head')} stroke="#5a3006" strokeWidth="1.2" strokeLinejoin="round" />
      {/* forelock curls */}
      {[38.5, 44.5, 50.5, 56.5, 62.5].map((x, i) => <path key={x} d={`M${x - 2.6} ${33.5 + (i % 2) * 0.6}a2.6 2.6 0 1 1 2.6 2.6a1.3 1.3 0 0 1 -1.3 -1.3`} fill="none" stroke="#8a4f0c" strokeWidth="1.05" strokeLinecap="round" opacity=".85" />)}
      {/* brow ridges */}
      <path d="M35 45.5Q41 41.5 46.5 44.5" fill="none" stroke="#8a4f0c" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M65 45.5Q59 41.5 53.5 44.5" fill="none" stroke="#8a4f0c" strokeWidth="1.6" strokeLinecap="round" />
      {/* carnelian forehead inlay */}
      <path d="M44.5 39.5H55.5L50 47.5Z" fill={u('carn')} stroke="#5a3006" strokeWidth="1" strokeLinejoin="round" />
      <path d="M46.5 40.7H52.3" stroke="#ffd8c4" strokeWidth=".9" strokeLinecap="round" opacity=".9" />
      {/* lapis eyes */}
      <path d="M33.5 50.5Q39 45 45 50Q39 54 33.5 50.5Z" fill="#fff3c4" stroke="#5a3006" strokeWidth="1" />
      <path d="M66.5 50.5Q61 45 55 50Q61 54 66.5 50.5Z" fill="#fff3c4" stroke="#5a3006" strokeWidth="1" />
      <circle cx="39.4" cy="49.8" r="2.9" fill={u('lapis')} />
      <circle cx="60.6" cy="49.8" r="2.9" fill={u('lapis')} />
      <circle cx="38.5" cy="48.9" r=".95" fill="#fff" />
      <circle cx="59.7" cy="48.9" r=".95" fill="#fff" />
      {/* nose ridge + cheek */}
      <path d="M50 49V68" stroke="#fffbe0" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
      <path d="M38 56C40 63 41 68 40.5 72" fill="none" stroke="#8a4f0c" strokeWidth="1.1" strokeLinecap="round" opacity=".5" />
      <path d="M62 56C60 63 59 68 59.5 72" fill="none" stroke="#8a4f0c" strokeWidth="1.1" strokeLinecap="round" opacity=".5" />
      {/* muzzle */}
      <path d="M37.5 76C37.5 69 43 66.5 50 66.5C57 66.5 62.5 69 62.5 76C62.5 84 57 88.5 50 88.5C43 88.5 37.5 84 37.5 76Z" fill={u('muz')} stroke="#5a3006" strokeWidth="1" />
      <path d="M45.5 74.5C42 74.6 40 77 40.6 79.6C42 78 43.8 77.6 45.6 78.2C46.6 77.4 46.8 75.6 45.5 74.5Z" fill="#4a2604" />
      <path d="M54.5 74.5C58 74.6 60 77 59.4 79.6C58 78 56.2 77.6 54.4 78.2C53.4 77.4 53.2 75.6 54.5 74.5Z" fill="#4a2604" />
      <path d="M50 70.5V80" stroke="#b07020" strokeWidth=".9" strokeLinecap="round" opacity=".6" />
      <path d="M44 84.5Q50 86.8 56 84.5" fill="none" stroke="#6a3a06" strokeWidth="1.1" strokeLinecap="round" />
      <ellipse cx="45" cy="70.5" rx="5" ry="2" fill={u('sh')} opacity=".7" transform="rotate(-12 45 70.5)" />
      {/* key highlight + storm rim light */}
      <path d="M36.5 36C34 43 34 50 36.5 57" fill="none" stroke="#fffbe0" strokeWidth="2" strokeLinecap="round" opacity=".8" />
      <path d={BULL_HEAD} fill="none" stroke={u('rim')} strokeWidth="2.2" />
      </g>
      <path d={sparkle(84, 9, 7.5)} fill="#fff" />
      <path d={sparkle(14, 64, 4.6)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- h2 · Şimşek Baltası (bronze eye-axe with blue lightning) ---------- */
const AXE_BLADE = 'M45 20C36 19.5 27.5 15 21 8.5C12.5 18 10 38 15.5 56.5C23.5 50 33 46.5 45 46Z';
function Axe({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('aura')} cx={0.32} cy={0.4} r={0.6} s={[[0, '#7fe7ff', 0.45], [0.5, '#2a7dff', 0.16], [1, '#2a7dff', 0]]} />
        <LG id={k('blade')} x1={0} y1={0} x2={1} y2={1} s={BRONZE} />
        <LG id={k('edge')} x1={0} y1={0} x2={0} y2={1} s={[[0, '#ffffff'], [0.5, '#d9f6ff'], [1, '#7fd3f0']]} />
        <LG id={k('haft')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#2a1406'], [0.3, '#6e3a16'], [0.5, '#9a5a2a'], [0.75, '#5a2c0e'], [1, '#2a1406']]} />
        <LG id={k('band')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#6a3a08'], [0.35, '#ffe08a'], [0.6, '#e2a636'], [1, '#6a3a08']]} />
        <LG id={k('sock')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#5a2e08'], [0.3, '#f6cf7a'], [0.55, '#fff2c8'], [0.8, '#c88a2e'], [1, '#5a2e08']]} />
      </defs>
      <circle cx="40" cy="42" r="46" fill={u('aura')} />
      <g transform="rotate(-16 50 54)">
        {/* lightning wrapping the haft (behind) */}
        <Spark d="M57 52L46 58L56 64L45 71" w={1.2} o={0.75} />
        {/* haft */}
        <rect x="45.5" y="14" width="10" height="82" rx="4.4" fill={u('haft')} stroke="#1e0e04" strokeWidth="1" />
        <path d="M48.3 50V92M52.4 48V88" stroke="#c48a52" strokeWidth=".8" opacity=".45" strokeLinecap="round" />
        <rect x="44.2" y="60" width="12.6" height="5" rx="1.6" fill={u('band')} stroke="#4a2604" strokeWidth=".9" />
        <rect x="44.2" y="78" width="12.6" height="4" rx="1.4" fill={u('band')} stroke="#4a2604" strokeWidth=".9" />
        <path d="M44 90H57L55.5 98.5Q50.5 101 45.5 98.5Z" fill={u('band')} stroke="#4a2604" strokeWidth=".9" strokeLinejoin="round" />
        {/* blade with two eye openings (fenestrated eye-axe) */}
        <path d={`${AXE_BLADE}M36.5 27.5C33 26 29 27 28 30C29.5 33 33.5 33.8 36.5 32Z M36.5 37C33 35.4 29 36.5 28 39.4C29.5 42.4 33.5 43.2 36.5 41.4Z`} fillRule="evenodd" fill={u('blade')} stroke="#3e1f04" strokeWidth="1.2" strokeLinejoin="round" />
        {/* polished cutting edge */}
        <path d="M21 8.5C12.5 18 10 38 15.5 56.5C14.4 50 16 47 19 45.5C16 33 17 21 23.5 12Z" fill={u('edge')} stroke="#3e1f04" strokeWidth=".9" strokeLinejoin="round" />
        <path d="M19.5 14C15.5 24 15.2 36 17.8 47" fill="none" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" opacity=".9" />
        {/* engraved storm wave on the blade */}
        <path d="M24 22C27 20.5 29 23 32 21.5S37 22.5 40 21.5" fill="none" stroke="#5a2e08" strokeWidth="1" strokeLinecap="round" opacity=".75" />
        <path d="M24 46.5C28 44 33 43 40 42.8" fill="none" stroke="#5a2e08" strokeWidth="1" strokeLinecap="round" opacity=".7" />
        <path d="M30 18.6C33 20 37 21 41 21.3" fill="none" stroke="#fff4c8" strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
        {/* socket + rear fin crest */}
        <path d="M56 20.5L66 16.5L63 24L70 26L56 33Z" fill={u('blade')} stroke="#3e1f04" strokeWidth="1" strokeLinejoin="round" />
        <rect x="43.2" y="15.5" width="14.6" height="33" rx="4" fill={u('sock')} stroke="#3e1f04" strokeWidth="1.1" />
        {[20, 26, 38, 44].map(y => <path key={y} d={`M43.6 ${y}H57.4`} stroke="#6a3a08" strokeWidth=".9" opacity=".7" />)}
        <circle cx="50.5" cy="32" r="3.4" fill={u('band')} stroke="#3e1f04" strokeWidth=".9" />
        <circle cx="49.6" cy="31.1" r="1" fill="#fff" />
        <path d="M46.5 12.5Q50.5 6.5 54.5 12.5L53.5 16H47.5Z" fill={u('band')} stroke="#3e1f04" strokeWidth=".9" strokeLinejoin="round" />
        {/* lightning crackling off the edge */}
        <Spark d="M18 12L9 9.5L11 4.5L3.5 1.5" w={1.5} />
        <Spark d="M13 30L5.5 31.5L7.5 26L0.5 25" w={1.5} />
        <Spark d="M14.5 50L7 55L11 57L4.5 64" w={1.4} />
        <Spark d="M21 12.5L26 23L22.5 27L27 39L23.5 43" w={0.9} o={0.85} />
        <Spark d="M66 17L74 12L72 7.5L79 4" w={1.1} o={0.9} />
        <circle cx="5" cy="38" r="1.3" fill="#e9fbff" />
        <circle cx="74" cy="22" r="1" fill="#e9fbff" />
      </g>
      <path d={sparkle(84, 72, 7)} fill="#fff" opacity=".9" />
    </>
  );
}

/* ---------- h3 · Aslan Kapısı Madalyonu (bronze lion medallion) ---------- */
const MANE = Array.from({ length: 18 }, (_, i) => {
  const a = ((i / 18) * 360 + 10) * (Math.PI / 180);
  const r0 = 12;
  const r1 = 30.5;
  const w = 0.2;
  const p = (r: number, aa: number) => `${n1(50 + Math.cos(aa) * r)} ${n1(51 + Math.sin(aa) * r)}`;
  return `M${p(r0, a - w)}Q${p(r1 * 0.86, a - w * 1.35)} ${p(r1, a + 0.08)}Q${p(r1 * 0.8, a + w * 1.1)} ${p(r0, a + w)}Z`;
});
function Lion({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const beads = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return [n1(50 + Math.cos(a) * 44.6), n1(50 + Math.sin(a) * 44.6)] as const;
  });
  const teeth = Array.from({ length: 24 }, (_, i) => {
    const a0 = (i / 24) * Math.PI * 2;
    const a1 = ((i + 0.5) / 24) * Math.PI * 2;
    const a2 = ((i + 1) / 24) * Math.PI * 2;
    const p = (r: number, a: number) => `${n1(50 + Math.cos(a) * r)},${n1(50 + Math.sin(a) * r)}`;
    return `${p(34.6, a0)} ${p(40.4, a1)} ${p(34.6, a2)}`;
  });
  return (
    <>
      <defs>
        <LG id={k('rim')} x1={0.15} y1={0} x2={0.85} y2={1} s={BRONZE} />
        <RG id={k('field')} cx={0.42} cy={0.35} r={0.7} s={[[0, '#7a4412'], [0.65, '#3d1e06'], [1, '#1e0e02']]} />
        <RG id={k('mane')} cx={0.4} cy={0.3} r={0.85} s={[[0, '#ffe08a'], [0.45, '#d58f2e'], [1, '#6a360a']]} />
        <RG id={k('face')} cx={0.4} cy={0.28} r={0.85} s={[[0, '#fffbe2'], [0.3, '#ffe07a'], [0.7, '#e3a034'], [1, '#8a4e0c']]} />
        <RG id={k('eye')} cx={0.5} cy={0.5} r={0.5} s={[[0, '#fffbe0'], [0.45, '#ffcf4a'], [1, '#d4520e']]} />
        <LG id={k('storm')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#7fe7ff', 0], [0.62, '#7fe7ff', 0], [1, '#a8f2ff', 0.95]]} />
      </defs>
      <circle cx="50" cy="50" r="48" fill={u('rim')} stroke="#3a1c04" strokeWidth="1.2" />
      {beads.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.5" fill="#fff0c0" stroke="#6a3a08" strokeWidth=".5" />)}
      <circle cx="50" cy="50" r="41.6" fill="#5a2e08" />
      <circle cx="50" cy="50" r="40.6" fill={u('rim')} />
      {teeth.map((t, i) => <polygon key={i} points={t} fill={i % 2 ? '#7a4410' : '#b06e22'} />)}
      <circle cx="50" cy="50" r="34.6" fill={u('field')} stroke="#2a1404" strokeWidth="1.2" />
      {/* mane */}
      {MANE.map((d, i) => <path key={i} d={d} fill={u('mane')} stroke="#3a1c04" strokeWidth=".9" strokeLinejoin="round" />)}
      <circle cx="50" cy="51" r="20.5" fill="#6a360a" opacity=".55" />
      {/* ears */}
      <circle cx="37" cy="33.5" r="5.2" fill={u('face')} stroke="#3a1c04" strokeWidth="1" />
      <circle cx="63" cy="33.5" r="5.2" fill={u('face')} stroke="#3a1c04" strokeWidth="1" />
      <circle cx="37" cy="34" r="2.4" fill="#7a3a0c" />
      <circle cx="63" cy="34" r="2.4" fill="#7a3a0c" />
      {/* face */}
      <path d="M50 31C60 31 66.5 37 66 47C65.8 56 61.5 63.5 50 71.5C38.5 63.5 34.2 56 34 47C33.5 37 40 31 50 31Z" fill={u('face')} stroke="#3a1c04" strokeWidth="1.1" />
      {/* brows (stern gate-lion frown) */}
      <path d="M37.5 41.5Q43 37.8 48 41.8" fill="none" stroke="#7a420c" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M62.5 41.5Q57 37.8 52 41.8" fill="none" stroke="#7a420c" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M47 35.5Q50 38.5 53 35.5" fill="none" stroke="#9a5a14" strokeWidth="1.1" strokeLinecap="round" />
      {/* glowing eyes */}
      <path d="M38.5 45.5Q43 42 47 45.2Q43 48.2 38.5 45.5Z" fill={u('eye')} stroke="#3a1c04" strokeWidth=".9" />
      <path d="M61.5 45.5Q57 42 53 45.2Q57 48.2 61.5 45.5Z" fill={u('eye')} stroke="#3a1c04" strokeWidth=".9" />
      <ellipse cx="43" cy="45.3" rx=".9" ry="1.6" fill="#2a1002" />
      <ellipse cx="57" cy="45.3" rx=".9" ry="1.6" fill="#2a1002" />
      {/* nose */}
      <path d="M50 43V50" stroke="#fffbe0" strokeWidth="2.2" strokeLinecap="round" opacity=".7" />
      <path d="M44.5 51.5H55.5Q55 56 50 57Q45 56 44.5 51.5Z" fill="#7a3a0c" stroke="#3a1c04" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M46.5 52.4H51" stroke="#ffcf8a" strokeWidth=".9" strokeLinecap="round" opacity=".8" />
      {/* roaring mouth */}
      <path d="M41.5 59.5Q46 57.2 50 59Q54 57.2 58.5 59.5Q57 68.5 50 70Q43 68.5 41.5 59.5Z" fill="#5a0e06" stroke="#3a1c04" strokeWidth="1" strokeLinejoin="round" />
      <path d="M45 66Q50 63.2 55 66Q53 69 50 69.2Q47 69 45 66Z" fill="#d0453a" />
      <path d="M43.2 59.4L45.2 64.4L46.6 58.8Z M56.8 59.4L54.8 64.4L53.4 58.8Z" fill="#fff8e0" stroke="#7a420c" strokeWidth=".4" />
      <path d="M45.5 68L47 64.8L48.2 68.6Z M54.5 68L53 64.8L51.8 68.6Z" fill="#fff8e0" stroke="#7a420c" strokeWidth=".4" />
      {/* whisker dots */}
      {[[40.8, 55.5], [39.6, 58.3], [59.2, 55.5], [60.4, 58.3]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".75" fill="#7a420c" />)}
      {/* highlights */}
      <path d="M38.5 36Q42 32.5 47 32" fill="none" stroke="#fffbe6" strokeWidth="1.6" strokeLinecap="round" opacity=".9" />
      <path d="M16 30C21 18 33 9 48 7.5" fill="none" stroke="#fffbe6" strokeWidth="2.2" strokeLinecap="round" opacity=".75" />
      <circle cx="50" cy="50" r="46.5" fill="none" stroke={u('storm')} strokeWidth="2.6" />
      <path d={sparkle(86, 16, 7)} fill="#fff" />
      <path d={sparkle(14, 82, 4)} fill="#fff" opacity=".8" />
    </>
  );
}

/* ---------- h4 · Güneş Kursu (openwork bronze sun-disc standard) ---------- */
const DISC_C = [50, 43] as const;
const DISC_R = 31;
function SunDisc({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const [cx, cy] = DISC_C;
  const lattice: string[] = [];
  for (let t = -60; t <= 60; t += 10) {
    lattice.push(`M${cx + t - 40} ${cy - 40}L${cx + t + 40} ${cy + 40}`);
    lattice.push(`M${cx + t + 40} ${cy - 40}L${cx + t - 40} ${cy + 40}`);
  }
  const lat = lattice.join('');
  const knobs = Array.from({ length: 13 }, (_, i) => {
    const a = ((-180 + 15 + i * (330 / 12)) * Math.PI) / 180;
    return { x: n1(cx + Math.cos(a) * (DISC_R + 6.2)), y: n1(cy + Math.sin(a) * (DISC_R + 6.2)), sx: n1(cx + Math.cos(a) * (DISC_R + 1)), sy: n1(cy + Math.sin(a) * (DISC_R + 1)), big: i === 6 || i === 3 || i === 9 };
  }).filter(p => p.y < cy + 22);
  return (
    <>
      <defs>
        <RG id={k('aura')} cx={0.5} cy={0.44} r={0.5} s={[[0, '#fff3b0', 0.85], [0.45, '#ffc443', 0.32], [1, '#ff9a1a', 0]]} />
        <RG id={k('sun')} cx={0.5} cy={0.5} r={0.5} s={[[0, '#fffbe6'], [0.45, '#ffd967'], [0.85, '#f08a1c'], [1, '#b0480a']]} />
        <LG id={k('gold')} x1={0.1} y1={0} x2={0.9} y2={1} s={GOLD} />
        <LG id={k('bronze')} x1={0} y1={0} x2={1} y2={1} s={BRONZE} />
        <LG id={k('storm')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#7fe7ff', 0], [0.6, '#7fe7ff', 0], [1, '#a8f2ff', 0.9]]} />
        <clipPath id={k('clip')}><circle cx={cx} cy={cy} r={DISC_R - 1} /></clipPath>
      </defs>
      <circle cx="50" cy="45" r="49" fill={u('aura')} />
      {/* bull-horn bracket + tang */}
      <path d="M44.5 74H55.5L54 94Q50 97.5 46 94Z" fill={u('bronze')} stroke="#3a1c04" strokeWidth="1" strokeLinejoin="round" />
      <path d="M43 86H57" stroke="#3a1c04" strokeWidth="1" />
      <path d="M43.5 89.5H56.5" stroke="#ffe7a0" strokeWidth=".9" opacity=".6" />
      <path d="M16 56C16 68 30 79 50 79C70 79 84 68 84 56C80 64 68 71 50 71C32 71 20 64 16 56Z" fill={u('bronze')} stroke="#3a1c04" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M16 56C14 52 11.5 50 9 50.5C11 53 12.5 55 13.5 58Z M84 56C86 52 88.5 50 91 50.5C89 53 87.5 55 86.5 58Z" fill={u('gold')} stroke="#3a1c04" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M21 63C29 70 40 73.5 50 73.5" fill="none" stroke="#fff3c4" strokeWidth="1.3" strokeLinecap="round" opacity=".8" />
      {/* pendant knobs on the rim */}
      {knobs.map((p, i) => (
        <g key={i}>
          <path d={`M${p.sx} ${p.sy}L${p.x} ${p.y}`} stroke="#3a1c04" strokeWidth="3.4" strokeLinecap="round" />
          <path d={`M${p.sx} ${p.sy}L${p.x} ${p.y}`} stroke={u('gold')} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx={p.x} cy={p.y} r={p.big ? 3.9 : 2.7} fill={u('gold')} stroke="#3a1c04" strokeWidth=".9" />
          <circle cx={p.x - 0.8} cy={p.y - 0.9} r={p.big ? 1.2 : 0.8} fill="#fff" opacity=".9" />
        </g>
      ))}
      {/* sunlight through the openwork */}
      <circle cx={cx} cy={cy} r={DISC_R} fill={u('sun')} opacity=".95" />
      <g clipPath={u('clip')}>
        <path d={lat} stroke="#3a1c04" strokeWidth="4.2" />
        <path d={lat} stroke={u('gold')} strokeWidth="2.6" />
        <path d={lat} stroke="#fff6cc" strokeWidth=".7" opacity=".6" transform="translate(-.5 -.5)" />
      </g>
      {/* rim */}
      <circle cx={cx} cy={cy} r={DISC_R} fill="none" stroke="#3a1c04" strokeWidth="7.6" />
      <circle cx={cx} cy={cy} r={DISC_R} fill="none" stroke={u('gold')} strokeWidth="5.6" />
      <circle cx={cx} cy={cy} r={DISC_R} fill="none" stroke="#fffbe0" strokeWidth="1" strokeDasharray="1.2 2.6" opacity=".8" />
      <path d={`M${cx - 26} ${cy - 17}A31 31 0 0 1 ${cx + 6} ${cy - 31}`} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity=".85" />
      {/* central boss */}
      <circle cx={cx} cy={cy} r="7.2" fill={u('gold')} stroke="#3a1c04" strokeWidth="1.1" />
      <circle cx={cx} cy={cy} r="4.1" fill="#1d4fb8" stroke="#3a1c04" strokeWidth=".8" />
      <circle cx={cx - 1.2} cy={cy - 1.3} r="1.4" fill="#cfe3ff" />
      <circle cx={cx} cy={cy} r={DISC_R + 3} fill="none" stroke={u('storm')} strokeWidth="2" />
      <path d={sparkle(84, 14, 7.5)} fill="#fff" />
      <path d={sparkle(16, 20, 4)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- l1..l5 · carved storm stones ---------- */
type StoneSpec = { body: string; light: string; mid: string; dark: string; deep: string; edge: string };
function StoneBody({ k, s, children, texture }: { k: K; s: StoneSpec; children: ReactNode; texture?: ReactNode }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('st')} cx={0.36} cy={0.3} r={0.85} s={[[0, s.light], [0.32, s.mid], [0.74, s.dark], [1, s.deep]]} />
        <RG id={k('sh')} cx={0.5} cy={0.5} r={0.5} s={SHEEN} />
        <LG id={k('stormrim')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#9ff0ff', 0], [0.62, '#9ff0ff', 0], [1, '#b4f4ff', 0.75]]} />
        <clipPath id={k('clip')}><path d={s.body} /></clipPath>
      </defs>
      <ellipse cx="50" cy="91.5" rx="30" ry="3.6" fill="#05060f" opacity=".35" />
      <path d={s.body} fill={u('st')} stroke={s.edge} strokeWidth="1.3" />
      {texture && <g clipPath={u('clip')}>{texture}</g>}
      <g clipPath={u('clip')}>
        <path d={s.body} fill="none" stroke="#000" strokeWidth="7" opacity=".18" transform="translate(1.8 2.6)" />
      </g>
      {children}
      <path d={s.body} fill="none" stroke={u('stormrim')} strokeWidth="1.8" />
    </>
  );
}

const LAPIS_BODY = pebble(50, 54, 41, 29, [[2, 0.04, 0.4], [3, 0.035, 1.3], [5, 0.012, 0.2]], -6);
function StoneLapis({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const flecks: Array<[number, number, number]> = [[24, 46, 0.9], [30, 64, 0.7], [66, 38, 0.8], [74, 60, 1], [58, 72, 0.7], [40, 36, 0.6], [80, 48, 0.6], [20, 58, 0.6], [46, 76, 0.8], [62, 44, 0.5]];
  return (
    <StoneBody k={k} s={{ body: LAPIS_BODY, light: '#a8c8ff', mid: '#3a70e0', dark: '#173c9e', deep: '#0a1a52', edge: '#060f36' }}
      texture={<>
        <path d="M8 70C26 62 38 74 56 66S84 58 96 64" fill="none" stroke="#b9d0ff" strokeWidth="3" opacity=".18" />
        <path d="M14 42C28 38 36 46 48 42" fill="none" stroke="#c9dcff" strokeWidth="1.6" opacity=".2" />
        {flecks.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#ffd96a" opacity=".85" />)}
      </>}>
      <defs><LG id={k('gold')} s={INLAY_GOLD} /></defs>
      <Inlay d="M27 45.5C31 40.5 35 40.5 39 45.5S47 50.5 51 45.5S59 40.5 63 45.5S71 50.5 74 46" w={3.3} metal={u('gold')} groove="#06123e" />
      <Inlay d="M27 58C31 53 35 53 39 58S47 63 51 58S59 53 63 58S71 63 74 58.5" w={3.3} metal={u('gold')} groove="#06123e" />
      <ellipse cx="34" cy="35.5" rx="13" ry="4.4" fill={u('sh')} opacity=".85" transform="rotate(-12 34 35.5)" />
      <path d={sparkle(80, 30, 5.5)} fill="#fff" opacity=".95" />
    </StoneBody>
  );
}

const CARN_BODY = (() => {
  const p: Array<readonly [number, number]> = [];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const y = Math.sin(a);
    const narrow = 1 - 0.2 * Math.max(0, -y);
    p.push([50 + Math.cos(a) * 29 * narrow * (1 + 0.03 * Math.cos(3 * a)), 53 + y * 40 * (1 + 0.02 * Math.sin(2 * a))]);
  }
  return smoothClosed(p);
})();
const EAGLE = 'M50 47.5C47.6 47.5 46.2 49.5 46.4 53L46.6 62.5L43.5 72.5L47.5 70.2L50 74L52.5 70.2L56.5 72.5L53.4 62.5L53.6 53C53.8 49.5 52.4 47.5 50 47.5Z'
  + 'M46.6 51.5C42.5 48.5 37.5 47 32.5 48.5L35 51.4L31 53.2L35.4 55L32 57.6L37.4 58.4L35.6 61.4L41.5 60.2C44 59.4 45.8 57.8 46.6 56Z'
  + 'M53.4 51.5C57.5 48.5 62.5 47 67.5 48.5L65 51.4L69 53.2L64.6 55L68 57.6L62.6 58.4L64.4 61.4L58.5 60.2C56 59.4 54.2 57.8 53.4 56Z'
  + 'M47.4 48.2C46 45.6 44.6 43.5 42.6 42.6C40.6 41.8 38.6 42.6 38 44.2L35.2 44.8L38.4 46C39.4 47 41.2 47.4 43 46.6C44.4 47.4 45.4 48.4 46.2 49.6Z'
  + 'M52.6 48.2C54 45.6 55.4 43.5 57.4 42.6C59.4 41.8 61.4 42.6 62 44.2L64.8 44.8L61.6 46C60.6 47 58.8 47.4 57 46.6C55.6 47.4 54.6 48.4 53.8 49.6Z';
function StoneCarnelian({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <StoneBody k={k} s={{ body: CARN_BODY, light: '#ffd6b8', mid: '#f2703a', dark: '#b52f14', deep: '#5e1206', edge: '#3a0a02' }}
      texture={<>
        {[0, 1, 2, 3].map(i => <ellipse key={i} cx={50} cy={60 + i * 3} rx={34 - i * 7} ry={44 - i * 9} fill="none" stroke="#ffd2b0" strokeWidth={2.4 - i * 0.4} opacity=".14" />)}
        <path d="M30 24C40 30 42 44 34 60" fill="none" stroke="#fff0e0" strokeWidth="5" opacity=".1" />
      </>}>
      <defs><LG id={k('gold')} s={INLAY_GOLD} /></defs>
      <g transform="translate(50 57) scale(1.22) translate(-50 -57)">
      <path d={EAGLE} fill="#fff" opacity=".16" transform="translate(.5 1)" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <path d={EAGLE} fill="#4a0c02" stroke="#4a0c02" strokeWidth="2.6" strokeLinejoin="round" />
      <path d={EAGLE} fill={u('gold')} stroke={u('gold')} strokeWidth=".7" strokeLinejoin="round" />
      <path d="M47.8 50.5C48.3 49.2 49.2 48.6 50 48.6M38 49.2C40.5 48.5 43 48.9 45.3 50" fill="none" stroke="#fffbe6" strokeWidth=".8" strokeLinecap="round" opacity=".9" />
      <circle cx="41.4" cy="44.2" r=".7" fill="#4a0c02" />
      <circle cx="58.6" cy="44.2" r=".7" fill="#4a0c02" />
      </g>
      <ellipse cx="40" cy="27" rx="9" ry="5" fill={u('sh')} opacity=".85" transform="rotate(-30 40 27)" />
      <path d={sparkle(68, 22, 5)} fill="#fff" opacity=".95" />
    </StoneBody>
  );
}

const AMBER_BODY = smoothClosed([[50, 13.5], [62, 24], [76, 46], [87, 70], [82, 86], [64, 90], [36, 90], [18, 86], [13, 70], [24, 46], [38, 24]]);
function StoneAmber({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return `M${n1(50 + Math.cos(a) * 11.5)} ${n1(64 + Math.sin(a) * 11.5)}L${n1(50 + Math.cos(a) * 17.5)} ${n1(64 + Math.sin(a) * 17.5)}`;
  }).join('');
  return (
    <StoneBody k={k} s={{ body: AMBER_BODY, light: '#fffbe0', mid: '#ffcf55', dark: '#e0820f', deep: '#8a3c04', edge: '#4a1e02' }}
      texture={<>
        <defs><RG id={k('core')} cx={0.5} cy={0.5} r={0.5} s={[[0, '#fff6c0', 0.85], [1, '#fff6c0', 0]]} /></defs>
        <ellipse cx="50" cy="64" rx="28" ry="22" fill={u('core')} />
        {[[30, 74, 1.4], [70, 78, 1], [62, 40, 1.2], [38, 46, 0.8], [76, 66, 0.7]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="none" stroke="#fff8d0" strokeWidth=".6" opacity=".8" />)}
        <path d="M20 80C34 72 60 74 84 80" fill="none" stroke="#a84e06" strokeWidth="2" opacity=".25" />
      </>}>
      <defs><LG id={k('ink')} s={[[0, '#a2420a'], [1, '#5a1e02']]} /></defs>
      <Inlay d={rays} w={3.1} metal={u('ink')} groove="#fff1b8" hi="#ffcf80" />
      <Inlay d="M50 56.5A7.5 7.5 0 1 1 49.99 56.5Z" w={3.1} metal={u('ink')} groove="#fff1b8" hi="#ffcf80" />
      <circle cx="50" cy="64" r="2.4" fill="#8a3204" />
      <ellipse cx="41" cy="33" rx="5" ry="10" fill={u('sh')} opacity=".9" transform="rotate(30 41 33)" />
      <path d={sparkle(71, 30, 5)} fill="#fff" opacity=".95" />
    </StoneBody>
  );
}

const JADE_BODY = (() => {
  // pillow tablet: superellipse with gently bulged sides, slight tilt
  const p: Array<readonly [number, number]> = [];
  const n = 32;
  const rot = (7 * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const e = 0.42;
    const x = Math.sign(c) * Math.pow(Math.abs(c), e) * 35;
    const y = Math.sign(s) * Math.pow(Math.abs(s), e) * 34;
    p.push([50 + x * Math.cos(rot) - y * Math.sin(rot), 53 + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return smoothClosed(p);
})();
function StoneJade({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const bands = [0, 1, 2, 3, 4, 5].map(i => pebble(76, 84, 18 + i * 10, 15 + i * 9, [[3, 0.05, i], [5, 0.03, i * 2]]));
  return (
    <StoneBody k={k} s={{ body: JADE_BODY, light: '#d2ffe8', mid: '#3fcf8c', dark: '#127a4c', deep: '#063a24', edge: '#03231a' }}
      texture={<>
        {bands.map((d, i) => <path key={i} d={d} fill="none" stroke={i % 2 ? '#0a5a36' : '#8af0bf'} strokeWidth={i % 2 ? 3.4 : 1.6} opacity={i % 2 ? 0.35 : 0.3} />)}
      </>}>
      <defs><LG id={k('gold')} s={INLAY_GOLD} /></defs>
      {/* tree of life: trunk, three branch pairs, roots */}
      <Inlay d="M50 76V36M50 64C45 62 40 58 37.5 53M50 64C55 62 60 58 62.5 53M50 54C46 52 42.5 48.5 41 44M50 54C54 52 57.5 48.5 59 44M50 45C47.8 43.4 46.4 41 46 38.4M50 45C52.2 43.4 53.6 41 54 38.4M50 76C46 77 43 79 41 81.5M50 76C54 77 57 79 59 81.5" w={2.9} metal={u('gold')} groove="#022016" />
      {[[37.5, 53], [62.5, 53], [41, 44], [59, 44], [46, 38.4], [54, 38.4], [50, 34]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" fill={u('gold')} stroke="#022016" strokeWidth="1" />)}
      <ellipse cx="33" cy="30" rx="11" ry="4" fill={u('sh')} opacity=".75" transform="rotate(-20 33 30)" />
      <path d={sparkle(76, 24, 5)} fill="#fff" opacity=".95" />
    </StoneBody>
  );
}

const OBS_BODY = pebble(50, 54, 38, 33, [[2, 0.06, 2.4], [3, 0.05, 0.3], [4, 0.025, 1.2]], 22);
const BOLT = 'M54.5 30L40 55.5H49L43.5 77L61 48.5H51.5L58.5 30Z';
function StoneObsidian({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <StoneBody k={k} s={{ body: OBS_BODY, light: '#8c9bb4', mid: '#3a4458', dark: '#151a26', deep: '#04060c', edge: '#000' }}
      texture={<>
        <defs><RG id={k('glow')} cx={0.5} cy={0.5} r={0.5} s={[[0, '#55d8ff', 0.55], [1, '#55d8ff', 0]]} /></defs>
        {[0, 1, 2].map(i => <path key={i} d={`M${18 + i * 6} ${30 + i * 8}Q${44 + i * 4} ${24 + i * 9} ${70 + i * 3} ${38 + i * 8}`} fill="none" stroke="#a9b8d4" strokeWidth=".8" opacity=".22" />)}
        <ellipse cx="51" cy="54" rx="24" ry="27" fill={u('glow')} />
      </>}>
      <defs><LG id={k('elec')} s={[[0, '#ffffff'], [0.4, '#aef3ff'], [1, '#35b8ff']]} /></defs>
      <path d={BOLT} fill="#2a9dff" opacity=".3" stroke="#2a9dff" strokeWidth="5" strokeLinejoin="round" />
      <path d={BOLT} fill="#0a2a52" stroke="#020611" strokeWidth="2.4" strokeLinejoin="round" />
      <path d={BOLT} fill={u('elec')} />
      <path d="M54.8 31.6L43 53.6" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
      <path d="M22 44C26 32 38 23 54 21.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".75" />
      <path d="M26 47C28 41 32 36 38 32" fill="none" stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity=".5" />
      <path d={sparkle(30, 32, 5)} fill="#fff" />
    </StoneBody>
  );
}

/* ---------- scatter · Şimşek Mührü (storm seal) ---------- */
const PRONG = (tipX: number, tipY: number, baseX: number, flip: number) => {
  // zigzag lightning prong from (baseX, 66) up to tip
  const dx = tipX - baseX;
  const y0 = 66;
  const h = y0 - tipY;
  const w = 3.1;
  const p: Array<[number, number]> = [
    [baseX - w, y0],
    [baseX + dx * 0.45 - w - flip * 2, y0 - h * 0.45],
    [baseX + dx * 0.45 + flip * 3.4, y0 - h * 0.5],
    [tipX - w * 0.6, tipY + 7],
    [tipX, tipY],
    [tipX + w * 1.2, tipY + 8.4],
    [baseX + dx * 0.55 + w + flip * 4.4, y0 - h * 0.48],
    [baseX + dx * 0.55 + w - flip * 0.6, y0 - h * 0.43],
    [baseX + w, y0],
  ];
  return `M${p.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L')}Z`;
};
const TRIDENT = `${PRONG(33.5, 42, 45.5, -1)}${PRONG(50, 34.5, 50, 0)}${PRONG(66.5, 42, 54.5, 1)}M42 64H58L56 69H44Z M47 69H53L52.3 80L50 83L47.7 80Z`;
const HELMET = 'M43.2 32C43 23.5 46 17.5 50 12.5C54 17.5 57 23.5 56.8 32Z';
const HORNS = 'M44 30.5C37 31 31.5 27 30.5 18.5C33.5 23.5 38 25.6 44.2 25.4Z M56 30.5C63 31 68.5 27 69.5 18.5C66.5 23.5 62 25.6 55.8 25.4Z';
function Seal({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const wedges = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * 360;
    const v = i % 3;
    return { a, v };
  });
  const rope = Array.from({ length: 44 }, (_, i) => (i / 44) * 360);
  return (
    <>
      <defs>
        <RG id={k('aura')} cx={0.5} cy={0.5} r={0.5} s={[[0.55, '#6fe3ff', 0.6], [0.78, '#2a7dff', 0.25], [1, '#2a7dff', 0]]} />
        <LG id={k('rim')} x1={0.1} y1={0} x2={0.9} y2={1} s={BRONZE} />
        <LG id={k('band')} x1={0} y1={0} x2={1} y2={1} s={GOLD} />
        <RG id={k('field')} cx={0.45} cy={0.38} r={0.7} s={[[0, '#4f93ff'], [0.45, '#1d4fc0'], [0.85, '#0c2370'], [1, '#06123e']]} />
        <LG id={k('emb')} x1={0} y1={0} x2={0.4} y2={1} s={[[0, '#ffffff'], [0.2, '#fff4b8'], [0.55, '#ffcf45'], [1, '#d4820e']]} />
        <RG id={k('flare')} cx={0.5} cy={0.5} r={0.5} s={[[0, '#ffffff', 0.9], [0.4, '#9ff0ff', 0.4], [1, '#2a9dff', 0]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <circle cx="50" cy="50" r="50" fill={u('aura')} />
      {/* lightning breaking out of the seal */}
      <Spark d="M14 20L6 15L9 10L1.5 5" w={1.5} />
      <Spark d="M86 19L93 13L90 9L98.5 3.5" w={1.5} />
      <Spark d="M9 76L2 80L6 84L0.5 92" w={1.3} />
      <Spark d="M90 78L97 84L93 87L99 95" w={1.3} />
      {/* lightning flanges radiating behind the seal */}
      {Array.from({ length: 8 }, (_, i) => {
        const long = i % 2 === 0;
        const t = long ? 'M-6 -36L-3 -44.5L-7 -45L0 -55.5L2.6 -46.5L6.5 -46L6 -36Z' : 'M-5 -36L-2.5 -42.5L-5.5 -43L0.5 -50.5L2.4 -44L5.5 -43.6L5 -36Z';
        return (
          <g key={i} transform={`translate(50 50) rotate(${i * 45 + 22.5})`}>
            <path d={t} fill={u('band')} stroke="#2a1404" strokeWidth="1.1" strokeLinejoin="round" />
            <path d={t} fill="none" stroke="#bff6ff" strokeWidth=".9" strokeLinejoin="round" opacity=".8" transform="translate(-.6 -.4)" />
          </g>
        );
      })}
      {/* outer rope rim */}
      <circle cx="50" cy="50" r="43" fill={u('rim')} stroke="#2a1404" strokeWidth="1.3" />
      {rope.map((a, i) => <path key={i} d="M50 8.6L51.6 11.8" stroke={i % 2 ? '#fff1c4' : '#6a3a08'} strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${a} 50 50)`} opacity=".85" />)}
      <circle cx="50" cy="50" r="38.4" fill={u('band')} stroke="#3a1c04" strokeWidth="1.2" />
      {/* cuneiform-like wedge band (original marks, no script) */}
      {wedges.map(({ a, v }, i) => (
        <g key={i} transform={`rotate(${a} 50 50)`} fill="#5a2e06">
          {v === 0 && <path d="M48.6 14H51.4L50 18.2Z" />}
          {v === 1 && <path d="M48.2 14.2L51.8 15.4L48.6 17.2Z M49.6 16.4V18.2" stroke="#5a2e06" strokeWidth=".8" />}
          {v === 2 && <path d="M48 14.4H52L50 16Z M48.8 17H51.2L50 18.2Z" />}
        </g>
      ))}
      <circle cx="50" cy="50" r="32.2" fill="#3a1c04" />
      <circle cx="50" cy="50" r="31.2" fill={u('field')} />
      {Array.from({ length: 24 }, (_, i) => <path key={i} d="M50 19.5V27" stroke="#7fb4ff" strokeWidth=".7" opacity=".35" transform={`rotate(${i * 15} 50 50)`} />)}
      <circle cx="50" cy="50" r="22" fill={u('flare')} opacity=".85" />
      {/* horned helmet sigil + three-pronged lightning */}
      <g stroke="#2a1404" strokeWidth="1.2" strokeLinejoin="round">
        <path d={TRIDENT} fill={u('emb')} />
        <path d={HORNS} fill={u('emb')} />
        <path d={HELMET} fill={u('emb')} />
        <path d="M41 31H59L57.6 35H42.4Z" fill={u('emb')} />
        <path d="M50 13.5V30.5" stroke="#8a4e0c" strokeWidth=".9" fill="none" />
      </g>
      <path d="M49.4 38L46 50.5M47.6 17.4C45.6 21 44.8 25 44.8 29.5" stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity=".95" fill="none" />
      <circle cx="50" cy="13.4" r="1.4" fill="#fff" />
      {/* glass gloss on the bronze */}
      <path d="M16.5 36C20.5 23.5 31 14.5 46 12" fill="none" stroke="#fffbe6" strokeWidth="2.4" strokeLinecap="round" opacity=".8" />
      <path d="M84 62C81 73 73 82 62 86" fill="none" stroke="#9ff0ff" strokeWidth="2.2" strokeLinecap="round" opacity=".85" />
      <path d={sparkle(22, 24, 6)} fill="#fff" />
      <path d={sparkle(82, 82, 4.4)} fill="#fff" opacity=".9" />
    </>
  );
}

/* ---------- orb · Fırtına Taşı (caged levitating storm crystal) ---------- */
type OrbPal = { light: string; mid: string; dark: string; deep: string; edge: string; glow: string; spark: string; f: readonly [string, string, string, string, string, string]; cage: readonly Stop[]; text: readonly [string, string] };
const ORB: Record<OrbTier, OrbPal> = {
  blue: { light: '#e2f6ff', mid: '#5cc4ff', dark: '#1f6fd6', deep: '#0c2f7a', edge: '#061848', glow: '#4cc3ff', spark: '#9ff0ff', f: ['#c8eeff', '#7fd2ff', '#2f86e6', '#16489e', '#4aa8f2', '#e6f8ff'], cage: BRONZE, text: ['#ffffff', '#bfeaff'] },
  green: { light: '#e2fff0', mid: '#4fe3a0', dark: '#14a065', deep: '#065034', edge: '#022a1c', glow: '#52f0a8', spark: '#b8ffd8', f: ['#c6ffe0', '#6ff0b2', '#1fb174', '#0a6a44', '#3bd690', '#eafff4'], cage: BRONZE, text: ['#ffffff', '#c8ffe2'] },
  violet: { light: '#f0e6ff', mid: '#b18cff', dark: '#6a3be0', deep: '#341a8a', edge: '#1a0a4e', glow: '#b48cff', spark: '#e2d2ff', f: ['#e0d0ff', '#b495ff', '#7448e8', '#3e1f9e', '#9a74ff', '#f4eeff'], cage: BRONZE, text: ['#ffffff', '#e6d8ff'] },
  crimson: { light: '#ffe2e2', mid: '#ff5a5a', dark: '#c41a2a', deep: '#640812', edge: '#33030a', glow: '#ff4a4a', spark: '#ffc0b0', f: ['#ffc8c8', '#ff7a72', '#d42a32', '#7a0a16', '#f24848', '#fff0ee'], cage: GOLD, text: ['#ffffff', '#ffd8cf'] },
  prism: { light: '#ffffff', mid: '#fff3c8', dark: '#f0c45a', deep: '#a8701a', edge: '#4a2a04', glow: '#fff1b0', spark: '#ffffff', f: ['#ffffff', '#ffe9a8', '#bff3ff', '#ffc3e6', '#d8c8ff', '#fffbe8'], cage: GOLD, text: ['#ffffff', '#fff1b8'] },
};
const CRYS_O: ReadonlyArray<readonly [number, number]> = [[50, 5], [56, 13.5], [61.5, 10.5], [62.5, 23], [69, 37], [66.5, 49], [71, 58], [63.5, 73], [56.5, 80], [50, 92], [43.5, 81], [36.5, 73], [29.5, 58], [33.5, 49], [31, 37], [37.5, 23], [38.5, 10.5], [44, 13.5]];
const CRYS_C: readonly [number, number] = [50.5, 47];
const SHARD_L = 'M33 25L21 34.5L16.5 55L26 70.5L32 58Z';
const SHARD_R = 'M67 27L79.5 37.5L83.5 57.5L73 70.5L67.5 58Z';
function Orb({ k, multiplier }: { k: K; multiplier?: number }) {
  const u = (n: string) => `url(#${k(n)})`;
  const tier = orbTier(multiplier ?? 2);
  const P = ORB[tier];
  const prism = tier === 'prism';
  const label = multiplier === undefined ? '' : `×${multiplier}`;
  const fs = label.length >= 4 ? 29.5 : label.length === 3 ? 36 : 42;
  return (
    <>
      <defs>
        <RG id={k('aura')} cx={0.5} cy={0.5} r={0.5} s={[[0.2, P.glow, prism ? 0.75 : 0.55], [0.6, P.glow, 0.2], [1, P.glow, 0]]} />
        <RG id={k('core')} cx={0.5} cy={0.48} r={0.5} s={[[0, '#ffffff', 0.95], [0.35, P.light, 0.65], [1, P.mid, 0]]} />
        <LG id={k('cage')} x1={0} y1={0} x2={1} y2={1} s={P.cage} />
        <LG id={k('text')} s={[[0.2, P.text[0]], [1, P.text[1]]]} />
        <LG id={k('shard')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.light], [0.5, P.mid], [1, P.deep]]} />
        {prism && <LG id={k('rain')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#9ff0ff', 0.7], [0.3, '#ffd0f0', 0.6], [0.6, '#fff0a0', 0.65], [1, '#c8b4ff', 0.6]]} />}
      </defs>
      <circle cx="50" cy="48" r="50" fill={u('aura')} />
      <ellipse cx="50" cy="96" rx="15" ry="2.6" fill="#05060f" opacity=".4" />
      <ellipse cx="50" cy="96" rx="9" ry="1.4" fill={P.glow} opacity=".55" />
      <g transform="translate(50 0) scale(1.2 1) translate(-50 0)">
      {/* side shards */}
      <path d={SHARD_L} fill={u('shard')} stroke={P.edge} strokeWidth="1" strokeLinejoin="round" />
      <path d="M33 25L24 48L26 70.5" fill="none" stroke={P.light} strokeWidth=".8" opacity=".7" />
      <path d={SHARD_R} fill={u('shard')} stroke={P.edge} strokeWidth="1" strokeLinejoin="round" />
      <path d="M67 27L76 50L73 70.5" fill="none" stroke={P.edge} strokeWidth=".8" opacity=".5" />
      {/* main crystal, faces fanned from an off-centre apex */}
      <polygon points={pts(CRYS_O)} fill={P.deep} stroke={P.edge} strokeWidth="2.2" strokeLinejoin="round" />
      {CRYS_O.map((p, i) => {
        const q = CRYS_O[(i + 1) % CRYS_O.length];
        // facet shade from its direction to the upper-left key light (prism keeps rainbow facets)
        const a = Math.atan2((p[1] + q[1]) / 2 - CRYS_C[1], (p[0] + q[0]) / 2 - CRYS_C[0]);
        const t = (1 + Math.cos(a + (3 * Math.PI) / 4)) / 2;
        const ramp = [P.deep, P.dark, P.mid, P.f[1], P.light] as const;
        const fill = prism ? P.f[i % 6] : ramp[Math.min(4, Math.floor(t * 5))];
        return <polygon key={i} points={pts([p, q, CRYS_C])} fill={fill} stroke={P.edge} strokeWidth=".5" strokeOpacity=".55" strokeLinejoin="round" />;
      })}
      {prism && <polygon points={pts(CRYS_O)} fill={u('rain')} />}
      <ellipse cx="50" cy="48" rx="17" ry="25" fill={u('core')} />
      <path d="M40.5 23L44 40" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".9" />
      {/* crackle inside + around */}
      <Spark d="M50 12L46 26L53 31L47 44" w={0.7} color={P.spark} halo={P.glow} o={0.85} />
      <Spark d="M21 30L13 26L15 21L8 17" w={1.1} color={P.spark} halo={P.glow} />
      <Spark d="M79 32L88 28L86 22L93 18" w={1.1} color={P.spark} halo={P.glow} />
      <Spark d="M24 72L15 76L18 80L10 86" w={1} color={P.spark} halo={P.glow} />
      <Spark d="M76 72L85 77L82 81L90 86" w={1} color={P.spark} halo={P.glow} />
      {/* bronze cage: cap, two straps, belt, spike */}
      <g fill="none" strokeLinecap="round">
        <path d="M44 14C34 26 30 44 33.5 64C35.5 74 41 82 46.5 88" stroke="#2a1404" strokeWidth="3.4" />
        <path d="M56 14C66 26 70 44 66.5 64C64.5 74 59 82 53.5 88" stroke="#2a1404" strokeWidth="3.4" />
        <path d="M44 14C34 26 30 44 33.5 64C35.5 74 41 82 46.5 88" stroke={u('cage')} strokeWidth="1.9" />
        <path d="M56 14C66 26 70 44 66.5 64C64.5 74 59 82 53.5 88" stroke={u('cage')} strokeWidth="1.9" />
        <path d="M31.5 72Q50 80.5 68.5 72" stroke="#2a1404" strokeWidth="4.6" />
        <path d="M31.5 72Q50 80.5 68.5 72" stroke={u('cage')} strokeWidth="2.8" />
      </g>
      {[[33.5, 72.6], [50, 76.6], [66.5, 72.6]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.9" fill={u('cage')} stroke="#2a1404" strokeWidth=".8" />)}
      <path d="M41 16.5L44 8.5H56L59 16.5Z" fill={u('cage')} stroke="#2a1404" strokeWidth="1" strokeLinejoin="round" />
      <path d="M46.5 8.5Q50 1.5 53.5 8.5" fill="none" stroke="#2a1404" strokeWidth="3.2" />
      <path d="M46.5 8.5Q50 1.5 53.5 8.5" fill="none" stroke={u('cage')} strokeWidth="1.8" />
      <path d="M44.5 87H55.5L50 97Z" fill={u('cage')} stroke="#2a1404" strokeWidth="1" strokeLinejoin="round" />
      <path d="M43.5 11.5H51" stroke="#fff6cc" strokeWidth="1" strokeLinecap="round" opacity=".85" />
      </g>
      {label && (
        <text x="50" y="53" textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={900} letterSpacing={label.length >= 4 ? -0.8 : -0.4}
          fontFamily="var(--font-barlow), 'Arial Narrow', 'Arial Black', system-ui, sans-serif" fill={u('text')} stroke={P.edge} strokeWidth={fs > 30 ? 6.4 : 5.6} strokeLinejoin="round" style={{ paintOrder: 'stroke fill' }}>{label}</text>
      )}
      <path d={sparkle(80, 12, prism ? 9 : 6.5)} fill="#fff" />
      <path d={sparkle(18, 86, 3.6)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- public API ---------- */
/** Optical balance: every symbol reads at the same visual weight inside a cell. */
const SCALE: Record<StormSymbol, number> = { h1: 1, h2: 1.02, h3: 1.03, h4: 1.04, l1: 1.12, l2: 1.1, l3: 1.1, l4: 1.12, l5: 1.12, scatter: 1.04, orb: 1.06 };
export function StormSymbolArt({ symbol, multiplier, size, className }: { symbol: StormSymbol; multiplier?: number; size?: number | string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k: K = (n) => `sts${uid}${n}`;
  const dim = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;
  let art: ReactNode;
  switch (symbol) {
    case 'h1': art = <Bull k={k} />; break;
    case 'h2': art = <Axe k={k} />; break;
    case 'h3': art = <Lion k={k} />; break;
    case 'h4': art = <SunDisc k={k} />; break;
    case 'l1': art = <StoneLapis k={k} />; break;
    case 'l2': art = <StoneCarnelian k={k} />; break;
    case 'l3': art = <StoneAmber k={k} />; break;
    case 'l4': art = <StoneJade k={k} />; break;
    case 'l5': art = <StoneObsidian k={k} />; break;
    case 'scatter': art = <Seal k={k} />; break;
    case 'orb': art = <Orb k={k} multiplier={multiplier} />; break;
  }
  return (
    <svg viewBox="0 0 100 100" width={dim} height={dim} className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={k('shadow')} x="-15%" y="-15%" width="130%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.4" stdDeviation="1.8" floodColor="#02040c" floodOpacity=".55" />
        </filter>
      </defs>
      <g filter={`url(#${k('shadow')})`}>{SCALE[symbol] === 1 ? art : <g transform={`translate(50 50) scale(${SCALE[symbol]}) translate(-50 -50)`}>{art}</g>}</g>
    </svg>
  );
}

/* ---------- sprite sheet ---------- */
export const STORM_PLAIN_SYMBOLS: readonly Exclude<StormSymbol, 'orb'>[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5', 'scatter'];
export const STORM_ORB_VALUES: readonly number[] = STORM_ORB_WEIGHTS.map(([value]) => value);
const ORB_SET = new Set(STORM_ORB_VALUES);
export const stormSpriteId = (symbol: StormSymbol, multiplier?: number) => (symbol === 'orb' ? `sts-orb-${multiplier}` : `sts-${symbol}`);

/** Draws every symbol once into a hidden SVG; mount exactly once per page, before any <StormSymbolUse/>. */
export const StormSymbolSprites = memo(function StormSymbolSprites() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        {STORM_PLAIN_SYMBOLS.map(symbol => <symbol key={symbol} id={stormSpriteId(symbol)} viewBox="0 0 100 100" overflow="visible"><StormSymbolArt symbol={symbol} size={100} /></symbol>)}
        {STORM_ORB_VALUES.map(value => <symbol key={value} id={stormSpriteId('orb', value)} viewBox="0 0 100 100" overflow="visible"><StormSymbolArt symbol="orb" multiplier={value} size={100} /></symbol>)}
      </defs>
    </svg>
  );
});

/** Cheap board cell art: two DOM nodes referencing the sprite (falls back to full art for unknown orb values). */
export const StormSymbolUse = memo(function StormSymbolUse({ symbol, multiplier, className }: { symbol: StormSymbol; multiplier?: number; className?: string }) {
  if (symbol === 'orb' && (multiplier === undefined || !ORB_SET.has(multiplier))) return <StormSymbolArt symbol={symbol} multiplier={multiplier} className={className} />;
  return <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}><use href={`#${stormSpriteId(symbol, multiplier)}`} /></svg>;
});
