'use client';
import { memo } from 'react';
import { useT } from '@/lib/i18n/client';
import { AS_PALETTE as P, asSparkle } from './symbols';
import styles from './art.module.css';

/* "ASENA · Yıldız Kurdu" logo. The five letters are drawn as constellations: angular chiselled strokes (original
   letterforms, steppe-steel with a bronze edge) whose corners are stars, joined above by a faint star line that runs
   from letter to letter; gold stars on the two A apexes. Subtitle in Barlow with felt-bronze rules. A shine sweeps
   the steel every few seconds and the stars twinkle (opacity / transform only, still with reduced motion). */

const LETTERS: Array<{ x: number; d: string; nodes: Array<[number, number]> }> = (() => {
  const w = 96, gap = 20, x0 = 36;
  const L = [
    { d: 'M0 130L48 0L96 130M24 86H72', nodes: [[0, 130], [48, 0], [96, 130], [24, 86], [72, 86]] },
    { d: 'M92 10H22L4 36L22 62H74L92 88L74 120H4', nodes: [[92, 10], [22, 10], [4, 36], [74, 62], [92, 88], [4, 120]] },
    { d: 'M92 8H8V122H92M8 64H70', nodes: [[92, 8], [8, 8], [8, 122], [92, 122], [70, 64]] },
    { d: 'M8 130V0L88 130V0', nodes: [[8, 130], [8, 0], [88, 130], [88, 0]] },
    { d: 'M0 130L48 0L96 130M24 86H72', nodes: [[0, 130], [48, 0], [96, 130], [24, 86], [72, 86]] },
  ];
  return L.map((l, i) => ({ x: x0 + i * (w + gap), d: l.d, nodes: l.nodes as Array<[number, number]> }));
})();
const TOP = 26;
const SKYLINE = LETTERS.map((l, i) => { const [nx, ny] = l.nodes[1]!; return `${i ? 'L' : 'M'}${l.x + nx} ${TOP + ny - 14}`; }).join('');

export const AsenaLogo = memo(function AsenaLogo({ className, subtitle = true }: { className?: string; subtitle?: boolean }) {
  const t = useT('asena');
  const h = subtitle ? 232 : 176;
  return (
    <svg className={`${styles.logo} ${className ?? ''}`} viewBox={`0 0 640 ${h}`} role="img" aria-label={t('logo.label')}>
      <defs>
        <linearGradient id="aslSteel" x1="0" y1={TOP} x2="0" y2={TOP + 130} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" /><stop offset=".28" stopColor={P.silver.light} /><stop offset=".55" stopColor="#8ea4e0" /><stop offset=".6" stopColor="#e8eeff" /><stop offset="1" stopColor={P.silver.deep} />
        </linearGradient>
        <linearGradient id="aslBronze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.bronze.hi} /><stop offset=".5" stopColor={P.bronze.base} /><stop offset="1" stopColor={P.bronze.dark} /></linearGradient>
        <linearGradient id="aslGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffbe6" /><stop offset=".5" stopColor={P.gold.light} /><stop offset="1" stopColor={P.gold.base} /></linearGradient>
        <linearGradient id="aslShine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <radialGradient id="aslGlow"><stop offset="0" stopColor="#6a8aff" stopOpacity=".45" /><stop offset="1" stopColor="#6a8aff" stopOpacity="0" /></radialGradient>
        <mask id="aslMask">
          {LETTERS.map((l, i) => <path key={i} d={l.d} transform={`translate(${l.x} ${TOP})`} fill="none" stroke="#fff" strokeWidth="21" strokeLinejoin="miter" strokeLinecap="square" />)}
        </mask>
      </defs>
      <ellipse cx="320" cy={TOP + 66} rx="330" ry="96" fill="url(#aslGlow)" />
      {/* star line above the letters */}
      <path d={SKYLINE} fill="none" stroke="#cfe0ff" strokeWidth="1.6" strokeDasharray="2 6" opacity=".7" />
      {LETTERS.map((l, i) => (
        <g key={i} transform={`translate(${l.x} ${TOP})`}>
          <path d={l.d} fill="none" stroke="#04061a" strokeWidth="31" strokeLinejoin="miter" strokeLinecap="square" />
          <path d={l.d} fill="none" stroke="url(#aslBronze)" strokeWidth="27" strokeLinejoin="miter" strokeLinecap="square" />
          <path d={l.d} fill="none" stroke="url(#aslSteel)" strokeWidth="19" strokeLinejoin="miter" strokeLinecap="square" />
          <path d={l.d} fill="none" stroke="#ffffff" strokeWidth="3" strokeLinejoin="miter" opacity=".55" transform="translate(-3 -3)" />
        </g>
      ))}
      <rect className={styles.logoShine} x="-160" y="0" width="120" height={TOP + 140} fill="url(#aslShine)" mask="url(#aslMask)" opacity=".8" />
      {LETTERS.map((l, i) => l.nodes.map(([nx, ny], j) => {
        const gold = (i === 0 || i === 4) && j === 1;
        return <path key={`${i}-${j}`} className={styles.logoStar} style={{ animationDelay: `${-((i * 5 + j) * 0.37) % 3}s` }} d={asSparkle(l.x + nx, TOP + ny, gold ? 15 : 7.4, 0.2)} fill={gold ? 'url(#aslGold)' : '#ffffff'} />;
      }))}
      {LETTERS.map((l, i) => { const [nx, ny] = l.nodes[1]!; return <circle key={i} cx={l.x + nx} cy={TOP + ny - 14} r="2.2" fill="#e6eeff" />; })}
      {subtitle && (
        <g>
          <path d="M60 200H200M440 200H580" stroke="url(#aslBronze)" strokeWidth="3" />
          <path d={`${asSparkle(206, 200, 7)}${asSparkle(434, 200, 7)}`} fill={P.turq.light} />
          <text x="320" y="212" textAnchor="middle" className={styles.logoSub} fill="url(#aslGold)" stroke="#2a1406" strokeWidth="1" paintOrder="stroke">{t('logo.subtitle')}</text>
        </g>
      )}
    </svg>
  );
});
