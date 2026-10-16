/**
 * Message catalogs: one JSON file per locale and namespace, `messages/<locale>/<namespace>.json`.
 * English (`messages/en`) is the source of truth for keys and types. Every file is reached only through a
 * dynamic import below, so each (locale, namespace) pair is its own chunk: a page ships the namespaces it uses,
 * in the active locale only, and other locales load on demand when the player switches.
 */
import type { Locale } from './config';
import { DEFAULT_LOCALE } from './config';
import type common from '@/messages/en/common.json';
import type lobby from '@/messages/en/lobby.json';
import type slotKit from '@/messages/en/slotKit.json';
import type verify from '@/messages/en/verify.json';

export interface Catalogs { common: typeof common; lobby: typeof lobby; slotKit: typeof slotKit; verify: typeof verify }
export type Namespace = keyof Catalogs;
export const NAMESPACES: readonly Namespace[] = ['common', 'lobby', 'slotKit', 'verify'];

/** Dotted paths to every string leaf of T: "shell.nav.rewards". */
export type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey<N extends Namespace> = Leaves<Catalogs[N]>;

/** A loaded namespace: nested objects whose leaves are ICU-subset strings. */
export type Dictionary = { readonly [key: string]: string | Dictionary };

type Loader = () => Promise<{ default: unknown }>;
/* Explicit table (not a template import) so every bundler emits exactly one chunk per file. */
const LOADERS: Readonly<Record<Locale, Readonly<Record<Namespace, Loader>>>> = {
  en: { common: () => import('@/messages/en/common.json'), lobby: () => import('@/messages/en/lobby.json'), slotKit: () => import('@/messages/en/slotKit.json'), verify: () => import('@/messages/en/verify.json') },
  de: { common: () => import('@/messages/de/common.json'), lobby: () => import('@/messages/de/lobby.json'), slotKit: () => import('@/messages/de/slotKit.json'), verify: () => import('@/messages/de/verify.json') },
  pt: { common: () => import('@/messages/pt/common.json'), lobby: () => import('@/messages/pt/lobby.json'), slotKit: () => import('@/messages/pt/slotKit.json'), verify: () => import('@/messages/pt/verify.json') },
  fr: { common: () => import('@/messages/fr/common.json'), lobby: () => import('@/messages/fr/lobby.json'), slotKit: () => import('@/messages/fr/slotKit.json'), verify: () => import('@/messages/fr/verify.json') },
  it: { common: () => import('@/messages/it/common.json'), lobby: () => import('@/messages/it/lobby.json'), slotKit: () => import('@/messages/it/slotKit.json'), verify: () => import('@/messages/it/verify.json') },
  es: { common: () => import('@/messages/es/common.json'), lobby: () => import('@/messages/es/lobby.json'), slotKit: () => import('@/messages/es/slotKit.json'), verify: () => import('@/messages/es/verify.json') },
  tr: { common: () => import('@/messages/tr/common.json'), lobby: () => import('@/messages/tr/lobby.json'), slotKit: () => import('@/messages/tr/slotKit.json'), verify: () => import('@/messages/tr/verify.json') },
  zh: { common: () => import('@/messages/zh/common.json'), lobby: () => import('@/messages/zh/lobby.json'), slotKit: () => import('@/messages/zh/slotKit.json'), verify: () => import('@/messages/zh/verify.json') },
  ko: { common: () => import('@/messages/ko/common.json'), lobby: () => import('@/messages/ko/lobby.json'), slotKit: () => import('@/messages/ko/slotKit.json'), verify: () => import('@/messages/ko/verify.json') },
};

const isDict = (value: unknown): value is Dictionary => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keys present in `base` but missing (or of the wrong shape) in `override`, as dotted paths. */
export function missingKeys(base: Dictionary, override: unknown, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(base)) {
    const other = isDict(override) ? override[key] : undefined;
    if (typeof value === 'string') { if (typeof other !== 'string') out.push(prefix + key); }
    else out.push(...missingKeys(value, other, `${prefix}${key}.`));
  }
  return out;
}

/** `override` on top of `base`, keeping only keys `base` has (missing keys fall back to English). */
export function withFallback(base: Dictionary, override: unknown): Dictionary {
  const out: Record<string, string | Dictionary> = {};
  for (const [key, value] of Object.entries(base)) {
    const other = isDict(override) ? override[key] : undefined;
    out[key] = typeof value === 'string' ? (typeof other === 'string' ? other : value) : withFallback(value, other);
  }
  return out;
}

const warned = new Set<string>();
function warnMissing(locale: Locale, namespace: Namespace, keys: string[]) {
  if (process.env.NODE_ENV === 'production' || keys.length === 0) return;
  const id = `${locale}:${namespace}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[i18n] ${id} is missing ${keys.length} key(s), English is used: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ' …' : ''}`);
}

const loaded = new Map<string, Promise<Dictionary>>();

/** One namespace in one locale, with English filled in for any missing key. Cached per (locale, namespace). */
export function loadNamespace(locale: Locale, namespace: Namespace): Promise<Dictionary> {
  const id = `${locale}:${namespace}`;
  let promise = loaded.get(id);
  if (!promise) {
    promise = (async () => {
      const base = (await LOADERS[DEFAULT_LOCALE][namespace]()).default as Dictionary;
      if (locale === DEFAULT_LOCALE) return base;
      const own = (await LOADERS[locale][namespace]()).default;
      warnMissing(locale, namespace, missingKeys(base, own));
      return withFallback(base, own);
    })();
    promise.catch(() => loaded.delete(id));
    loaded.set(id, promise);
  }
  return promise;
}

export type LoadedMessages = Partial<Record<Namespace, Dictionary>>;

export async function loadNamespaces(locale: Locale, namespaces: readonly Namespace[]): Promise<LoadedMessages> {
  const entries = await Promise.all(namespaces.map(async ns => [ns, await loadNamespace(locale, ns)] as const));
  return Object.fromEntries(entries) as LoadedMessages;
}
