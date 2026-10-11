'use client';
import { useId, useState, type ReactNode } from 'react';
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
  /** Extra classes for the individual controls (themed decks). */
  classNames?: Partial<Record<'minus' | 'plus' | 'value' | 'max', string>>;
  /**
   * Custom layout: receives the ready controls and places them anywhere (e.g. − and + around a spin button).
   * The caller must render `parts.label` and wrap the controls in an element with `parts.groupProps`.
   * The level menu and the live status line are always rendered by the selector itself.
   */
  render?: (parts: BetSelectorParts) => ReactNode;
}

export interface BetSelectorParts {
  label: ReactNode;
  groupProps: { role: 'group'; 'aria-labelledby': string };
  minus: ReactNode;
  plus: ReactNode;
  /** The value button; opens the level menu. */
  value: ReactNode;
  max: ReactNode;
  /** Cost note when a mode changes the cost, else null. */
  cost: ReactNode;
  currentCents: number;
  costCents: number;
  openMenu: () => void;
}

const REASONS = { balance: 'Bakiye yetmez', limit: 'Limit üstü' } as const;

/** Bet control: −/+ steppers, a level menu and a max-bet shortcut. Disabled levels explain why. */
export function BetSelector({ ladder, valueCents, onChange, balanceCents, maxBetCents, costMode = STANDARD_COST_MODE, modeLabel, disabled, label = 'Bahis', className, classNames = {}, render }: BetSelectorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const labelId = useId();
  const limits = { balanceCents, maxBetCents, cost: costMode };
  const current = snapToLadder(ladder, valueCents);
  const max = maxAffordableBet(ladder, limits);
  const cost = modeCostCents(current, costMode);
  const hasMode = costMode.num !== costMode.den;
  const levels = betLevels(ladder, limits);
  const choose = (cents: number) => { onChange(cents); setMenuOpen(false); };

  const labelNode = <span id={labelId} className={styles.fieldLabel}>{label}</span>;
  const minus = <button type="button" className={cx(styles.roundBtn, classNames.minus)} aria-label="Bahsi azalt" disabled={disabled || !canStep(ladder, current, -1)} onClick={() => onChange(stepBet(ladder, current, -1, limits))}><MinusIcon /></button>;
  const plus = <button type="button" className={cx(styles.roundBtn, classNames.plus)} aria-label="Bahsi artır" disabled={disabled || !canStep(ladder, current, 1, limits)} onClick={() => onChange(stepBet(ladder, current, 1, limits))}><PlusIcon /></button>;
  const value = (
    <button type="button" className={cx(styles.betValue, classNames.value)} disabled={disabled} aria-haspopup="dialog" aria-label={`${label} ${formatDemo(current)}, seviye menüsünü aç`} onClick={() => setMenuOpen(true)}>
      <strong>{formatAmount(current)}</strong>
      <span><GridIcon width={14} height={14} /> DEMO</span>
    </button>
  );
  const maxButton = <button type="button" className={cx(styles.chip, classNames.max)} disabled={disabled || max === null || max === current} onClick={() => max !== null && onChange(max)}>Azami bahis</button>;
  const costNode = hasMode ? (
    <p className={styles.costNote}>
      Maliyet <strong>{formatDemo(cost)}</strong>
      <span>{modeLabel ? ` · ${modeLabel} ` : ' · '}({formatFactor(costMode.num, costMode.den)})</span>
    </p>
  ) : null;
  const menu = (
    <>
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
        <button type="button" className={cx(styles.btn, styles.btnGhost)} disabled={max === null || max === current} onClick={() => max !== null && choose(max)}>
          Azami bahis{max !== null ? ` · ${formatDemo(max)}` : ''}
        </button>
        {hasMode && <p className={styles.note}>Toplam maliyet seçilen bahsin {formatFactor(costMode.num, costMode.den)} katıdır.</p>}
      </Modal>
    </>
  );

  if (render) {
    return (
      <>
        {render({ label: labelNode, groupProps: { role: 'group', 'aria-labelledby': labelId }, minus, plus, value, max: maxButton, cost: costNode, currentCents: current, costCents: cost, openMenu: () => setMenuOpen(true) })}
        {menu}
      </>
    );
  }
  return (
    <div className={cx(styles.kit, styles.bet, className)} role="group" aria-labelledby={labelId}>
      {labelNode}
      <div className={styles.betRow}>{minus}{value}{plus}</div>
      <div className={styles.betMeta}>{maxButton}{costNode}</div>
      {menu}
    </div>
  );
}
