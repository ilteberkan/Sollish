'use client';
import { useId } from 'react';
import { useDuration } from './use-duration';
import { useFormat, useT } from '@/lib/i18n/client';
import { Modal } from './modal';
import { ClockIcon } from './icons';
import { cx } from './cx';
import styles from './kit.module.css';

export interface RealityCheckDialogProps {
  open: boolean;
  elapsedMs: number;
  netCents: number;
  onContinue: () => void;
  onQuit: () => void;
}

/** Periodic responsible-play reminder. Cannot be dismissed by Esc or a backdrop click: the player picks. */
export function RealityCheckDialog({ open, elapsedMs, netCents, onContinue, onQuit }: RealityCheckDialogProps) {
  const descId = useId();
  const t = useT('slotKit');
  const format = useFormat();
  const duration = useDuration();
  const tone = netCents > 0 ? styles.pos : netCents < 0 ? styles.neg : undefined;
  return (
    <Modal
      open={open}
      onClose={onContinue}
      title={t('reality.title')}
      size="sm"
      role="alertdialog"
      dismissible={false}
      descriptionId={descId}
      footer={
        <>
          <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={onQuit}>{t('reality.quit')}</button>
          <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={onContinue} data-autofocus="">{t('reality.continue')}</button>
        </>
      }
    >
      <p id={descId} className={styles.copy}><ClockIcon width={18} height={18} /> {t('reality.text')}</p>
      <dl className={styles.stats}>
        <div><dt>{t('reality.duration')}</dt><dd>{duration(elapsedMs)}</dd></div>
        <div><dt>{t('reality.net')}</dt><dd className={tone}>{format.signedDemo(netCents)}</dd></div>
      </dl>
    </Modal>
  );
}
