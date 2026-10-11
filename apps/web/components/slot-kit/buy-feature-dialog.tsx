'use client';
import type { ReactNode } from 'react';
import { formatDemo } from '@/lib/slot-kit/bet';
import { Modal } from './modal';
import { WarnIcon } from './icons';
import { cx } from './cx';
import styles from './kit.module.css';

export interface BuyFeatureDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** e.g. "Bedava dönüş". */
  featureName: string;
  priceCents: number;
  /** Separate RTP of the buy mode, e.g. "Satın alma modu RTP: %96,10". */
  rtpText: string;
  description?: ReactNode;
  /** Why buying is not possible right now (e.g. "Şans ×2 açıkken satın alınamaz"). Disables confirm. */
  disabledReason?: string;
  balanceCents?: number;
  /** Request in flight: both buttons are disabled. */
  busy?: boolean;
  title?: string;
}

/** Confirmation for buying a bonus: price, mode RTP, and a visible reason when it cannot be bought. */
export function BuyFeatureDialog({ open, onClose, onConfirm, featureName, priceCents, rtpText, description, disabledReason, balanceCents, busy, title = 'Bonus satın al' }: BuyFeatureDialogProps) {
  const short = balanceCents !== undefined && balanceCents < priceCents;
  const reason = disabledReason ?? (short ? 'Bakiye yetersiz' : undefined);
  const blocked = reason !== undefined || busy === true;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={onClose} disabled={busy} data-autofocus="">Vazgeç</button>
          <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={onConfirm} disabled={blocked}>Satın al</button>
        </>
      }
    >
      <p className={styles.featureName}>{featureName}</p>
      <div className={styles.price}>
        <span>Fiyat</span>
        <strong>{formatDemo(priceCents)}</strong>
        {balanceCents !== undefined && <small>Bakiye {formatDemo(balanceCents)}</small>}
      </div>
      {description && <div className={styles.copy}>{description}</div>}
      <p className={styles.rtp}>{rtpText}</p>
      {reason && <p className={styles.warn} role="alert"><WarnIcon /> <span>{reason}</span></p>}
      <p className={styles.note}>DEMO tutarı gerçek para değildir. Satın alma, standart moddan ayrı bir RTP ile çalışır.</p>
    </Modal>
  );
}
