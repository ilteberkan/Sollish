import { useId } from 'react';
import type { ReactNode } from 'react';

/* Candy Cascade symbol art. Every shape is hand-authored inline SVG (viewBox 100x100):
   multi-stop gradients, one light drop shadow, rim light, specular glints and small texture.
   No feTurbulence / blur filters, so ~30 animated instances stay cheap on a phone. */

export type CascadeArtSymbol = 'crown' | 'cupcake' | 'donut' | 'gumdrop' | 'strawberry' | 'blueberry' | 'kiwi' | 'lemon' | 'cherry' | 'star' | 'crystal';

export const SYMBOL_LABELS: Record<CascadeArtSymbol, string> = {
  crown: 'Taç makaron',
  cupcake: 'Nane kek',
  donut: 'Mor halka',
  gumdrop: 'Turuncu jöle',
  strawberry: 'Çilek',
  blueberry: 'Yaban mersini',
  kiwi: 'Kivi',
  lemon: 'Limon',
  cherry: 'Kiraz',
  star: 'Altın yıldız kurabiye',
  crystal: 'Çarpan kristali',
};

export type CrystalTier = 'amber' | 'rose' | 'violet' | 'emerald' | 'prism';

export function crystalTier(multiplier: number): CrystalTier {
  if (multiplier <= 5) return 'amber';
  if (multiplier <= 10) return 'rose';
  if (multiplier <= 20) return 'violet';
  if (multiplier <= 50) return 'emerald';
  return 'prism';
}

/* ---------- tiny helpers ---------- */
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
const starPoly = (cx: number, cy: number, R: number, r: number, n = 5, rot = -90) => {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${n1(cx + Math.cos(a) * rad)},${n1(cy + Math.sin(a) * rad)}`);
  }
  return pts.join(' ');
};
/* closed smooth path through points (quadratic midpoints) */
const smoothClosed = (pts: Array<[number, number]>) => {
  const m = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = m(pts[pts.length - 1], pts[0]);
  let d = `M${n1(start[0])} ${n1(start[1])}`;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const e = m(p, pts[(i + 1) % pts.length]);
    d += `Q${n1(p[0])} ${n1(p[1])} ${n1(e[0])} ${n1(e[1])}`;
  }
  return `${d}Z`;
};
const SHEEN = [[0, '#fff', 0.85], [1, '#fff', 0]] as const;

/* ---------- 1. crown macaron (high) ---------- */
const MAC_FOOT_TOP = (() => {
  let d = 'M9 52';
  for (let i = 0; i < 13; i++) d += 'a3.1 3.4 0 0 0 6.2 0';
  return `${d}L90 49L9 49Z`;
})();
const MAC_FOOT_BOT = (() => {
  let d = 'M9 65';
  for (let i = 0; i < 13; i++) d += 'a3.1 3.4 0 0 1 6.2 0';
  return `${d}L90 68L9 68Z`;
})();
const MAC_CREAM = (() => {
  let d = 'M8 58';
  for (let i = 0; i < 12; i++) d += 'q3.45 -6.4 6.9 0';
  return d;
})();
function Crown({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('top')} cx={0.34} cy={0.2} r={0.85} s={[[0, '#ffd0de'], [0.35, '#ff7aa2'], [0.78, '#e23468'], [1, '#a31446']]} />
        <LG id={k('bot')} s={[[0, '#ec3f78'], [0.5, '#c9275f'], [1, '#85103a']]} />
        <LG id={k('foot')} s={[[0, '#ffc2d4'], [1, '#ee4c80']]} />
        <LG id={k('cream')} s={[[0, '#fffdf4'], [0.55, '#fdeccb'], [1, '#ecc98f']]} />
        <LG id={k('gold')} x1={0.1} y1={0} x2={0.9} y2={1} s={[[0, '#fff8c8'], [0.28, '#ffe05a'], [0.62, '#f0a328'], [1, '#a95a12']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <ellipse cx="50" cy="92" rx="38" ry="3.4" fill="#2a0b1d" opacity=".35" />
      {/* bottom shell */}
      <path d="M9 65H91Q91 65 90 72C87 85 71 90 50 90C29 90 13 85 10 72Q9 65 9 65Z" fill={url('bot')} />
      <path d={MAC_FOOT_BOT} fill={url('foot')} stroke="#a3144a" strokeWidth=".8" strokeOpacity=".5" />
      <path d="M18 80C27 87 39 89 50 89" fill="none" stroke="#ffb0c8" strokeWidth="1.8" strokeLinecap="round" opacity=".55" />
      {/* piped cream */}
      <path d={`${MAC_CREAM}L91 58L91 61Q91 63 89 63H10Q8 63 8 61Z`} fill={url('cream')} stroke="#d9b172" strokeWidth=".8" strokeLinejoin="round" />
      <rect x="10" y="53" width="80" height="10" rx="5" fill={url('cream')} />
      <path d="M15 55.5H85" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".9" />
      <path d="M13 60.8Q22 63.4 31 60.8T49 60.8T67 60.8T85 60.8" fill="none" stroke="#e0b87a" strokeWidth="1" opacity=".7" />
      {[18, 34, 50, 66, 82].map((x) => <circle key={x} cx={x} cy="58" r="1.5" fill="#fff" stroke="#e0b87a" strokeWidth=".5" />)}
      {/* top shell */}
      <path d="M9 52C9 31 28 21 50 21C72 21 91 31 91 52Z" fill={url('top')} />
      <path d={MAC_FOOT_TOP} fill={url('foot')} stroke="#a3144a" strokeWidth=".8" strokeOpacity=".5" />
      <ellipse cx="30" cy="35" rx="16" ry="6.5" fill={url('sh')} transform="rotate(-26 30 35)" opacity=".85" />
      <path d="M80 38C83 42 84 46 84 49" fill="none" stroke="#ffd1df" strokeWidth="2" strokeLinecap="round" opacity=".65" />
      {[[58, 33], [68, 40], [46, 41], [74, 32], [60, 45], [24, 46], [83, 45], [38, 30], [52, 36], [30, 42]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.1 : 0.8} fill={i % 2 ? '#ffe9a0' : '#fff'} opacity=".6" />)}
      {/* gold crown */}
      <path d="M28 29L25 7L38 17L50 3L62 17L75 7L72 29Z" fill={url('gold')} stroke="#a85a10" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M31 26L29 13L38 20L49 8" fill="none" stroke="#fffbe0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".85" />
      <rect x="26.5" y="24" width="47" height="9" rx="3.6" fill={url('gold')} stroke="#a85a10" strokeWidth="1.1" />
      <circle cx="25" cy="7" r="3" fill="#fff4b0" stroke="#b86a14" strokeWidth=".9" />
      <circle cx="50" cy="3.4" r="3.4" fill="#fff4b0" stroke="#b86a14" strokeWidth=".9" />
      <circle cx="75" cy="7" r="3" fill="#fff4b0" stroke="#b86a14" strokeWidth=".9" />
      <circle cx="37" cy="28.5" r="2.5" fill="#7ee6ff" stroke="#8a4a10" strokeWidth=".6" />
      <circle cx="50" cy="28.5" r="3.2" fill="#ff5d8f" stroke="#8a4a10" strokeWidth=".6" />
      <circle cx="63" cy="28.5" r="2.5" fill="#7ee6ff" stroke="#8a4a10" strokeWidth=".6" />
      <circle cx="49" cy="27.4" r="1.1" fill="#fff" opacity=".95" />
      <path d={sparkle(82, 20, 8.5)} fill="#fff" opacity=".95" />
      <path d={sparkle(14, 70, 5)} fill="#fff" opacity=".85" />
      <path d={sparkle(20, 22, 3.6)} fill="#fff" opacity=".8" />
    </>
  );
}

/* ---------- 2. mint cupcake (high) ---------- */
function Cupcake({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const sprinkles: Array<[number, number, number, string]> = [
    [26, 52, -30, '#ff7fa9'], [42, 58, 20, '#ffe066'], [64, 55, -15, '#ff7fa9'], [76, 50, 40, '#fff'], [33, 41, 50, '#fff'], [58, 40, -40, '#ffe066'],
    [68, 34, 20, '#c3a4ff'], [44, 31, -20, '#ff7fa9'], [54, 24, 30, '#fff'], [38, 22, 0, '#ffe066'],
  ];
  return (
    <>
      <defs>
        <RG id={k('mint')} cx={0.35} cy={0.28} r={0.85} s={[[0, '#effff9'], [0.3, '#9bf5da'], [0.7, '#31cdb2'], [1, '#12907f']]} />
        <LG id={k('liner')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#d98a3e'], [0.2, '#ffd493'], [0.5, '#fff0cf'], [0.8, '#f4b563'], [1, '#c4752a']]} />
        <LG id={k('rim')} s={[[0, '#fff3c4'], [0.5, '#f1b457'], [1, '#b8691a']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      {/* liner */}
      <path d="M17 58H83L75.5 89Q74.5 92.5 71 92.5H29Q25.5 92.5 24.5 89Z" fill={url('liner')} stroke="#a85f1c" strokeWidth="1" strokeLinejoin="round" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const t = (i + 0.5) / 7;
        const x1 = 17 + t * 66;
        const x2 = 24.5 + t * 51;
        return <path key={i} d={`M${n1(x1)} 60L${n1(x2)} 91`} stroke="#c2742a" strokeWidth="1.1" opacity=".42" />;
      })}
      <path d="M26 62L31 88" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".45" />
      {/* frosting tiers */}
      <ellipse cx="50" cy="51" rx="41" ry="14" fill={url('mint')} stroke="#0f7f72" strokeWidth=".9" />
      <ellipse cx="50" cy="37" rx="30" ry="12.5" fill={url('mint')} stroke="#0f7f72" strokeWidth=".9" />
      <path d="M31 30C30 21 40 16 50 17C60 17 68 21 67 29C60 38 38 38 31 30Z" fill={url('mint')} stroke="#0f7f72" strokeWidth=".9" />
      <path d="M38 22C40 14 49 10 57 8C55 12 59 14 61 18C58 25 44 26 38 22Z" fill={url('mint')} stroke="#0f7f72" strokeWidth=".9" />
      {/* swirl highlights */}
      <path d="M14 55C26 62 70 62 86 53" fill="none" stroke="#0d7b6e" strokeWidth="1.2" opacity=".35" />
      <path d="M22 42C26 36 38 33 50 36" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".8" />
      <path d="M34 31C37 26 45 23 52 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".8" />
      <path d="M18 51C18 47 22 44 26 43" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".75" />
      <path d="M60 41C68 42 74 40 78 36" fill="none" stroke="#0d7b6e" strokeWidth="1.2" opacity=".3" />
      {/* rim */}
      <rect x="13" y="56" width="74" height="8" rx="4" fill={url('rim')} stroke="#a85f1c" strokeWidth="1" />
      <path d="M18 59H48" stroke="#fffbe6" strokeWidth="1.5" strokeLinecap="round" opacity=".85" />
      {/* sprinkles */}
      {sprinkles.map(([x, y, r, c], i) => <rect key={i} x={x - 2.4} y={y - 0.9} width="4.8" height="1.8" rx=".9" fill={c} transform={`rotate(${r} ${x} ${y})`} stroke="#0b5f55" strokeWidth=".25" strokeOpacity=".5" />)}
      {/* sugar star on top */}
      <polygon points={starPoly(59, 8, 8, 3.8)} fill="#ffe27a" stroke="#c98a14" strokeWidth="1.2" strokeLinejoin="round" />
      <polygon points={starPoly(58.4, 7.6, 3.6, 1.8)} fill="#fff8d2" />
      <path d={sparkle(76, 14, 5)} fill="#fff" opacity=".9" />
    </>
  );
}

/* ---------- 3. lavender donut (high) ---------- */
const GLAZE_PATH = (() => {
  const pts: Array<[number, number]> = [];
  const N = 44;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let r = 1 + 0.035 * Math.sin(7 * a + 1) + 0.025 * Math.sin(12 * a + 0.4);
    for (const th of [1.1, 1.75, 2.5]) { const d = Math.atan2(Math.sin(a - th), Math.cos(a - th)); r += 0.075 * Math.exp(-(d * d) / 0.02); }
    pts.push([50 + Math.cos(a) * 42 * r, 49 + Math.sin(a) * 32.5 * r]);
  }
  return smoothClosed(pts);
})();
function Donut({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const sprinkles: Array<[number, number, number, string]> = [
    [24, 42, 20, '#fff'], [34, 29, -30, '#ffc94a'], [49, 24, 10, '#fff'], [65, 28, 35, '#7de8cc'], [78, 38, -20, '#fff'],
    [84, 52, 50, '#ff8fb3'], [74, 64, 15, '#fff'], [60, 70, -35, '#ffc94a'], [43, 72, 25, '#fff'], [29, 66, -15, '#7de8cc'],
    [19, 54, 60, '#ff8fb3'], [30, 53, -40, '#ffc94a'], [70, 51, 30, '#fff'], [64, 40, -10, '#ff8fb3'], [38, 40, 45, '#fff'], [55, 60, 70, '#fff'],
  ];
  return (
    <>
      <defs>
        <RG id={k('dough')} cx={0.4} cy={0.3} r={0.8} s={[[0, '#f6c37a'], [0.6, '#d98d3d'], [1, '#9a5518']]} />
        <RG id={k('glaze')} cx={0.36} cy={0.26} r={0.85} s={[[0, '#f2e6ff'], [0.35, '#c9a6ff'], [0.75, '#9468e6'], [1, '#6a3fbc']]} />
        <RG id={k('hole')} cx={0.5} cy={0.25} r={0.75} s={[[0, '#8d5a28'], [0.6, '#4b2a14'], [1, '#2a170c']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <ellipse cx="50" cy="58" rx="43" ry="34" fill={url('dough')} stroke="#7f4311" strokeWidth="1" />
      <path d={GLAZE_PATH} fill={url('glaze')} stroke="#5f35ae" strokeWidth="1" strokeLinejoin="round" />
      <path d="M12 52C12 70 30 82 50 82C66 82 80 74 86 62" fill="none" stroke="#6a3fbc" strokeWidth="2" strokeLinecap="round" opacity=".35" />
      <ellipse cx="50" cy="49" rx="17" ry="12" fill="#b995f5" stroke="#5f35ae" strokeWidth=".9" />
      <ellipse cx="50" cy="49.5" rx="14.5" ry="10" fill={url('hole')} />
      <path d="M38 53C42 58 58 58 62 53" fill="none" stroke="#e9ac61" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
      <path d="M36 44C40 39 60 39 64 44" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
      <ellipse cx="29" cy="33" rx="15" ry="5.6" fill={url('sh')} transform="rotate(-30 29 33)" opacity=".85" />
      <path d="M14 56C14 58 15 60 17 62" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".5" />
      {sprinkles.map(([x, y, r, c], i) => <rect key={i} x={x - 3} y={y - 1.1} width="6" height="2.2" rx="1.1" fill={c} transform={`rotate(${r} ${x} ${y})`} stroke="#4d2a96" strokeWidth=".35" strokeOpacity=".45" />)}
      <path d={sparkle(82, 20, 6)} fill="#fff" opacity=".95" />
    </>
  );
}

/* ---------- 4. orange sugar gumdrop (high) ---------- */
function Gumdrop({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const dome = 'M8 54A42 42 0 0 1 92 54C94 66 93 76 92 82C91 88 78 91 50 91C22 91 9 88 8 82C7 76 6 66 8 54Z';
  return (
    <>
      <defs>
        <RG id={k('jelly')} cx={0.4} cy={0.34} r={0.78} s={[[0, '#ffe7b8'], [0.28, '#ffb64e'], [0.68, '#f37a14'], [1, '#c24a0a']]} />
        <RG id={k('core')} cx={0.5} cy={0.6} r={0.5} s={[[0, '#ffd27a', 0.6], [1, '#ffd27a', 0]]} />
        <LG id={k('base')} s={[[0, '#ffa23a', 0], [0.6, '#d4560e', 0.55], [1, '#a23a08', 0.85]]} />
        <pattern id={k('sugar')} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <circle cx="1.4" cy="1.8" r=".8" fill="#fff" opacity=".8" />
          <circle cx="5.6" cy="1" r=".55" fill="#fff0c8" opacity=".85" />
          <circle cx="3.8" cy="4.8" r=".85" fill="#fff" opacity=".65" />
          <circle cx="7" cy="6.6" r=".55" fill="#fff" opacity=".8" />
          <circle cx=".8" cy="6.5" r=".5" fill="#ffd9a0" opacity=".9" />
        </pattern>
        <LG id={k('sh')} s={SHEEN} />
        <clipPath id={k('clip')}><path d={dome} /></clipPath>
      </defs>
      <path d={dome} fill={url('jelly')} stroke="#a23a08" strokeWidth="1" />
      <g clipPath={`url(#${k('clip')})`}>
        <ellipse cx="54" cy="66" rx="30" ry="22" fill={url('core')} />
        <rect x="0" y="62" width="100" height="40" fill={url('base')} />
        <rect x="0" y="0" width="100" height="100" fill={url('sugar')} opacity=".6" />
        <path d="M70 24C84 34 90 52 88 74" fill="none" stroke="#ffe9bd" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      </g>
      <path d="M10 80C14 87 32 89.5 50 89.5C68 89.5 86 87 90 80" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeDasharray="0.1 3.3" opacity=".95" />
      <path d={dome} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.1 3.6" opacity=".5" />
      <ellipse cx="31" cy="36" rx="13" ry="20" fill={url('sh')} transform="rotate(30 31 36)" opacity=".9" />
      <ellipse cx="19" cy="64" rx="2.8" ry="7" fill="#fff" opacity=".5" transform="rotate(8 19 64)" />
      <path d={sparkle(74, 26, 8)} fill="#fff" opacity=".98" />
      <path d={sparkle(84, 50, 4)} fill="#fff" opacity=".85" />
      <path d={sparkle(18, 18, 3.6)} fill="#fff" opacity=".8" />
    </>
  );
}

/* ---------- 5. strawberry (low) ---------- */
function Strawberry({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const seeds: Array<[number, number, number]> = [
    [32, 42, -20], [46, 40, 0], [60, 40, 0], [72, 43, 20], [24, 54, -25], [38, 53, -8], [52, 52, 0], [66, 53, 8], [78, 55, 25],
    [31, 65, -22], [45, 65, -6], [59, 65, 6], [72, 66, 22], [38, 76, -15], [51, 77, 0], [64, 76, 15], [50, 86, 0],
  ];
  return (
    <>
      <defs>
        <RG id={k('berry')} cx={0.34} cy={0.3} r={0.85} s={[[0, '#ffa4a8'], [0.35, '#ff4a5e'], [0.8, '#cf1238'], [1, '#8a0a28']]} />
        <LG id={k('leaf')} x1={0.2} y1={0} x2={0.8} y2={1} s={[[0, '#c4f58a'], [0.5, '#52b84a'], [1, '#237a38']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <path d="M50 94C30 83 10 65 11 41C12 28 24 22 36 25C42 27 46 28 50 27C54 28 58 27 64 25C76 22 88 28 89 41C90 65 70 83 50 94Z" fill={url('berry')} stroke="#7d0a26" strokeWidth="1" strokeLinejoin="round" />
      <path d="M80 50C79 62 70 74 56 86" fill="none" stroke="#7d0a26" strokeWidth="3" strokeLinecap="round" opacity=".22" />
      {seeds.map(([x, y, r], i) => (
        <g key={i} transform={`rotate(${r} ${x} ${y})`}>
          <ellipse cx={x} cy={y + 0.9} rx="1.8" ry="2.7" fill="#7d0a26" opacity=".5" />
          <ellipse cx={x} cy={y} rx="1.6" ry="2.5" fill="#ffe9a8" stroke="#c78a2a" strokeWidth=".4" />
        </g>
      ))}
      <ellipse cx="29" cy="46" rx="6.5" ry="13" fill={url('sh')} transform="rotate(14 29 46)" opacity=".8" />
      {/* calyx */}
      {[-78, -40, 0, 40, 78].map((a) => (
        <path key={a} transform={`translate(50 25) rotate(${a})`} d="M0 0C-8 -1 -10 7 -1.5 17C-0.6 18.2 0.6 18.2 1.5 17C10 7 8 -1 0 0Z" fill={url('leaf')} stroke="#1b6430" strokeWidth=".9" strokeLinejoin="round" />
      ))}
      <path d="M0 3V12" transform="translate(50 25) rotate(-40)" stroke="#e5ffc0" strokeWidth=".8" strokeLinecap="round" opacity=".6" />
      <path d="M0 3V12" transform="translate(50 25) rotate(40)" stroke="#e5ffc0" strokeWidth=".8" strokeLinecap="round" opacity=".6" />
      <circle cx="50" cy="25" r="3.4" fill="#2f8f3e" stroke="#1b6430" strokeWidth=".8" />
      <path d="M50 24C50 18 52 13 57 9" fill="none" stroke="#3b9d3f" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M50 24C50 18 52 13 57 9" fill="none" stroke="#bff08a" strokeWidth="1.2" strokeLinecap="round" opacity=".8" />
      <path d={sparkle(78, 30, 4)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- 6. blueberry cluster (low) ---------- */
function Blueberry({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const berry = (cx: number, cy: number, r: number, key: string) => (
    <g key={key}>
      <circle cx={cx} cy={cy} r={r} fill={url('bb')} stroke="#141a6b" strokeWidth="1" />
      <ellipse cx={cx} cy={cy + r * 0.62} rx={r * 0.7} ry={r * 0.32} fill="#0e1250" opacity=".28" />
      <ellipse cx={cx - r * 0.3} cy={cy - r * 0.42} rx={r * 0.5} ry={r * 0.26} fill={url('bloom')} transform={`rotate(-30 ${cx - r * 0.3} ${cy - r * 0.42})`} />
      <circle cx={cx + r * 0.1} cy={cy - r * 0.08} r={r * 0.2} fill="#0f1355" />
      <polygon points={starPoly(cx + r * 0.1, cy - r * 0.08, r * 0.3, r * 0.14)} fill="#262d9a" stroke="#0f1355" strokeWidth=".6" strokeLinejoin="round" />
      <circle cx={cx + r * 0.1} cy={cy - r * 0.08} r={r * 0.07} fill="#5b66e8" />
      <circle cx={cx + r * 0.52} cy={cy + r * 0.38} r={r * 0.09} fill="#aab4ff" opacity=".55" />
    </g>
  );
  return (
    <>
      <defs>
        <RG id={k('bb')} cx={0.34} cy={0.28} r={0.85} s={[[0, '#a6b4ff'], [0.35, '#5767ee'], [0.75, '#2a309f'], [1, '#161a66']]} />
        <RG id={k('bloom')} s={[[0, '#fff', 0.85], [0.6, '#dfe3ff', 0.35], [1, '#c9d0ff', 0]]} />
        <LG id={k('leaf')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#c4f58a'], [1, '#2f9a40']]} />
      </defs>
      <path d="M52 22C58 8 72 6 82 12C76 22 64 26 52 22Z" fill={url('leaf')} stroke="#1b6430" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M54 21C62 17 70 14 78 12" fill="none" stroke="#e5ffc0" strokeWidth=".9" opacity=".7" />
      {berry(50, 33, 21, 'c')}
      {berry(29, 66, 23, 'a')}
      {berry(71, 66, 23, 'b')}
      <path d={sparkle(86, 38, 4.4)} fill="#fff" opacity=".9" />
    </>
  );
}

/* ---------- 7. kiwi slice (low) ---------- */
function Kiwi({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const rays = Array.from({ length: 24 }, (_, i) => (i * 360) / 24);
  const seeds = Array.from({ length: 16 }, (_, i) => (i * 360) / 16 + 7);
  return (
    <>
      <defs>
        <RG id={k('skin')} cx={0.4} cy={0.32} r={0.8} s={[[0, '#b9834d'], [0.7, '#8a5a2b'], [1, '#5c3a18']]} />
        <RG id={k('flesh')} cx={0.5} cy={0.5} r={0.5} s={[[0.3, '#c8ef4f'], [0.75, '#7ed12e'], [1, '#43a11f']]} />
        <RG id={k('core')} cx={0.5} cy={0.45} r={0.55} s={[[0, '#ffffff'], [0.65, '#f4ffd6'], [1, '#d6ec97']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <circle cx="50" cy="50" r="44" fill={url('skin')} stroke="#4d2f12" strokeWidth="1" />
      <circle cx="50" cy="50" r="42.4" fill="none" stroke="#d3a46c" strokeWidth="2.4" strokeDasharray="0.2 2.8" strokeLinecap="round" opacity=".7" />
      <circle cx="50" cy="50" r="38.5" fill="#f0ffc9" />
      <circle cx="50" cy="50" r="36.5" fill={url('flesh')} />
      <g transform="translate(50 50)">
        {rays.map((a, i) => <line key={i} x1="0" y1="-15" x2="0" y2={i % 2 ? -29 : -34} transform={`rotate(${a})`} stroke="#e4ff8e" strokeWidth={i % 2 ? 0.8 : 1.5} strokeLinecap="round" opacity=".6" />)}
        <circle r="14.5" fill={url('core')} stroke="#bcd97a" strokeWidth=".9" />
        {seeds.map((a, i) => (
          <g key={i} transform={`rotate(${a}) translate(0 -20.5)`}>
            <ellipse rx="1.7" ry="2.9" fill="#1d2a10" />
            <ellipse cx="-.5" cy="-.9" rx=".5" ry="1" fill="#6b7b4a" opacity=".8" />
          </g>
        ))}
      </g>
      <path d="M17 40C22 25 34 16 48 14" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".75" />
      <ellipse cx="36" cy="30" rx="12" ry="4.6" fill={url('sh')} transform="rotate(-38 36 30)" opacity=".45" />
      <path d={sparkle(77, 24, 4.6)} fill="#fff" opacity=".9" />
    </>
  );
}

/* ---------- 8. lemon wedge (low) ---------- */
function Lemon({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const cx = 50;
  const cy = 34;
  const seg = (i: number) => {
    const n = 5;
    const R = 33;
    const r0 = 4;
    const b0 = (i * Math.PI) / n + 0.05;
    const b1 = ((i + 1) * Math.PI) / n - 0.05;
    const P = (b: number, r: number) => `${n1(cx + Math.cos(b) * r)} ${n1(cy + Math.sin(b) * r)}`;
    return `M${P(b0, r0)}L${P(b0, R)}A${R} ${R} 0 0 1 ${P(b1, R)}L${P(b1, r0)}Z`;
  };
  return (
    <>
      <defs>
        <LG id={k('rind')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#fff27a'], [0.45, '#ffd51a'], [1, '#e8a600']]} />
        <RG id={k('flesh')} cx={0.5} cy={0.1} r={0.95} s={[[0, '#fff3a0'], [0.55, '#ffe040'], [1, '#ffc417']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <g transform="rotate(-14 50 50)">
        <path d="M5 34H95A45 45 0 0 1 5 34Z" fill={url('rind')} stroke="#b27a00" strokeWidth="1" strokeLinejoin="round" />
        <path d="M10 34H90A40 40 0 0 1 10 34Z" fill="#fffbe0" />
        <path d="M13 34H87A37 37 0 0 1 13 34Z" fill={url('flesh')} />
        {[0, 1, 2, 3, 4].map((i) => <path key={i} d={seg(i)} fill={i % 2 ? '#ffe44a' : '#ffd52a'} stroke="#f6b813" strokeWidth=".8" strokeLinejoin="round" opacity=".92" />)}
        {[[28, 52], [42, 62], [58, 62], [72, 52], [50, 48]].map(([x, y], i) => <path key={i} d={`M${x} ${y - 6}L${x} ${y + 3}`} stroke="#fffbd0" strokeWidth="1.3" strokeLinecap="round" opacity=".55" />)}
        <path d="M8 34H92" stroke="#b27a00" strokeWidth="1" opacity=".5" />
        <path d="M11 30C12 25 14 21 17 18" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".7" />
        <path d="M9 40C16 60 32 74 50 78" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".6" />
        <path d="M26 81C40 88 60 88 74 81" fill="none" stroke="#b27a00" strokeWidth="2" strokeLinecap="round" opacity=".18" />
      </g>
      <path d="M84 62C88 68 90 72 87 76C83 78 80 74 81 70C82 67 83 64 84 62Z" fill="#fff6a3" stroke="#d9a000" strokeWidth=".8" />
      <circle cx="84" cy="72" r="1.2" fill="#fff" />
      <path d={sparkle(22, 20, 5)} fill="#fff" opacity=".95" />
    </>
  );
}

/* ---------- 9. cherry pair (low) ---------- */
function Cherry({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const fruit = (cx: number, cy: number, r: number, key: string) => (
    <g key={key}>
      <path d={`M${cx - r * 0.97} ${cy - r * 0.18}C${cx - r * 0.97} ${cy - r * 0.95} ${cx - r * 0.12} ${cy - r * 1.08} ${cx} ${cy - r * 0.74}C${cx + r * 0.12} ${cy - r * 1.08} ${cx + r * 0.97} ${cy - r * 0.95} ${cx + r * 0.97} ${cy - r * 0.18}C${cx + r * 0.97} ${cy + r * 0.7} ${cx + r * 0.5} ${cy + r} ${cx} ${cy + r}C${cx - r * 0.5} ${cy + r} ${cx - r * 0.97} ${cy + r * 0.7} ${cx - r * 0.97} ${cy - r * 0.18}Z`} fill={url('ch')} stroke="#6e0615" strokeWidth="1" strokeLinejoin="round" />
      <ellipse cx={cx} cy={cy - r * 0.72} rx={r * 0.2} ry={r * 0.09} fill="#5c0412" opacity=".7" />
      <ellipse cx={cx - r * 0.38} cy={cy - r * 0.22} rx={r * 0.24} ry={r * 0.42} fill={url('sh')} transform={`rotate(18 ${cx - r * 0.38} ${cy - r * 0.22})`} opacity=".85" />
      <ellipse cx={cx + r * 0.55} cy={cy + r * 0.4} rx={r * 0.1} ry={r * 0.2} fill="#ff9aa0" opacity=".55" transform={`rotate(-30 ${cx + r * 0.55} ${cy + r * 0.4})`} />
    </g>
  );
  return (
    <>
      <defs>
        <RG id={k('ch')} cx={0.34} cy={0.3} r={0.85} s={[[0, '#ff9a9a'], [0.32, '#f02843'], [0.75, '#b30c25'], [1, '#6c0616']]} />
        <LG id={k('stem')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#9ad45a'], [1, '#4c7c26']]} />
        <LG id={k('leaf')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#c9f78e'], [0.6, '#4cb446'], [1, '#237a38']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <path d="M31 49C31 34 44 20 59 10" fill="none" stroke="#3c5c1a" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M31 49C31 34 44 20 59 10" fill="none" stroke={url('stem')} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M69 46C69 32 65 21 59 10" fill="none" stroke="#3c5c1a" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M69 46C69 32 65 21 59 10" fill="none" stroke={url('stem')} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M58 11C64 2 80 0 90 8C86 20 68 22 58 11Z" fill={url('leaf')} stroke="#1b6430" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M60 11C68 9 77 8 86 8" fill="none" stroke="#e5ffc0" strokeWidth=".9" opacity=".75" />
      {fruit(30, 71, 21, 'l')}
      {fruit(70, 67, 20, 'r')}
      <path d={sparkle(88, 44, 4)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- 10. golden star cookie (scatter) ---------- */
function Star({ k }: { k: (n: string) => string }) {
  const url = (n: string) => `url(#${k(n)})`;
  const tips: Array<[number, number]> = Array.from({ length: 5 }, (_, i) => {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    return [50 + Math.cos(a) * 33, 51 + Math.sin(a) * 33];
  });
  return (
    <>
      <defs>
        <RG id={k('aura')} s={[[0, '#fff2a8', 0.75], [0.55, '#ffd24a', 0.3], [1, '#ffb400', 0]]} />
        <RG id={k('glaze')} cx={0.38} cy={0.28} r={0.85} s={[[0, '#fffbd0'], [0.3, '#ffe263'], [0.7, '#ffb52a'], [1, '#e08511']]} />
        <LG id={k('edge')} s={[[0, '#d98a2c'], [1, '#8f4a12']]} />
        <LG id={k('emb')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#fff6b8'], [1, '#e8941c']]} />
        <RG id={k('rays')} s={[[0.2, '#fff6c0', 0.8], [1, '#ffd24a', 0]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <circle cx="50" cy="50" r="49" fill={url('aura')} />
      <polygon points={starPoly(50, 50, 52, 7, 10, -90 + 9)} fill={url('rays')} opacity=".7" />
      {/* cookie body (baked edge) */}
      <polygon points={starPoly(50, 56, 38, 20)} fill={url('edge')} stroke={`url(#${k('edge')})`} strokeWidth="8" strokeLinejoin="round" />
      {/* glaze */}
      <polygon points={starPoly(50, 51, 37, 19.5)} fill={url('glaze')} stroke="#a85e10" strokeWidth="9.4" strokeLinejoin="round" paintOrder="stroke" />
      <polygon points={starPoly(50, 51, 37, 19.5)} fill={url('glaze')} stroke={url('glaze')} strokeWidth="7.4" strokeLinejoin="round" />
      <polygon points={starPoly(50, 51, 37, 19.5)} fill="none" stroke="#fff6b8" strokeWidth="1.4" strokeLinejoin="round" opacity=".7" transform="translate(-.4 -.6)" />
      {/* embossed inner star */}
      <polygon points={starPoly(50, 53, 21, 10.5)} fill={url('emb')} stroke="#d9871a" strokeWidth="3" strokeLinejoin="round" opacity=".9" />
      <polygon points={starPoly(50, 52, 17, 8.4)} fill="#fff4b0" stroke="#fff4b0" strokeWidth="2" strokeLinejoin="round" opacity=".75" />
      {/* pearl sugar on tips */}
      {tips.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="2.8" fill="#fffdf0" stroke="#c98a1e" strokeWidth=".7" /><circle cx={x - 0.7} cy={y - 0.8} r=".9" fill="#fff" /></g>)}
      {[[42, 40], [60, 38], [34, 60], [66, 62], [50, 70], [28, 44], [72, 44]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".9" fill="#fff" opacity=".8" />)}
      <ellipse cx="38" cy="36" rx="12" ry="4.6" fill={url('sh')} transform="rotate(-38 38 36)" opacity=".8" />
      <path d={sparkle(82, 17, 11)} fill="#fff" />
      <path d={sparkle(82, 17, 11)} fill="none" stroke="#ffd24a" strokeWidth=".6" opacity=".8" />
      <path d={sparkle(14, 70, 6)} fill="#fff" opacity=".95" />
      <path d={sparkle(22, 14, 4)} fill="#fff" opacity=".9" />
    </>
  );
}

/* ---------- 11. multiplier crystal ---------- */
type Palette = { light: string; mid: string; dark: string; deep: string; edge: string; glow: string; facets: readonly [string, string, string, string, string, string] };
const TIERS: Record<CrystalTier, Palette> = {
  amber: { light: '#fff0b4', mid: '#ffc23d', dark: '#d9801a', deep: '#a8530e', edge: '#7a3a08', glow: '#ffd26a', facets: ['#ffe58a', '#f6aa2c', '#c4690f', '#d9801a', '#f9bd45', '#fff0b4'] },
  rose: { light: '#ffd8e6', mid: '#ff6fa3', dark: '#d02c6c', deep: '#9c1650', edge: '#6d0c38', glow: '#ff8fba', facets: ['#ffb0cd', '#f0508a', '#b5215c', '#d02c6c', '#ff7fae', '#ffd8e6'] },
  violet: { light: '#e9dcff', mid: '#a47dff', dark: '#6a37d6', deep: '#472199', edge: '#2d1066', glow: '#b99cff', facets: ['#cdb5ff', '#8a5df0', '#4f27b3', '#6a37d6', '#a98aff', '#e9dcff'] },
  emerald: { light: '#d3ffe8', mid: '#45e09a', dark: '#12985f', deep: '#0b6a42', edge: '#054027', glow: '#6ff0b2', facets: ['#a6f7cf', '#2fd187', '#0c7b4c', '#12985f', '#5aeaa8', '#d3ffe8'] },
  prism: { light: '#ffffff', mid: '#9ee9ff', dark: '#b266f0', deep: '#6c34b8', edge: '#2d1a63', glow: '#f2dcff', facets: ['#bff3ff', '#ffa9d9', '#a58cff', '#7fe4ff', '#ffe09a', '#ffffff'] },
};
function Crystal({ k, multiplier }: { k: (n: string) => string; multiplier?: number }) {
  const url = (n: string) => `url(#${k(n)})`;
  const tier = crystalTier(multiplier ?? 2);
  const P = TIERS[tier];
  const R = 44;
  const r = 31;
  const ang = (i: number) => ((-90 + i * 60) * Math.PI) / 180;
  const O = Array.from({ length: 6 }, (_, i) => [50 + Math.cos(ang(i)) * R, 50 + Math.sin(ang(i)) * R] as const);
  const I = Array.from({ length: 6 }, (_, i) => [50 + Math.cos(ang(i)) * r, 50 + Math.sin(ang(i)) * r] as const);
  const pts = (a: ReadonlyArray<readonly [number, number]>) => a.map(([x, y]) => `${n1(x)},${n1(y)}`).join(' ');
  const label = multiplier === undefined ? '' : `${multiplier}×`;
  const fs = label.length >= 4 ? 23 : label.length === 3 ? 28 : 35;
  const prism = tier === 'prism';
  return (
    <>
      <defs>
        <RG id={k('aura')} s={[[0.45, P.glow, prism ? 0.6 : 0.4], [1, P.glow, 0]]} />
        <RG id={k('face')} cx={0.4} cy={0.3} r={0.85} s={prism ? [[0, '#ffffff'], [0.35, '#d7c6ff'], [0.7, '#9a6ae8'], [1, '#5c2fb0']] : [[0, P.light], [0.3, P.mid], [0.75, P.dark], [1, P.deep]]} />
        <LG id={k('rim')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#ffffff'], [0.5, P.mid], [1, P.edge]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      {prism && <circle cx="50" cy="50" r="50" fill={url('aura')} />}
      {!prism && <circle cx="50" cy="50" r="48" fill={url('aura')} />}
      <polygon points={pts(O)} fill={P.deep} stroke={P.edge} strokeWidth="3.2" strokeLinejoin="round" />
      {O.map((o, i) => {
        const o2 = O[(i + 1) % 6];
        const i2 = I[(i + 1) % 6];
        return <polygon key={i} points={`${n1(o[0])},${n1(o[1])} ${n1(o2[0])},${n1(o2[1])} ${n1(i2[0])},${n1(i2[1])} ${n1(I[i][0])},${n1(I[i][1])}`} fill={P.facets[i]} stroke={P.edge} strokeWidth=".6" strokeOpacity=".5" strokeLinejoin="round" />;
      })}
      <polygon points={pts(I)} fill={url('face')} stroke={P.edge} strokeWidth=".9" strokeOpacity=".6" strokeLinejoin="round" />
      <polygon points={pts(O)} fill="none" stroke={url('rim')} strokeWidth="1.6" strokeLinejoin="round" />
      {/* inner glass sheen */}
      <polygon points={`${n1(I[5][0])},${n1(I[5][1])} ${n1(I[0][0])},${n1(I[0][1])} ${n1(I[1][0])},${n1(I[1][1])} 50,38`} fill={url('sh')} opacity=".42" />
      <path d={`M${n1(O[5][0] + 3)} ${n1(O[5][1] + 5)}L${n1(O[0][0] - 2)} ${n1(O[0][1] + 3)}`} stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" />
      {[[26, 34, 0.7], [70, 28, 0.5], [76, 62, 0.5], [34, 74, 0.45]].map(([x, y, o], i) => <circle key={i} cx={x} cy={y} r=".9" fill="#fff" opacity={o} />)}
      {prism && <polygon points={pts(O)} fill="none" stroke="#ffe9a0" strokeWidth=".9" strokeDasharray="1 3" strokeLinecap="round" opacity=".9" />}
      {label && (
        <text x="50" y="51" textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={900} fontFamily="var(--font-barlow), 'Arial Black', system-ui, sans-serif" fill="#fff" stroke={P.edge} strokeWidth={fs > 30 ? 6 : 5.4} strokeLinejoin="round" style={{ paintOrder: 'stroke fill' }}>{label}</text>
      )}
      <path d={sparkle(80, 18, prism ? 9 : 7)} fill="#fff" opacity=".95" />
      <path d={sparkle(17, 76, 4.2)} fill="#fff" opacity=".8" />
    </>
  );
}

/* ---------- public component ---------- */
export function SymbolArt({ symbol, multiplier, size, className }: { symbol: CascadeArtSymbol; multiplier?: number; size?: number | string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `cs${uid}${n}`;
  const dim = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;
  let art: ReactNode;
  switch (symbol) {
    case 'crown': art = <Crown k={k} />; break;
    case 'cupcake': art = <Cupcake k={k} />; break;
    case 'donut': art = <Donut k={k} />; break;
    case 'gumdrop': art = <Gumdrop k={k} />; break;
    case 'strawberry': art = <Strawberry k={k} />; break;
    case 'blueberry': art = <Blueberry k={k} />; break;
    case 'kiwi': art = <Kiwi k={k} />; break;
    case 'lemon': art = <Lemon k={k} />; break;
    case 'cherry': art = <Cherry k={k} />; break;
    case 'star': art = <Star k={k} />; break;
    case 'crystal': art = <Crystal k={k} multiplier={multiplier} />; break;
  }
  return (
    <svg viewBox="0 0 100 100" width={dim} height={dim} className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={k('shadow')} x="-15%" y="-15%" width="130%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.6" stdDeviation="2" floodColor="#05060f" floodOpacity=".5" />
        </filter>
      </defs>
      <g filter={`url(#${k('shadow')})`}>{art}</g>
    </svg>
  );
}
