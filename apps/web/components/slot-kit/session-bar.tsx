'use client';
import { useDuration } from './use-duration';
import { useFormat, useT } from '@/lib/i18n/client';
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
  const t = useT('slotKit');
  const format = useFormat();
  const duration = useDuration();
  const tone = netCents > 0 ? styles.pos : netCents < 0 ? styles.neg : undefined;
  return (
    <div className={cx(styles.kit, styles.sessionBar, className)} role="group" aria-label={t('session.aria')}>
      <span className={styles.sbItem}><ClockIcon width={15} height={15} /><span className={styles.sbLabel}>{t('session.clock')}</span><strong suppressHydrationWarning>{nowMs === null ? '--:--' : format.clock(nowMs)}</strong></span>
      <span className={styles.sbItem}><span className={styles.sbLabel}>{t('session.session')}</span><strong>{nowMs === null ? '--' : duration(elapsedMs)}</strong></span>
      <span className={styles.sbItem}><span className={styles.sbLabel}>{t('session.net')}</span><strong className={tone}>{format.signedDemo(netCents)}</strong></span>
    </div>
  );
}
