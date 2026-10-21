import { memo } from 'react';
import type { ReactNode } from 'react';
import { GR_PALETTE as P, grDiamond } from './symbols';
import styles from './art.module.css';

/* "GÖREME · Şafak Balonları" wordmark. Original lettering: soft, round-jointed strokes like letters carved into tuff
   (cream tuff face, terracotta edge, warm ink outline, a sunlit top highlight). The O of GÖ is a rising sun (stepped
   rays behind it) and its two dots are tiny hot-air balloons that bob. A kilim strip runs under the letters; the
   subtitle sits between two rules with diamond ends. A light sweep crosses the face every few seconds (transform /
   opacity only; still with reduced motion). `subtitle` accepts text or a node (null hides it). */

const LW = 92, GAP = 18, X0 = 30, TOP = 46, LH = 120;
const LETTERS: string[] = [
  // G
  'M84 22C76 10 64 4 50 4C26 4 8 26 8 60C8 94 26 116 50 116C70 116 86 104 88 82V64H54',
  // Ö (drawn as the sun ring, see below)
  'M46 4C72 4 88 28 88 60C88 92 72 116 46 116C20 116 4 92 4 60C4 28 20 4 46 4Z',
  // R
  'M10 116V4H52C74 4 86 16 86 34C86 52 74 64 52 64H10M50 64L88 116',
  // E
  'M86 4H10V116H86M10 60H72',
  // M
  'M6 116V4L46 76L86 4V116',
  // E
  'M86 4H10V116H86M10 60H72',
];
const X = LETTERS.map((_, i) => X0 + i * (LW + GAP));
const SUN_CX = X[1]! + 46, SUN_CY = TOP + 60;
const SUN_RAYS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  const r0 = 66, r1 = i % 2 ? 80 : 92;
  const p = (r: number, da: number) => `${Math.round((SUN_CX + Math.cos(a + da) * r) * 10) / 10} ${Math.round((SUN_CY + Math.sin(a + da) * r * 1.2) * 10) / 10}`;
  return `M${p(r0, -0.1)}L${p(r1, 0)}L${p(r0, 0.1)}Z`;
}).join('');
const MINI = (x: number, y: number) => `M${x} ${y - 13}C${x + 9} ${y - 13} ${x + 13} ${y - 7} ${x + 13} ${y}C${x + 13} ${y + 6} ${x + 7} ${y + 9} ${x + 4} ${y + 12}H${x - 4}C${x - 7} ${y + 9} ${x - 13} ${y + 6} ${x - 13} ${y}C${x - 13} ${y - 7} ${x - 9} ${y - 13} ${x} ${y - 13}Z`;

export const GoremeLogo = memo(function GoremeLogo({ className, subtitle = 'ŞAFAK BALONLARI', label = 'Göreme: Şafak Balonları' }: { className?: string; subtitle?: ReactNode | null; label?: string }) {
  const hasSub = subtitle !== null && subtitle !== false && subtitle !== '';
  const h = hasSub ? 268 : 206;
  const totalW = X0 * 2 + LETTERS.length * LW + (LETTERS.length - 1) * GAP;
  return (
    <svg className={`${styles.logo} ${className ?? ''}`} viewBox={`0 0 ${totalW} ${h}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id="grlFace" x1="0" y1={TOP} x2="0" y2={TOP + LH} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" /><stop offset=".3" stopColor={P.tuff.hi} /><stop offset=".62" stopColor={P.tuff.light} /><stop offset=".64" stopColor="#ffe9d2" /><stop offset="1" stopColor={P.tuff.base} />
        </linearGradient>
        <linearGradient id="grlEdge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.clay.light} /><stop offset="1" stopColor={P.clay.deep} /></linearGradient>
        <linearGradient id="grlGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffbe6" /><stop offset=".5" stopColor={P.saffron.light} /><stop offset="1" stopColor={P.saffron.base} /></linearGradient>
        <radialGradient id="grlSun" cx=".45" cy=".42" r=".6"><stop offset="0" stopColor="#ffffff" /><stop offset=".45" stopColor="#fff2c0" /><stop offset="1" stopColor={P.saffron.light} /></radialGradient>
        <radialGradient id="grlGlow"><stop offset="0" stopColor="#ffd890" stopOpacity=".55" /><stop offset="1" stopColor="#ffd890" stopOpacity="0" /></radialGradient>
        <linearGradient id="grlShine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <radialGradient id="grlB1" cx=".36" cy=".3" r=".8"><stop offset="0" stopColor={P.madder.light} /><stop offset="1" stopColor={P.madder.deep} /></radialGradient>
        <radialGradient id="grlB2" cx=".36" cy=".3" r=".8"><stop offset="0" stopColor={P.turq.light} /><stop offset="1" stopColor={P.turq.deep} /></radialGradient>
        <pattern id="grlKilim" width="24" height="16" patternUnits="userSpaceOnUse" x={X0}>
          <rect width="24" height="16" fill={P.madder.base} />
          <path d={grDiamond(12, 8, 7, 6)} fill={P.saffron.light} /><path d={grDiamond(12, 8, 3, 2.6)} fill={P.indigo.base} />
          <path d={`${grDiamond(0, 8, 2.4)}${grDiamond(24, 8, 2.4)}`} fill={P.cream} />
        </pattern>
        <mask id="grlMask">
          {LETTERS.map((d, i) => <path key={i} d={d} transform={`translate(${X[i]} ${TOP})`} fill="none" stroke="#fff" strokeWidth="22" strokeLinejoin="round" strokeLinecap="round" />)}
        </mask>
      </defs>
      <ellipse cx={totalW / 2} cy={TOP + 60} rx={totalW * 0.55} ry="110" fill="url(#grlGlow)" />
      {/* sun rays behind the Ö */}
      <path d={SUN_RAYS} fill="url(#grlGold)" stroke={P.ink} strokeWidth="2" strokeLinejoin="round" className={styles.logoRays} />
      {/* kilim strip under the letters */}
      <rect x={X0 - 6} y={TOP + LH + 12} width={totalW - X0 * 2 + 12} height="16" fill="url(#grlKilim)" stroke={P.ink} strokeWidth="2.4" />
      {LETTERS.map((d, i) => (
        <g key={i} transform={`translate(${X[i]} ${TOP})`}>
          <path d={d} fill="none" stroke={P.ink} strokeWidth="34" strokeLinejoin="round" strokeLinecap="round" />
          <path d={d} fill="none" stroke="url(#grlEdge)" strokeWidth="29" strokeLinejoin="round" strokeLinecap="round" />
          {i === 1 && <path d={d} fill="url(#grlSun)" />}
          <path d={d} fill="none" stroke="url(#grlFace)" strokeWidth="20" strokeLinejoin="round" strokeLinecap="round" />
          <path d={d} fill="none" stroke="#fff" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" opacity=".7" transform="translate(-2.6 -3.4)" />
        </g>
      ))}
      <rect className={styles.logoShine} x="-160" y="0" width="120" height={TOP + LH + 20} fill="url(#grlShine)" mask="url(#grlMask)" opacity=".75" />
      {/* the two balloon dots of Ö */}
      {[[SUN_CX - 22, TOP - 26, 'grlB1', 0], [SUN_CX + 22, TOP - 30, 'grlB2', 1]].map(([x, y, g, i]) => (
        <g key={String(g)} className={styles.logoBalloon} style={{ animationDelay: `${-(i as number) * 1.4}s` }}>
          <path d={MINI(x as number, y as number)} fill={`url(#${g})`} stroke={P.ink} strokeWidth="2.4" />
          <path d={`M${(x as number) - 12} ${(y as number) - 1}H${(x as number) + 12}`} stroke={P.saffron.light} strokeWidth="3" />
          <rect x={(x as number) - 4} y={(y as number) + 14} width="8" height="6" rx="1.4" fill={P.basalt.light} stroke={P.ink} strokeWidth="1.6" />
        </g>
      ))}
      {hasSub && (
        <g>
          <path d={`M${X0 + 10} ${h - 34}H${totalW / 2 - 262}M${totalW / 2 + 262} ${h - 34}H${totalW - X0 - 10}`} stroke="url(#grlGold)" strokeWidth="4" />
          <path d={`${grDiamond(totalW / 2 - 256, h - 34, 8)}${grDiamond(totalW / 2 + 256, h - 34, 8)}`} fill={P.madder.light} stroke={P.ink} strokeWidth="1.6" />
          <text x={totalW / 2} y={h - 22} textAnchor="middle" className={styles.logoSub} fill="url(#grlGold)" stroke={P.ink} strokeWidth="1.4" paintOrder="stroke">{subtitle}</text>
        </g>
      )}
    </svg>
  );
});
