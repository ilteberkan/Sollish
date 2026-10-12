'use client';
import { useId, useMemo, useState } from 'react';
import { AUTOPLAY_ADVANCED_DEFAULTS, AUTOPLAY_SPIN_OPTIONS, autoplayAdvancedSummary, validateAutoplayConfig, type AutoplayConfig, type AutoplaySpins } from '@/lib/slot-kit/autoplay';
import { formatDemo, parseDemoAmountCents } from '@/lib/slot-kit/bet';
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
  startLabel?: string;
  className?: string;
  /** Open the "Gelişmiş" (optional stop conditions) section initially. Default: closed. */
  defaultAdvancedOpen?: boolean;
}

const SHORTCUTS = [10, 25, 50, 100] as const;

/** Plain input text for a cents value: 1250 -> "12,5", 5000 -> "50". */
function centsText(cents: number): string {
  const fraction = String(cents % 100).padStart(2, '0').replace(/0$/, '');
  return fraction === '' ? String(Math.floor(cents / 100)) : `${Math.floor(cents / 100)},${fraction}`;
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
  const showError = error !== null && (touched || value !== '');
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>{label}{required && <span className={styles.req}> · zorunlu</span>}</label>
      <div className={cx(styles.inputWrap, showError && styles.inputBad)}>
        <input
          id={id}
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder={required ? 'örn. 50' : 'kapalı'}
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

const optionalCents = (text: string): { cents: number | undefined; error: string | null } => {
  if (text.trim() === '') return { cents: undefined, error: null };
  const cents = parseDemoAmountCents(text);
  return cents === null ? { cents: undefined, error: 'Geçerli bir tutar girin (örn. 25 veya 12,50)' } : { cents, error: null };
};

/**
 * Autoplay setup (game-standards §6): the main view is only the spin count, the required loss limit and Start.
 * The optional stop conditions sit in a closed "Gelişmiş" section ("bedava dönüşte dur" on by default). The Start
 * button stays disabled until the config passes `validateAutoplayConfig`.
 */
export function AutoplayPanel({ onStart, spinCostCents, balanceCents, disabled, initialSpins = 10, startLabel = 'Başlat', className, defaultAdvancedOpen = false }: AutoplayPanelProps) {
  const [spins, setSpins] = useState<AutoplaySpins>(initialSpins);
  const [lossText, setLossText] = useState('');
  const [singleText, setSingleText] = useState('');
  const [increaseText, setIncreaseText] = useState('');
  const [stopOnAnyWin, setStopOnAnyWin] = useState(AUTOPLAY_ADVANCED_DEFAULTS.stopOnAnyWin);
  const [stopOnFeature, setStopOnFeature] = useState(AUTOPLAY_ADVANCED_DEFAULTS.stopOnFeature);
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen);

  const parsed = useMemo(() => {
    const loss = lossText.trim() === '' ? null : parseDemoAmountCents(lossText);
    let lossError: string | null = null;
    if (lossText.trim() === '') lossError = 'Kayıp limiti zorunlu';
    else if (loss === null) lossError = 'Geçerli bir tutar girin (örn. 50 veya 12,50)';
    else if (spinCostCents !== undefined && loss < spinCostCents) lossError = `En az bir dönüş kadar olmalı (${formatDemo(spinCostCents)})`;
    const single = optionalCents(singleText);
    const increase = optionalCents(increaseText);
    const config: AutoplayConfig | null = lossError === null && single.error === null && increase.error === null && loss !== null
      ? {
          spins, lossLimitCents: loss, stopOnAnyWin, stopOnFeature,
          ...(single.cents !== undefined ? { singleWinLimitCents: single.cents } : {}),
          ...(increase.cents !== undefined ? { balanceIncreaseCents: increase.cents } : {}),
        }
      : null;
    return { loss, lossError, single, increase, config: config && validateAutoplayConfig(config).length === 0 ? config : null };
  }, [lossText, singleText, increaseText, spins, stopOnAnyWin, stopOnFeature, spinCostCents]);

  const lossHint = parsed.loss !== null && balanceCents !== undefined && parsed.loss > balanceCents
    ? 'Bakiyeden büyük; bakiye bitince yine durur.'
    : 'Net kayıp bu tutarı aşacaksa durur.';
  const summary = autoplayAdvancedSummary({
    stopOnAnyWin, stopOnFeature,
    ...(parsed.single.cents !== undefined ? { singleWinLimitCents: parsed.single.cents } : {}),
    ...(parsed.increase.cents !== undefined ? { balanceIncreaseCents: parsed.increase.cents } : {}),
  });

  return (
    <form
      className={cx(styles.kit, styles.panel, className)}
      noValidate
      onSubmit={event => { event.preventDefault(); if (parsed.config && !disabled) onStart(parsed.config); }}
    >
      <Segmented
        label="Tur sayısı"
        layout="chips"
        options={AUTOPLAY_SPIN_OPTIONS.map(n => ({ value: n, label: String(n) }))}
        value={spins}
        onChange={setSpins}
        disabled={disabled}
      />
      <section className={styles.group}>
        <AmountField label="Kayıp limiti" required hint={lossHint} value={lossText} onChange={setLossText} error={parsed.lossError} disabled={disabled} />
        {spinCostCents !== undefined && (
          <div className={styles.shortcuts} role="group" aria-label="Kayıp limiti kısayolları">
            {SHORTCUTS.map(n => (
              <button key={n} type="button" className={styles.chip} disabled={disabled} onClick={() => setLossText(centsText(spinCostCents * n))}>{n}× bahis</button>
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
          <span className={styles.advancedTitle}>Gelişmiş</span>
          <span className={styles.advancedState}>{summary.length ? summary.join(' · ') : 'Ek durma koşulu yok'}</span>
        </summary>
        <div className={styles.advancedBody} role="group" aria-label="Ek durma koşulları">
          <Toggle label="Her kazançta dur" checked={stopOnAnyWin} onChange={setStopOnAnyWin} disabled={disabled} />
          <Toggle label="Bedava dönüşte dur" checked={stopOnFeature} onChange={setStopOnFeature} disabled={disabled} />
          <AmountField label="Tek kazanç şu tutarı aşarsa dur" hint="Boş = kapalı." value={singleText} onChange={setSingleText} error={parsed.single.error} disabled={disabled} />
          <AmountField label="Bakiye şu kadar artarsa dur" hint="Başlangıca göre. Boş = kapalı." value={increaseText} onChange={setIncreaseText} error={parsed.increase.error} disabled={disabled} />
        </div>
      </details>
      <button type="submit" className={cx(styles.btn, styles.btnPrimary)} disabled={disabled || parsed.config === null}>
        {startLabel} · {spins} tur
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
  return (
    <button
      type="button"
      className={cx(styles.kit, styles.stopBtn, className)}
      onClick={onStop}
      disabled={disabled}
      aria-label={`Otomatik oyunu durdur, ${remaining} tur kaldı`}
    >
      <span className={styles.stopNum} aria-hidden="true">{remaining}</span>
      <span className={styles.stopText} aria-hidden="true">DURDUR</span>
    </button>
  );
}
