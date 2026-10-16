'use client';
import { HTML_LANG, LOCALE_NATIVE_NAMES, LOCALES, isLocale } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/client';
import { Icon } from './icons';

/**
 * Compact header language picker: globe + current code, with a native <select> laid over it (keyboard, screen
 * reader and phone pickers work out of the box). Options use their own language names and `lang`.
 */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, pending } = useLocale();
  const t = useT('common');
  return (
    <label className={`locale-switcher ${className}`} data-pending={pending || undefined} title={t('locale.current', { name: LOCALE_NATIVE_NAMES[locale] })}>
      <Icon name="globe" size={18} />
      <span className="locale-code" aria-hidden="true">{locale.toUpperCase()}</span>
      <select
        data-testid="locale-switcher"
        aria-label={t('locale.label')}
        aria-busy={pending || undefined}
        value={locale}
        onChange={event => { if (isLocale(event.target.value)) void setLocale(event.target.value); }}
      >
        {LOCALES.map(code => <option key={code} value={code} lang={HTML_LANG[code]}>{LOCALE_NATIVE_NAMES[code]}</option>)}
      </select>
    </label>
  );
}
