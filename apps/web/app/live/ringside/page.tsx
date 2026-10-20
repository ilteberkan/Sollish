import type { Metadata } from 'next';
import { RingsideArena } from '@/components/ringside-arena';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('ringside');
  return { title: t('meta.title'), description: t('meta.description') };
}
export default function Page() { return <I18nMessages namespaces={['ringside']}><RingsideArena/></I18nMessages>; }
