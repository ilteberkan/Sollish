/**
 * Which language the character voices speak (owner decision, 16 Oct 2026): English by default; Turkish voices play
 * only when the site language is Turkish. Every other language (de, pt, fr, it, es, zh, ko, en) hears English.
 *
 * Contract with the i18n layer: it sets `<html lang>` and dispatches a `sollish:locale` event on `window` with
 * `detail.locale` whenever the site language changes. Nothing here reads a result; presentation only.
 */

export type VoiceLanguage = 'tr' | 'en';
export const VOICE_LANGUAGES: readonly VoiceLanguage[] = ['tr', 'en'];
export const LOCALE_EVENT = 'sollish:locale';

/** Locale tag (`tr`, `tr-TR`, `TR_tr`, `de`, …) to the voice language. Anything that is not Turkish is English. */
export function voiceLanguageOf(locale: unknown): VoiceLanguage {
  return typeof locale === 'string' && /^tr(?![a-z])/i.test(locale.trim()) ? 'tr' : 'en';
}

/** Voice language of the page right now: from `document.documentElement.lang`; on the server, English. */
export function voiceLanguage(): VoiceLanguage {
  try {
    if (typeof document === 'undefined') return 'en';
    return voiceLanguageOf(document.documentElement?.lang);
  } catch { return 'en'; }
}

/** `/audio/voice/storm` + `tr` → `/audio/voice/storm/tr` (the folder an engine's `setVoiceBank` takes). */
export function voiceBankFolder(base: string, language: VoiceLanguage = voiceLanguage()): string {
  return `${base.trim().replace(/\/+$/, '')}/${language}`;
}

/**
 * Calls `cb` with the voice language after every `sollish:locale` event (the caller compares it with the bank it
 * has loaded, so de → fr reloads nothing). Returns the unsubscribe function; a no-op on the server.
 */
export function onVoiceLanguageChange(cb: (language: VoiceLanguage) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ locale?: unknown } | null>).detail;
    const next = detail && typeof detail === 'object' && 'locale' in detail && detail.locale !== undefined ? voiceLanguageOf(detail.locale) : voiceLanguage();
    try { cb(next); } catch { /* a listener must never break the language switch */ }
  };
  window.addEventListener(LOCALE_EVENT, handler);
  return () => window.removeEventListener(LOCALE_EVENT, handler);
}
