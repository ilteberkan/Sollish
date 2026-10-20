import type { Metadata } from 'next';
import { getTranslator } from '@/lib/i18n/server';
import { LobbyPage } from '@/components/lobby/lobby-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('lobby');
  return { title: t('meta.title'), description: t('meta.description') };
}
/** `/` is the lobby (no redirect round trip); `/games` serves the same page for existing links. */
export default function Home() { return <LobbyPage />; }
