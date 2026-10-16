/**
 * Supported locales and the browser-facing contract (docs/architecture/i18n.md).
 * Owner decision 16 Oct 2026: nine languages; English is the default.
 *
 * CONTRACT (slot audio and other listeners): the active locale is always on `document.documentElement.lang`
 * (see HTML_LANG) and every change dispatches `new CustomEvent(LOCALE_EVENT, { detail: { locale } })` on `window`,
 * where `locale` is one of LOCALES. Do not rename the cookie, the event or the html lang values without updating
 * every listener.
 */
export const LOCALES = ['en', 'de', 'pt', 'fr', 'it', 'es', 'tr', 'zh', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Explicit user choice. Readable by the server (no URL prefix yet), one year, SameSite=Lax. */
export const LOCALE_COOKIE = 'sollish_locale';
/** localStorage mirror of the cookie, so a cleared/expired cookie can be restored on the next visit. */
export const LOCALE_STORAGE_KEY = 'sollish_locale';
/** window event fired after every locale change; detail: { locale: Locale }. */
export const LOCALE_EVENT = 'sollish:locale';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Names in their own language, for the language switcher (never translated). */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'English', de: 'Deutsch', pt: 'Português', fr: 'Français', it: 'Italiano', es: 'Español', tr: 'Türkçe', zh: '中文', ko: '한국어',
});

/** Value of `<html lang>`. Chinese is Simplified, so the script is explicit (font and glyph selection). */
export const HTML_LANG: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'en', de: 'de', pt: 'pt', fr: 'fr', it: 'it', es: 'es', tr: 'tr', zh: 'zh-Hans', ko: 'ko',
});

/** Intl locale used for numbers, dates and plural rules. Portuguese copy is Brazilian; Spanish is neutral/European. */
export const INTL_LOCALE: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'en-US', de: 'de-DE', pt: 'pt-BR', fr: 'fr-FR', it: 'it-IT', es: 'es-ES', tr: 'tr-TR', zh: 'zh-CN', ko: 'ko-KR',
});

/** All supported locales are left-to-right; kept as a function so an RTL locale only changes this table. */
const RTL: ReadonlySet<Locale> = new Set<Locale>();
export function localeDir(locale: Locale): 'ltr' | 'rtl' { return RTL.has(locale) ? 'rtl' : 'ltr'; }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
