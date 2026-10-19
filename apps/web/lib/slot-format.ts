/**
 * Locale-aware number text for the slot games' own screens (fixed two decimals, RTP percents, one-decimal figures).
 * Every function defaults to Turkish so existing callers, tests and stored history rows keep their exact text;
 * game components pass the active locale (`useFormat().locale`).
 */
import { INTL_LOCALE, type Locale } from './i18n/config';

const cache = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: Locale, key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `${locale}:${key}`;
  let format = cache.get(id);
  if (!format) { format = new Intl.NumberFormat(INTL_LOCALE[locale], options); cache.set(id, format); }
  return format;
}

/** 3510/100 -> "35,10" (tr) / "35.10" (en): always two decimals, grouping always on (same as `useFormat().amount`). */
export function fixed2(value: number, locale: Locale = 'tr'): string {
  return numberFormat(locale, 'f2', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(value);
}
/** 12.34 -> "12,3" (tr): always one decimal. */
export function fixed1(value: number, locale: Locale = 'tr'): string {
  return numberFormat(locale, 'f1', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: true }).format(Number(value.toFixed(1)));
}
/** A whole number with the locale's grouping: 10000 -> "10.000" (tr) / "10,000" (en). */
export function groupedInt(value: number, locale: Locale = 'tr'): string {
  return numberFormat(locale, 'int', { maximumFractionDigits: 0, useGrouping: true }).format(value);
}
/**
 * `points` are percentage points (95.5 = 95.5 %). The text is rounded to `digits` first exactly like the legacy
 * `toFixed(digits)` formatter, then printed in the locale's percent pattern: "%95,5" (tr), "95.5%" (en), "95,5 %" (de).
 */
export function percentPoints(points: number, digits: number, locale: Locale = 'tr'): string {
  if (!Number.isFinite(points)) return '—';
  const rounded = Number(points.toFixed(digits));
  return numberFormat(locale, `p${digits}`, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(rounded / 100);
}
/** 0.955 -> "%95,5" (tr): RTP style, rounded to a tenth of a percent. */
export function rtpPercent(ratio: number, locale: Locale = 'tr'): string {
  if (!Number.isFinite(ratio)) return '—';
  return percentPoints(Math.round(ratio * 1000) / 10, 1, locale);
}
/** "%95,0–96,1" (tr keeps its legacy shape: one percent sign); other locales repeat the sign: "95.0%–96.1%". */
export function rtpRange(low: number, high: number, locale: Locale = 'tr'): string {
  const a = rtpPercent(low, locale), b = rtpPercent(high, locale);
  return locale === 'tr' ? `${a}–${b.slice(1)}` : `${a}–${b}`;
}
