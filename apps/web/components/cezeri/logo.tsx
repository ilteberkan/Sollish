'use client';
import { memo, useId } from 'react';
import { useT } from '@/lib/i18n/client';
import { CZ_PALETTE as P } from './symbols';
import styles from './art.module.css';

/* "CEZERİ — Zamanın Çarkları" logotype. Original letterforms drawn as broad monoline strokes with chamfered
   ends: a polished brass edge around turquoise enamel (the board's colours), an engraved hairline in every
   stroke, a toothed brass arc behind the word and the dot of the İ cut as a small ruby-hubbed gear that turns.
   The subtitle sits in a lapis cartouche with gear-tooth ends. A shine passes over the brass now and then.
   Reduced motion: still. */

const LETTERS = [
  // C
  'M118 66A52 52 0 1 0 118 134',
  // E
  'M160 48V152', 'M160 48H220', 'M160 100H208', 'M160 152H222',
  // Z
  'M254 48H322L256 152H326',
  // E
  'M360 48V152', 'M360 48H420', 'M360 100H408', 'M360 152H422',
  // R
  'M458 152V48H498Q530 48 530 75Q530 102 498 102H458', 'M494 102L534 152',
  // İ
  'M574 48V152',
];
const S = 24;
const r2 = (n: number) => Math.round(n * 100) / 100;
const gearD = (cx: number, cy: number, n: number, r0: number, r1: number) => {
  let d = '';
  for (let i = 0; i < n * 4; i++) { const a = (i / (n * 4)) * Math.PI * 2, r = i % 4 < 2 ? r1 : r0; d += `${i ? 'L' : 'M'}${r2(cx + Math.cos(a) * r)} ${r2(cy + Math.sin(a) * r)}`; }
  return `${d}Z`;
};
/** Teeth along an arc (centre cx, cy), from a0 to a1 degrees (0 = up). */
const arcTeeth = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, n: number) => {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, w = ((a1 - a0) / n) * 0.24;
    const p = (r: number, aa: number) => { const t = (aa * Math.PI) / 180; return `${r2(cx + Math.sin(t) * r)} ${r2(cy - Math.cos(t) * r)}`; };
    d += `M${p(r0, a - w)}L${p(r1, a - w * 0.6)}L${p(r1, a + w * 0.6)}L${p(r0, a + w)}Z`;
  }
  return d;
};

export const CezeriLogo = memo(function CezeriLogo({ className, subtitle = true }: { className?: string; subtitle?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `czl${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  const strokes = (w: number, color: string, extra?: Record<string, string | number>) => (
    <g fill="none" stroke={color} strokeWidth={w} strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={2} {...extra}>
      {LETTERS.map((d, i) => <path key={i} d={d} />)}
    </g>
  );
  const h = subtitle ? 262 : 196;
  return (
    <svg className={`${styles.logo} ${className ?? ''}`} viewBox={`0 0 640 ${h}`} role="img" aria-label={t('logo.label')} focusable="false">
      <defs>
        <linearGradient id={k('brass')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.brass.hi} /><stop offset=".32" stopColor={P.brass.light} /><stop offset=".62" stopColor={P.brass.base} /><stop offset="1" stopColor={P.brass.dark} /></linearGradient>
        <linearGradient id={k('enamel')} x1="0" y1="40" x2="0" y2="160" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor={P.turq.hi} /><stop offset=".3" stopColor={P.turq.light} /><stop offset=".65" stopColor={P.turq.base} /><stop offset="1" stopColor={P.turq.deep} /></linearGradient>
        <linearGradient id={k('gloss')} x1="0" y1="40" x2="0" y2="160" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff" stopOpacity=".7" /><stop offset=".42" stopColor="#fff" stopOpacity=".05" /><stop offset="1" stopColor="#000" stopOpacity=".2" /></linearGradient>
        <linearGradient id={k('shine')} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".95" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <linearGradient id={k('lapis')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.lapis.light} /><stop offset=".5" stopColor={P.lapis.base} /><stop offset="1" stopColor={P.lapis.dark} /></linearGradient>
        <radialGradient id={k('ruby')} cx=".38" cy=".32" r=".75"><stop offset="0" stopColor="#ffe0e0" /><stop offset=".35" stopColor="#ff4a5a" /><stop offset="1" stopColor="#5a0010" /></radialGradient>
        <mask id={k('m')} maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="200">{strokes(S + 8, '#fff')}</mask>
      </defs>
      {/* toothed arc behind the word */}
      <g opacity=".9">
        <path d="M60 182A270 270 0 0 1 580 182" fill="none" stroke="#1a0d05" strokeWidth="14" />
        <path d={arcTeeth(320, 400, 262, 284, -64, 64, 46)} fill={P.brass.deep} stroke="#1a0d05" strokeWidth="1.6" />
        <path d="M60 182A270 270 0 0 1 580 182" fill="none" stroke={u('brass')} strokeWidth="8" />
      </g>
      {/* shadow, brass edge, dark seam, enamel, gloss, hairline */}
      {strokes(S + 16, '#05030a', { opacity: 0.55, transform: 'translate(0 6)' })}
      {strokes(S + 10, u('brass'))}
      {strokes(S + 2.6, '#1a0d05')}
      {strokes(S, u('enamel'))}
      {strokes(S, u('gloss'))}
      {strokes(1.6, '#062a2e', { opacity: 0.55 })}
      {/* passing shine over the brass */}
      <g mask={u('m')}><g transform="skewX(-18)"><rect className={styles.logoShine} x="0" y="-20" width="80" height="240" fill={u('shine')} opacity=".75" /></g></g>
      {/* İ dot: a little gear */}
      <g className={styles.logoGear}>
        <path d={gearD(574, 18, 10, 13, 18)} fill={u('brass')} stroke="#1a0d05" strokeWidth="2" />
        <circle cx="574" cy="18" r="6.4" fill={u('ruby')} stroke="#1a0d05" strokeWidth="1.6" />
      </g>
      {subtitle && (
        <g>
          <path d="M150 222L170 204H470L490 222L470 240H170Z" fill={u('lapis')} stroke={u('brass')} strokeWidth="3" strokeLinejoin="round" />
          <path d="M150 222L170 204H470L490 222L470 240H170Z" fill="none" stroke="#1a0d05" strokeWidth="1" transform="translate(320 222) scale(.97 .8) translate(-320 -222)" opacity=".6" />
          <g className={styles.logoGear2}><path d={gearD(130, 222, 8, 11, 16)} fill={u('brass')} stroke="#1a0d05" strokeWidth="1.8" /><circle cx="130" cy="222" r="4.6" fill="#1a0d05" /></g>
          <g className={styles.logoGear}><path d={gearD(510, 222, 8, 11, 16)} fill={u('brass')} stroke="#1a0d05" strokeWidth="1.8" /><circle cx="510" cy="222" r="4.6" fill="#1a0d05" /></g>
          <text x="320" y="223" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-barlow), system-ui, sans-serif" fontWeight={600} fontSize={fit} letterSpacing="4"
            fill={u('brass')} stroke="#1a0d05" strokeWidth="3.4" strokeLinejoin="round" style={{ paintOrder: 'stroke fill' }}>{sub}</text>
        </g>
      )}
    </svg>
  );
});
