'use client';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './kit.module.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Switch with a full-row 48px target. Exposed as role="switch". */
export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-l`}
      aria-describedby={description ? `${id}-d` : undefined}
      disabled={disabled}
      className={cx(styles.kit, styles.toggle, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleText}>
        <span id={`${id}-l`} className={styles.toggleLabel}>{label}</span>
        {description && <span id={`${id}-d`} className={styles.toggleDesc}>{description}</span>}
      </span>
      <span className={styles.switch} aria-hidden="true"><span className={styles.knob} /></span>
    </button>
  );
}

export interface SliderProps {
  label: ReactNode;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Text shown live and used as aria-valuetext. Default: percent, "%70". */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

const percent = (v: number) => `%${Math.round(v * 100)}`;

export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, format = percent, disabled, className }: SliderProps) {
  const id = useId();
  const span = max - min;
  const fill = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  const text = format(value);
  return (
    <div className={cx(styles.kit, styles.slider, className)} data-disabled={disabled || undefined}>
      <div className={styles.sliderHead}>
        <label htmlFor={id} className={styles.sliderLabel}>{label}</label>
        <output htmlFor={id} className={styles.sliderValue}>{text}</output>
      </div>
      <input
        id={id}
        type="range"
        className={styles.range}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={text}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={event => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Small second line, e.g. "×0,6". */
  hint?: ReactNode;
}
export interface SegmentedProps<T extends string | number> {
  label: ReactNode;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  /** 'bar' keeps options on one line; 'chips' wraps them. */
  layout?: 'bar' | 'chips';
  disabled?: boolean;
  className?: string;
}

/** Radio group styled as a segmented control; arrow keys come from the native radios. */
export function Segmented<T extends string | number>({ label, options, value, onChange, layout = 'bar', disabled, className }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={cx(styles.kit, styles.segmented, className)} disabled={disabled}>
      <legend className={styles.fieldLabel}>{label}</legend>
      <div className={cx(styles.segTrack, layout === 'chips' && styles.segChips)}>
        {options.map(option => (
          <label key={String(option.value)} className={styles.segOption}>
            <input
              type="radio"
              name={name}
              className={styles.segInput}
              value={String(option.value)}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.segFace}>
              <span>{option.label}</span>
              {option.hint && <small>{option.hint}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
