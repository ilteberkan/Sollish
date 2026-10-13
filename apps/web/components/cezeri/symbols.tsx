import { memo, useId } from 'react';
import type { ReactNode } from 'react';
import type { CezeriSymbol } from '@sollish/protocol';

/* Cezeri: Zamanın Çarkları symbol art. Ten pieces from a 12th-century automaton workshop, drawn as original
   code-drawn "engineering manuscript" plates: flat miniature colours (lapis, turquoise, vermilion, ivory) on
   polished brass, an ink outline that holds at 28 px, gold-leaf hairlines, one specular stroke from the upper
   left and one cheap feDropShadow. Silhouettes are all different so they read in grayscale and with colour
   blindness:
     h1 Fil Saati        elephant carrying a domed clock tower      (wide body + tower)
     h2 Otomat Davulcu   automaton drummer behind a kettle drum      (figure with raised arms)
     h3 Su Saati Kalesi  water-clock gate with zodiac dial           (crenellated block)
     h4 Tavus Çeşmesi    peacock fountain on a basin                 (fan)
     l1 Usturlap         lapis astrolabe with rete and ring          (disc + ring on top)
     l2 Çini Yıldızı     turquoise eight-point tile star             (8-point star)
     l3 Bakır Kepçe      copper scoop pouring water                  (diagonal ladle)
     l4 Makara           plum pulley block with hooks                (vertical, hooks top and bottom)
     gear  Altın Dişli   golden toothed gear, ruby hub (wild)        (toothed disc)
     vessel Su Kabı      turquoise-glazed ewer pouring (scatter)     (ewer with spout and handle)
   viewBox 100 × 100, upright. Boards draw through <CezeriSymbolSprites/> + <CezeriSymbolUse/> (two DOM nodes
   per cell). Hand-authored, not traced from any real artwork. */

export type { CezeriSymbol };

export const CEZERI_SYMBOL_LABELS: Record<CezeriSymbol, string> = {
  h1: 'Fil Saati',
  h2: 'Otomat Davulcu',
  h3: 'Su Saati Kalesi',
  h4: 'Tavus Çeşmesi',
  l1: 'Usturlap',
  l2: 'Çini Yıldızı',
  l3: 'Bakır Kepçe',
  l4: 'Makara',
  gear: 'Altın Dişli (joker)',
  vessel: 'Su Kabı',
};
export const CEZERI_SYMBOLS: readonly CezeriSymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'gear', 'vessel'];

/** Shared palette (also used by the board, the frame and the FX canvas). */
export const CZ_PALETTE = {
  ink: '#1a0d05',
  brass: { hi: '#fff4c4', light: '#f6d27a', base: '#d9a441', deep: '#8f5a17', dark: '#4a2a08' },
  turq: { hi: '#d8fff8', light: '#7fe8dc', base: '#1fb3ab', deep: '#0b6b70', dark: '#053238' },
  lapis: { hi: '#c9d6ff', light: '#6f8cff', base: '#2c47c0', deep: '#16226e', dark: '#080d36' },
  verm: { hi: '#ffd2c4', light: '#ff7a64', base: '#d6302c', deep: '#7c1014', dark: '#3a0508' },
  ivory: { hi: '#fffaf0', base: '#f1e2c0', deep: '#b9a074' },
  copper: { hi: '#ffe0c0', light: '#f39a5a', base: '#c4602a', deep: '#6e2a0c' },
  plum: { hi: '#f2d4ff', light: '#b67ae0', base: '#7a3aa8', deep: '#3a1258' },
  emerald: { hi: '#d4ffe4', light: '#5fe39a', base: '#169a5a', deep: '#0a4a2a' },
  slate: { hi: '#e6eefa', light: '#a9bbd4', base: '#62769a', deep: '#2c3852', dark: '#141a28' },
} as const;
const P = CZ_PALETTE;

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
const pt = (cx: number, cy: number, r: number, deg: number) => { const a = (deg * Math.PI) / 180; return [n1(cx + Math.sin(a) * r), n1(cy - Math.cos(a) * r)] as const; };
/** Regular star polygon (points alternating r1 / r2). */
const star = (cx: number, cy: number, n: number, r1: number, r2: number, rot = 0) => {
  let d = '';
  for (let i = 0; i < n * 2; i++) { const [x, y] = pt(cx, cy, i % 2 ? r2 : r1, rot + (i * 180) / n); d += `${i ? 'L' : 'M'}${x} ${y}`; }
  return `${d}Z`;
};
/** Gear outline with n teeth. */
const gear = (cx: number, cy: number, n: number, rRoot: number, rTip: number, rot = 0, duty = 0.5) => {
  let d = '';
  const step = 360 / n;
  for (let i = 0; i < n; i++) {
    const a = rot + i * step;
    const h = (step * duty) / 2, ht = h * 0.66;
    const p = [pt(cx, cy, rRoot, a - step / 2 + 0.01), pt(cx, cy, rRoot, a - h), pt(cx, cy, rTip, a - ht), pt(cx, cy, rTip, a + ht), pt(cx, cy, rRoot, a + h)];
    d += `${i ? 'L' : 'M'}${p[0][0]} ${p[0][1]}L${p[1][0]} ${p[1][1]}L${p[2][0]} ${p[2][1]}L${p[3][0]} ${p[3][1]}L${p[4][0]} ${p[4][1]}`;
  }
  return `${d}Z`;
};
const SHEEN: readonly Stop[] = [[0, '#fff', 0.95], [1, '#fff', 0]];
const BRASS: readonly Stop[] = [[0, P.brass.hi], [0.3, P.brass.light], [0.62, P.brass.base], [0.86, P.brass.deep], [1, P.brass.dark]];
const BRASS_H: readonly Stop[] = [[0, P.brass.dark], [0.22, P.brass.deep], [0.45, P.brass.light], [0.55, P.brass.hi], [0.72, P.brass.base], [1, P.brass.dark]];
const INK = P.ink;

/** Soft coloured aura behind a symbol (cheap: one radial gradient). */
function Aura({ k, color, cy = 52, r = 48, o = 0.55 }: { k: K; color: string; cy?: number; r?: number; o?: number }) {
  return (
    <>
      <defs><RG id={k('aura')} s={[[0.3, color, o], [0.7, color, o * 0.3], [1, color, 0]]} /></defs>
      <circle cx="50" cy={cy} r={r} fill={`url(#${k('aura')})`} />
    </>
  );
}

/* ---------- h1 · Fil Saati (elephant clock) ---------- */
/** Elephant outline (symbol space 100 × 100, facing right); the scene reuses it for the elephant clock. */
export const CZ_ELEPHANT_PATH = 'M15 63C15 53 25 47.5 39 47.5H63C69 43 79 42 85.5 47.5C91 52 92.5 59 91.5 66C90.5 73 88.5 79 88.5 84C88.5 87.5 90.5 88.6 92.6 87.8C94.6 87.2 95.6 89.4 94.4 91.2C92.4 94.2 86.4 94.4 84.2 90.2C82.2 86.2 83.2 80 82.2 74.5C81.4 72.2 79.6 71.4 78 72.4L77.6 92.5H66.8L66 80.5C60 82.4 50 82.4 44.2 80.6L43.4 92.5H32.6L31.2 78.6C25.6 76.6 21.4 72.8 19.6 68.4C18.6 70.6 17.4 73.6 16 75.4C14.6 73.4 14.6 67 15 63Z';
function ElephantClock({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('hide')} cx={0.42} cy={0.3} r={0.75} fx={0.36} fy={0.2} s={[[0, P.slate.hi], [0.3, P.slate.light], [0.68, P.slate.base], [1, P.slate.deep]]} />
        <LG id={k('far')} s={[[0, P.slate.base], [1, P.slate.dark]]} />
        <LG id={k('rug')} s={[[0, P.verm.light], [0.45, P.verm.base], [1, P.verm.deep]]} />
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('brassH')} x2={1} y2={0} s={BRASS_H} />
        <LG id={k('dome')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.turq.hi], [0.35, P.turq.light], [0.7, P.turq.base], [1, P.turq.deep]]} />
        <LG id={k('tower')} x2={1} y2={0} s={[[0, P.ivory.deep], [0.35, P.ivory.hi], [0.7, P.ivory.base], [1, P.ivory.deep]]} />
        <RG id={k('dial')} cx={0.4} cy={0.35} r={0.65} s={[[0, '#fffef6'], [0.7, P.ivory.base], [1, P.ivory.deep]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <Aura k={k} color="#ffc76a" cy={54} o={0.5} />
      <ellipse cx="54" cy="93.5" rx="38" ry="4.2" fill="#000" opacity=".4" />
      {/* far legs */}
      <path d="M60 78L61 92.5H69L69.4 79ZM25.6 74.6L26.4 92.5H34L33.4 77Z" fill={u('far')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      {/* body */}
      <path d={CZ_ELEPHANT_PATH} fill={u('hide')} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      {/* toes */}
      <path d="M68 92.5V90.6M71.6 92.5V90.6M75 92.5V90.6M34.2 92.5V90.6M37.8 92.5V90.6M41.4 92.5V90.6" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
      {/* trunk wrinkles + ear + eye + tusk */}
      <path d="M89 72L85.4 72.6M88.8 77L85 77.4M88.6 82L85 82" stroke={P.slate.deep} strokeWidth="1" strokeLinecap="round" />
      <path d="M70.6 51.4C64.6 53.6 62.6 65.4 66.6 71.2C70.4 76 76.8 72.4 77.6 64.4C78 58.2 75.6 52.6 70.6 51.4Z" fill={P.slate.light} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M70.4 55.6C67.8 58 67.2 64 69 67.8" fill="none" stroke="#e8a2a2" strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
      <circle cx="84.2" cy="56.2" r="1.7" fill={INK} />
      <circle cx="84.7" cy="55.7" r=".55" fill="#fff" />
      <path d="M82.6 71.4C86.6 73.8 91.2 73.6 94.6 70.6C92.4 76.8 86.4 78.4 82.2 75.4Z" fill={P.ivory.hi} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      {/* saddle rug with gold border and tassels */}
      <path d="M28.4 49.2H67.2L69.2 66.6Q48.4 71.4 26.8 66.4Z" fill={u('rug')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M30.6 63.4Q48.4 67.6 66.9 63.6" fill="none" stroke={u('brass')} strokeWidth="2.2" />
      <path d="M31.2 52.2H65" stroke={P.turq.light} strokeWidth="1.6" />
      <path d="M38 57.6l2.4-2.4l2.4 2.4l-2.4 2.4ZM46.6 57.6l2.4-2.4l2.4 2.4l-2.4 2.4ZM55.2 57.6l2.4-2.4l2.4 2.4l-2.4 2.4Z" fill={P.brass.light} stroke={INK} strokeWidth=".6" />
      {[30, 37, 44, 51, 58, 65].map((x, i) => <circle key={x} cx={x + 1} cy={n1(67 + Math.sin(i * 1.1) * 0.4 + (i === 0 || i === 5 ? -0.6 : 1.2))} r="1.3" fill={P.brass.light} stroke={INK} strokeWidth=".5" />)}
      {/* howdah platform */}
      <path d="M30.6 44.6H67.4L68.6 49.4H29.4Z" fill={u('brassH')} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      {/* tower */}
      <path d="M35.6 44.6V24.4H62.4V44.6Z" fill={u('tower')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M33.8 26H64.2V22.6H33.8Z" fill={u('brassH')} stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M37.4 44.6V28.6M60.6 44.6V28.6" stroke={P.turq.base} strokeWidth="2.2" />
      {/* clock dial */}
      <circle cx="49" cy="35.4" r="7.6" fill={u('dial')} stroke={u('brass')} strokeWidth="2.2" />
      <circle cx="49" cy="35.4" r="7.6" fill="none" stroke={INK} strokeWidth=".8" />
      {Array.from({ length: 12 }, (_, i) => { const [x, y] = pt(49, 35.4, 5.6, i * 30); return <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 0.9 : 0.55} fill={P.lapis.base} />; })}
      <path d="M49 35.4L49 30.6M49 35.4L52.4 37.2" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      {/* dome with gold finial and a little bird */}
      <path d="M36.2 22.6C36.2 14.8 42.4 10 49 6.6C55.6 10 61.8 14.8 61.8 22.6Z" fill={u('dome')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M41.6 21.6C41.6 16 44.6 12.4 48 10.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".75" />
      <path d="M42.4 22.6V16.6M49 22.6V12M55.6 22.6V16.6" stroke={P.turq.deep} strokeWidth=".9" opacity=".7" />
      <path d="M49 6.6V3.4" stroke={INK} strokeWidth="1.4" />
      <circle cx="49" cy="3.2" r="2" fill={u('brass')} stroke={INK} strokeWidth=".9" />
      {/* specular on the back */}
      <path d="M20 58C22 53 28 50 34 49.2" fill="none" stroke={u('sh')} strokeWidth="2.6" strokeLinecap="round" opacity=".9" />
      <path d="M73 46.4C77 45 82 45.6 85 48" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
      <path d={sparkle(68, 12, 5.4)} fill="#fff" />
    </>
  );
}

/* ---------- h2 · Otomat Davulcu (automaton drummer) ---------- */
function Drummer({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  // a sleeve from shoulder to hand with a brass elbow joint
  const arm = (sx: number, sy: number, ex: number, ey: number, hx: number, hy: number) => (
    <g>
      <path d={`M${sx} ${sy}L${ex} ${ey}L${hx} ${hy}`} fill="none" stroke={INK} strokeWidth="9.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M${sx} ${sy}L${ex} ${ey}L${hx} ${hy}`} fill="none" stroke={u('robe')} strokeWidth="6.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ex} cy={ey} r="3.3" fill={u('brass')} stroke={INK} strokeWidth="1.1" />
      <circle cx={ex} cy={ey} r="1" fill={INK} />
      <circle cx={hx} cy={hy} r="3.4" fill={u('face')} stroke={INK} strokeWidth="1.2" />
    </g>
  );
  return (
    <>
      <defs>
        <LG id={k('robe')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.verm.light], [0.5, P.verm.base], [1, P.verm.deep]]} />
        <LG id={k('vest')} s={[[0, P.lapis.light], [0.5, P.lapis.base], [1, P.lapis.deep]]} />
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('bowl')} x2={1} y2={0} s={BRASS_H} />
        <RG id={k('face')} cx={0.38} cy={0.32} r={0.7} s={[[0, P.brass.hi], [0.45, P.brass.light], [1, P.brass.deep]]} />
        <RG id={k('skin')} cx={0.45} cy={0.35} r={0.65} s={[[0, '#fffaf0'], [0.75, '#efe0c0'], [1, '#bda274']]} />
        <LG id={k('cap')} s={[[0, P.verm.light], [0.6, P.verm.base], [1, P.verm.deep]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <Aura k={k} color="#ff8a5a" cy={54} o={0.5} />
      <ellipse cx="50" cy="94" rx="34" ry="3.8" fill="#000" opacity=".4" />
      {/* torso (robe with lapis vest and gold belt) */}
      <path d="M33.6 74L36.4 49.4Q50 42.4 63.6 49.4L66.4 74Z" fill={u('robe')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M43 46.4L45 74H55L57 46.4Q50 44.6 43 46.4Z" fill={u('vest')} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M50 47V73" stroke={P.brass.light} strokeWidth="1.2" strokeDasharray="1.6 2.4" />
      <path d="M35.4 62.6H64.6" stroke={u('brass')} strokeWidth="3.2" />
      {/* arms raised with the sticks */}
      {arm(38, 51, 24.6, 46, 25.6, 30.6)}
      {arm(62, 51, 75.4, 46, 74.4, 30.6)}
      <path d="M25.4 30.4L15 13.6M74.6 30.4L85 13.6" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M25.4 30.4L15 13.6M74.6 30.4L85 13.6" stroke={P.brass.light} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14.4" cy="12.6" r="3.6" fill={u('brass')} stroke={INK} strokeWidth="1.3" />
      <circle cx="85.6" cy="12.6" r="3.6" fill={u('brass')} stroke={INK} strokeWidth="1.3" />
      {/* brass automaton face with painted eyes, turban and tall cap */}
      <path d="M45.4 44.6H54.6V48.6H45.4Z" fill={u('brass')} stroke={INK} strokeWidth="1" />
      <circle cx="50" cy="36.4" r="9" fill={u('face')} stroke={INK} strokeWidth="2" />
      <path d="M45.6 35.6Q47 34.4 48.4 35.6M51.6 35.6Q53 34.4 54.4 35.6" fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M47.4 40.4Q50 42 52.6 40.4" fill="none" stroke={INK} strokeWidth="1" strokeLinecap="round" />
      <circle cx="45.4" cy="38.6" r="1.3" fill={P.verm.light} opacity=".7" /><circle cx="54.6" cy="38.6" r="1.3" fill={P.verm.light} opacity=".7" />
      <path d="M42.6 26.6Q44.6 8.6 50 3.6Q55.4 8.6 57.4 26.6Z" fill={u('cap')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M47 23Q47.4 12 50 7" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity=".55" />
      <ellipse cx="50" cy="28.2" rx="11.4" ry="4.6" fill={u('skin')} stroke={INK} strokeWidth="1.8" />
      <path d="M40 28.6Q50 25 60 28.6" fill="none" stroke={P.ivory.deep} strokeWidth="1" />
      <circle cx="50" cy="3.4" r="1.9" fill={u('brass')} stroke={INK} strokeWidth=".8" />
      {/* kettle drum */}
      <path d="M17.4 72.6Q19.4 93.4 50 93.6Q80.6 93.4 82.6 72.6Z" fill={u('bowl')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M22 78Q50 88 78 78" fill="none" stroke={P.brass.dark} strokeWidth="1.3" opacity=".6" />
      {Array.from({ length: 7 }, (_, i) => { const x = 24 + i * 8.6; return <path key={i} d={`M${x} 75L${n1(x + (x < 50 ? 3 : x > 50 ? -3 : 0))} 89`} stroke={P.verm.deep} strokeWidth="1.1" opacity=".85" />; })}
      <ellipse cx="50" cy="72.6" rx="33" ry="6.8" fill={u('skin')} stroke={INK} strokeWidth="2" />
      <ellipse cx="50" cy="72.6" rx="27" ry="4.6" fill="none" stroke={P.ivory.deep} strokeWidth=".9" opacity=".8" />
      <path d="M27 71.4Q32 68.6 40 68" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
      <path d="M22 82Q24 87 31 89.6" fill="none" stroke={u('sh')} strokeWidth="2.4" strokeLinecap="round" opacity=".8" />
      <path d={sparkle(92, 30, 4.6)} fill="#fff" />
    </>
  );
}

/* ---------- h3 · Su Saati Kalesi (water-clock gate) ---------- */
const merlons = (x0: number, x1: number, y: number, h: number, n: number) => {
  const w = (x1 - x0) / (n * 2 - 1);
  let d = `M${x0} ${y + h}`;
  for (let i = 0; i < n; i++) { const a = x0 + i * 2 * w; d += `L${n1(a)} ${y}L${n1(a + w)} ${y}L${n1(a + w)} ${y + h}`; if (i < n - 1) d += `L${n1(a + 2 * w)} ${y + h}`; }
  return d;
};
function WaterCastle({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const tower = (x0: number, x1: number) => (
    <g>
      <path d={`${merlons(x0 - 1.4, x1 + 1.4, 22, 5, 3)}V88H${x0 - 1.4}Z`} fill={u('stone')} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {/* ablaq: basalt and cream courses */}
      {[34, 46, 58, 70].map((y) => <rect key={y} x={x0 - 0.4} y={y} width={x1 - x0 + 0.8} height="5" fill={P.slate.deep} opacity=".85" />)}
      <path d={`M${(x0 + x1) / 2 - 2.6} 52V44Q${(x0 + x1) / 2} 40 ${(x0 + x1) / 2 + 2.6} 44V52Z`} fill={P.lapis.dark} stroke={INK} strokeWidth=".8" />
    </g>
  );
  return (
    <>
      <defs>
        <LG id={k('stone')} x2={1} y2={0} s={[[0, P.ivory.deep], [0.3, P.ivory.hi], [0.75, P.ivory.base], [1, P.ivory.deep]]} />
        <LG id={k('tile')} s={[[0, P.turq.light], [0.5, P.turq.base], [1, P.turq.deep]]} />
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('door')} x2={1} y2={0} s={BRASS_H} />
        <RG id={k('disc')} cx={0.4} cy={0.35} r={0.7} s={[[0, P.lapis.light], [0.55, P.lapis.base], [1, P.lapis.dark]]} />
        <LG id={k('water')} s={[[0, P.turq.hi], [0.4, P.turq.light], [1, P.turq.deep]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <Aura k={k} color="#5ff0e0" cy={52} o={0.45} />
      {/* basin */}
      <path d="M10 87H90L86 95H14Z" fill={u('door')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13 87.2Q50 84.4 87 87.2V89.6H13Z" fill={u('water')} />
      {/* central body */}
      <path d={`${merlons(26, 74, 40, 4.6, 5)}V88H26Z`} fill={u('stone')} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <rect x="27" y="52" width="46" height="6.4" fill={u('tile')} stroke={INK} strokeWidth="1" />
      {Array.from({ length: 6 }, (_, i) => <path key={i} d={`M${n1(30.4 + i * 7.8)} 55.2l2.4-2.2l2.4 2.2l-2.4 2.2Z`} fill={P.ivory.hi} />)}
      {/* twin towers */}
      {tower(15, 29)}
      {tower(71, 85)}
      {/* zodiac dial crowning the gate */}
      <circle cx="50" cy="32.4" r="16" fill={u('brass')} stroke={INK} strokeWidth="2" />
      <circle cx="50" cy="32.4" r="12.6" fill={u('disc')} stroke={INK} strokeWidth="1.2" />
      {Array.from({ length: 12 }, (_, i) => { const [x, y] = pt(50, 32.4, 10.2, i * 30); return <circle key={i} cx={x} cy={y} r="1.4" fill={i === 0 ? '#fff6c8' : P.brass.light} stroke={INK} strokeWidth=".4" />; })}
      <path d={star(50, 32.4, 8, 6.4, 3.2, 22.5)} fill={u('brass')} stroke={INK} strokeWidth=".8" />
      <circle cx="50" cy="32.4" r="2" fill={P.verm.base} stroke={INK} strokeWidth=".6" />
      {/* arched door with studded brass leaves and a water spout */}
      <path d="M39 88V69Q39 60 50 57Q61 60 61 69V88Z" fill={P.lapis.dark} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M41.4 88V69.4Q41.4 62.4 49.4 59.8V88ZM58.6 88V69.4Q58.6 62.4 50.6 59.8V88Z" fill={u('door')} stroke={INK} strokeWidth="1" strokeLinejoin="round" />
      {[66, 72, 78, 84].map((y) => <g key={y}><circle cx="45" cy={y} r=".9" fill={P.brass.dark} /><circle cx="55" cy={y} r=".9" fill={P.brass.dark} /></g>)}
      <path d="M50 80Q52.6 83 51.4 87.2" fill="none" stroke={P.turq.hi} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M21 26.6Q22 24 24.6 23.2" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity=".7" />
      <path d="M38 26Q41 20 47 17.6" fill="none" stroke={u('sh')} strokeWidth="2.6" strokeLinecap="round" opacity=".9" />
      <path d={sparkle(86, 12, 5)} fill="#fff" />
    </>
  );
}

/* ---------- h4 · Tavus Çeşmesi (peacock fountain) ---------- */
function PeacockFountain({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  const feathers = 9;
  return (
    <>
      <defs>
        <LG id={k('fan')} s={[[0, P.emerald.light], [0.55, P.emerald.base], [1, P.emerald.deep]]} />
        <RG id={k('eye')} cx={0.45} cy={0.4} r={0.6} s={[[0, '#2a3cff'], [0.5, P.lapis.deep], [1, P.lapis.dark]]} />
        <RG id={k('body')} cx={0.38} cy={0.3} r={0.75} s={[[0, '#bff4ff'], [0.35, '#2fb5e0'], [0.8, P.lapis.base], [1, P.lapis.deep]]} />
        <LG id={k('bowl')} x2={1} y2={0} s={BRASS_H} />
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('water')} s={[[0, P.turq.hi], [1, P.turq.base]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <Aura k={k} color="#5fe3a0" cy={50} o={0.48} />
      <ellipse cx="50" cy="94.4" rx="30" ry="3.6" fill="#000" opacity=".4" />
      {/* the fan: nine feathers, each with an eye */}
      {Array.from({ length: feathers }, (_, i) => {
        const a = -78 + (i * 156) / (feathers - 1);
        return (
          <g key={i} transform={`rotate(${n1(a)} 50 64)`}>
            <path d="M50 64C44.4 52 43.4 30 50 14.6C56.6 30 55.6 52 50 64Z" fill={u('fan')} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M50 60V22" stroke={P.emerald.hi} strokeWidth=".7" opacity=".7" />
            <ellipse cx="50" cy="24.4" rx="4.2" ry="5.4" fill={P.brass.light} stroke={INK} strokeWidth=".8" />
            <ellipse cx="50" cy="24.8" rx="2.6" ry="3.4" fill={u('eye')} />
          </g>
        );
      })}
      {/* basin */}
      <path d="M22 76Q24 92 50 92.6Q76 92 78 76Z" fill={u('bowl')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <ellipse cx="50" cy="76" rx="28" ry="5" fill={u('water')} stroke={INK} strokeWidth="1.8" />
      <path d="M30 75.4Q36 73.2 44 73" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity=".8" />
      <path d="M44 92.4L42 96.4H58L56 92.4" fill={u('brass')} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      {/* bird: body, S-neck, crest */}
      <path d="M38.6 74C37 64 42 55.6 49 55.4C52.4 50 51.4 44 48.6 40.4C46.6 37.8 47.4 33 51.6 32.2C56.6 31.4 59 35.6 57.6 39.2C56.2 43 57.2 49 58.6 54C63 58 63.6 67 60.4 74Z" fill={u('body')} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M57.6 36.4L63.4 37.8L57.8 39.6Z" fill={P.brass.light} stroke={INK} strokeWidth="1" strokeLinejoin="round" />
      <circle cx="54" cy="35.6" r="1.4" fill="#fff" stroke={INK} strokeWidth=".7" />
      <circle cx="54.2" cy="35.6" r=".6" fill={INK} />
      {[[48.6, 26], [51.6, 25], [54.6, 26.2]].map(([x, y], i) => <g key={i}><path d={`M52 32L${x} ${y! + 2}`} stroke={INK} strokeWidth=".9" /><circle cx={x} cy={y} r="1.5" fill={P.brass.light} stroke={INK} strokeWidth=".6" /></g>)}
      <path d="M44 64Q48 60 54 61.4M43.4 69Q49 65.6 56 67" fill="none" stroke={P.lapis.hi} strokeWidth="1" opacity=".55" />
      {/* water jets from the beak and the basin */}
      <path d="M63.4 37.8Q76 38 80 52Q82 62 76.6 74" fill="none" stroke={P.turq.hi} strokeWidth="2" strokeLinecap="round" opacity=".95" />
      <path d="M63.4 37.8Q76 38 80 52Q82 62 76.6 74" fill="none" stroke={P.turq.base} strokeWidth=".7" strokeLinecap="round" strokeDasharray="2 3" />
      <circle cx="78" cy="66" r="1.1" fill={P.turq.hi} /><circle cx="82.4" cy="58" r=".9" fill={P.turq.hi} />
      <path d="M44 48Q45 42 48 39" fill="none" stroke={u('sh')} strokeWidth="2.2" strokeLinecap="round" opacity=".85" />
      <path d={sparkle(18, 22, 4.4)} fill="#fff" />
    </>
  );
}

/* ---------- l1 · Usturlap (astrolabe) ---------- */
function Astrolabe({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('brassH')} x2={1} y2={0} s={BRASS_H} />
        <RG id={k('plate')} cx={0.4} cy={0.35} r={0.7} s={[[0, P.lapis.light], [0.45, P.lapis.base], [1, P.lapis.dark]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <Aura k={k} color="#7a94ff" cy={56} r={44} o={0.5} />
      {/* ring and throne (kürsi) */}
      <circle cx="50" cy="10.6" r="6.2" fill="none" stroke={INK} strokeWidth="5" />
      <circle cx="50" cy="10.6" r="6.2" fill="none" stroke={u('brassH')} strokeWidth="2.8" />
      <path d="M40 24Q40 16.6 50 15.4Q60 16.6 60 24Z" fill={u('brass')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="50" cy="20.2" r="1.6" fill={P.verm.base} stroke={INK} strokeWidth=".6" />
      {/* mater rim */}
      <circle cx="50" cy="57" r="36" fill={u('brass')} stroke={INK} strokeWidth="2.4" />
      <circle cx="50" cy="57" r="29.6" fill={u('plate')} stroke={INK} strokeWidth="1.6" />
      <g stroke={INK} strokeWidth=".9">
        {Array.from({ length: 36 }, (_, i) => { const [x1, y1] = pt(50, 57, 35, i * 10); const [x2, y2] = pt(50, 57, i % 3 === 0 ? 31 : 33, i * 10); return <path key={i} d={`M${x1} ${y1}L${x2} ${y2}`} />; })}
      </g>
      {/* plate engraving: almucantars */}
      <g fill="none" stroke={P.lapis.hi} strokeWidth=".7" opacity=".55">
        <circle cx="50" cy="62" r="18" /><circle cx="50" cy="65" r="11" /><path d="M21 57H79M50 28V86" />
      </g>
      {/* rete: a gold star net with pointers */}
      <g fill="none" stroke={INK} strokeWidth="3.6" strokeLinejoin="round" strokeLinecap="round">
        <circle cx="50" cy="52.6" r="17" />
        <path d={star(50, 57, 6, 25, 9, 0)} />
      </g>
      <g fill="none" stroke={u('brassH')} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
        <circle cx="50" cy="52.6" r="17" />
        <path d={star(50, 57, 6, 25, 9, 0)} />
      </g>
      {[0, 60, 120, 180, 240, 300].map((a) => { const [x, y] = pt(50, 57, 25, a); return <circle key={a} cx={x} cy={y} r="1.7" fill={P.verm.light} stroke={INK} strokeWidth=".6" />; })}
      {/* alidade */}
      <path d="M22.6 74.6L77.4 39.4" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <path d="M22.6 74.6L77.4 39.4" stroke={u('brassH')} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="50" cy="57" r="4.2" fill={u('brass')} stroke={INK} strokeWidth="1.4" />
      <circle cx="50" cy="57" r="1.4" fill={INK} />
      <path d="M22 44Q25 33 34 27" fill="none" stroke={u('sh')} strokeWidth="2.8" strokeLinecap="round" opacity=".9" />
      <path d={sparkle(82, 26, 4.6)} fill="#fff" />
    </>
  );
}

/* ---------- l2 · Çini Yıldızı (tile star) ---------- */
function TileStar({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <LG id={k('tq')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.turq.hi], [0.3, P.turq.light], [0.7, P.turq.base], [1, P.turq.deep]]} />
        <RG id={k('cob')} cx={0.45} cy={0.4} r={0.6} s={[[0, P.lapis.light], [0.6, P.lapis.base], [1, P.lapis.deep]]} />
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('glaze')} s={[[0, '#fff', 0.8], [0.5, '#fff', 0.05], [1, '#fff', 0]]} />
      </defs>
      <Aura k={k} color="#4ff0e0" o={0.5} />
      <path d={star(50, 51, 8, 44, 31, 0)} fill={u('brass')} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d={star(50, 51, 8, 39.6, 27.6, 0)} fill={u('tq')} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      {/* cobalt octagon rosette with white petals */}
      <path d={star(50, 51, 8, 22, 18.6, 22.5)} fill={u('cob')} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} transform={`rotate(${i * 45} 50 51)`} d="M50 51C47.4 45 47.6 39 50 34.6C52.4 39 52.6 45 50 51Z" fill={P.ivory.hi} stroke={P.lapis.dark} strokeWidth=".7" />
      ))}
      <circle cx="50" cy="51" r="5" fill={P.verm.base} stroke={INK} strokeWidth="1.2" />
      <circle cx="48.6" cy="49.6" r="1.4" fill="#fff" opacity=".8" />
      {/* tips: little white trefoils */}
      {Array.from({ length: 8 }, (_, i) => { const [x, y] = pt(50, 51, 33, i * 45); return <circle key={i} cx={x} cy={y} r="1.6" fill={P.ivory.hi} stroke={P.turq.deep} strokeWidth=".6" />; })}
      <path d={star(50, 51, 8, 39.6, 27.6, 0)} fill={u('glaze')} opacity=".6" transform="translate(50 51) scale(.9) translate(-50 -51)" />
      <path d="M23 34Q28 24 38 19" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".75" />
      <path d={sparkle(80, 18, 5)} fill="#fff" />
    </>
  );
}

/* ---------- l3 · Bakır Kepçe (copper scoop) ---------- */
function CopperScoop({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('cu')} cx={0.36} cy={0.3} r={0.8} s={[[0, P.copper.hi], [0.3, P.copper.light], [0.7, P.copper.base], [1, P.copper.deep]]} />
        <LG id={k('handle')} x1={0} y1={0} x2={1} y2={1} s={[[0, P.copper.hi], [0.45, P.copper.light], [1, P.copper.deep]]} />
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('water')} s={[[0, P.turq.hi], [1, P.turq.base]]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <Aura k={k} color="#ff9a5a" o={0.5} />
      {/* handle up to the right with a ring end */}
      <path d="M44 46L80.6 13" stroke={INK} strokeWidth="8.4" strokeLinecap="round" />
      <path d="M44 46L80.6 13" stroke={u('handle')} strokeWidth="5" strokeLinecap="round" />
      <circle cx="84" cy="10" r="5.4" fill="none" stroke={INK} strokeWidth="4.6" />
      <circle cx="84" cy="10" r="5.4" fill="none" stroke={u('brass')} strokeWidth="2.4" />
      <path d="M54 37.6L59 33" stroke={P.copper.deep} strokeWidth="1.4" />
      {/* bowl tipped to pour */}
      <g transform="rotate(-24 36 54)">
        <path d="M10 48H62Q62 78 36 78Q10 78 10 48Z" fill={u('cu')} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
        <ellipse cx="36" cy="48" rx="26" ry="6.2" fill={P.copper.deep} stroke={INK} strokeWidth="2" />
        <ellipse cx="36" cy="49" rx="22" ry="4.2" fill={u('water')} />
        <path d="M14 56Q18 70 30 74" fill="none" stroke={u('sh')} strokeWidth="2.8" strokeLinecap="round" opacity=".85" />
        <path d="M12 62Q36 70 61 60" fill="none" stroke={P.copper.deep} strokeWidth="1.2" opacity=".7" />
        {[16, 26, 36, 46, 56].map((x) => <circle key={x} cx={x} cy={n1(63.4 + Math.abs(36 - x) * -0.08)} r=".9" fill={P.copper.hi} />)}
      </g>
      {/* pouring stream and drops */}
      <path d="M12.6 59Q9 70 13 83" fill="none" stroke={P.turq.hi} strokeWidth="4" strokeLinecap="round" />
      <path d="M12.6 59Q9 70 13 83" fill="none" stroke={P.turq.base} strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
      <path d="M14 88C15.6 90.4 16.6 92 16.6 93.4C16.6 95 15.4 96 14 96C12.6 96 11.4 95 11.4 93.4C11.4 92 12.4 90.4 14 88Z" fill={P.turq.light} stroke={INK} strokeWidth="1" />
      <ellipse cx="30" cy="93" rx="16" ry="2.4" fill="none" stroke={P.turq.light} strokeWidth="1.2" opacity=".7" />
      <path d={sparkle(68, 40, 4.6)} fill="#fff" />
    </>
  );
}

/* ---------- l4 · Makara (pulley block) ---------- */
function Pulley({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('wheel')} cx={0.38} cy={0.32} r={0.75} s={[[0, P.plum.hi], [0.35, P.plum.light], [0.75, P.plum.base], [1, P.plum.deep]]} />
        <LG id={k('brassH')} x2={1} y2={0} s={BRASS_H} />
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('iron')} x2={1} y2={0} s={[[0, '#3a3f4a'], [0.45, '#e6ebf4'], [1, '#4a505c']]} />
        <LG id={k('rope')} s={[[0, '#f6e2b0'], [1, '#b8904a']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <Aura k={k} color="#c48aff" o={0.5} />
      {/* top hook */}
      <path d="M50 22V14Q50 6 56 6Q62 6 62 12" fill="none" stroke={INK} strokeWidth="6.4" strokeLinecap="round" />
      <path d="M50 22V14Q50 6 56 6Q62 6 62 12" fill="none" stroke={u('iron')} strokeWidth="3.4" strokeLinecap="round" />
      {/* ropes */}
      <path d="M24.6 50V84M75.4 50V76" stroke={INK} strokeWidth="5" />
      <path d="M24.6 50V84M75.4 50V76" stroke={u('rope')} strokeWidth="3" />
      <path d="M24.6 54V84M75.4 54V76" stroke="#8a5a20" strokeWidth="3" strokeDasharray="1.2 2.2" opacity=".6" />
      {/* bracket (strap) */}
      <path d="M38 22H62L74 50H26Z" fill={u('brassH')} stroke={INK} strokeWidth="2" strokeLinejoin="round" opacity=".001" />
      <path d="M40 22H60V30H40Z" fill={u('brass')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      {/* wheel */}
      <circle cx="50" cy="50" r="26.6" fill={u('wheel')} stroke={INK} strokeWidth="2.4" />
      <circle cx="50" cy="50" r="22" fill="none" stroke={P.plum.deep} strokeWidth="2.6" opacity=".8" />
      <circle cx="50" cy="50" r="24.4" fill="none" stroke={u('rope')} strokeWidth="2.2" strokeDasharray="56 20" transform="rotate(-160 50 50)" />
      {Array.from({ length: 6 }, (_, i) => { const [x, y] = pt(50, 50, 18.6, i * 60 + 30); return <path key={i} d={`M50 50L${x} ${y}`} stroke={INK} strokeWidth="5" strokeLinecap="round" />; })}
      {Array.from({ length: 6 }, (_, i) => { const [x, y] = pt(50, 50, 18.6, i * 60 + 30); return <path key={i} d={`M50 50L${x} ${y}`} stroke={u('brassH')} strokeWidth="2.6" strokeLinecap="round" />; })}
      <circle cx="50" cy="50" r="7.2" fill={u('brass')} stroke={INK} strokeWidth="1.6" />
      <circle cx="50" cy="50" r="2.4" fill={INK} />
      {/* side straps over the wheel */}
      <path d="M44 28.6L41 50M56 28.6L59 50" stroke={INK} strokeWidth="5.4" strokeLinecap="round" />
      <path d="M44 28.6L41 50M56 28.6L59 50" stroke={u('brassH')} strokeWidth="3" strokeLinecap="round" />
      {/* bottom hook with a weight */}
      <path d="M24.6 84Q24.6 92 31 92Q37 92 37 86" fill="none" stroke={INK} strokeWidth="5.6" strokeLinecap="round" />
      <path d="M24.6 84Q24.6 92 31 92Q37 92 37 86" fill="none" stroke={u('iron')} strokeWidth="2.8" strokeLinecap="round" />
      <path d="M69 76H82L84 92H67Z" fill={u('iron')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M70 80H81" stroke="#fff" strokeWidth="1" opacity=".5" />
      <path d="M31 38Q35 29 44 25.4" fill="none" stroke={u('sh')} strokeWidth="2.6" strokeLinecap="round" opacity=".9" />
      <path d={sparkle(84, 30, 4.6)} fill="#fff" />
    </>
  );
}

/* ---------- gear · Altın Dişli (wild) ---------- */
function GoldenGear({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('aura')} s={[[0.25, '#fff1b0', 0.95], [0.6, '#ffbe3a', 0.4], [1, '#ff9a1a', 0]]} />
        <RG id={k('rays')} s={[[0.35, '#fff5c8', 0.9], [1, '#ffcf5a', 0]]} />
        <LG id={k('gold')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#fffbe0'], [0.25, '#ffe27a'], [0.55, '#e8a62a'], [0.82, '#9a5a0c'], [1, '#4a2804']]} />
        <LG id={k('goldH')} x2={1} y2={0} s={[[0, '#6a3a06'], [0.4, '#fff0b0'], [0.6, '#f2bb46'], [1, '#6a3804']]} />
        <RG id={k('tq')} cx={0.4} cy={0.35} r={0.7} s={[[0, P.turq.hi], [0.4, P.turq.light], [1, P.turq.deep]]} />
        <RG id={k('ruby')} cx={0.38} cy={0.32} r={0.75} s={[[0, '#ffe0e0'], [0.3, '#ff4a5a'], [0.75, '#a00a1e'], [1, '#3a0008']]} />
        <LG id={k('sh')} s={SHEEN} />
      </defs>
      <circle cx="50" cy="50" r="50" fill={u('aura')} />
      {Array.from({ length: 16 }, (_, i) => {
        const a = i * 22.5 + 11.25;
        const [x1, y1] = pt(50, 50, 38, a - 3.4), [x2, y2] = pt(50, 50, i % 2 ? 50 : 56, a), [x3, y3] = pt(50, 50, 38, a + 3.4);
        return <path key={i} d={`M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}Z`} fill={u('rays')} />;
      })}
      <path d={gear(50, 50, 12, 35, 45.4, 0, 0.52)} fill={u('gold')} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="50" cy="50" r="31.4" fill="none" stroke={P.brass.dark} strokeWidth="1.2" opacity=".6" />
      {/* openwork: six lobes between filigree spokes */}
      <circle cx="50" cy="50" r="27" fill={P.brass.dark} stroke={INK} strokeWidth="1.4" />
      {Array.from({ length: 6 }, (_, i) => (
        <path key={i} transform={`rotate(${i * 60} 50 50)`} d="M50 50C44 42 43.4 31 50 24C56.6 31 56 42 50 50Z" fill={u('goldH')} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      ))}
      <circle cx="50" cy="50" r="15" fill={u('tq')} stroke={INK} strokeWidth="1.8" />
      {Array.from({ length: 12 }, (_, i) => { const [x, y] = pt(50, 50, 12.4, i * 30); return <circle key={i} cx={x} cy={y} r=".9" fill="#fff6d8" />; })}
      <circle cx="50" cy="50" r="9" fill={u('ruby')} stroke={INK} strokeWidth="1.6" />
      <path d={star(50, 50, 8, 7.4, 3.4, 0)} fill="none" stroke="#ffd0d6" strokeWidth=".7" opacity=".7" />
      <ellipse cx="47" cy="46.6" rx="3.2" ry="2.2" fill="#fff" opacity=".85" />
      <path d="M17.6 38Q22 25 34 18" fill="none" stroke={u('sh')} strokeWidth="3.4" strokeLinecap="round" opacity=".95" />
      <path d={sparkle(80, 16, 7)} fill="#fff" />
      <path d={sparkle(16, 80, 4.6)} fill="#fff" opacity=".9" />
      <path d={sparkle(88, 76, 3.6)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- vessel · Su Kabı (ewer, scatter) ---------- */
const EWER = 'M38 34C36 40 25 47 25 63C25 79 35.6 88 50 88C64.4 88 75 79 75 63C75 47 64 40 62 34Z';
function WaterVessel({ k }: { k: K }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <>
      <defs>
        <RG id={k('aura')} s={[[0.25, '#d8fff8', 0.95], [0.6, '#38e8e0', 0.4], [1, '#18b0c8', 0]]} />
        <RG id={k('glaze')} cx={0.38} cy={0.32} r={0.78} s={[[0, P.turq.hi], [0.3, P.turq.light], [0.72, P.turq.base], [1, P.turq.dark]]} />
        <LG id={k('brass')} s={BRASS} />
        <LG id={k('brassH')} x2={1} y2={0} s={BRASS_H} />
        <LG id={k('water')} s={[[0, '#ffffff'], [0.5, P.turq.hi], [1, P.turq.light]]} />
        <LG id={k('sh')} s={SHEEN} />
        <clipPath id={k('clip')}><path d={EWER} /></clipPath>
      </defs>
      <circle cx="50" cy="54" r="50" fill={u('aura')} />
      {/* ripples it stands on */}
      <ellipse cx="50" cy="90" rx="40" ry="5" fill="none" stroke={P.turq.hi} strokeWidth="1.2" opacity=".6" />
      <ellipse cx="50" cy="90" rx="28" ry="3.4" fill="none" stroke="#fff" strokeWidth="1" opacity=".55" />
      {/* handle */}
      <path d="M64 40C84 34 86 58 72 70" fill="none" stroke={INK} strokeWidth="6.6" strokeLinecap="round" />
      <path d="M64 40C84 34 86 58 72 70" fill="none" stroke={u('brassH')} strokeWidth="3.4" strokeLinecap="round" />
      {/* spout */}
      <path d="M31 56C22 50 16 40 10.6 30.6L15.4 28.6C20 37 26 44 34 48Z" fill={u('brass')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      {/* body with gold arabesque band */}
      <path d={EWER} fill={u('glaze')} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <g clipPath={u('clip')}>
        <rect x="20" y="58" width="60" height="9" fill={u('brassH')} />
        {Array.from({ length: 7 }, (_, i) => <path key={i} d={`M${24 + i * 8.6} 62.5q2.2-3.6 4.3 0t4.3 0`} fill="none" stroke={P.brass.dark} strokeWidth="1" />)}
        <path d="M25 76Q50 84 75 76" fill="none" stroke={P.turq.deep} strokeWidth="1.4" opacity=".6" />
        {[30, 40, 50, 60, 70].map((x) => <path key={x} d={`M${x} 46l2.4 3.4l-2.4 3.4l-2.4 -3.4Z`} fill={P.ivory.hi} opacity=".85" />)}
      </g>
      {/* neck, lid, finial */}
      <path d="M40 34H60L58 24H42Z" fill={u('brassH')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M41 24Q41 15 50 13Q59 15 59 24Z" fill={u('brass')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="50" cy="10.4" r="3" fill={u('brass')} stroke={INK} strokeWidth="1.1" />
      {/* foot */}
      <path d="M40 86.4L37.6 92.6H62.4L60 86.4Z" fill={u('brassH')} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      {/* the pour */}
      <path d="M12.6 29.4Q4 36 7 52" fill="none" stroke={u('water')} strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="8" cy="58" r="1.8" fill={P.turq.hi} /><circle cx="10" cy="64.4" r="1.3" fill={P.turq.hi} />
      <path d="M32 50Q33 41 39 37.6" fill="none" stroke={u('sh')} strokeWidth="3.2" strokeLinecap="round" opacity=".95" />
      <ellipse cx="38" cy="70" rx="4" ry="7" fill="#fff" opacity=".18" />
      <path d={sparkle(82, 14, 6.6)} fill="#fff" />
      <path d={sparkle(90, 84, 3.8)} fill="#fff" opacity=".9" />
      <path d={sparkle(22, 14, 3.6)} fill="#fff" opacity=".85" />
    </>
  );
}

/* ---------- public API ---------- */
/** Optical balance inside a cell. */
const SCALE: Record<CezeriSymbol, number> = { h1: 1.04, h2: 1.02, h3: 1.04, h4: 1.04, l1: 1.04, l2: 1.04, l3: 1.04, l4: 1.04, gear: 1.06, vessel: 1.04 };
function art(symbol: CezeriSymbol, k: K): ReactNode {
  switch (symbol) {
    case 'h1': return <ElephantClock k={k} />;
    case 'h2': return <Drummer k={k} />;
    case 'h3': return <WaterCastle k={k} />;
    case 'h4': return <PeacockFountain k={k} />;
    case 'l1': return <Astrolabe k={k} />;
    case 'l2': return <TileStar k={k} />;
    case 'l3': return <CopperScoop k={k} />;
    case 'l4': return <Pulley k={k} />;
    case 'gear': return <GoldenGear k={k} />;
    case 'vessel': return <WaterVessel k={k} />;
  }
}
function Shell({ k, children, size, className, scale = 1 }: { k: K; children: ReactNode; size?: number | string; className?: string; scale?: number }) {
  const dim = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;
  return (
    <svg viewBox="0 0 100 100" width={dim} height={dim} className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={k('shadow')} x="-15%" y="-15%" width="130%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.4" stdDeviation="1.6" floodColor="#060302" floodOpacity=".65" />
        </filter>
      </defs>
      <g filter={`url(#${k('shadow')})`}>{scale === 1 ? children : <g transform={`translate(50 50) scale(${scale}) translate(-50 -50)`}>{children}</g>}</g>
    </svg>
  );
}
/** Full symbol art (own defs; use for big previews, info pages, celebrations). */
export function CezeriSymbolArt({ symbol, size, className }: { symbol: CezeriSymbol; size?: number | string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k: K = (n) => `czs${uid}${n}`;
  return <Shell k={k} size={size} className={className} scale={SCALE[symbol]}>{art(symbol, k)}</Shell>;
}

/* ---------- sprite sheet ---------- */
export const cezeriSpriteId = (symbol: CezeriSymbol) => `czs-${symbol}`;
/** Draws every symbol once into a hidden SVG; mount once per page, before any <CezeriSymbolUse/>. */
export const CezeriSymbolSprites = memo(function CezeriSymbolSprites() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        {CEZERI_SYMBOLS.map((s) => <symbol key={s} id={cezeriSpriteId(s)} viewBox="0 0 100 100" overflow="visible"><CezeriSymbolArt symbol={s} size={100} /></symbol>)}
      </defs>
    </svg>
  );
});
/** Cheap board cell art: two DOM nodes referencing the sprite. */
export const CezeriSymbolUse = memo(function CezeriSymbolUse({ symbol, className }: { symbol: CezeriSymbol; className?: string }) {
  return <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false" style={{ display: 'block', overflow: 'visible' }}><use href={`#${cezeriSpriteId(symbol)}`} /></svg>;
});
