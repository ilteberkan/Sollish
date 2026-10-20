import { memo, useId } from 'react';
import { useT } from '@/lib/i18n/client';
import { marblePattern } from './water';
import styles from './art.module.css';

/* "EBRU — Mürekkep Bahçesi" logotype. Original letterforms drawn as broad pen strokes with round ink-drop
   terminals; the letters are filled with a real marbled sheet (computed with the same marbling maths as the
   water, deterministic, SSR-stable) that slowly drifts inside them (CSS transform on the masked group), framed
   by a gold-leaf edge with a passing shine. Reduced motion: the pattern holds still. */

const LETTERS = [
  // E
  'M38 46V154', 'M38 46H102', 'M38 100H88', 'M38 154H104',
  // B
  'M148 46V154', 'M148 46H186Q214 46 214 73Q214 100 186 100H148', 'M148 100H192Q222 100 222 127Q222 154 192 154H148',
  // R
  'M262 46V154', 'M262 46H300Q330 46 330 73Q330 100 300 100H262', 'M294 100Q318 108 324 130Q329 150 346 156',
  // U
  'M376 46V114Q376 156 414 156Q452 156 452 114V46',
];
const STROKE = 25;
const MARBLE_A = marblePattern({ seed: 77, width: 640, height: 220, style: 'tarakli', drops: 30, colors: ['#e0283c', '#f2bf3c', '#22c9c0', '#fff3dc', '#3d6cf0', '#ee79ad', '#f7901e', '#fff3dc'] });
const MARBLE_B = marblePattern({ seed: 5, width: 640, height: 220, style: 'gelgit', drops: 14, colors: ['#fff6e2', '#ffd768', '#38f0e0'] });

export const EbruLogo = memo(function EbruLogo({ className, subtitle = true }: { className?: string; subtitle?: boolean }) {
  const t = useT('ebru');
  const tc = useT('common');
  const ribbon = subtitle ? t('logo.subtitle') : '';
  /* Long translations are squeezed to the ribbon instead of overflowing it. */
  const fit = ribbon.length > 17 ? { textLength: 300, lengthAdjust: 'spacingAndGlyphs' as const } : {};
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `ebl${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  const strokes = (w: number, color: string, extra?: Record<string, string | number>) => (
    <g fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" {...extra}>
      {LETTERS.map((d, i) => <path key={i} d={d} />)}
    </g>
  );
  const h = subtitle ? 252 : 200;
  return (
    <svg className={`${styles.logo} ${className ?? ''}`} viewBox={`0 0 490 ${h}`} role="img" aria-label={tc('games.ebru')} focusable="false">
      <defs>
        <linearGradient id={k('gold')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffbe2" /><stop offset=".3" stopColor="#ffd968" /><stop offset=".62" stopColor="#d8961e" /><stop offset="1" stopColor="#7a4406" /></linearGradient>
        <linearGradient id={k('gloss')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".45" stopColor="#fff" stopOpacity=".05" /><stop offset="1" stopColor="#000" stopOpacity=".25" /></linearGradient>
        <linearGradient id={k('shine')} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <mask id={k('m')} maskUnits="userSpaceOnUse" x="0" y="0" width="490" height="200">
          {strokes(STROKE, '#fff')}
        </mask>
        <mask id={k('mo')} maskUnits="userSpaceOnUse" x="0" y="0" width="490" height="200">
          {strokes(STROKE + 9, '#fff')}
        </mask>
      </defs>
      {/* drop shadow + gold-leaf edge */}
      {strokes(STROKE + 14, '#06030e', { opacity: 0.55, transform: 'translate(0 5)' })}
      {strokes(STROKE + 9, u('gold'))}
      {strokes(STROKE + 2.4, '#2a1204')}
      {/* marbled fill */}
      <g mask={u('m')}>
        <rect x="0" y="0" width="490" height="200" fill="#16133e" />
        <g className={styles.logoDrift}>
          <g transform="translate(-75 -10)">{MARBLE_A.map((p, i) => <path key={i} d={p.d} fill={p.fill} />)}</g>
        </g>
        <g className={styles.logoDrift2} opacity=".55">
          <g transform="translate(-75 -10)">{MARBLE_B.map((p, i) => <path key={i} d={p.d} fill="none" stroke={p.fill} strokeWidth="1.6" />)}</g>
        </g>
        <rect x="0" y="0" width="490" height="200" fill={u('gloss')} />
      </g>
      {/* passing shine over the gold edge */}
      <g mask={u('mo')}>
        <g transform="skewX(-18)"><rect className={styles.logoShine} x="0" y="-20" width="70" height="240" fill={u('shine')} opacity=".8" /></g>
      </g>
      {/* a falling ink drop from the U */}
      <path d="M452 168C455 174 459 178 459 183C459 188 455.5 191 452 191C448.5 191 445 188 445 183C445 178 449 174 452 168Z" fill={u('gold')} stroke="#2a1204" strokeWidth="1.6" />
      <path d="M449 180Q449.5 177 451.5 175.5" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity=".85" />
      {subtitle && (
        <g>
          <path d="M18 227H66M424 227H472" stroke={u('gold')} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="14" cy="227" r="2.6" fill={u('gold')} /><circle cx="476" cy="227" r="2.6" fill={u('gold')} />
          <path d="M70 227Q77 216 82 227Q77 238 70 227ZM420 227Q413 216 408 227Q413 238 420 227Z" fill="#e0283c" stroke="#5a2a04" strokeWidth=".8" />
          <text x="245" y="227" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-barlow), system-ui, sans-serif" fontWeight={600} fontSize="25" letterSpacing="3.2"
            fill={u('gold')} stroke="#1a0a02" strokeWidth="3.2" strokeLinejoin="round" style={{ paintOrder: 'stroke fill' }} {...fit}>{ribbon}</text>
        </g>
      )}
    </svg>
  );
});
