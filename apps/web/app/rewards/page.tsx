import type { Metadata } from 'next';
import { RewardsPage } from '@/components/rewards-page';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslator('incentives'); return { title: t('rewardsPage.title') }; }
export default function Page() { return <I18nMessages namespaces={['incentives']}><RewardsPage/></I18nMessages>; }
