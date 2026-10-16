/**
 * Server-side locale for the current request (Server Components, generateMetadata). Reads the cookie and the
 * Accept-Language header, so every page that uses it renders per request (no URL prefix yet; see
 * docs/architecture/i18n.md for the /[locale] route plan).
 */
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, type Locale } from './config';
import { resolveLocale } from './negotiate';
import { loadNamespace, loadNamespaces, type Namespace } from './catalog';
import { createTranslator, type Translator } from './translator';
import { getFormatter } from './format';

export const getLocale = cache(async (): Promise<Locale> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get('accept-language'));
});

export async function getTranslator<N extends Namespace>(namespace: N): Promise<Translator<N>> {
  const locale = await getLocale();
  return createTranslator(locale, namespace, await loadNamespace(locale, namespace));
}

export async function getMessages(namespaces: readonly Namespace[]) {
  const locale = await getLocale();
  return { locale, messages: await loadNamespaces(locale, namespaces) };
}

export async function getServerFormatter() {
  return getFormatter(await getLocale());
}
