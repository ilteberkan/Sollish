import type { Metadata } from 'next';
import { CoinflipGame } from '@/components/coinflip-game';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslator('common'); return { title: t('games.coinflip') }; }
export default function Page() { return <I18nMessages namespaces={['coinflip']}><CoinflipGame/></I18nMessages>; }
