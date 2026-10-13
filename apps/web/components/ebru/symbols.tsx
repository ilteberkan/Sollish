import { memo, useId } from 'react';
import type { ReactNode } from 'react';
import type { EbruSymbol } from '@sollish/protocol';
import { EBRU_INKS, EBRU_STAIN_TIERS, ebruStainTier, type EbruInkPalette } from './water';

/* Ebru: Mürekkep Bahçesi symbol art. Eight luminous ink blooms floating on water, each with its own
   silhouette (tulip, carnation fan, hatip swirl, leaf, peacock eye, daisy, rose ripple, pebble) so they read
   by shape alone (grayscale, colour blindness) and at 48 px. Shared rules: key light from the upper left,
   a pigment-ring inner motif (scaled copies of the outline, like concentric ebru drops), a paper-white vein,
   a wet specular crescent and a meniscus ring on the water. One cheap feDropShadow per symbol, no blur or
   turbulence. Hand-authored, original, viewBox 100 × 100. Boards draw through <EbruSymbolSprites/> +
   <EbruSymbolUse/> (two DOM nodes per cell). */

export type { EbruSymbol };

export const EBRU_SYMBOL_LABELS: Record<EbruSymbol, string> = {
  c1: 'Altın Lale',
  c2: 'Lal Karanfil',
  c3: 'Firuze Hatip',
  c4: 'Zümrüt Yaprak',
  c5: 'Lacivert Tavus Gözü',
  c6: 'Safran Papatya',
  c7: 'Gül Dalgası',
  c8: 'İs Damlası',
  drop: 'Usta Damlası (joker)',
  comb: 'Altın Tarak',
};
export const EBRU_STAIN_VALUES: readonly number[] = [2, 4, 8, 16, 32, 64, 128, 256];
export function ebruCellLabel(cell: { symbol: EbruSymbol; stain?: number }) {
  return cell.stain ? `${EBRU_SYMBOL_LABELS[cell.symbol]}, leke ×${cell.stain}` : EBRU_SYMBOL_LABELS[cell.symbol];
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
  const k = r * 0.16;
  return `M${n1(cx)} ${n1(cy - r)}Q${n1(cx + k)} ${n1(cy - k)} ${n1(cx + r)} ${n1(cy)}Q${n1(cx + k)} ${n1(cy + k)} ${n1(cx)} ${n1(cy + r)}Q${n1(cx - k)} ${n1(cy + k)} ${n1(cx - r)} ${n1(cy)}Q${n1(cx - k)} ${n1(cy - k)} ${n1(cx)} ${n1(cy - r)}Z`;
};
const smoothClosed = (pts: ReadonlyArray<readonly [number, number]>) => {
  const m = (a: readonly [number, number], b: readonly [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const start = m(pts[pts.length - 1]!, pts[0]!);
  let d = `M${n1(start[0])} ${n1(start[1])}`;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const e = m(p, pts[(i + 1) % pts.length]!);
    d += `Q${n1(p[0])} ${n1(p[1])} ${n1(e[0])} ${n1(e[1])}`;
  }
  return `${d}Z`;
};
/** Closed outline from a polar radius function around (cx, cy). */
const polar = (cx: number, cy: number, n: number, r: (a: number) => number, rot = 0) => {
  const pts: Array<readonly [number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    const rr = r(a);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return smoothClosed(pts);
};
const SHEEN = [[0, '#fff', 0.95], [1, '#fff', 0]] as const;

/** Body gradient + aura + meniscus for one ink. */
function InkDefs({ k, p, fx = 0.34, fy = 0.28 }: { k: K; p: EbruInkPalette; fx?: number; fy?: number }) {
  return (
    <>
      <RG id={k('aura')} cx={0.5} cy={0.52} r={0.5} s={[[0.35, p.glow, 0.5], [0.7, p.glow, 0.16], [1, p.glow, 0]]} />
      <RG id={k('body')} cx={0.5} cy={0.5} r={0.62} fx={fx} fy={fy} s={[[0, p.light], [0.32, p.base], [0.78, p.deep], [1, p.edge]]} />
      <RG id={k('core')} cx={0.4} cy={0.36} r={0.5} s={[[0, '#ffffff', 0.85], [0.5, p.light, 0.35], [1, p.light, 0]]} />
      <LG id={k('sh')} s={SHEEN} />
    </>
  );
}
/** Concentric pigment rings: scaled copies of the outline around (cx, cy). */
function Rings({ d, cx, cy, scales, color, w = 1.3, o = 0.7 }: { d: string; cx: number; cy: number; scales: readonly number[]; color: string; w?: number; o?: number }) {
  return (
    <g fill="none" stroke={color} strokeLinejoin="round">
      {scales.map((s, i) => (
        <path key={s} d={d} transform={`translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`} strokeWidth={w / s} opacity={o * (1 - i * 0.18)} />
      ))}
    </g>
  );
}
/** Water meniscus: an elliptical ring of light under the bloom. */
function Meniscus({ p, cy = 90, rx = 26 }: { p: EbruInkPalette; cy?: number; rx?: number }) {
  return (
    <g>
      <ellipse cx="50" cy={cy} rx={rx} ry={rx * 0.16} fill="#020616" opacity=".45" />
      <ellipse cx="50" cy={cy} rx={rx * 0.86} ry={rx * 0.12} fill="none" stroke={p.glow} strokeWidth="1.1" opacity=".55" />
    </g>
  );
}

/* ---------- c1 · Altın Lale (gold-leaf tulip) ---------- */
const TULIP = 'M50 9C55.5 17 58.5 25 58.5 34C62 27 68.5 21 77 18.5C79 31 76 45 69.5 55C64.5 63 58 69.5 50 72C42 69.5 35.5 63 30.5 55C24 45 21 31 23 18.5C31.5 21 38 27 41.5 34C41.5 25 44.5 17 50 9Z';
const TULIP_MID = 'M50 15C54 23 55.5 33 55 43C54.5 54 52.6 63 50 69C47.4 63 45.5 54 45 43C44.5 33 46 23 50 15Z';
function Tulip({ k }: { k: K }) {
  const p = EBRU_INKS.c1;
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <InkDefs k={k} p={p} />
        <LG id={k('leaf')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#c9f2a8'], [0.45, '#3f9a4a'], [1, '#0f3d1e']]} />
        <RG id={k('rays')} cx={0.5} cy={0.45} r={0.5} s={[[0.5, '#fff1b0', 0.55], [1, '#fff1b0', 0]]} />
      </defs>
      <circle cx="50" cy="48" r="49" fill={u('aura')} />
      {/* gold-leaf sun rays behind: the most valuable ink */}
      <g opacity=".75">
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          const r0 = 30, r1 = i % 2 ? 44 : 49;
          const w = 0.07;
          return <path key={i} d={`M${n1(50 + Math.cos(a - w) * r0)} ${n1(45 + Math.sin(a - w) * r0)}L${n1(50 + Math.cos(a) * r1)} ${n1(45 + Math.sin(a) * r1)}L${n1(50 + Math.cos(a + w) * r0)} ${n1(45 + Math.sin(a + w) * r0)}Z`} fill={u('rays')} />;
        })}
      </g>
      <Meniscus p={p} cy={92} rx={22} />
      {/* stem and leaves */}
      <path d="M50 70C49 78 50 85 51.5 92" fill="none" stroke="#173d1c" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M50 70C49 78 50 85 51.5 92" fill="none" stroke="#6cc25a" strokeWidth="2" strokeLinecap="round" />
      <path d="M50.5 88C42 87 33 81 28.5 72C38 72.5 46 78 50.5 88Z" fill={u('leaf')} stroke="#0f2c14" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M51 86C58 83 65 77 68 69C60 70.5 54 76 51 86Z" fill={u('leaf')} stroke="#0f2c14" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M48 85.5C42 83 36 79 32 74" fill="none" stroke="#e6ffd0" strokeWidth=".8" opacity=".7" />
      {/* bloom */}
      <path d={TULIP} fill={u('body')} stroke={p.edge} strokeWidth="2.2" strokeLinejoin="round" />
      <Rings d={TULIP} cx={50} cy={46} scales={[0.8, 0.6]} color="#fff6d0" w={1.2} o={0.7} />
      <path d={TULIP_MID} fill={u('body')} stroke={p.edge} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M50 19C52.5 28 53 40 52 52" fill="none" stroke="#fffbe6" strokeWidth="1.2" strokeLinecap="round" opacity=".85" />
      {/* gold-leaf crackle */}
      <path d="M30 30L35 34L33 39M68 30L64 35L67 40M38 56L43 58M62 56L57 59" fill="none" stroke="#7a4708" strokeWidth=".8" opacity=".55" />
      <ellipse cx="50" cy="44" rx="20" ry="22" fill={u('core')} opacity=".7" />
      <path d="M27 24C30 34 33 41 37.5 47" fill="none" stroke={u('sh')} strokeWidth="3.4" strokeLinecap="round" opacity=".85" />
      <path d={sparkle(73, 15, 6.5)} fill="#fff" />
      <path d={sparkle(22, 62, 3.4)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- c2 · Lal Karanfil (crimson carnation fan) ---------- */
const CARNATION = (() => {
  const pts: string[] = [];
  const cx = 50, cy = 70;
  const n = 15;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (1.08 + (i / n) * 0.84);
    const r = i % 2 ? 50 : 42;
    pts.push(`${n1(cx + Math.cos(a) * r)} ${n1(cy + Math.sin(a) * r * 0.92)}`);
  }
  return `M${pts[0]}L${pts.slice(1).join('L')}Q74 50 58 68Q50 74 42 68Q26 50 ${pts[0]}Z`;
})();
function Carnation({ k }: { k: K }) {
  const p = EBRU_INKS.c2;
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <InkDefs k={k} p={p} fx={0.36} fy={0.3} />
        <LG id={k('calyx')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#b8f0a0'], [0.5, '#3a8a40'], [1, '#0f3418']]} />
      </defs>
      <circle cx="50" cy="50" r="49" fill={u('aura')} />
      <Meniscus p={p} cy={92} rx={24} />
      <path d="M50 74C50.5 81 50 86 49 92" fill="none" stroke="#173d1c" strokeWidth="4" strokeLinecap="round" />
      <path d="M50 74C50.5 81 50 86 49 92" fill="none" stroke="#6cc25a" strokeWidth="1.8" strokeLinecap="round" />
      <path d={CARNATION} fill={u('body')} stroke={p.edge} strokeWidth="2.2" strokeLinejoin="round" />
      <Rings d={CARNATION} cx={50} cy={58} scales={[0.76, 0.52]} color="#ffd2c8" w={1.3} o={0.75} />
      {/* fan ribs */}
      <g fill="none" stroke={p.edge} strokeWidth="1" opacity=".55" strokeLinecap="round">
        {[-0.95, -0.55, -0.18, 0.18, 0.55, 0.95].map((t) => <path key={t} d={`M50 70L${n1(50 + Math.sin(t * 0.72) * 40)} ${n1(70 - Math.cos(t * 0.72) * 40)}`} />)}
      </g>
      <path d="M50 66L50 30" stroke="#fff4ee" strokeWidth="1.1" strokeLinecap="round" opacity=".75" />
      {/* calyx */}
      <path d="M41 66C44 72 46.5 76 50 78C53.5 76 56 72 59 66C56 69 53 70 50 70C47 70 44 69 41 66Z" fill={u('calyx')} stroke="#0f2c14" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M44 69L47 73M56 69L53 73" stroke="#d8ffc0" strokeWidth=".8" opacity=".7" />
      <ellipse cx="45" cy="40" rx="17" ry="13" fill={u('core')} opacity=".7" />
      <path d="M17 39C22 31 28 26 35 23" fill="none" stroke={u('sh')} strokeWidth="3.2" strokeLinecap="round" opacity=".85" />
      <path d={sparkle(80, 22, 5)} fill="#fff" />
    </>
  );
}

/* ---------- c3 · Firuze Hatip (turquoise hatip swirl) ---------- */
const HATIP = 'M50 12C69 12 84 26 84 46C84 66 70 82 50 86C42 88 34 91 24 93C30 86 31 80 28 74C20 66 16 56 16 46C16 26 31 12 50 12Z';
const SPIRAL = (() => {
  let d = '';
  const cx = 51, cy = 47;
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const a = t * Math.PI * 4.4 - Math.PI / 2;
    const r = 3 + t * 27;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    d += `${i ? 'L' : 'M'}${n1(x)} ${n1(y)}`;
  }
  return d;
})();
function Hatip({ k }: { k: K }) {
  const p = EBRU_INKS.c3;
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs><InkDefs k={k} p={p} /></defs>
      <circle cx="50" cy="50" r="49" fill={u('aura')} />
      <Meniscus p={p} cy={93} rx={23} />
      <path d={HATIP} fill={u('body')} stroke={p.edge} strokeWidth="2.2" strokeLinejoin="round" />
      {/* the swirl: a dark band and a paper-white band wound together */}
      <path d={SPIRAL} fill="none" stroke={p.deep} strokeWidth="5.2" strokeLinecap="round" opacity=".75" />
      <path d={SPIRAL} fill="none" stroke="#e8fffb" strokeWidth="1.8" strokeLinecap="round" opacity=".9" transform="translate(1.4 1.2)" />
      <path d="M28 74C33 79 38 82 44 84" fill="none" stroke={p.light} strokeWidth="1.2" opacity=".7" />
      <ellipse cx="42" cy="34" rx="16" ry="12" fill={u('core')} opacity=".75" />
      <path d="M22 38C25 28 31 21 39 17" fill="none" stroke={u('sh')} strokeWidth="3.4" strokeLinecap="round" opacity=".9" />
      <path d={sparkle(80, 18, 5)} fill="#fff" />
    </>
  );
}

/* ---------- c4 · Zümrüt Yaprak (emerald leaf) ---------- */
const LEAF = 'M20 82C16 58 26 32 48 20C60 13.5 72 12 84 14C86 30 82 50 70 64C58 78 40 86 20 82Z';
function Leaf({ k }: { k: K }) {
  const p = EBRU_INKS.c4;
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs><InkDefs k={k} p={p} fx={0.4} fy={0.3} /></defs>
      <circle cx="50" cy="50" r="49" fill={u('aura')} />
      <Meniscus p={p} cy={92} rx={24} />
      <path d="M20 82L11 92" stroke="#0f2c14" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M20 82L11 92" stroke="#7ed07a" strokeWidth="2" strokeLinecap="round" />
      <path d={LEAF} fill={u('body')} stroke={p.edge} strokeWidth="2.2" strokeLinejoin="round" />
      <Rings d={LEAF} cx={52} cy={48} scales={[0.74, 0.48]} color="#d6ffd8" w={1.2} o={0.6} />
      {/* veins */}
      <path d="M21 81C40 62 60 40 82 16" fill="none" stroke={p.edge} strokeWidth="2.6" strokeLinecap="round" opacity=".6" />
      <path d="M21 81C40 62 60 40 82 16" fill="none" stroke="#efffe6" strokeWidth="1.2" strokeLinecap="round" opacity=".9" />
      <g fill="none" stroke="#efffe6" strokeWidth=".9" strokeLinecap="round" opacity=".7">
        {[0.22, 0.4, 0.58, 0.74].map((t) => {
          const x = 21 + (82 - 21) * t, y = 81 - (81 - 16) * t;
          return <path key={t} d={`M${n1(x)} ${n1(y)}Q${n1(x - 2)} ${n1(y - 12)} ${n1(x - 10)} ${n1(y - 18)}M${n1(x)} ${n1(y)}Q${n1(x + 10)} ${n1(y + 3)} ${n1(x + 18)} ${n1(y + 10)}`} />;
        })}
      </g>
      <ellipse cx="46" cy="36" rx="15" ry="11" fill={u('core')} opacity=".7" transform="rotate(-40 46 36)" />
      <path d="M26 58C28 44 36 32 47 24" fill="none" stroke={u('sh')} strokeWidth="3.2" strokeLinecap="round" opacity=".85" />
      <path d={sparkle(84, 30, 4.6)} fill="#fff" />
    </>
  );
}

/* ---------- c5 · Lacivert Tavus Gözü (lapis peacock eye) ---------- */
const EYE = 'M50 6C58 20 76 36 76 58C76 76 64 88 50 88C36 88 24 76 24 58C24 36 42 20 50 6Z';
function PeacockEye({ k }: { k: K }) {
  const p = EBRU_INKS.c5;
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <InkDefs k={k} p={p} />
        <RG id={k('iris')} cx={0.42} cy={0.38} r={0.6} s={[[0, '#d6fff8'], [0.45, '#22c9c0'], [1, '#05535a']]} />
        <RG id={k('pupil')} cx={0.4} cy={0.35} r={0.6} s={[[0, '#4a5cff'], [0.6, '#0c1450'], [1, '#03051c']]} />
        <LG id={k('goldR')} s={[[0, '#fff2b0'], [0.5, '#f2bf3c'], [1, '#9a5a0c']]} />
      </defs>
      <circle cx="50" cy="52" r="49" fill={u('aura')} />
      <Meniscus p={p} cy={93} rx={22} />
      <path d={EYE} fill={u('body')} stroke={p.edge} strokeWidth="2.2" strokeLinejoin="round" />
      <Rings d={EYE} cx={50} cy={58} scales={[0.86]} color="#cfe0ff" w={1.1} o={0.6} />
      <ellipse cx="50" cy="60" rx="17.5" ry="19" fill={u('goldR')} stroke={p.edge} strokeWidth="1.4" />
      <ellipse cx="50" cy="61" rx="14" ry="15.4" fill={u('iris')} stroke="#033038" strokeWidth="1" />
      <ellipse cx="50" cy="62.5" rx="8" ry="9" fill={u('pupil')} stroke="#01020c" strokeWidth="1" />
      <ellipse cx="46.5" cy="57.5" rx="2.8" ry="3.4" fill="#fff" opacity=".95" />
      <path d="M50 12C54 24 62 32 66 42" fill="none" stroke="#e6eeff" strokeWidth="1" opacity=".6" />
      <path d="M33 40C36 31 41 24 47 16" fill="none" stroke={u('sh')} strokeWidth="3.2" strokeLinecap="round" opacity=".85" />
      <path d={sparkle(76, 24, 5)} fill="#fff" />
    </>
  );
}

/* ---------- c6 · Safran Papatya (saffron daisy) ---------- */
function Daisy({ k }: { k: K }) {
  const p = EBRU_INKS.c6;
  const u = (n: string) => `url(#${k(n)})`;
  const petals = 12;
  return (
    <>
      <defs>
        <InkDefs k={k} p={p} />
        <LG id={k('petal')} x1={0} y1={0} x2={0} y2={1} s={[[0, p.light], [0.5, p.base], [1, p.deep]]} />
        <RG id={k('eye')} cx={0.4} cy={0.35} r={0.6} s={[[0, '#ffe6a0'], [0.5, '#b4560a'], [1, '#4a1a02']]} />
      </defs>
      <circle cx="50" cy="50" r="49" fill={u('aura')} />
      <Meniscus p={p} cy={92} rx={24} />
      {Array.from({ length: petals }, (_, i) => (
        <g key={i} transform={`rotate(${(i * 360) / petals} 50 49)`}>
          <path d="M50 49C44.5 40 44 24 50 13C56 24 55.5 40 50 49Z" fill={u('petal')} stroke={p.edge} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M50 44C48.6 36 48.8 26 50 19" fill="none" stroke="#fff8e6" strokeWidth=".9" strokeLinecap="round" opacity=".75" />
        </g>
      ))}
      <circle cx="50" cy="49" r="12.5" fill={u('eye')} stroke={p.edge} strokeWidth="1.6" />
      {Array.from({ length: 9 }, (_, i) => {
        const a = i * 2.4;
        const r = 2.4 + (i % 3) * 2.6;
        return <circle key={i} cx={n1(50 + Math.cos(a) * r)} cy={n1(49 + Math.sin(a) * r)} r="1.2" fill="#ffd27a" opacity=".85" />;
      })}
      <circle cx="46" cy="45" r="4" fill="#fff" opacity=".55" />
      <path d={sparkle(80, 18, 5)} fill="#fff" />
    </>
  );
}

/* ---------- c7 · Gül Dalgası (rose ripple) ---------- */
const ROSE = polar(50, 50, 48, (a) => 36 * (1 + 0.075 * Math.cos(8 * a)));
function RoseRipple({ k }: { k: K }) {
  const p = EBRU_INKS.c7;
  const u = (n: string) => `url(#${k(n)})`;
  const ring = (r: number, ph: number) => polar(50, 50, 40, (a) => r * (1 + 0.09 * Math.cos(8 * a + ph)));
  return (
    <>
      <defs><InkDefs k={k} p={p} /></defs>
      <circle cx="50" cy="50" r="49" fill={u('aura')} />
      <Meniscus p={p} cy={92} rx={24} />
      <path d={ROSE} fill={u('body')} stroke={p.edge} strokeWidth="2.2" strokeLinejoin="round" />
      <g fill="none" strokeLinejoin="round">
        <path d={ring(27, 0.4)} stroke="#ffe8f2" strokeWidth="1.5" opacity=".8" />
        <path d={ring(19, 0.8)} stroke={p.deep} strokeWidth="2" opacity=".6" />
        <path d={ring(12, 1.2)} stroke="#ffe8f2" strokeWidth="1.4" opacity=".85" />
      </g>
      {/* rose heart: a small spiral */}
      <path d="M50 50C52 48 54.5 50 53.5 52.5C52 55.5 47 55 46 51.5C45 47 49.5 44 53.5 45C58 46.5 59 52 56.5 56" fill="none" stroke={p.edge} strokeWidth="1.8" strokeLinecap="round" opacity=".75" />
      <ellipse cx="42" cy="38" rx="15" ry="11" fill={u('core')} opacity=".75" />
      <path d="M20 44C22 34 28 26 37 21" fill="none" stroke={u('sh')} strokeWidth="3.2" strokeLinecap="round" opacity=".85" />
      <path d={sparkle(80, 20, 4.6)} fill="#fff" />
    </>
  );
}

/* ---------- c8 · İs Damlası (ink-grey pebble) ---------- */
const PEBBLE = polar(50, 54, 30, (a) => 32 * (1 + 0.05 * Math.cos(2 * a + 0.6) + 0.035 * Math.cos(3 * a + 1.4)) * (Math.abs(Math.sin(a)) > 0 ? 1 - 0.24 * Math.sin(a) ** 2 : 1));
function Pebble({ k }: { k: K }) {
  const p = EBRU_INKS.c8;
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs><InkDefs k={k} p={p} /></defs>
      <circle cx="50" cy="54" r="44" fill={u('aura')} opacity=".8" />
      <Meniscus p={p} cy={84} rx={30} />
      <path d={PEBBLE} fill={u('body')} stroke={p.edge} strokeWidth="2.2" strokeLinejoin="round" />
      {/* marbled stone veins */}
      <path d="M22 50C32 44 40 54 50 49C60 44 68 52 78 47" fill="none" stroke="#f4f6fb" strokeWidth="1.3" strokeLinecap="round" opacity=".75" />
      <path d="M26 62C36 57 44 66 54 61C63 57 70 63 76 59" fill="none" stroke={p.edge} strokeWidth="1.4" strokeLinecap="round" opacity=".45" />
      <path d="M30 40C38 37 44 41 50 38" fill="none" stroke="#f4f6fb" strokeWidth=".9" strokeLinecap="round" opacity=".55" />
      <ellipse cx="42" cy="44" rx="15" ry="8" fill={u('core')} opacity=".7" />
      <path d="M24 48C27 41 33 36 41 33" fill="none" stroke={u('sh')} strokeWidth="3" strokeLinecap="round" opacity=".85" />
    </>
  );
}

/* ---------- drop · Usta Damlası (master ink drop held by a brass awl) ---------- */
const MASTER = 'M53 24C60 37 81 49 81 67C81 83 68 94 51 94C34 94 21 83 21 67C21 49 46 37 53 24Z';
function MasterDrop({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  // hatip bands inside the drop: concentric rings pulled up into a heart by the awl
  const bands = ['#e0283c', '#fff3dc', '#22c9c0', '#f2bf3c', '#3d6cf0', '#fff3dc', '#ee79ad'];
  const heart = (r: number) => `M51 ${n1(66 - r * 1.25)}C${n1(51 + r * 0.25)} ${n1(66 - r * 0.7)} ${n1(51 + r)} ${n1(66 - r * 0.85)} ${n1(51 + r)} ${n1(66 - r * 0.05)}C${n1(51 + r)} ${n1(66 + r * 0.75)} ${n1(51 + r * 0.45)} ${n1(66 + r * 0.98)} 51 ${n1(66 + r)}C${n1(51 - r * 0.45)} ${n1(66 + r * 0.98)} ${n1(51 - r)} ${n1(66 + r * 0.75)} ${n1(51 - r)} ${n1(66 - r * 0.05)}C${n1(51 - r)} ${n1(66 - r * 0.85)} ${n1(51 - r * 0.25)} ${n1(66 - r * 0.7)} 51 ${n1(66 - r * 1.25)}Z`;
  return (
    <>
      <defs>
        <RG id={k('aura')} cx={0.5} cy={0.6} r={0.5} s={[[0.15, '#fff6dc', 0.85], [0.5, '#ffd36a', 0.32], [1, '#ffb43a', 0]]} />
        <RG id={k('drop')} cx={0.5} cy={0.6} r={0.56} fx={0.36} fy={0.46} s={[[0, '#ffffff'], [0.28, '#e6f4ff'], [0.6, '#4a64e0'], [0.85, '#24158a'], [1, '#0c0530']]} />
        <RG id={k('core')} cx={0.4} cy={0.45} r={0.5} s={[[0, '#ffffff', 0.95], [0.6, '#ffffff', 0.25], [1, '#ffffff', 0]]} />
        <LG id={k('brass')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#5a3204'], [0.35, '#e9b24a'], [0.5, '#fff1b8'], [0.7, '#c98a26'], [1, '#4a2803']]} />
        <LG id={k('wood')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#2a0806'], [0.4, '#9a2a1c'], [0.55, '#d8604a'], [1, '#3a0a08']]} />
        <LG id={k('steel')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#5a5e68'], [0.45, '#f6f8fc'], [1, '#4a4e58']]} />
        <clipPath id={k('clip')}><path d={MASTER} /></clipPath>
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <circle cx="51" cy="60" r="46" fill={u('aura')} />
      {/* ripples where the drop meets the water */}
      <ellipse cx="51" cy="94" rx="38" ry="5.4" fill="none" stroke="#fff3c8" strokeWidth="1.1" opacity=".5" />
      <ellipse cx="51" cy="94" rx="27" ry="3.8" fill="none" stroke="#bfefff" strokeWidth="1.2" opacity=".7" />
      <ellipse cx="51" cy="94" rx="17" ry="2.4" fill="#020616" opacity=".45" />
      {/* the master drop */}
      <path d={MASTER} fill={u('drop')} stroke="#0e0634" strokeWidth="2.4" strokeLinejoin="round" />
      <g clipPath={u('clip')} fill="none" strokeLinejoin="round">
        {bands.map((c, i) => <path key={i} d={heart(31 - i * 3.9)} stroke={c} strokeWidth={i % 3 === 1 ? 1.8 : 3.2} opacity="1" />)}
      </g>
      <ellipse cx="46" cy="62" rx="14" ry="13" fill={u('core')} />
      <path d="M31 58C32 49 37 42 43 37" fill="none" stroke={u('sh')} strokeWidth="4" strokeLinecap="round" opacity=".95" />
      {/* the awl (biz) from the upper right: rose-wood handle, brass ferrule, steel needle touching the drop */}
      <g>
        <path d="M74.5 4.5L90 -2L95 9L80.5 14.5Z" fill={u('wood')} stroke="#1a0402" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M71.6 7.4L80.4 3.8L83.8 12.4L75 16Z" fill={u('brass')} stroke="#3a1f02" strokeWidth="1" strokeLinejoin="round" />
        <path d="M73.6 13.4L76.4 15.2L54.6 25.6L53.6 24.6Z" fill={u('steel')} stroke="#2a2d34" strokeWidth=".7" strokeLinejoin="round" />
        <path d="M76 6.6L80.6 4.8" stroke="#fff6cc" strokeWidth="1" strokeLinecap="round" opacity=".9" />
      </g>
      <path d={sparkle(53.5, 24.5, 7.5)} fill="#fff" />
      <path d={sparkle(84, 58, 4.4)} fill="#fff" opacity=".9" />
      <path d={sparkle(16, 78, 3.6)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- comb · Altın Tarak (gilded marbling comb on a marbled rosette, scatter) ---------- */
const ROSETTE = polar(50, 50, 64, (a) => 47 * (1 + 0.035 * Math.cos(16 * a)));
function GoldComb({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const tines = 9;
  const chevrons = ['#e0283c', '#fff3dc', '#22c9c0', '#f2bf3c', '#fff3dc', '#e0283c', '#22c9c0'];
  return (
    <>
      <defs>
        <RG id={k('aura')} cx={0.5} cy={0.5} r={0.5} s={[[0.3, '#fff1b0', 0.9], [0.62, '#ffbe3a', 0.35], [1, '#ff9a1a', 0]]} />
        <RG id={k('rays')} cx={0.5} cy={0.5} r={0.5} s={[[0.4, '#fff5c8', 0.9], [1, '#ffcf5a', 0]]} />
        <LG id={k('gold')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#fffbe0'], [0.28, '#ffe07a'], [0.6, '#e0a028'], [0.85, '#9a5a0c'], [1, '#5a3204']]} />
        <LG id={k('spine')} s={[[0, '#fffbe0'], [0.22, '#ffe07a'], [0.55, '#e8a52a'], [0.82, '#9a5a0c'], [1, '#5a3204']]} />
        <LG id={k('tine')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#7a4206'], [0.4, '#fff0b0'], [0.62, '#f2bb46'], [1, '#6a3804']]} />
        <RG id={k('disc')} cx={0.4} cy={0.35} r={0.7} s={[[0, '#3a56c8'], [0.6, '#16206e'], [1, '#080a30']]} />
        <RG id={k('tq')} cx={0.38} cy={0.32} r={0.75} s={[[0, '#e6fffb'], [0.35, '#3ee0d0'], [1, '#05535a']]} />
        <RG id={k('rb')} cx={0.38} cy={0.32} r={0.75} s={[[0, '#ffd8d0'], [0.4, '#e8283c'], [1, '#5a0614']]} />
        <clipPath id={k('in')}><circle cx="50" cy="50" r="38" /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="50" fill={u('aura')} />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2 + 0.13;
        const r0 = 40, r1 = i % 2 ? 50 : 56;
        const w = 0.05;
        return <path key={i} d={`M${n1(50 + Math.cos(a - w) * r0)} ${n1(50 + Math.sin(a - w) * r0)}L${n1(50 + Math.cos(a) * r1)} ${n1(50 + Math.sin(a) * r1)}L${n1(50 + Math.cos(a + w) * r0)} ${n1(50 + Math.sin(a + w) * r0)}Z`} fill={u('rays')} />;
      })}
      {/* rosette rim with tezhip dots */}
      <path d={ROSETTE} fill={u('gold')} stroke="#3a1f02" strokeWidth="1.6" strokeLinejoin="round" />
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return <circle key={i} cx={n1(50 + Math.cos(a) * 42.6)} cy={n1(50 + Math.sin(a) * 42.6)} r="1.5" fill={i % 2 ? '#d42a3a' : '#1d3a8a'} />;
      })}
      <circle cx="50" cy="50" r="38.5" fill={u('disc')} stroke="#2a1602" strokeWidth="1.4" />
      {/* the marbled disc: gelgit chevrons drawn by the comb */}
      <g clipPath={u('in')} fill="none" strokeLinejoin="round" strokeLinecap="round">
        {chevrons.map((c, i) => {
          const y = 56 + i * 4.8;
          let d = `M8 ${y}`;
          for (let t = 0; t < 10; t++) { const x = 12 + t * 9.5; d += `L${n1(x - 2.4)} ${n1(y + 3.6)}L${n1(x + 2.4)} ${n1(y)}`; }
          return <path key={i} d={d} stroke={c} strokeWidth={i % 2 ? 1.5 : 2.6} opacity=".9" />;
        })}
        <path d="M14 40Q30 32 50 36T86 34" stroke="#fff3dc" strokeWidth="1" opacity=".4" />
      </g>
      {/* tines */}
      {Array.from({ length: tines }, (_, i) => {
        const x = 20 + i * 7.5;
        return (
          <g key={i}>
            <path d={`M${n1(x - 2.3)} 44L${n1(x - 0.9)} 80Q${n1(x)} 84 ${n1(x + 0.9)} 80L${n1(x + 2.3)} 44Z`} fill={u('tine')} stroke="#3a2002" strokeWidth=".9" strokeLinejoin="round" />
            <path d={`M${n1(x - 0.9)} 47L${n1(x - 0.3)} 77`} stroke="#fff6c8" strokeWidth=".8" strokeLinecap="round" opacity=".9" />
          </g>
        );
      })}
      {/* spine with an ogee crest */}
      <path d="M10 44Q10 36 18 36H36Q41 24 50 19Q59 24 64 36H82Q90 36 90 44Q90 50 84 50H16Q10 50 10 44Z" fill={u('spine')} stroke="#2a1602" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 40Q15 38.5 18 38.5H37.6Q42.5 27 50 22.4" fill="none" stroke="#fffbe6" strokeWidth="1.4" strokeLinecap="round" opacity=".9" />
      <path d="M15 47.5H85" stroke="#5a3204" strokeWidth="1.1" opacity=".75" />
      <g fill="none" stroke="#6b3a05" strokeWidth="1.1" strokeLinecap="round" opacity=".85">
        <path d="M16 44Q19.5 40.5 23 44T30 44" />
        <path d="M70 44Q73.5 40.5 77 44T84 44" />
      </g>
      <ellipse cx="50" cy="36.5" rx="10.5" ry="11.5" fill={u('spine')} stroke="#2a1602" strokeWidth="1.5" />
      <ellipse cx="50" cy="36.5" rx="7.4" ry="8.4" fill={u('tq')} stroke="#1f1003" strokeWidth="1" />
      <path d="M50 30.4Q54.2 33.6 52.4 38.4Q51.4 41.2 50 42.6Q48.6 41.2 47.6 38.4Q45.8 33.6 50 30.4Z" fill={u('rb')} stroke="#3a0408" strokeWidth=".8" />
      <path d="M46.8 32.4Q48.2 30 51 30.4" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity=".9" />
      <circle cx="13" cy="43" r="2.2" fill={u('rb')} stroke="#2a1602" strokeWidth=".7" />
      <circle cx="87" cy="43" r="2.2" fill={u('rb')} stroke="#2a1602" strokeWidth=".7" />
      <path d={sparkle(50, 13, 7)} fill="#fff" />
      <path d={sparkle(86, 22, 5.6)} fill="#fff" />
      <path d={sparkle(14, 24, 4.2)} fill="#fff" opacity=".9" />
      <path d={sparkle(88, 86, 3.8)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- stain badge · Boya Lekesi ×2 … ×256 ---------- */
function Stain({ k, value }: { k: K; value: number }) {
  const u = (n: string) => `url(#${k(n)})`;
  const tier = ebruStainTier(value);
  const P = EBRU_STAIN_TIERS[tier]!;
  const top = tier === 5;
  const label = `×${value}`;
  const fs = label.length >= 4 ? 30 : label.length === 3 ? 36 : 42;
  const blot = polar(50, 50, 36, (a) => 41 * (1 + 0.06 * Math.cos(3 * a + tier) + 0.04 * Math.cos(5 * a + 1.3 + tier)));
  const ring = (r: number, ph: number) => polar(50, 50, 30, (a) => r * (1 + 0.07 * Math.cos(4 * a + ph)));
  return (
    <>
      <defs>
        <RG id={k('aura')} cx={0.5} cy={0.5} r={0.5} s={[[0.45, P.glow, top ? 0.8 : 0.55], [1, P.glow, 0]]} />
        <RG id={k('blot')} cx={0.5} cy={0.5} r={0.6} fx={0.36} fy={0.3} s={[[0, P.light], [0.38, P.base], [0.85, P.deep], [1, '#05040e']]} />
        <LG id={k('gold')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#fffbe0'], [0.3, '#ffd768'], [0.7, '#c27c14'], [1, '#5a3204']]} />
        <LG id={k('txt')} s={[[0.15, '#ffffff'], [1, P.light]]} />
      </defs>
      <circle cx="50" cy="50" r="50" fill={u('aura')} />
      <path d={blot} fill={u('blot')} stroke={u('gold')} strokeWidth={top ? 4.2 : 3.2} strokeLinejoin="round" />
      <path d={ring(31, 0.3)} fill="none" stroke="#fff8ea" strokeWidth="1.2" opacity=".55" />
      <path d={ring(22, 1.1)} fill="none" stroke={P.deep} strokeWidth="1.6" opacity=".5" />
      {top && Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <circle key={i} cx={n1(50 + Math.cos(a) * 45.5)} cy={n1(50 + Math.sin(a) * 45.5)} r="2" fill="#fff6c8" />;
      })}
      <path d="M22 36C26 27 33 21 42 18" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={600} letterSpacing={-1}
        fontFamily="var(--font-barlow), 'Arial Narrow', system-ui, sans-serif" fill={u('txt')} stroke="#0a0614" strokeWidth={fs > 34 ? 6.2 : 5.4} strokeLinejoin="round" style={{ paintOrder: 'stroke fill' }}>{label}</text>
      {top && <path d={sparkle(80, 18, 7)} fill="#fff" />}
    </>
  );
}

/* ---------- public API ---------- */
/** Optical balance inside a cell. */
const SCALE: Record<EbruSymbol, number> = { c1: 1.02, c2: 1.04, c3: 1.04, c4: 1.05, c5: 1.04, c6: 1.04, c7: 1.06, c8: 1.08, drop: 1.04, comb: 1.06 };
function art(symbol: EbruSymbol, k: K): ReactNode {
  switch (symbol) {
    case 'c1': return <Tulip k={k} />;
    case 'c2': return <Carnation k={k} />;
    case 'c3': return <Hatip k={k} />;
    case 'c4': return <Leaf k={k} />;
    case 'c5': return <PeacockEye k={k} />;
    case 'c6': return <Daisy k={k} />;
    case 'c7': return <RoseRipple k={k} />;
    case 'c8': return <Pebble k={k} />;
    case 'drop': return <MasterDrop k={k} />;
    case 'comb': return <GoldComb k={k} />;
  }
}
function Shell({ k, children, size, className, scale = 1 }: { k: K; children: ReactNode; size?: number | string; className?: string; scale?: number }) {
  const dim = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;
  return (
    <svg viewBox="0 0 100 100" width={dim} height={dim} className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={k('shadow')} x="-15%" y="-15%" width="130%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.2" stdDeviation="1.6" floodColor="#02040e" floodOpacity=".6" />
        </filter>
      </defs>
      <g filter={`url(#${k('shadow')})`}>{scale === 1 ? children : <g transform={`translate(50 50) scale(${scale}) translate(-50 -50)`}>{children}</g>}</g>
    </svg>
  );
}
export function EbruSymbolArt({ symbol, size, className }: { symbol: EbruSymbol; size?: number | string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k: K = (n) => `ebs${uid}${n}`;
  return <Shell k={k} size={size} className={className} scale={SCALE[symbol]}>{art(symbol, k)}</Shell>;
}
/** Stain-multiplier badge (×2 … ×256, colour tier by value). */
export function EbruStainArt({ value, size, className }: { value: number; size?: number | string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k: K = (n) => `ebk${uid}${n}`;
  return <Shell k={k} size={size} className={className}><Stain k={k} value={value} /></Shell>;
}

/* ---------- sprite sheet ---------- */
export const EBRU_SYMBOLS: readonly EbruSymbol[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'drop', 'comb'];
const STAIN_SET = new Set(EBRU_STAIN_VALUES);
export const ebruSpriteId = (symbol: EbruSymbol) => `ebs-${symbol}`;
export const ebruStainSpriteId = (value: number) => `ebs-stain-${value}`;

/** Draws every symbol and stain badge once into a hidden SVG; mount once per page, before any <EbruSymbolUse/>. */
export const EbruSymbolSprites = memo(function EbruSymbolSprites() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        {EBRU_SYMBOLS.map((s) => <symbol key={s} id={ebruSpriteId(s)} viewBox="0 0 100 100" overflow="visible"><EbruSymbolArt symbol={s} size={100} /></symbol>)}
        {EBRU_STAIN_VALUES.map((v) => <symbol key={v} id={ebruStainSpriteId(v)} viewBox="0 0 100 100" overflow="visible"><EbruStainArt value={v} size={100} /></symbol>)}
      </defs>
    </svg>
  );
});
/** Cheap board cell art: two DOM nodes referencing the sprite. */
export const EbruSymbolUse = memo(function EbruSymbolUse({ symbol, className }: { symbol: EbruSymbol; className?: string }) {
  return <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}><use href={`#${ebruSpriteId(symbol)}`} /></svg>;
});
/** Stain badge for a cell corner (falls back to full art for values outside ×2 … ×256). */
export const EbruStainUse = memo(function EbruStainUse({ value, className }: { value: number; className?: string }) {
  if (!STAIN_SET.has(value)) return <EbruStainArt value={value} className={className} />;
  return <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}><use href={`#${ebruStainSpriteId(value)}`} /></svg>;
});
