'use client';
import { useId } from 'react';
import { formatDuration } from '@/lib/slot-kit/session';
import { formatSignedDemo } from '@/lib/slot-kit/bet';
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
  const tone = netCents > 0 ? styles.pos : netCents < 0 ? styles.neg : undefined;
  return (
    <Modal
      open={open}
      onClose={onContinue}
      title="Oturum hatırlatması"
      size="sm"
      role="alertdialog"
      dismissible={false}
      descriptionId={descId}
      footer={
        <>
          <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={onQuit}>Çık</button>
          <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={onContinue} data-autofocus="">Devam</button>
        </>
      }
    >
      <p id={descId} className={styles.copy}><ClockIcon width={18} height={18} /> Ara vermek isteyebilirsiniz. Oyun devam etmeden önce lütfen kontrol edin.</p>
      <dl className={styles.stats}>
        <div><dt>Oturum süresi</dt><dd>{formatDuration(elapsedMs)}</dd></div>
        <div><dt>Net sonuç</dt><dd className={tone}>{formatSignedDemo(netCents)}</dd></div>
      </dl>
    </Modal>
  );
}
