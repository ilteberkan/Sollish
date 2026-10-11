'use client';
/**
 * Ringside broadcast (client component). The 'broadcast' camera is the classic 2D fighting-game view in lib/ringside-2d:
 * frame sprites from a fixed side camera, a snapping pose state machine driven by the engine frames, hit-stop, impact
 * flashes, knockdown replays, round highlights and arena sound. The 'overhead' camera is the tactical map from
 * lib/ringside-25d/scene.ts. There is no orbit camera: input is a tap to select a fighter while bets are open
 * (`resetViewKey` and `onManualView` are kept as no-ops for compatibility). Presentation only: camera, FPS, reduced
 * motion, sound and hidden tabs never touch a result or payout.
 */
import { useEffect, useRef } from 'react';
import { mountBroadcast2D } from '@/lib/ringside-2d/scene';
import type { BroadcastProps } from '@/lib/ringside-25d/scene';

export type { BroadcastProps };

export default function RingsideBroadcast(props: BroadcastProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const mode = props.camera === 'overhead' ? 'overhead' : 'side';
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let stop = () => {}, dead = false;
    if (mode === 'side') stop = mountBroadcast2D(host, () => latest.current);
    else void import('@/lib/ringside-25d/scene').then(m => { if (!dead) stop = m.mountBroadcast(host, () => latest.current); });
    return () => { dead = true; stop(); };
  }, [mode]);
  return <div ref={hostRef} data-boxing-scene="broadcast" data-phase={props.phase} data-camera={mode === 'overhead' ? 'overhead' : 'broadcast'} aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0b0d10' }}/>;
}
