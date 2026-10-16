import { INTL_LOCALE, type Locale } from './config';
import type { Dictionary, MessageKey, Namespace } from './catalog';
import { formatMessage, splitTags, type MessageVars } from './message-format';

export interface Translator<N extends Namespace> {
  (key: MessageKey<N>, vars?: MessageVars): string;
  /** Rich text: `<tag>chunk</tag>` pairs in the message are mapped through `tags` (flat, no nesting). */
  rich<T>(key: MessageKey<N>, tags: Readonly<Record<string, (chunk: string) => T>>, vars?: MessageVars): Array<string | T>;
  /** True when the key exists (useful for optional per-game copy). */
  has(key: string): boolean;
  readonly locale: Locale;
  readonly namespace: N;
}

const warned = new Set<string>();
function warnOnce(id: string, text: string) {
  if (process.env.NODE_ENV === 'production' || warned.has(id)) return;
  warned.add(id);
  console.warn(text);
}

function lookup(dict: Dictionary | undefined, key: string): string | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Translator for one namespace. A missing key returns "namespace.key" (and warns once in development);
 * a malformed message returns its raw text instead of throwing during render.
 */
export function createTranslator<N extends Namespace>(locale: Locale, namespace: N, dict: Dictionary | undefined): Translator<N> {
  const intl = INTL_LOCALE[locale];
  const text = (key: string, vars?: MessageVars): string => {
    const source = lookup(dict, key);
    if (source === undefined) {
      warnOnce(`${locale}:${namespace}:${key}`, dict ? `[i18n] Missing key ${namespace}.${key} (${locale})` : `[i18n] Namespace "${namespace}" is not loaded for ${locale}; wrap the page in <I18nMessages namespaces={['${namespace}']}>`);
      return `${namespace}.${key}`;
    }
    try { return formatMessage(source, intl, vars); } catch (error) {
      warnOnce(`${locale}:${namespace}:${key}:syntax`, `[i18n] ${(error as Error).message}`);
      return source;
    }
  };
  const t = ((key: MessageKey<N>, vars?: MessageVars) => text(key, vars)) as Translator<N>;
  t.rich = (key, tags, vars) => splitTags(text(key, vars), tags);
  t.has = key => lookup(dict, key) !== undefined;
  Object.defineProperty(t, 'locale', { value: locale });
  Object.defineProperty(t, 'namespace', { value: namespace });
  return t;
}
