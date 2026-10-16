import type { Metadata } from 'next';
import { VerifyPanel } from '@/components/verify-panel';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('verify');
  return { title: t('verify.metaTitle'), description: t('verify.metaDescription') };
}
export default function Page() { return <I18nMessages namespaces={['verify']}><VerifyPanel /></I18nMessages>; }
