import type { Metadata } from 'next';
import { AsenaGame } from '@/components/asena/asena-game';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('asena');
  return { title: t('meta.title'), description: t('meta.description') };
}
export default function Page() { return <I18nMessages namespaces={['asena']}><AsenaGame /></I18nMessages>; }
