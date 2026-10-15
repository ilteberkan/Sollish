'use client';

import { memo, useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { ASENA_MAP_MULTIPLIERS, ASENA_TEMPLATES } from '@sollish/protocol';
import { ASENA_TEMPLATE_INFO, asenaTemplateGlyph } from './geometry';
import { asSparkle } from './symbols';
import styles from './art.module.css';

/* Ergenekon map / constellation tracker. Six tiles (engine template order) each show the constellation's star
   glyph, its name and template multiplier, and two pips: dark (not lit), lit once (cyan stars) and lit twice (gold).
   Beside them the iron mountain emblem cracks per level and the global multiplier medallion steps ×1 → ×2 (3 distinct)
   → ×3 (all 6) → ×5 (all 6 twice). Props-driven (pieces = AsenaMapEvent.pieces / AsenaSpin.mapAfter, multiplier =
   globalMultiplierAfter); a tile that gains a piece and a medallion that steps play a flash (opacity / transform).
   `orientation`: 'column' (desktop side panel) or 'row' (phone strip above the board, names hidden). */

export interface AsenaSkyMapHandle {
  /** Tile element of template index i (FX star flights land here). */
  tile(i: number): HTMLElement | null;
  /** The multiplier medallion. */
  medallion(): HTMLElement | null;
  /** The iron mountain emblem. */
  emblem(): HTMLElement | null;
}
export interface AsenaSkyMapProps {
  pieces?: readonly number[];
  multiplier?: number;
  orientation?: 'column' | 'row';
  className?: string;
  ref?: Ref<AsenaSkyMapHandle>;
  /** Show the map even in the base game (dimmed, "Ergenekon bedava dönüşlerde açılır"). */
  inactive?: boolean;
}

const levelOf = (m: number) => (m >= ASENA_MAP_MULTIPLIERS.twice ? 3 : m >= ASENA_MAP_MULTIPLIERS[6] ? 2 : m >= ASENA_MAP_MULTIPLIERS[3] ? 1 : 0);

const Glyph = memo(function Glyph({ index }: { index: number }) {
  const t = ASENA_TEMPLATES[index]!;
  const g = asenaTemplateGlyph(t.id);
  const span = Math.max(g.width, g.height), cell = 56 / span;
  const ox = 32 - (g.width * cell) / 2, oy = 32 - (g.height * cell) / 2;
  const at = ([x, y]: readonly [number, number]) => [ox + (x + 0.5) * cell, oy + (y + 0.5) * cell] as const;
  const lines = g.edges.map(([a, b]) => { const p = at(g.cells[a]!), q = at(g.cells[b]!); return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }).join('');
  return (
    <svg className={styles.glyph} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className={styles.glyphLine} d={lines} fill="none" strokeLinecap="round" />
      {g.cells.map((c, i) => { const [x, y] = at(c); return <path key={i} className={styles.glyphStar} d={asSparkle(x, y, i === g.edges[0]![0] ? 6.4 : 4.6, 0.22)} />; })}
    </svg>
  );
});

const Emblem = memo(function Emblem() {
  return (
    <svg viewBox="0 0 80 60" aria-hidden="true" focusable="false">
      <path d="M2 58L18 34L26 38L38 10L48 30L58 24L78 58Z" fill="#20243a" stroke="#8a94c0" strokeWidth="1.4" />
      <path d="M38 10L34 58H30L26 38L18 34L2 58Z" fill="#3a4060" />
      <path className={styles.emC1} d="M38 14L35 28L39 38L35 50" fill="none" stroke="#ffb84a" strokeWidth="2.4" strokeLinecap="round" />
      <path className={styles.emC2} d="M26 40L28 50M48 32L46 44L50 52" fill="none" stroke="#ffb84a" strokeWidth="2" strokeLinecap="round" />
      <path className={styles.emC3} d="M38 16L35 32L39 40L36 58H42L44 40L40 32Z" fill="#ffe7a0" />
    </svg>
  );
});

export function AsenaSkyMap({ pieces = [0, 0, 0, 0, 0, 0], multiplier = 1, orientation = 'column', className, ref, inactive }: AsenaSkyMapProps) {
  const tiles = useRef<Array<HTMLDivElement | null>>([]);
  const medal = useRef<HTMLDivElement>(null);
  const emblem = useRef<HTMLDivElement>(null);
  const prev = useRef<readonly number[]>(pieces);
  const prevMult = useRef(multiplier);
  useImperativeHandle(ref, () => ({ tile: (i) => tiles.current[i] ?? null, medallion: () => medal.current, emblem: () => emblem.current }), []);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pieces.forEach((n, i) => {
      if (n > (prev.current[i] ?? 0) && !reduced) tiles.current[i]?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: 620, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    });
    if (multiplier > prevMult.current && !reduced) medal.current?.animate([{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(1.45) rotate(-8deg)', offset: 0.3 }, { transform: 'scale(.95) rotate(3deg)', offset: 0.65 }, { transform: 'scale(1) rotate(0)' }], { duration: 900, easing: 'ease-out' });
    prev.current = pieces.slice();
    prevMult.current = multiplier;
  }, [pieces, multiplier]);

  const distinct = pieces.filter((n) => n > 0).length;
  const twice = pieces.every((n) => n >= 2);
  const level = levelOf(multiplier);
  const steps = [
    { need: '3', m: ASENA_MAP_MULTIPLIERS[3], on: distinct >= 3 },
    { need: '6', m: ASENA_MAP_MULTIPLIERS[6], on: distinct >= 6 },
    { need: '6×2', m: ASENA_MAP_MULTIPLIERS.twice, on: twice },
  ];
  return (
    <section className={`${styles.map} ${className ?? ''}`} data-orient={orientation} data-level={level} data-inactive={inactive || undefined} aria-label={`Ergenekon haritası: ${distinct} takımyıldız yandı, genel çarpan ×${multiplier}`}>
      <header className={styles.mapHead}>
        <div ref={emblem} className={styles.emblem}><Emblem /></div>
        <div className={styles.mapTitle}><span>ERGENEKON</span><small>{inactive ? 'bedava dönüşlerde açılır' : `${distinct}/6 takımyıldız`}</small></div>
        <div ref={medal} className={styles.medal} aria-live="polite"><span>×{multiplier}</span></div>
      </header>
      <div className={styles.tiles}>
        {ASENA_TEMPLATES.map((t, i) => {
          const n = Math.min(2, pieces[i] ?? 0);
          return (
            <div key={t.id} ref={(el) => { tiles.current[i] = el; }} className={styles.tile} data-n={n} title={`${t.name} ×${t.multiplier}`}>
              <Glyph index={i} />
              <div className={styles.tileText}><b>{ASENA_TEMPLATE_INFO[t.id].name}</b><span>×{t.multiplier}</span></div>
              <div className={styles.pips} aria-label={`${n} kez yandı`}><i data-on={n >= 1 || undefined} /><i data-on={n >= 2 || undefined} /></div>
            </div>
          );
        })}
      </div>
      <ol className={styles.steps}>
        {steps.map((s) => <li key={s.need} data-on={s.on || undefined}><span>{s.need}</span><b>×{s.m}</b></li>)}
      </ol>
    </section>
  );
}
