'use client';
import { useId, useState } from 'react';
import {
  betLevels, canStep, formatAmount, formatDemo, formatFactor, maxAffordableBet, modeCostCents, snapToLadder, stepBet,
  STANDARD_COST_MODE, type BetLadder, type CostMode,
} from '@/lib/slot-kit/bet';
import { Modal } from './modal';
import { GridIcon, MinusIcon, PlusIcon } from './icons';
import { cx } from './cx';
import styles from './kit.module.css';

export interface BetSelectorProps {
  ladder: BetLadder;
  valueCents: number;
  onChange: (cents: number) => void;
  balanceCents: number;
  /** Table maximum for the bet level. */
  maxBetCents?: number;
  /** Cost factor of the active mode (ante, buy). Affordability and the cost note use it. */
  costMode?: CostMode;
  /** Name of the active mode, shown next to the cost, e.g. "Şans ×2". */
  modeLabel?: string;
  disabled?: boolean;
  label?: string;
  className?: string;
}

const REASONS = { balance: 'Bakiye yetmez', limit: 'Limit üstü' } as const;

/** Bet control: −/+ steppers, a level menu and a max-bet shortcut. Disabled levels explain why. */
export function BetSelector({ ladder, valueCents, onChange, balanceCents, maxBetCents, costMode = STANDARD_COST_MODE, modeLabel, disabled, label = 'Bahis', className }: BetSelectorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const labelId = useId();
  const limits = { balanceCents, maxBetCents, cost: costMode };
  const current = snapToLadder(ladder, valueCents);
  const max = maxAffordableBet(ladder, limits);
  const cost = modeCostCents(current, costMode);
  const hasMode = costMode.num !== costMode.den;
  const levels = betLevels(ladder, limits);
  const choose = (cents: number) => { onChange(cents); setMenuOpen(false); };

  return (
    <div className={cx(styles.kit, styles.bet, className)} role="group" aria-labelledby={labelId}>
      <span id={labelId} className={styles.fieldLabel}>{label}</span>
      <div className={styles.betRow}>
        <button type="button" className={cx(styles.roundBtn)} aria-label="Bahsi azalt" disabled={disabled || !canStep(ladder, current, -1)} onClick={() => onChange(stepBet(ladder, current, -1, limits))}><MinusIcon /></button>
        <button type="button" className={styles.betValue} disabled={disabled} aria-haspopup="dialog" aria-label={`${label} ${formatDemo(current)}, seviye menüsünü aç`} onClick={() => setMenuOpen(true)}>
          <strong>{formatAmount(current)}</strong>
          <span><GridIcon width={14} height={14} /> DEMO</span>
        </button>
        <button type="button" className={cx(styles.roundBtn)} aria-label="Bahsi artır" disabled={disabled || !canStep(ladder, current, 1, limits)} onClick={() => onChange(stepBet(ladder, current, 1, limits))}><PlusIcon /></button>
      </div>
      <div className={styles.betMeta}>
        <button type="button" className={styles.chip} disabled={disabled || max === null || max === current} onClick={() => max !== null && onChange(max)}>Azami bahis</button>
        {hasMode && (
          <p className={styles.costNote}>
            Maliyet <strong>{formatDemo(cost)}</strong>
            <span>{modeLabel ? ` · ${modeLabel} ` : ' · '}({formatFactor(costMode.num, costMode.den)})</span>
          </p>
        )}
      </div>
      <p className={styles.srOnly} role="status" aria-live="polite">{`${label} ${formatDemo(current)}`}</p>
      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Bahis seç" size="sm">
        <ul className={styles.levelGrid}>
          {levels.map(level => (
            <li key={level.betCents}>
              <button
                type="button"
                className={styles.level}
                aria-pressed={level.betCents === current}
                disabled={!level.enabled}
                data-autofocus={level.betCents === current ? '' : undefined}
                onClick={() => choose(level.betCents)}
              >
                <strong>{formatAmount(level.betCents, { trimZeros: true })}</strong>
                <small>{level.reason ? REASONS[level.reason] : 'DEMO'}</small>
              </button>
            </li>
          ))}
        </ul>
        {hasMode && <p className={styles.note}>Toplam maliyet seçilen bahsin {formatFactor(costMode.num, costMode.den)} katıdır.</p>}
      </Modal>
    </div>
  );
}
