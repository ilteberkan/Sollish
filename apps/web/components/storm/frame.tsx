import { useId } from 'react';
import type { ReactNode } from 'react';
import styles from './symbols.module.css';

/* Tarhun board frame: cyclopean stone border with bronze inlay, a sunken relief frieze (bull and lion
   procession on top, running storm waves on the sides and bottom), carved corner lion heads, a keystone
   with the storm sigil and glowing runes that intensify in the 'feature' mood. The decoration is one static
   SVG drawn in a fixed 1000×864 space: padding is a percentage of the width, so the frame keeps its exact
   proportions at every size and the inner area stays 6:5. Only rune opacity animates. No backdrop-filter. */

export type StormFrameMood = 'base' | 'feature';

const W = 1000;
const H = 870;
const GX = 50;
const GY = 64;
const GW = 900;
const GH = 750;
const f1 = (n: number) => Math.round(n * 10) / 10;
/** Sunken relief strips: top frieze, left/right waves, bottom waves. */
const STRIPS: ReadonlyArray<readonly [number, number, number, number]> = [[72, 15, W - 144, 37], [15, 100, 26, H - 200], [W - 41, 100, 26, H - 200], [72, H - 46, W - 144, 32]];

const BULL = 'M2 10.5C2 7.4 4.6 6 8.4 6H21.2C22.4 4.2 24 3.4 25.6 3.6L27.4 1.4L28 4.2C30.4 4.8 32 6.6 31.6 8.6L30.4 11C29.6 12.6 28 13 26.6 12.2L24.6 14.6L24.2 21H21.6L21.2 15.4H11.6L10.8 21H8.2L8 14.8C5.8 14.6 4.4 13.4 3.6 12L1 15.6L0.4 15C1 13.4 1.4 12 2 10.5Z';
const LION = 'M3 11C3 8 5.6 6.6 9.2 6.6H19.6C20.4 3.6 23 2 26 2.4C29.2 2.8 31.2 5.4 30.6 8.2L32 10.6L28.8 11.4C28 12.8 26.6 13.4 25.2 13L24.4 15L24.2 21H21.6L21.2 15.6H12L11.2 21H8.6L8.4 15C6.4 14.6 5 13.6 4.2 12.6C2.6 12.6 1.4 11.6 0.8 9.8C0.4 8.4 0.4 6.6 0.4 5.2C1.4 6.8 1.8 8.6 3 11Z';
const RUNES = [
  'M8 1.5V14.5M3.5 5.5L8 1.5L12.5 5.5',
  'M3 3H13M8 3V13M4.5 13H11.5',
  'M3 2.5L8 8L13 2.5M8 8V14.5',
  'M4.5 2Q12.5 5 4.5 8Q12.5 11 4.5 14',
  'M3 14V6.5Q8 1.5 13 6.5V14',
  'M9.5 1.5L4.5 8.5H11.5L6.5 14.5',
  'M3 4.5H13M3 11.5H13M8 1.5V14.5',
];

/** Carved stone lion head for the corners (local 100×100 space). */
function CornerLion({ x, y, s, k, mirror }: { x: number; y: number; s: number; k: (n: string) => string; mirror?: boolean }) {
  const u = (n: string) => `url(#${k(n)})`;
  const mane = Array.from({ length: 14 }, (_, i) => {
    const a = ((i / 14) * 360 - 90) * (Math.PI / 180);
    const p = (r: number, aa: number) => `${f1(50 + Math.cos(aa) * r)} ${f1(52 + Math.sin(aa) * r)}`;
    return `M${p(20, a - 0.26)}Q${p(44, a - 0.3)} ${p(48, a + 0.06)}Q${p(42, a + 0.3)} ${p(20, a + 0.26)}Z`;
  });
  return (
    <g transform={`translate(${x - 50 * s} ${y - 50 * s}) scale(${s})${mirror ? ' translate(100 0) scale(-1 1)' : ''}`}>
      <circle cx="51" cy="56" r="49" fill="#05070e" opacity=".55" />
      <circle cx="50" cy="52" r="48" fill={u('bronze')} stroke="#1a0e04" strokeWidth="1.6" />
      <circle cx="50" cy="52" r="44.5" fill="#26272d" stroke="#1a0e04" strokeWidth="1" />
      {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={f1(50 + Math.cos((i / 12) * Math.PI * 2) * 46.2)} cy={f1(52 + Math.sin((i / 12) * Math.PI * 2) * 46.2)} r="1.3" fill="#fff4cc" opacity=".85" />)}
      {mane.map((d, i) => <path key={i} d={d} fill={i % 2 ? u('maneB') : u('maneA')} stroke="#1a1714" strokeWidth="1.6" strokeLinejoin="round" />)}
      <circle cx="50" cy="52" r="30" fill="none" stroke={u('bronze')} strokeWidth="3.2" />
      <circle cx="50" cy="52" r="30" fill="none" stroke="#2a1404" strokeWidth=".8" opacity=".8" />
      <g transform="translate(50 52) scale(1.14) translate(-50 -52)">
      <path d="M50 26C64 26 73 34 72 48C71.6 60 66 70 50 80C34 70 28.4 60 28 48C27 34 36 26 50 26Z" fill={u('face')} stroke="#1a1714" strokeWidth="1.6" />
      <path d="M33 42Q41 35.5 48 41.5" fill="none" stroke="#2c2722" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M67 42Q59 35.5 52 41.5" fill="none" stroke="#2c2722" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M34.5 47.5Q41 42.5 47 47Q41 51.5 34.5 47.5Z" className={styles.lionEye} />
      <path d="M65.5 47.5Q59 42.5 53 47Q59 51.5 65.5 47.5Z" className={styles.lionEye} />
      <path d="M50 42V54" stroke="#cfc6b8" strokeWidth="2.6" strokeLinecap="round" opacity=".55" />
      <path d="M42.5 55H57.5Q57 61 50 62.5Q43 61 42.5 55Z" fill="#3a332c" stroke="#1a1714" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M39.5 65Q50 61 60.5 65Q58 76 50 77.5Q42 76 39.5 65Z" fill="#160d0a" stroke="#1a1714" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M42 65L44.5 71L46.4 64.2Z M58 65L55.5 71L53.6 64.2Z" fill="#e8dfcf" />
      <path d="M34 32Q40 27.5 47 27.6" fill="none" stroke="#e9e1d4" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </g>
    </g>
  );
}

export function StormFrame({ children, mood = 'base', className }: { children?: ReactNode; mood?: StormFrameMood; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `stf${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;

  const outer = `M16 0H${W - 16}Q${W} 0 ${W} 16V${H - 16}Q${W} ${H} ${W - 16} ${H}H16Q0 ${H} 0 ${H - 16}V16Q0 0 16 0Z`;
  const inner = `M${GX + 10} ${GY}H${GX + GW - 10}Q${GX + GW} ${GY} ${GX + GW} ${GY + 10}V${GY + GH - 10}Q${GX + GW} ${GY + GH} ${GX + GW - 10} ${GY + GH}H${GX + 10}Q${GX} ${GY + GH} ${GX} ${GY + GH - 10}V${GY + 10}Q${GX} ${GY} ${GX + 10} ${GY}Z`;

  // top frieze: bulls and lions walking toward the keystone
  const animals: Array<{ x: number; lion: boolean; dir: 1 | -1 }> = [];
  const joints = [262, 738];
  for (const [from, to, dir] of [[92, 410, 1], [556, 874, -1]] as const) {
    let i = 0;
    for (let x = from; x <= to; x += 50) {
      if (joints.some(j => Math.abs(j - (x + 16)) < 24)) continue;
      animals.push({ x, lion: i % 2 === 1, dir });
      i++;
    }
  }
  // runes: three per side, a cartouche of five at the bottom
  const sideRunes = [256, 435, 614];
  const bottomRunes = [-2, -1, 0, 1, 2];

  return (
    <div className={`${styles.frame} ${className ?? ''}`} data-mood={mood}>
      <div className={styles.glass}>
        <svg className={styles.clouds} viewBox="0 0 600 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={k('cl')} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#9fc4ff" stopOpacity=".3" />
              <stop offset="1" stopColor="#9fc4ff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={k('cl2')} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#5fe0d0" stopOpacity=".2" />
              <stop offset="1" stopColor="#5fe0d0" stopOpacity="0" />
            </radialGradient>
          </defs>
          {[[90, 70, 160, 50], [230, 50, 140, 40], [420, 80, 190, 56], [560, 40, 120, 40], [140, 260, 180, 40], [470, 300, 200, 50], [300, 440, 260, 60], [60, 420, 150, 46]].map(([x, y, rx, ry], i) => <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill={u(i % 3 === 2 ? 'cl2' : 'cl')} />)}
          <path d="M470 0L452 46L470 52L440 120" fill="none" stroke="#8fd8ff" strokeWidth="1.2" opacity=".12" />
          <path d="M80 500L104 452L88 446L120 380" fill="none" stroke="#8fd8ff" strokeWidth="1.2" opacity=".1" />
        </svg>
        <div className={styles.content}>{children}</div>
        <div className={styles.glassSheen} aria-hidden="true" />
      </div>
      <svg className={styles.frameArt} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={k('stone')} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor="#7c7a7a" />
            <stop offset=".35" stopColor="#5a5960" />
            <stop offset=".7" stopColor="#42424b" />
            <stop offset="1" stopColor="#2a2a32" />
          </linearGradient>
          <linearGradient id={k('bronze')} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff1c4" />
            <stop offset=".2" stopColor="#e9b75c" />
            <stop offset=".45" stopColor="#a8661e" />
            <stop offset=".6" stopColor="#f2cf86" />
            <stop offset=".8" stopColor="#8a4e14" />
            <stop offset="1" stopColor="#4a260a" />
          </linearGradient>
          <linearGradient id={k('bronzeV')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff0c0" />
            <stop offset=".4" stopColor="#d9a04a" />
            <stop offset="1" stopColor="#6a3a0e" />
          </linearGradient>
          <linearGradient id={k('sunk')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1c1c22" />
            <stop offset=".3" stopColor="#33333b" />
            <stop offset="1" stopColor="#45454e" />
          </linearGradient>
          <radialGradient id={k('maneA')} cx="0.4" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#a39a8c" />
            <stop offset="1" stopColor="#4c463f" />
          </radialGradient>
          <radialGradient id={k('maneB')} cx="0.4" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#8a8174" />
            <stop offset="1" stopColor="#38332e" />
          </radialGradient>
          <radialGradient id={k('face')} cx="0.38" cy="0.3" r="0.85">
            <stop offset="0" stopColor="#d6cdbd" />
            <stop offset=".5" stopColor="#968c7e" />
            <stop offset="1" stopColor="#4e4840" />
          </radialGradient>
          <radialGradient id={k('keyGlow')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#7fe7ff" stopOpacity=".55" />
            <stop offset="1" stopColor="#7fe7ff" stopOpacity="0" />
          </radialGradient>
          <pattern id={k('grain')} width="46" height="38" patternUnits="userSpaceOnUse">
            <circle cx="6" cy="8" r="1.1" fill="#fff" opacity=".07" />
            <circle cx="30" cy="4" r=".8" fill="#000" opacity=".22" />
            <circle cx="18" cy="22" r="1.4" fill="#000" opacity=".14" />
            <circle cx="40" cy="28" r="1" fill="#fff" opacity=".06" />
            <circle cx="10" cy="33" r=".7" fill="#000" opacity=".25" />
            <path d="M24 30l5 -2" stroke="#000" strokeWidth=".8" opacity=".18" />
            <path d="M34 15l3 3" stroke="#fff" strokeWidth=".7" opacity=".06" />
          </pattern>
          <pattern id={k('waveH')} width="34" height="22" patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${H - 41})`}>
            <path d="M-1 17C6 17 8.5 5 16.5 5C23 5 24.5 12.5 19.8 13.4C16.6 14 15.8 10.4 18.4 9.6M19.8 13.4C24 15.4 27.6 17 35 17" fill="none" stroke="#1c1916" strokeWidth="3.4" strokeLinecap="round" transform="translate(.8 1.2)" opacity=".7" />
            <path d="M-1 17C6 17 8.5 5 16.5 5C23 5 24.5 12.5 19.8 13.4C16.6 14 15.8 10.4 18.4 9.6M19.8 13.4C24 15.4 27.6 17 35 17" fill="none" stroke="#aaa6a2" strokeWidth="2.6" strokeLinecap="round" />
          </pattern>
          <pattern id={k('waveV')} width="34" height="22" patternUnits="userSpaceOnUse" patternTransform="translate(39 0) rotate(90)">
            <path d="M-1 17C6 17 8.5 5 16.5 5C23 5 24.5 12.5 19.8 13.4C16.6 14 15.8 10.4 18.4 9.6M19.8 13.4C24 15.4 27.6 17 35 17" fill="none" stroke="#1c1916" strokeWidth="3.4" strokeLinecap="round" transform="translate(.8 1.2)" opacity=".7" />
            <path d="M-1 17C6 17 8.5 5 16.5 5C23 5 24.5 12.5 19.8 13.4C16.6 14 15.8 10.4 18.4 9.6M19.8 13.4C24 15.4 27.6 17 35 17" fill="none" stroke="#aaa6a2" strokeWidth="2.6" strokeLinecap="round" />
          </pattern>
          <pattern id={k('waveV2')} width="34" height="22" patternUnits="userSpaceOnUse" patternTransform={`translate(${W - 17} 0) rotate(90)`}>
            <path d="M-1 17C6 17 8.5 5 16.5 5C23 5 24.5 12.5 19.8 13.4C16.6 14 15.8 10.4 18.4 9.6M19.8 13.4C24 15.4 27.6 17 35 17" fill="none" stroke="#1c1916" strokeWidth="3.4" strokeLinecap="round" transform="translate(.8 1.2)" opacity=".7" />
            <path d="M-1 17C6 17 8.5 5 16.5 5C23 5 24.5 12.5 19.8 13.4C16.6 14 15.8 10.4 18.4 9.6M19.8 13.4C24 15.4 27.6 17 35 17" fill="none" stroke="#aaa6a2" strokeWidth="2.6" strokeLinecap="round" />
          </pattern>
          <path id={k('bull')} d={BULL} />
          <path id={k('lion')} d={LION} />
          {RUNES.map((d, i) => <path key={i} id={k(`r${i}`)} d={d} />)}
        </defs>

        {/* stone body + grain */}
        <path d={`${outer}${inner}`} fillRule="evenodd" fill={u('stone')} />
        <path d={`${outer}${inner}`} fillRule="evenodd" fill={u('grain')} />
        {/* outer bronze lip */}
        <path d={outer} fill="none" stroke="#120d08" strokeWidth="2" />
        <rect x="5" y="5" width={W - 10} height={H - 10} rx="12" fill="none" stroke={u('bronze')} strokeWidth="5" />
        <rect x="8.5" y="8.5" width={W - 17} height={H - 17} rx="10" fill="none" stroke="#2a1404" strokeWidth="1" opacity=".7" />

        {[150, 350, 650, 850].flatMap(x => [[x, 6.5], [x, H - 6.5]]).concat([200, 400, 670].flatMap(y => [[6.5, y], [W - 6.5, y]])).map(([x, y], i) => (
          <g key={i}><circle cx={x} cy={y} r="4.6" fill={u('bronze')} stroke="#1a0e04" strokeWidth="1.2" /><circle cx={x - 1.2} cy={y - 1.3} r="1.4" fill="#fff6d8" /></g>
        ))}
        {/* sunken relief strips */}
        {STRIPS.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx="4" fill={u('sunk')} />)}
        <rect x="76" y={H - 41} width={W - 152} height="22" fill={u('waveH')} />
        <rect x="17" y="104" width="22" height={H - 208} fill={u('waveV')} />
        <rect x={W - 39} y="104" width="22" height={H - 208} fill={u('waveV2')} />
        {/* strip bevels: dark top edge, light lower edge */}
        {STRIPS.map(([x, y, w, h], i) => (
          <g key={i} fill="none">
            <rect x={x} y={y} width={w} height={h} rx="4" stroke="#14110e" strokeWidth="2" opacity=".85" />
            <path d={`M${x + 3} ${y + h + 1.4}H${x + w - 3}`} stroke="#c4b9a8" strokeWidth="1.4" opacity=".45" />
          </g>
        ))}

        {/* bull & lion procession */}
        {animals.map(({ x, lion, dir }, i) => {
          const t = dir === 1 ? `translate(${x} 20) scale(1.3)` : `translate(${x + 42} 20) scale(-1.3 1.3)`;
          return (
            <g key={i} transform={t}>
              <use href={`#${k(lion ? 'lion' : 'bull')}`} fill="#15120f" transform="translate(.9 1.3)" />
              <use href={`#${k(lion ? 'lion' : 'bull')}`} fill={lion ? '#d4ae6e' : '#bdb8b0'} />
              <path d="M8 7.4H20" stroke="#fff" strokeWidth=".9" opacity=".35" strokeLinecap="round" />
            </g>
          );
        })}

        {/* cyclopean block joints */}
        {[
          `M${joints[0]} 0L${joints[0] + 7} ${GY - 6}`, `M${joints[1]} 0L${joints[1] - 6} ${GY - 6}`,
          `M0 ${300}L${GX - 6} ${306}`, `M0 ${584}L${GX - 6} ${578}`, `M${W} ${336}L${W - GX + 6} ${330}`, `M${W} ${560}L${W - GX + 6} ${566}`,
          `M${312} ${H}L${306} ${H - 52}`, `M${696} ${H}L${703} ${H - 52}`,
        ].map((d, i) => (
          <g key={i}>
            <path d={d} stroke="#0e0b09" strokeWidth="4.6" />
            <path d={d} stroke="#a89d8e" strokeWidth="1.2" opacity=".5" transform="translate(2.6 0)" />
          </g>
        ))}

        {/* inner bronze inlay around the glass */}
        <rect x={GX - 6} y={GY - 6} width={GW + 12} height={GH + 12} rx="14" fill="none" stroke="#120d08" strokeWidth="2.4" />
        <rect x={GX - 4} y={GY - 4} width={GW + 8} height={GH + 8} rx="13" fill="none" stroke={u('bronze')} strokeWidth="5" />
        <rect x={GX - 1.2} y={GY - 1.2} width={GW + 2.4} height={GH + 2.4} rx="11" fill="none" stroke="#2a1404" strokeWidth="1.6" />
        <rect x={GX - 4} y={GY - 4} width={GW + 8} height={GH + 8} rx="13" fill="none" stroke="#fff6d8" strokeWidth=".9" strokeDasharray="2 14" opacity=".75" />
        <rect x={GX - 0.5} y={GY - 0.5} width={GW + 1} height={GH + 1} rx="10.5" fill="none" className={styles.innerArc} />

        {/* runes (side medallions + bottom cartouche) */}
        <g className={styles.runeSockets}>
          {sideRunes.flatMap((y) => [[28, y], [W - 28, y]]).map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="16" fill="#191612" stroke={u('bronze')} strokeWidth="3" />
              <circle cx={x} cy={y} r="12.5" fill="#0d0f16" />
            </g>
          ))}
          <path d={`M${W / 2 - 92} ${H - 50}H${W / 2 + 92}L${W / 2 + 108} ${H - 30}L${W / 2 + 92} ${H - 10}H${W / 2 - 92}L${W / 2 - 108} ${H - 30}Z`} fill="#13110f" stroke={u('bronze')} strokeWidth="3.4" strokeLinejoin="round" />
        </g>
        <g className={styles.runes}>
          {sideRunes.flatMap((y, j) => [[28, y, j], [W - 28, y, j + 3]]).map(([x, y, r], i) => (
            <g key={i} transform={`translate(${x - 10.4} ${y - 10.4}) scale(1.3)`} className={styles.rune}>
              <use href={`#${k(`r${r % RUNES.length}`)}`} className={styles.runeHalo} />
              <use href={`#${k(`r${r % RUNES.length}`)}`} className={styles.runeCore} />
            </g>
          ))}
          {bottomRunes.map((o, i) => (
            <g key={o} transform={`translate(${W / 2 + o * 34 - 9.6} ${H - 39.6}) scale(1.2)`} className={styles.rune}>
              <use href={`#${k(`r${(i + 2) % RUNES.length}`)}`} className={styles.runeHalo} />
              <use href={`#${k(`r${(i + 2) % RUNES.length}`)}`} className={styles.runeCore} />
            </g>
          ))}
        </g>

        {/* keystone with the storm sigil */}
        <g>
          <circle cx={W / 2} cy="20" r="80" fill={u('keyGlow')} className={styles.keyGlow} />
          <path d={`M${W / 2 - 64} -22H${W / 2 + 64}L${W / 2 + 50} 58H${W / 2 - 50}Z`} fill="#05070e" opacity=".5" transform="translate(0 5)" />
          <path d={`M${W / 2 - 64} -22H${W / 2 + 64}L${W / 2 + 50} 58H${W / 2 - 50}Z`} fill={u('stone')} stroke="#120d08" strokeWidth="2" strokeLinejoin="round" />
          <path d={`M${W / 2 - 64} -22H${W / 2 + 64}L${W / 2 + 50} 58H${W / 2 - 50}Z`} fill={u('grain')} />
          <path d={`M${W / 2 - 58} -16H${W / 2 + 58}L${W / 2 + 45.5} 52H${W / 2 - 45.5}Z`} fill="none" stroke={u('bronze')} strokeWidth="4" strokeLinejoin="round" />
          <path d={`M${W / 2 - 57} -15H${W / 2 + 57}`} stroke="#fff6d8" strokeWidth="1.4" opacity=".6" />
          <g transform={`translate(${W / 2 - 34} -15) scale(.68)`}>
            <path d="M50 2L37 42H47L38 92L64 34H53L62 2Z" fill="#0b2a52" opacity=".5" transform="translate(2 3)" />
            <path d="M50 2L37 42H47L38 92L64 34H53L62 2Z" className={styles.keyBolt} stroke="#2a1404" strokeWidth="2.4" strokeLinejoin="round" />
            <path d="M23 26L14 48H20L15 70L30 44H24L29 26Z M77 26L86 48H80L85 70L70 44H76L71 26Z" fill={u('bronzeV')} stroke="#2a1404" strokeWidth="2" strokeLinejoin="round" />
          </g>
        </g>

        {/* corner lion heads */}
        <CornerLion x={26} y={30} s={0.96} k={k} />
        <CornerLion x={W - 26} y={30} s={0.96} k={k} mirror />
        <CornerLion x={26} y={H - 30} s={0.96} k={k} />
        <CornerLion x={W - 26} y={H - 30} s={0.96} k={k} mirror />
      </svg>
    </div>
  );
}
