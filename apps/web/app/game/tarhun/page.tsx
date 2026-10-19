import type { Metadata } from 'next';
import { TarhunGame } from '@/components/storm/tarhun-game';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const [t, tc] = await Promise.all([getTranslator('tarhun'), getTranslator('common')]);
  const title = tc('games.tarhun');
  return { title, description: t('meta.description', { title }) };
}
export default function Page() { return <I18nMessages namespaces={['tarhun']}><TarhunGame /></I18nMessages>; }
