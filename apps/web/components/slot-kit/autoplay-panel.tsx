'use client';
import { useId, useMemo, useState } from 'react';
import { AUTOPLAY_ADVANCED_DEFAULTS, AUTOPLAY_SPIN_OPTIONS, autoplayAdvancedConditions, validateAutoplayConfig, type AutoplayConfig, type AutoplaySpins } from '@/lib/slot-kit/autoplay';
import { parseDemoAmountCents } from '@/lib/slot-kit/bet';
import { useFormat, useT } from '@/lib/i18n/client';
import { Segmented, Toggle } from './controls';
import { cx } from './cx';
import styles from './kit.module.css';

export interface AutoplayPanelProps {
  onStart: (config: AutoplayConfig) => void;
  /** Cost of one spin at the current bet/mode. Enables the minimum check and the ×bahis shortcuts. */
  spinCostCents?: number;
  /** Shown as a hint under the loss limit when the limit is larger than the balance. */
  balanceCents?: number;
  disabled?: boolean;
  initialSpins?: AutoplaySpins;
  /** Defaults to the translated "Start". */
  startLabel?: string;
  className?: string;
  /** Open the "Gelişmiş" (optional stop conditions) section initially. Default: closed. */
  defaultAdvancedOpen?: boolean;
}

const SHORTCUTS = [10, 25, 50, 100] as const;

/** Plain input text for a cents value: 1250 -> "12,5" (or "12.5"), 5000 -> "50". No grouping: the parser rejects it. */
function centsText(cents: number, decimal: string): string {
  const fraction = String(cents % 100).padStart(2, '0').replace(/0$/, '');
  return fraction === '' ? String(Math.floor(cents / 100)) : `${Math.floor(cents / 100)}${decimal === ',' ? ',' : '.'}${fraction}`;
}

interface AmountFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  required?: boolean;
  disabled?: boolean;
}

function AmountField({ label, hint, value, onChange, error, required, disabled }: AmountFieldProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const t = useT('slotKit');
  const showError = error !== null && (touched || value !== '');
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>{label}{required && <span className={styles.req}>{t('autoplay.required')}</span>}</label>
      <div className={cx(styles.inputWrap, showError && styles.inputBad)}>
        <input
          id={id}
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder={required ? t('autoplay.placeholderRequired') : t('autoplay.placeholderOff')}
          value={value}
          disabled={disabled}
          required={required}
          aria-invalid={showError}
          aria-describedby={`${id}-m`}
          onChange={event => onChange(event.target.value)}
          onBlur={() => setTouched(true)}
        />
        <span className={styles.unit} aria-hidden="true">DEMO</span>
      </div>
      <p id={`${id}-m`} className={cx(styles.fieldMsg, showError && styles.fieldErr)} role={showError ? 'alert' : undefined}>{showError ? error : hint}</p>
    </div>
  );
}

const optionalCents = (text: string, invalid: string): { cents: number | undefined; error: string | null } => {
  if (text.trim() === '') return { cents: undefined, error: null };
  const cents = parseDemoAmountCents(text);
  return cents === null ? { cents: undefined, error: invalid } : { cents, error: null };
};

/**
 * Autoplay setup (game-standards §6): the main view is only the spin count, the required loss limit and Start.
 * The optional stop conditions sit in a closed "Gelişmiş" section ("bedava dönüşte dur" on by default). The Start
 * button stays disabled until the config passes `validateAutoplayConfig`.
 */
export function AutoplayPanel({ onStart, spinCostCents, balanceCents, disabled, initialSpins = 10, startLabel, className, defaultAdvancedOpen = false }: AutoplayPanelProps) {
  const [spins, setSpins] = useState<AutoplaySpins>(initialSpins);
  const [lossText, setLossText] = useState('');
  const [singleText, setSingleText] = useState('');
  const [increaseText, setIncreaseText] = useState('');
  const [stopOnAnyWin, setStopOnAnyWin] = useState(AUTOPLAY_ADVANCED_DEFAULTS.stopOnAnyWin);
  const [stopOnFeature, setStopOnFeature] = useState(AUTOPLAY_ADVANCED_DEFAULTS.stopOnFeature);
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen);
  const t = useT('slotKit');
  const format = useFormat();

  const parsed = useMemo(() => {
    const loss = lossText.trim() === '' ? null : parseDemoAmountCents(lossText);
    let lossError: string | null = null;
    if (lossText.trim() === '') lossError = t('autoplay.lossRequired');
    else if (loss === null) lossError = t('autoplay.invalidLoss');
    else if (spinCostCents !== undefined && loss < spinCostCents) lossError = t('autoplay.lossMin', { amount: format.demo(spinCostCents) });
    const single = optionalCents(singleText, t('autoplay.invalidAmount'));
    const increase = optionalCents(increaseText, t('autoplay.invalidAmount'));
    const config: AutoplayConfig | null = lossError === null && single.error === null && increase.error === null && loss !== null
      ? {
          spins, lossLimitCents: loss, stopOnAnyWin, stopOnFeature,
          ...(single.cents !== undefined ? { singleWinLimitCents: single.cents } : {}),
          ...(increase.cents !== undefined ? { balanceIncreaseCents: increase.cents } : {}),
        }
      : null;
    return { loss, lossError, single, increase, config: config && validateAutoplayConfig(config).length === 0 ? config : null };
  }, [lossText, singleText, increaseText, spins, stopOnAnyWin, stopOnFeature, spinCostCents, t, format]);

  const lossHint = parsed.loss !== null && balanceCents !== undefined && parsed.loss > balanceCents
    ? t('autoplay.lossHintOver')
    : t('autoplay.lossHint');
  const summary = autoplayAdvancedConditions({
    stopOnAnyWin, stopOnFeature,
    ...(parsed.single.cents !== undefined ? { singleWinLimitCents: parsed.single.cents } : {}),
    ...(parsed.increase.cents !== undefined ? { balanceIncreaseCents: parsed.increase.cents } : {}),
  }).map(c => c.kind === 'any-win' ? t('autoplay.summaryAnyWin') : c.kind === 'feature' ? t('autoplay.summaryFeature')
    : c.kind === 'single-win' ? t('autoplay.summarySingleWin', { amount: format.demo(c.cents, { trimZeros: true }) })
    : t('autoplay.summaryBalance', { amount: format.demo(c.cents, { trimZeros: true }) }));

  return (
    <form
      className={cx(styles.kit, styles.panel, className)}
      noValidate
      onSubmit={event => { event.preventDefault(); if (parsed.config && !disabled) onStart(parsed.config); }}
    >
      <Segmented
        label={t('autoplay.spins')}
        layout="chips"
        options={AUTOPLAY_SPIN_OPTIONS.map(n => ({ value: n, label: String(n) }))}
        value={spins}
        onChange={setSpins}
        disabled={disabled}
      />
      <section className={styles.group}>
        <AmountField label={t('autoplay.lossLimit')} required hint={lossHint} value={lossText} onChange={setLossText} error={parsed.lossError} disabled={disabled} />
        {spinCostCents !== undefined && (
          <div className={cx(styles.shortcuts, styles.shortcutsRow)} role="group" aria-label={t('autoplay.shortcuts')}>
            {SHORTCUTS.map(n => (
              <button key={n} type="button" className={styles.chip} disabled={disabled} onClick={() => setLossText(centsText(spinCostCents * n, format.decimal))}>{t('autoplay.shortcut', { n })}</button>
            ))}
          </div>
        )}
      </section>
      <details
        className={styles.advanced}
        open={advancedOpen}
        onToggle={event => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className={styles.advancedSummary}>
          <span className={styles.advancedTitle}>{t('autoplay.advanced')}</span>
          <span className={styles.advancedState}>{summary.length ? t('autoplay.stopsOn', { list: summary.join(' · ') }) : t('autoplay.noExtra')}</span>
        </summary>
        <div className={styles.advancedBody} role="group" aria-label={t('autoplay.extraGroup')}>
          <Toggle label={t('autoplay.stopAnyWin')} checked={stopOnAnyWin} onChange={setStopOnAnyWin} disabled={disabled} />
          <Toggle label={t('autoplay.stopFeature')} checked={stopOnFeature} onChange={setStopOnFeature} disabled={disabled} />
          <AmountField label={t('autoplay.singleWin')} hint={t('autoplay.singleWinHint')} value={singleText} onChange={setSingleText} error={parsed.single.error} disabled={disabled} />
          <AmountField label={t('autoplay.balanceIncrease')} hint={t('autoplay.balanceIncreaseHint')} value={increaseText} onChange={setIncreaseText} error={parsed.increase.error} disabled={disabled} />
        </div>
      </details>
      <button type="submit" className={cx(styles.btn, styles.btnPrimary)} disabled={disabled || parsed.config === null}>
        {t('autoplay.startWith', { label: startLabel ?? t('autoplay.start'), spins })}
      </button>
    </form>
  );
}

export interface AutoplayStopButtonProps {
  remaining: number;
  onStop: () => void;
  disabled?: boolean;
  className?: string;
}

/** Round stop button that replaces the spin button while autoplay runs; shows the spins left. */
export function AutoplayStopButton({ remaining, onStop, disabled, className }: AutoplayStopButtonProps) {
  const t = useT('slotKit');
  return (
    <button
      type="button"
      className={cx(styles.kit, styles.stopBtn, className)}
      onClick={onStop}
      disabled={disabled}
      aria-label={t('autoplay.stopAria', { remaining })}
    >
      <span className={styles.stopNum} aria-hidden="true">{remaining}</span>
      <span className={styles.stopText} aria-hidden="true">{t('autoplay.stop')}</span>
    </button>
  );
}
