import { Fragment, type ReactNode } from 'react';
import type { MessageKey, Namespace } from '@/lib/i18n/catalog';
import type { Translator } from '@/lib/i18n/translator';
import type { MessageVars } from '@/lib/i18n/message-format';

/**
 * Rich text for game copy: `<b>…</b>` -> <strong>, `<bold>…</bold>` -> <b>, `<code>…</code>` -> <code>, `<kbd>…</kbd>` -> <kbd>.
 * The translation can only choose among these tags; anything else is plain text (see splitTags).
 */
export function richText<N extends Namespace>(t: Translator<N>, key: MessageKey<N>, vars?: MessageVars): ReactNode {
  const parts = t.rich(key, { b: chunk => <strong>{chunk}</strong>, bold: chunk => <b>{chunk}</b>, code: chunk => <code>{chunk}</code>, kbd: chunk => <kbd>{chunk}</kbd> }, vars);
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}
