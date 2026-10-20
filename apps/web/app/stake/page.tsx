import type { Metadata } from 'next';
import { StakePage } from '@/components/stake-page';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslator('incentives'); return { title: t('stakePage.title') }; }
export default function Page() { return <I18nMessages namespaces={['incentives']}><StakePage/></I18nMessages>; }
