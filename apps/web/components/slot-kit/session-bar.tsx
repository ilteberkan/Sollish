'use client';
import { useId, useMemo, useState } from 'react';
import { useDuration } from './use-duration';
import type { SessionStats } from '@/lib/slot-kit/session';
import { useFormat, useT } from '@/lib/i18n/client';
import { ClockIcon } from './icons';
import { cx } from './cx';
import styles from './kit.module.css';

export interface SessionBarProps {
  /** Current time in ms; null until the client has mounted (renders placeholders). */
  nowMs: number | null;
  elapsedMs: number;
  netCents: number;
  /** When given, a small "Oturum istatistiği" toggle shows rounds, stakes, wins, session RTP and the stated RTP of the modes played. */
  stats?: SessionStats;
  className?: string;
}

/** Thin strip: wall clock (HH:MM), session length and net result. Not a live region (no chatter). */
export function SessionBar({ nowMs, elapsedMs, netCents, stats, className }: SessionBarProps) {
  const t = useT('slotKit');
  const format = useFormat();
  const duration = useDuration();
  const tone = netCents > 0 ? styles.pos : netCents < 0 ? styles.neg : undefined;
  return (
    <div className={cx(styles.kit, styles.sessionBar, className)} role="group" aria-label={t('session.aria')}>
      <span className={styles.sbItem}><ClockIcon width={15} height={15} /><span className={styles.sbLabel}>{t('session.clock')}</span><strong suppressHydrationWarning>{nowMs === null ? '--:--' : format.clock(nowMs)}</strong></span>
      <span className={styles.sbItem}><span className={styles.sbLabel}>{t('session.session')}</span><strong>{nowMs === null ? '--' : duration(elapsedMs)}</strong></span>
      <span className={styles.sbItem}><span className={styles.sbLabel}>{t('session.net')}</span><strong className={tone}>{format.signedDemo(netCents)}</strong></span>
      {stats ? <SessionStatsToggle stats={stats} /> : null}
    </div>
  );
}

/** "Oturum istatistiği": collapsed by default; a disclosure button, not a live region. */
function SessionStatsToggle({ stats }: { stats: SessionStats }) {
  const t = useT('slotKit');
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const pct = useMemo(() => new Intl.NumberFormat(format.intl, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }), [format.intl]);
  const rtp = (value: number | null) => (value === null || !Number.isFinite(value) ? '—' : pct.format(value));
  return (
    <>
      <button type="button" className={styles.sbStatsToggle} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}>
        {t('session.stats.toggle')}
      </button>
      {open ? (
        <dl id={panelId} className={styles.sbStats} aria-label={t('session.stats.title')}>
          <div><dt>{t('session.stats.rounds')}</dt><dd>{format.number(stats.rounds, 0)}</dd></div>
          <div><dt>{t('session.stats.spent')}</dt><dd>{format.demo(stats.spentCents)}</dd></div>
          <div><dt>{t('session.stats.won')}</dt><dd>{format.demo(stats.wonCents)}</dd></div>
          <div><dt>{t('session.stats.sessionRtp')}</dt><dd>{rtp(stats.sessionRtp)}</dd></div>
          <div><dt>{t('session.stats.expectedRtp')}</dt><dd>{rtp(stats.expectedRtp)}{stats.expectedRtp !== null && !stats.expectedCoversAll ? ` (${t('session.stats.partial')})` : ''}</dd></div>
          <p className={styles.sbStatsNote}>{t('session.stats.note')}</p>
        </dl>
      ) : null}
    </>
  );
}
