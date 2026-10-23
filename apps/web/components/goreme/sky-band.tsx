'use client';

import { memo, useEffect, useRef } from 'react';
import { GoremeSymbol } from './symbols';
import styles from './sky-band.module.css';

/* Gök kuşağı: the strip above the reel window where balloons that leave the top row moor during Şafak Şöleni. A rope
   strung between two tuff posts; moored balloons float above it on short tethers, filling outward from the centre
   (alternating right / left) and squeezing together as more arrive; a tuff medallion in the middle shows the sky
   multiplier, "GÖK ×N", which bumps every time the value changes (with a "+N" chip for the added value). Inactive (base
   game): the band dims and the empty mooring pegs show where balloons will go. `incoming` balloons hold their slot
   invisibly (the board flies the real balloon there: `goremeBandSlot` measures the slot), so when they join `balloons`
   they appear exactly where the flight ended and only settle on the tether. Every slot carries `data-moor-id`.

   <GoremeSkyBand balloons={[{ id, multiplier }]} multiplier={7} active />
   Only transform / opacity animate. */

export interface GoremeMooredBalloon { id: string | number; multiplier: number; size?: number }
export interface GoremeSkyBandProps {
  balloons: readonly GoremeMooredBalloon[];
  /** The sky multiplier shown in the medallion (×1 before the first mooring). */
  multiplier: number;
  /** Feature running (bright) or not (dimmed, pegs visible). Default true. */
  active?: boolean;
  /** Empty pegs drawn per side when there are fewer balloons. Default 3. */
  pegs?: number;
  className?: string;
  /** Label for the medallion (default "GÖK"). */
  label?: string;
  /** Balloons on their way up: their slots are reserved (invisible) so the board can fly them in. */
  incoming?: readonly GoremeMooredBalloon[];
}

/** The slot of a moored or incoming balloon inside a band element, or null. */
export function goremeBandSlot(band: Element, id: string | number): Element | null {
  return band.querySelector(`[data-moor-id="${String(id)}"] [data-slot]`);
}

export const GoremeSkyBand = memo(function GoremeSkyBand({ balloons, multiplier, active = true, pegs = 3, className, label = 'GÖK', incoming }: GoremeSkyBandProps) {
  const right: GoremeMooredBalloon[] = [], left: GoremeMooredBalloon[] = [];
  const shown = new Set(balloons.map(b => String(b.id)));
  const waiting = new Set<string>();
  const all = [...balloons];
  for (const b of incoming ?? []) if (!shown.has(String(b.id))) { all.push(b); waiting.add(String(b.id)); }
  all.forEach((b, i) => (i % 2 === 0 ? right : left).push(b));
  const prev = useRef(multiplier);
  const added = multiplier - prev.current;
  useEffect(() => { prev.current = multiplier; }, [multiplier]);
  const per = Math.max(right.length, left.length);
  const dense = per > 3;
  const lane = (list: GoremeMooredBalloon[], side: 'l' | 'r') => (
    <div className={styles.lane} data-side={side} data-dense={dense || undefined}>
      {list.map((b) => (
        <div key={b.id} className={styles.moored} data-moor-id={b.id} data-incoming={waiting.has(String(b.id)) || undefined} style={{ ['--bs' as string]: String(b.size ?? 1) }}>
          <span className={styles.tether} aria-hidden="true" />
          <div className={styles.balloon} data-slot=""><GoremeSymbol sprite symbol="balloon" multiplier={b.multiplier} size={b.size ?? 1} label={null} /></div>
        </div>
      ))}
      {Array.from({ length: Math.max(0, pegs - list.length) }, (_, i) => <div key={`p${i}`} className={styles.peg} aria-hidden="true"><span /></div>)}
    </div>
  );
  return (
    <div className={`${styles.band} ${className ?? ''}`} data-active={active || undefined} role="group" aria-label={`${label} ×${multiplier}, ${balloons.length}`} data-count={balloons.length}>
      <div className={styles.glass} aria-hidden="true" />
      <div className={styles.rope} aria-hidden="true" />
      <div className={`${styles.post} ${styles.postL}`} aria-hidden="true" />
      <div className={`${styles.post} ${styles.postR}`} aria-hidden="true" />
      {lane(left, 'l')}
      <div className={styles.medal}>
        <span className={styles.medalLabel}>{label}</span>
        <span key={multiplier} className={styles.medalValue} aria-live="polite"><small>×</small>{multiplier}</span>
        {active && added > 0 && <span key={`p${multiplier}`} className={styles.medalPlus} aria-hidden="true" data-testid="goreme-sky-plus">+{added}</span>}
      </div>
      {lane(right, 'r')}
    </div>
  );
});
