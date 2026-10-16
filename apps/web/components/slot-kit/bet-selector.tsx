'use client';
import { useId, useState, type ReactNode } from 'react';
import {
  betLevels, canStep, maxAffordableBet, modeCostCents, snapToLadder, stepBet,
  STANDARD_COST_MODE, type BetLadder, type CostMode,
} from '@/lib/slot-kit/bet';
import { Modal } from './modal';
import { useFormat, useT } from '@/lib/i18n/client';
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
  /** Name of the active mode, shown next to the cost, e.g. "Chance ×2". */
  modeLabel?: string;
  disabled?: boolean;
  /** Defaults to the translated "Bet". */
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

const REASONS = { balance: 'bet.reasonBalance', limit: 'bet.reasonLimit' } as const;

/** Bet control: −/+ steppers, a level menu and a max-bet shortcut. Disabled levels explain why. */
export function BetSelector({ ladder, valueCents, onChange, balanceCents, maxBetCents, costMode = STANDARD_COST_MODE, modeLabel, disabled, label: labelProp, className, classNames = {}, render }: BetSelectorProps) {
  const t = useT('slotKit');
  const format = useFormat();
  const label = labelProp ?? t('bet.label');
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
  const minus = <button type="button" className={cx(styles.roundBtn, classNames.minus)} aria-label={t('bet.decrease')} disabled={disabled || !canStep(ladder, current, -1)} onClick={() => onChange(stepBet(ladder, current, -1, limits))}><MinusIcon /></button>;
  const plus = <button type="button" className={cx(styles.roundBtn, classNames.plus)} aria-label={t('bet.increase')} disabled={disabled || !canStep(ladder, current, 1, limits)} onClick={() => onChange(stepBet(ladder, current, 1, limits))}><PlusIcon /></button>;
  const value = (
    <button type="button" className={cx(styles.betValue, classNames.value)} disabled={disabled} aria-haspopup="dialog" aria-label={t('bet.openMenu', { label, amount: format.demo(current) })} onClick={() => setMenuOpen(true)}>
      <strong>{format.amount(current)}</strong>
      <span><GridIcon width={14} height={14} /> DEMO</span>
    </button>
  );
  const maxButton = <button type="button" className={cx(styles.chip, classNames.max)} disabled={disabled || max === null || max === current} onClick={() => max !== null && onChange(max)}>{t('bet.max')}</button>;
  const costNode = hasMode ? (
    <p className={styles.costNote}>
      {t('bet.cost')} <strong>{format.demo(cost)}</strong>
      <span>{modeLabel ? ` · ${modeLabel} ` : ' · '}({format.factor(costMode.num, costMode.den)})</span>
    </p>
  ) : null;
  const menu = (
    <>
      <p className={styles.srOnly} role="status" aria-live="polite">{t('bet.status', { label, amount: format.demo(current) })}</p>
      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title={t('bet.menuTitle')} size="sm">
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
                <strong>{format.amount(level.betCents, { trimZeros: true })}</strong>
                <small>{level.reason ? t(REASONS[level.reason]) : 'DEMO'}</small>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className={cx(styles.btn, styles.btnGhost)} disabled={max === null || max === current} onClick={() => max !== null && choose(max)}>
          {max !== null ? t('bet.maxWith', { amount: format.demo(max) }) : t('bet.max')}
        </button>
        {hasMode && <p className={styles.note}>{t('bet.costNote', { factor: format.factor(costMode.num, costMode.den) })}</p>}
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
