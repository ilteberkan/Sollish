/**
 * Server component: loads namespaces for the request locale and hands them to the client subtree.
 *   <I18nMessages namespaces={['slotKit']}><TarhunGame /></I18nMessages>
 * Only the active locale is serialized into the page; other locales load as separate chunks on a switch.
 */
import type { ReactNode } from 'react';
import type { Namespace } from './catalog';
import { getMessages } from './server';
import { I18nMessagesClient } from './client';

export async function I18nMessages({ namespaces, children }: { namespaces: readonly Namespace[]; children: ReactNode }) {
  const { locale, messages } = await getMessages(namespaces);
  return <I18nMessagesClient locale={locale} messages={messages}>{children}</I18nMessagesClient>;
}
