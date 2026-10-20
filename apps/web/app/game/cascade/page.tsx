import type { Metadata } from 'next';
import { CascadeGame } from '@/components/cascade/cascade-game';
import { I18nMessages } from '@/lib/i18n/messages';
import { getTranslator } from '@/lib/i18n/server';
export async function generateMetadata(): Promise<Metadata> {
  const tc = await getTranslator('common');
  return { title: tc('games.cascade') };
}
export default function Page() { return <I18nMessages namespaces={['cascade']}><CascadeGame/></I18nMessages>; }
