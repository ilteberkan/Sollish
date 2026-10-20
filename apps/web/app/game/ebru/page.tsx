import type { Metadata } from 'next';
import { EbruGame } from '@/components/ebru/ebru-game';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const [t, tc] = await Promise.all([getTranslator('ebru'), getTranslator('common')]);
  const title = tc('games.ebru');
  return { title, description: t('meta.description', { title }) };
}
export default function Page() { return <I18nMessages namespaces={['ebru']}><EbruGame /></I18nMessages>; }
