import { useId } from 'react';
import { useT } from '@/lib/i18n/client';
import styles from './symbols.module.css';

/* TARHUN logotype. The capitals are drawn as paths (no font dependency): chiselled slab letters with
   wedge-cut terminals inspired by clay-tablet wedges, hammered gold with bronze extrusion and white-hot
   lightning cracks. They sit on a carved storm-stone plaque with bull-horn ends and a keystone bolt sigil;
   the subtitle rides on a lapis enamel ribbon (Barlow, system fallback). */

const LETTERS: Array<{ x: number; d: string }> = [
  { x: 0, d: 'M0 0H50V21L44 15H32.5V58L37 64H13L17.5 58V15H6L0 21Z' },
  { x: 56, d: 'M17 0H37L55 64H39.5L36 51H18L14.5 64H0Z M27 14.5L21.2 38H32.8Z' },
  { x: 117, d: 'M0 0H37L48 9V28L40 35.5L51 64H35L26 39H15V58L19 64H0Z M15 13V26H31L34 23V16L31 13Z' },
  { x: 174, d: 'M0 0H17L15 6V25H35V6L33 0H50V64H33L35 58V39H15V58L17 64H0Z' },
  { x: 230, d: 'M0 0H17L15 6V47L19.5 51H30.5L35 47V6L33 0H50V54L40 64H10L0 54Z' },
  { x: 286, d: 'M0 0H15L35 36V6L33 0H50V64H36L15 28V58L17 64H0Z' },
];
const LETTER_W = 336;
const LETTER_H = 64;
const CRACKS = [
  'M4 1L14 8L10 12L19 15L16 19M14 8L22 6',
  'M80 1L71 14L79 20L72 31L77 36M71 14L64 16',
  'M117 48L128 42L124 36L138 33L135 28M128 42L132 50',
  'M199 1L193 13L201 18L194 27L199 31',
  'M265 64L258 54L266 49L259 41M266 49L273 52',
  'M296 4L306 15L301 22L314 30L311 37M306 15L313 12',
];

export function StormLogo({ size = 420, variant = 'full', className, title }: { size?: number | string; variant?: 'full' | 'compact'; className?: string; title?: string }) {
  const tc = useT('common');
  const t = useT('tarhun');
  const name = title ?? tc('games.tarhun');
  const ribbon = t('logo.subtitle');
  /* Long translations are squeezed to the ribbon instead of overflowing it. */
  const fit = ribbon.length > 14 ? { textLength: 236, lengthAdjust: 'spacingAndGlyphs' as const } : {};
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `stl${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  const full = variant === 'full';
  const VW = 520;
  const VH = full ? 228 : 176;
  const scale = 1.12;
  const lx = (VW - LETTER_W * scale) / 2;
  const ly = full ? 66 : 62;
  const letters = LETTERS.map(l => <path key={l.x} d={l.d} transform={`translate(${l.x} 0)`} />);
  const dim = typeof size === 'number' ? `${size}px` : size;
  const plaqueY = full ? 46 : 42;
  const plaqueH = 110;
  const px0 = 40;
  const px1 = VW - 40;
  const py0 = plaqueY;
  const py1 = plaqueY + plaqueH;
  const plaque = `M${px0 + 18} ${py0}H${px1 - 18}L${px1} ${py0 + 18}V${py1 - 18}L${px1 - 18} ${py1}H${px0 + 18}L${px0} ${py1 - 18}V${py0 + 18}Z`;
  const plaqueIn = `M${px0 + 22} ${py0 + 7}H${px1 - 22}L${px1 - 7} ${py0 + 22}V${py1 - 22}L${px1 - 22} ${py1 - 7}H${px0 + 22}L${px0 + 7} ${py1 - 22}V${py0 + 22}Z`;
  const hornL = `M${px0 + 8} ${py0 + 30}C${px0 - 16} ${py0 + 28} ${px0 - 30} ${py0 + 4} ${px0 - 24} ${py0 - 30}C${px0 - 18} ${py0 - 6} ${px0 - 6} ${py0 + 8} ${px0 + 14} ${py0 + 12}Z`;
  const hornR = `M${px1 - 8} ${py0 + 30}C${px1 + 16} ${py0 + 28} ${px1 + 30} ${py0 + 4} ${px1 + 24} ${py0 - 30}C${px1 + 18} ${py0 - 6} ${px1 + 6} ${py0 + 8} ${px1 - 14} ${py0 + 12}Z`;
  return (
    <svg viewBox={`-10 -14 ${VW + 20} ${VH + 14}`} width={dim} className={`${styles.logo} ${className ?? ''}`} role="img" aria-label={name} style={{ height: 'auto', overflow: 'visible' }}>
      <title>{name}</title>
      <defs>
        <radialGradient id={k('glow')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#5fd8ff" stopOpacity=".55" />
          <stop offset=".55" stopColor="#2a6dff" stopOpacity=".2" />
          <stop offset="1" stopColor="#2a6dff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={k('stone')} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor="#4a5262" />
          <stop offset=".45" stopColor="#2c323f" />
          <stop offset="1" stopColor="#161a22" />
        </linearGradient>
        <linearGradient id={k('bronze')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1c4" />
          <stop offset=".22" stopColor="#e9b75c" />
          <stop offset=".48" stopColor="#a4621c" />
          <stop offset=".62" stopColor="#f2cf86" />
          <stop offset=".82" stopColor="#8a4e14" />
          <stop offset="1" stopColor="#4a260a" />
        </linearGradient>
        <linearGradient id={k('horn')} x1="0" y1="1" x2="0.4" y2="0">
          <stop offset="0" stopColor="#6a3a0e" />
          <stop offset=".45" stopColor="#d99a3a" />
          <stop offset=".8" stopColor="#fff0b8" />
          <stop offset="1" stopColor="#c48428" />
        </linearGradient>
        <linearGradient id={k('gold')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset=".18" stopColor="#ffe48a" />
          <stop offset=".46" stopColor="#f1ae36" />
          <stop offset=".6" stopColor="#b56c14" />
          <stop offset=".74" stopColor="#e6a43a" />
          <stop offset="1" stopColor="#fff0b0" />
        </linearGradient>
        <linearGradient id={k('lapis')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f7ae6" />
          <stop offset=".5" stopColor="#1a3f9e" />
          <stop offset="1" stopColor="#0a1a52" />
        </linearGradient>
        <linearGradient id={k('top')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".75" />
          <stop offset=".22" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <pattern id={k('hammer')} width="9" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(17)">
          <ellipse cx="2.4" cy="2.2" rx="2.2" ry="1.6" fill="#fff" opacity=".16" />
          <ellipse cx="6.6" cy="6" rx="2.4" ry="1.7" fill="#7a3e06" opacity=".16" />
          <ellipse cx="7.6" cy="1.4" rx="1.2" ry=".9" fill="#7a3e06" opacity=".12" />
        </pattern>
        <clipPath id={k('clip')}>{LETTERS.map(l => <path key={l.x} d={l.d} transform={`translate(${lx} ${ly}) scale(${scale}) translate(${l.x} 0)`} />)}</clipPath>
      </defs>

      <ellipse cx={VW / 2} cy={(py0 + py1) / 2} rx={VW * 0.56} ry={plaqueH * 0.95} fill={u('glow')} className={styles.logoGlow} />
      {/* bull-horn plaque */}
      <path d={hornL} fill={u('horn')} stroke="#1e1006" strokeWidth="2" strokeLinejoin="round" />
      <path d={hornR} fill={u('horn')} stroke="#1e1006" strokeWidth="2" strokeLinejoin="round" />
      <path d={plaque} fill="#07090e" transform="translate(0 6)" opacity=".6" />
      <path d={plaque} fill={u('stone')} stroke="#0b0d12" strokeWidth="2.4" strokeLinejoin="round" />
      <path d={plaqueIn} fill="none" stroke={u('bronze')} strokeWidth="3.6" strokeLinejoin="round" />
      <path d={plaqueIn} fill="none" stroke="#1a0e04" strokeWidth="1" strokeLinejoin="round" transform="translate(0 2.2)" opacity=".6" />
      {[[px0 + 24, py0 + 14], [px1 - 24, py0 + 14], [px0 + 24, py1 - 14], [px1 - 24, py1 - 14]].map(([x, y], i) => (
        <g key={i}><circle cx={x} cy={y} r="3.6" fill={u('bronze')} stroke="#1a0e04" strokeWidth="1" /><circle cx={x - 1} cy={y - 1} r="1.1" fill="#fff" opacity=".8" /></g>
      ))}
      {Array.from({ length: 14 }, (_, i) => <path key={i} d={`M${px0 + 40 + i * 31} ${py0 + 12 + (i % 3) * 3}l7 2`} stroke="#9aa6bc" strokeWidth="1" opacity=".18" />)}
      <path d={`M${px0 + 26} ${py0 + 9}H${px1 - 26}`} stroke="#c0cadb" strokeWidth="1.2" opacity=".35" />

      {/* letters: extrusion, outline, hammered gold, top light, cracks */}
      <g transform={`translate(${lx} ${ly + 6}) scale(${scale})`} fill="#2a1404">{letters}</g>
      <g transform={`translate(${lx} ${ly + 3}) scale(${scale})`} fill="#7a420e">{letters}</g>
      <g transform={`translate(${lx} ${ly}) scale(${scale})`} fill={u('gold')} stroke="#2a1404" strokeWidth="2.2" strokeLinejoin="round" style={{ paintOrder: 'stroke fill' }}>{letters}</g>
      <g clipPath={u('clip')}>
        <rect x={lx} y={ly} width={LETTER_W * scale} height={LETTER_H * scale} fill={u('hammer')} />
        <rect x={lx} y={ly} width={LETTER_W * scale} height={LETTER_H * scale} fill={u('top')} />
        <g transform={`translate(${lx} ${ly}) scale(${scale})`} fill="none" strokeWidth="2.4" strokeLinejoin="round">
          <g stroke="#fffbe6" opacity=".85" transform="translate(-1.1 -1.1)">{letters}</g>
          <g stroke="#6a3604" opacity=".75" transform="translate(1.1 1.3)">{letters}</g>
        </g>
        <g transform={`translate(${lx} ${ly}) scale(${scale})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {CRACKS.map((d, i) => <path key={i} d={d} stroke="#123a80" strokeWidth="4.4" opacity=".7" />)}
          {CRACKS.map((d, i) => <path key={`c${i}`} d={d} stroke="#6fe3ff" strokeWidth="2.4" />)}
          {CRACKS.map((d, i) => <path key={`w${i}`} d={d} stroke="#fff" strokeWidth="1" />)}
        </g>
      </g>
      {/* sparks escaping the letters */}
      <g transform={`translate(${lx} ${ly}) scale(${scale})`} fill="none" strokeLinecap="round" strokeLinejoin="round" className={styles.logoSparks}>
        {['M-4 -3L-12 -10L-8 -14L-16 -22', 'M342 60L350 66L346 70L356 76', 'M196 -2L200 -12L195 -15L201 -24'].map((d, i) => (
          <g key={i}><path d={d} stroke="#3aa6ff" strokeWidth="4" opacity=".35" /><path d={d} stroke="#bff6ff" strokeWidth="1.6" /></g>
        ))}
      </g>

      {/* keystone bolt sigil */}
      <g transform={`translate(${VW / 2 - 15} ${py0 - 24})`}>
        <path d="M2 0H28L24 30H6Z" fill={u('stone')} stroke={u('bronze')} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M17 3L9 17H14.5L10.5 28L21 13.5H15.5L20 3Z" fill="#bff6ff" stroke="#0a2a52" strokeWidth="1" strokeLinejoin="round" />
      </g>

      {full && (
        <g>
          <path d={`M126 ${py1 - 10}H394L414 ${py1 + 13}L394 ${py1 + 36}H126L106 ${py1 + 13}Z`} fill="#07090e" opacity=".55" transform="translate(0 4)" />
          <path d={`M126 ${py1 - 10}H394L414 ${py1 + 13}L394 ${py1 + 36}H126L106 ${py1 + 13}Z`} fill={u('lapis')} stroke={u('bronze')} strokeWidth="3.4" strokeLinejoin="round" />
          <path d={`M130 ${py1 - 5}H390`} stroke="#9cc0ff" strokeWidth="1.2" opacity=".5" />
          {[[116, py1 + 13], [404, py1 + 13]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={u('bronze')} stroke="#1a0e04" strokeWidth=".8" />)}
          <text x={VW / 2} y={py1 + 14} textAnchor="middle" dominantBaseline="central" fontSize="19.5" fontWeight={600} letterSpacing="5.4"
            fontFamily="var(--font-barlow), 'Arial Narrow', system-ui, sans-serif" fill="#06123e" transform="translate(0 1.4)" {...fit}>{ribbon}</text>
          <text x={VW / 2} y={py1 + 14} textAnchor="middle" dominantBaseline="central" fontSize="19.5" fontWeight={600} letterSpacing="5.4"
            fontFamily="var(--font-barlow), 'Arial Narrow', system-ui, sans-serif" fill="#ffe7a0" {...fit}>{ribbon}</text>
        </g>
      )}
    </svg>
  );
}
