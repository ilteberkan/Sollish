/**
 * Locale-aware formatting for amounts, factors, percents and times. Integer cents in, text out:
 * the whole part and the fraction are formatted separately, so no floating point touches an amount.
 * DEMO amounts always keep the "DEMO" unit (it is not a currency and never gets a currency sign).
 */
import { INTL_LOCALE, type Locale } from './config';

const MINUS = '−';

export interface Formatter {
  readonly locale: Locale;
  /** BCP 47 tag used for Intl (e.g. "tr-TR"). */
  readonly intl: string;
  /** Plain number, up to `maxFractionDigits` (default 2). */
  number(value: number, maxFractionDigits?: number): string;
  /** 123456 → "1,234.56" (en) / "1.234,56" (tr). Not a safe integer → "—". Negative uses the true minus sign. */
  amount(cents: number, options?: { trimZeros?: boolean }): string;
  /** amount + " DEMO". */
  demo(cents: number, options?: { trimZeros?: boolean }): string;
  /** "+12.40 DEMO", "−3.00 DEMO", "0.00 DEMO". */
  signedDemo(cents: number): string;
  /** Multiplier from an integer ratio: 5/4 → "×1.25" (en) / "×1,25" (tr). */
  factor(num: number, den: number): string;
  /** Hundredths of the bet as a multiplier number without the sign: 1250 → "12.5". */
  times(hundredths: number): string;
  /** 0.7 → "70%" (en) / "%70" (tr). */
  percent(fraction: number): string;
  /** Wall-clock time of day, hours and minutes, in the locale's convention. */
  clock(ms: number): string;
  /** Time of day with seconds. */
  time(ms: number): string;
}

const cache = new Map<Locale, Formatter>();

export function getFormatter(locale: Locale): Formatter {
  const hit = cache.get(locale);
  if (hit) return hit;
  const intl = INTL_LOCALE[locale];
  const whole = new Intl.NumberFormat(intl, { maximumFractionDigits: 0, useGrouping: true });
  const decimal = new Intl.NumberFormat(intl).formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.';
  const plain = new Map<number, Intl.NumberFormat>();
  const numberWith = (digits: number) => {
    let f = plain.get(digits);
    if (!f) { f = new Intl.NumberFormat(intl, { maximumFractionDigits: digits }); plain.set(digits, f); }
    return f;
  };
  const percentFormat = new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: 0 });
  const clockFormat = new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit' });
  const timeFormat = new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const amount = (cents: number, options: { trimZeros?: boolean } = {}) => {
    if (!Number.isSafeInteger(cents)) return '—';
    const abs = Math.abs(cents);
    const fraction = String(abs % 100).padStart(2, '0');
    const body = options.trimZeros && fraction === '00' ? whole.format(Math.floor(abs / 100)) : `${whole.format(Math.floor(abs / 100))}${decimal}${fraction}`;
    return cents < 0 ? `${MINUS}${body}` : body;
  };
  const demo = (cents: number, options: { trimZeros?: boolean } = {}) => `${amount(cents, options)} DEMO`;
  const formatter: Formatter = {
    locale,
    intl,
    number: (value, maxFractionDigits = 2) => (Number.isFinite(value) ? numberWith(maxFractionDigits).format(value) : '—'),
    amount,
    demo,
    signedDemo: cents => (!Number.isSafeInteger(cents) ? '—' : cents > 0 ? `+${demo(cents)}` : demo(cents)),
    factor: (num, den) => `×${numberWith(2).format(Math.round((num * 100) / den) / 100)}`,
    times: hundredths => numberWith(2).format(Math.floor(hundredths) / 100),
    percent: fraction => percentFormat.format(fraction),
    clock: ms => (Number.isFinite(ms) ? clockFormat.format(ms) : '--:--'),
    time: ms => (Number.isFinite(ms) ? timeFormat.format(ms) : '--:--:--'),
  };
  cache.set(locale, formatter);
  return formatter;
}
