import type { Locale } from '@/lib/i18n/config';

/** A symbol name inside a sentence ("8 strawberries, 2.02× win"): lower-cased per language, except German (nouns stay capitalised). */
export function inlineName(locale: Locale, label: string): string {
  return locale === 'de' ? label : label.toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : locale);
}
