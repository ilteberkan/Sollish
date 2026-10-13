'use client';

import { memo, useEffect, useId, useRef } from 'react';
import { CZ_PALETTE as P } from './symbols';
import styles from './art.module.css';

/* Fil Saati reservoir: the free-spin meter. A glass cistern in a brass cage (in the elephant clock the water
   vessel drives the automata); the water rises one level after every free spin and the falcon comes when it is
   full. Water is an HTML layer scaled on the compositor (scaleY with a slosh overshoot) with a looping wave
   strip on top; the cage is static SVG. `level` 0..levels; when it returns to 0 from full the water drains.
   Reduced motion: the level jumps. */

export interface CezeriReservoirProps { level: number; levels?: number; className?: string; label?: string }

const r2 = (n: number) => Math.round(n * 100) / 100;

const Cage = memo(function Cage({ levels }: { levels: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `czr${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  // glass spans y 48..130 inside a 100 × 150 box
  const marks = Array.from({ length: levels - 1 }, (_, i) => r2(130 - ((i + 1) / levels) * 78));
  return (
    <svg viewBox="0 0 100 150" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={k('brass')} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={P.brass.dark} /><stop offset=".3" stopColor={P.brass.light} /><stop offset=".5" stopColor={P.brass.hi} /><stop offset=".75" stopColor={P.brass.base} /><stop offset="1" stopColor={P.brass.dark} /></linearGradient>
        <linearGradient id={k('glass')} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity=".18" /><stop offset=".22" stopColor="#fff" stopOpacity=".05" /><stop offset=".7" stopColor="#fff" stopOpacity="0" /><stop offset=".86" stopColor="#fff" stopOpacity=".22" /><stop offset="1" stopColor="#fff" stopOpacity=".05" /></linearGradient>
        <linearGradient id={k('dome')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={P.turq.hi} /><stop offset=".4" stopColor={P.turq.light} /><stop offset="1" stopColor={P.turq.deep} /></linearGradient>
      </defs>
      {/* dome cap with finial */}
      <path d="M22 44C22 30 34 22 50 16C66 22 78 30 78 44Z" fill={u('dome')} stroke="#1a0d05" strokeWidth="2" />
      <path d="M32 40C32 32 38 27 46 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".6" />
      <path d="M50 16V8" stroke="#1a0d05" strokeWidth="2" /><circle cx="50" cy="7" r="3.4" fill={u('brass')} stroke="#1a0d05" strokeWidth="1.2" />
      <rect x="16" y="42" width="68" height="8" rx="2" fill={u('brass')} stroke="#1a0d05" strokeWidth="1.6" />
      {/* glass front (water layer is behind this svg's glass highlights) */}
      <path d="M20 50V122Q20 134 50 134Q80 134 80 122V50" fill={u('glass')} stroke="#1a0d05" strokeWidth="2" />
      {marks.map((y) => <g key={y}><path d={`M20 ${y}H30M70 ${y}H80`} stroke={P.brass.light} strokeWidth="2" /><circle cx="50" cy={y} r="1.6" fill={P.brass.light} opacity=".7" /></g>)}
      {/* cage bars */}
      <path d="M20 50V122M80 50V122" stroke={u('brass')} strokeWidth="4" />
      <path d="M50 134V140" stroke="#1a0d05" strokeWidth="2" />
      <path d="M26 138H74L80 146H20Z" fill={u('brass')} stroke="#1a0d05" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
});

export function CezeriReservoir({ level, levels = 3, className, label = 'FİL SAATİ' }: CezeriReservoirProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const prev = useRef(level);
  useEffect(() => {
    const el = fillRef.current, wave = waveRef.current;
    if (!el || !wave) return;
    const to = Math.max(0, Math.min(1, level / levels));
    const from = Math.max(0, Math.min(1, prev.current / levels));
    prev.current = level;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tf = (v: number) => `scaleY(${Math.max(0.001, v)})`;
    el.style.transform = tf(to);
    wave.style.translate = `0 calc(${(1 - to) * 100}% * 6.25 - 50%)`;
    if (reduced || from === to) return;
    const rising = to > from;
    el.animate(rising
      ? [{ transform: tf(from) }, { transform: tf(to + 0.06), offset: 0.55 }, { transform: tf(to - 0.02), offset: 0.8 }, { transform: tf(to) }]
      : [{ transform: tf(from) }, { transform: tf(to) }], { duration: rising ? 900 : 700, easing: rising ? 'cubic-bezier(.3,.7,.4,1)' : 'ease-in' });
  }, [level, levels]);
  const pct = Math.round((Math.max(0, Math.min(levels, level)) / levels) * 100);
  return (
    <div className={`${styles.reservoir} ${className ?? ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={levels} aria-valuenow={level} aria-valuetext={`${level}/${levels}`} data-full={level >= levels ? '' : undefined} style={{ containerType: 'inline-size' }}>
      <div className={styles.resWater}>
        <div ref={fillRef} className={styles.resFill} style={{ transform: `scaleY(${Math.max(0.001, pct / 100)})` }} />
        <div ref={waveRef} className={styles.resWave} style={{ top: 0, translate: `0 calc(${100 - pct}% * 6.25 - 50%)` }}>
          <svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d="M0 10Q12.5 2 25 10T50 10T75 10T100 10T125 10T150 10T175 10T200 10V20H0Z" fill="#b8fff4" opacity=".9" />
          </svg>
        </div>
      </div>
      <Cage levels={levels} />
      <div className={styles.resLabel}>{label}</div>
    </div>
  );
}
