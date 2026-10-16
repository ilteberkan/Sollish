'use client';
/**
 * Client side of the i18n layer. The root layout renders <I18nProvider> with the locale the server resolved
 * and the `common` namespace; pages add namespaces with the server component <I18nMessages>, which renders
 * <I18nMessagesClient>. A language change loads the needed namespaces for the new locale (one chunk each),
 * re-renders client components in place, updates <html lang/dir>, fires the `sollish:locale` event and
 * refreshes Server Components (router.refresh keeps client state: open dialogs, a running round, etc.).
 */
import { createContext, startTransition, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_LOCALE, HTML_LANG, isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_EVENT, LOCALE_STORAGE_KEY, localeDir, type Locale } from './config';
import { loadNamespace, type Dictionary, type LoadedMessages, type Namespace } from './catalog';
import { createTranslator, type Translator } from './translator';
import { getFormatter, type Formatter } from './format';

interface I18nContextValue {
  locale: Locale;
  /** True while the namespaces of a newly chosen locale are loading. */
  pending: boolean;
  setLocale: (next: Locale) => Promise<void>;
  dictionary: (locale: Locale, namespace: Namespace) => Dictionary | undefined;
  seed: (locale: Locale, messages: LoadedMessages) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookie(): string | null {
  try {
    const match = document.cookie.split('; ').find(part => part.startsWith(`${LOCALE_COOKIE}=`));
    return match ? decodeURIComponent(match.slice(LOCALE_COOKIE.length + 1)) : null;
  } catch { return null; }
}
function writeChoice(locale: Locale) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {}
  try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch {}
}

export function I18nProvider({ locale: serverLocale, messages, children }: { locale: Locale; messages: LoadedMessages; children: ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(serverLocale);
  const [pending, setPending] = useState(false);
  const store = useRef(new Map<string, Dictionary>());
  const namespaces = useRef(new Set<Namespace>());
  const request = useRef(0);

  const seed = useCallback((at: Locale, loaded: LoadedMessages) => {
    for (const [ns, dict] of Object.entries(loaded) as Array<[Namespace, Dictionary | undefined]>) {
      if (!dict) continue;
      namespaces.current.add(ns);
      if (!store.current.has(`${at}:${ns}`)) store.current.set(`${at}:${ns}`, dict);
    }
  }, []);
  // Idempotent cache fill during render, so the very first render (SSR and hydration) already has the text.
  seed(serverLocale, messages);

  // A server render with another locale (another tab changed the cookie, then a refresh) wins.
  useEffect(() => { setLocaleState(serverLocale); }, [serverLocale]);

  const setLocale = useCallback(async (next: Locale) => {
    if (!isLocale(next)) return;
    const id = ++request.current;
    writeChoice(next);
    setPending(true);
    try {
      await Promise.all([...namespaces.current].map(async ns => {
        const dict = await loadNamespace(next, ns);
        if (!store.current.has(`${next}:${ns}`)) store.current.set(`${next}:${ns}`, dict);
      }));
    } catch {
      // Offline or a missing chunk: the server render below still delivers the text.
    }
    if (id !== request.current) return;
    setLocaleState(next);
    setPending(false);
    startTransition(() => router.refresh());
  }, [router]);

  // <html lang/dir> follow the rendered locale; listeners hear about every change after the first paint.
  const announced = useRef<Locale>(serverLocale);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = HTML_LANG[locale];
    root.dir = localeDir(locale);
    if (announced.current === locale) return;
    announced.current = locale;
    window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: { locale } }));
  }, [locale]);

  // Keep the localStorage mirror in sync; restore an explicit choice whose cookie is gone.
  useEffect(() => {
    const cookie = readCookie();
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch {}
    if (isLocale(cookie)) { if (stored !== cookie) try { window.localStorage.setItem(LOCALE_STORAGE_KEY, cookie); } catch {} }
    else if (isLocale(stored)) { if (stored !== serverLocale) void setLocale(stored); else writeChoice(stored); }
    // Runs once on mount; later changes go through setLocale.
  }, []);

  const dictionary = useCallback((at: Locale, ns: Namespace) => store.current.get(`${at}:${ns}`), []);
  const value = useMemo<I18nContextValue>(() => ({ locale, pending, setLocale, dictionary, seed }), [locale, pending, setLocale, dictionary, seed]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

/** Adds server-loaded namespaces for its subtree (rendered by the server component <I18nMessages>). */
export function I18nMessagesClient({ locale, messages, children }: { locale: Locale; messages: LoadedMessages; children: ReactNode }) {
  const context = useContext(I18nContext);
  context?.seed(locale, messages);
  return <>{children}</>;
}

const FALLBACK: I18nContextValue = { locale: DEFAULT_LOCALE, pending: false, setLocale: async () => {}, dictionary: () => undefined, seed: () => {} };
function useI18nContext(): I18nContextValue {
  return useContext(I18nContext) ?? FALLBACK;
}

/** Current locale and the switch function. */
export function useLocale(): { locale: Locale; setLocale: (next: Locale) => Promise<void>; pending: boolean } {
  const { locale, setLocale, pending } = useI18nContext();
  return { locale, setLocale, pending };
}

/** Typed translator for one namespace: `const t = useT('slotKit'); t('bet.label')`. */
export function useT<N extends Namespace>(namespace: N): Translator<N> {
  const { locale, dictionary } = useI18nContext();
  const dict = dictionary(locale, namespace) ?? (locale === DEFAULT_LOCALE ? undefined : dictionary(DEFAULT_LOCALE, namespace));
  return useMemo(() => createTranslator(locale, namespace, dict), [locale, namespace, dict]);
}

/** Locale-bound number/amount/time formatting. */
export function useFormat(): Formatter {
  return getFormatter(useI18nContext().locale);
}
