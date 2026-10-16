import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './config';

/** Language ranges of an Accept-Language header, best first (q-value, then header order). Invalid parts are skipped. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header || typeof header !== 'string') return [];
  const out: Array<{ tag: string; q: number; index: number }> = [];
  header.slice(0, 1024).split(',').forEach((part, index) => {
    const [rawTag, ...params] = part.trim().split(';');
    const tag = rawTag?.trim().toLowerCase() ?? '';
    if (!tag || !/^([a-z]{1,8}(-[a-z0-9]{1,8})*|\*)$/.test(tag)) return;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.trim().split('=');
      if (key?.trim() === 'q') { q = Number(value); if (!Number.isFinite(q)) q = 0; }
    }
    if (q > 0) out.push({ tag, q: Math.min(1, q), index });
  });
  return out.sort((a, b) => b.q - a.q || a.index - b.index).map(entry => entry.tag);
}

/**
 * Best supported locale for an Accept-Language header, or null. Matches on the primary language subtag, so
 * `pt-BR` → pt, `de-AT` → de, and every Chinese range (`zh-CN`, `zh-TW`, `zh-Hant`) → zh (Simplified is the only
 * Chinese catalog). `*` is ignored: it carries no preference, the caller's default applies.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  for (const tag of parseAcceptLanguage(header)) {
    if (tag === '*') continue;
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

/** Resolution order: explicit choice (cookie) → Accept-Language → DEFAULT_LOCALE. */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return matchAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

export { LOCALES };
