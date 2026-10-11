'use client';
import { formatClock, formatDuration } from '@/lib/slot-kit/session';
import { formatSignedDemo } from '@/lib/slot-kit/bet';
import { ClockIcon } from './icons';
import { cx } from './cx';
import styles from './kit.module.css';

export interface SessionBarProps {
  /** Current time in ms; null until the client has mounted (renders placeholders). */
  nowMs: number | null;
  elapsedMs: number;
  netCents: number;
  className?: string;
}

/** Thin strip: wall clock (HH:MM), session length and net result. Not a live region (no chatter). */
export function SessionBar({ nowMs, elapsedMs, netCents, className }: SessionBarProps) {
  const tone = netCents > 0 ? styles.pos : netCents < 0 ? styles.neg : undefined;
  return (
    <div className={cx(styles.kit, styles.sessionBar, className)} role="group" aria-label="Oturum bilgisi">
      <span className={styles.sbItem}><ClockIcon width={15} height={15} /><span className={styles.sbLabel}>Saat</span><strong suppressHydrationWarning>{nowMs === null ? '--:--' : formatClock(nowMs)}</strong></span>
      <span className={styles.sbItem}><span className={styles.sbLabel}>Oturum</span><strong>{nowMs === null ? '--' : formatDuration(elapsedMs)}</strong></span>
      <span className={styles.sbItem}><span className={styles.sbLabel}>Net</span><strong className={tone}>{formatSignedDemo(netCents)}</strong></span>
    </div>
  );
}
