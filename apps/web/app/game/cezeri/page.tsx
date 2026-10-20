import type { Metadata } from 'next';
import { CezeriGame } from '@/components/cezeri/cezeri-game';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('cezeri');
  return { title: t('meta.title'), description: t('meta.description') };
}
export default function Page() { return <I18nMessages namespaces={['cezeri']}><CezeriGame /></I18nMessages>; }
