import { INTL_LOCALE, type Locale } from './i18n/config';

/** SOL amount text in the given locale (`solLabel` in `live.ts` is the Turkish-only original): whole part grouped, fraction without trailing zeros. */
export function solLabelIn(lamports: bigint, locale: Locale): string {
  const intl = INTL_LOCALE[locale];
  const decimal = new Intl.NumberFormat(intl).formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.';
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole.toLocaleString(intl)}${fraction ? `${decimal}${fraction}` : ''}`;
}
