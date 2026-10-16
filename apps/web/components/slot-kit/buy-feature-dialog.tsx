'use client';
import type { ReactNode } from 'react';
import { Modal } from './modal';
import { useFormat, useT } from '@/lib/i18n/client';
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
export function BuyFeatureDialog({ open, onClose, onConfirm, featureName, priceCents, rtpText, description, disabledReason, balanceCents, busy, title }: BuyFeatureDialogProps) {
  const t = useT('slotKit');
  const format = useFormat();
  const short = balanceCents !== undefined && balanceCents < priceCents;
  const reason = disabledReason ?? (short ? t('buy.insufficient') : undefined);
  const blocked = reason !== undefined || busy === true;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t('buy.title')}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={onClose} disabled={busy} data-autofocus="">{t('buy.cancel')}</button>
          <button type="button" className={cx(styles.btn, styles.btnPrimary)} onClick={onConfirm} disabled={blocked}>{t('buy.confirm')}</button>
        </>
      }
    >
      <p className={styles.featureName}>{featureName}</p>
      <div className={styles.price}>
        <span>{t('buy.price')}</span>
        <strong>{format.demo(priceCents)}</strong>
        {balanceCents !== undefined && <small>{t('buy.balance', { amount: format.demo(balanceCents) })}</small>}
      </div>
      {description && <div className={styles.copy}>{description}</div>}
      <p className={styles.rtp}>{rtpText}</p>
      {reason && <p className={styles.warn} role="alert"><WarnIcon /> <span>{reason}</span></p>}
      <p className={styles.note}>{t('buy.note')}</p>
    </Modal>
  );
}
