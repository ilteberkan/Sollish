import type { Metadata } from 'next';
import { getTranslator } from '@/lib/i18n/server';
import { LobbyPage } from '@/components/lobby/lobby-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('lobby');
  return { title: t('meta.title'), description: t('meta.description'), alternates: { canonical: '/' } };
}
/** Same lobby as `/` (older links, slot "quit" buttons and tests use /games). */
export default function Games() { return <LobbyPage />; }
