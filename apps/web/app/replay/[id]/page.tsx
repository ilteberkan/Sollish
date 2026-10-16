import type { Metadata } from 'next';
import { ReplayView } from '@/components/replay-view';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('verify');
  return { title: t('replay.metaTitle'), description: t('replay.metaDescription'), robots: { index: false, follow: false } };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <I18nMessages namespaces={['verify']}><ReplayView id={id} /></I18nMessages>;
}
