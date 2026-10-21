'use client';

import { memo } from 'react';
import { GoremeSymbol } from './symbols';
import styles from './sky-band.module.css';

/* Gök kuşağı: the strip above the reel window where balloons that leave the top row moor during Şafak Şöleni. A rope
   strung between two tuff posts; moored balloons float above it on short tethers, filling outward from the centre
   (alternating right / left) and squeezing together as more arrive; a tuff medallion in the middle shows the sky
   multiplier, "GÖK ×N", which bumps every time the value changes. Inactive (base game): the band dims and the empty
   mooring pegs show where balloons will go. Each balloon animates in once when it mounts (give it a stable `id`).

   <GoremeSkyBand balloons={[{ id, multiplier }]} multiplier={7} active />
   Only transform / opacity animate. */

export interface GoremeMooredBalloon { id: string | number; multiplier: number; size?: number }
export interface GoremeSkyBandProps {
  balloons: readonly GoremeMooredBalloon[];
  /** The sky multiplier shown in the medallion (×1 before the first mooring). */
  multiplier: number;
  /** Feature running (bright) or not (dimmed, pegs visible). Default true. */
  active?: boolean;
  /** Empty pegs drawn per side when there are fewer balloons. Default 4. */
  pegs?: number;
  className?: string;
  /** Label for the medallion (default "GÖK"). */
  label?: string;
}

export const GoremeSkyBand = memo(function GoremeSkyBand({ balloons, multiplier, active = true, pegs = 4, className, label = 'GÖK' }: GoremeSkyBandProps) {
  const right: GoremeMooredBalloon[] = [], left: GoremeMooredBalloon[] = [];
  balloons.forEach((b, i) => (i % 2 === 0 ? right : left).push(b));
  const per = Math.max(right.length, left.length);
  const dense = per > 4;
  const lane = (list: GoremeMooredBalloon[], side: 'l' | 'r') => (
    <div className={styles.lane} data-side={side} data-dense={dense || undefined}>
      {list.map((b) => (
        <div key={b.id} className={styles.moored} style={{ ['--bs' as string]: String(b.size ?? 1) }}>
          <span className={styles.tether} aria-hidden="true" />
          <div className={styles.balloon}><GoremeSymbol symbol="balloon" multiplier={b.multiplier} size={b.size ?? 1} label={null} /></div>
        </div>
      ))}
      {Array.from({ length: Math.max(0, pegs - list.length) }, (_, i) => <div key={`p${i}`} className={styles.peg} aria-hidden="true"><span /></div>)}
    </div>
  );
  return (
    <div className={`${styles.band} ${className ?? ''}`} data-active={active || undefined} role="group" aria-label={`${label} ×${multiplier}, ${balloons.length}`}>
      <div className={styles.glass} aria-hidden="true" />
      <div className={styles.rope} aria-hidden="true" />
      <div className={`${styles.post} ${styles.postL}`} aria-hidden="true" />
      <div className={`${styles.post} ${styles.postR}`} aria-hidden="true" />
      {lane(left, 'l')}
      <div className={styles.medal}>
        <span className={styles.medalLabel}>{label}</span>
        <span key={multiplier} className={styles.medalValue} aria-live="polite"><small>×</small>{multiplier}</span>
      </div>
      {lane(right, 'r')}
    </div>
  );
});
