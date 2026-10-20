import type { Metadata } from 'next';
import { CrashGame } from '@/components/crash-game';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslator('common'); return { title: t('games.crash') }; }
export default function Page() { return <I18nMessages namespaces={['crash']}><CrashGame/></I18nMessages>; }
