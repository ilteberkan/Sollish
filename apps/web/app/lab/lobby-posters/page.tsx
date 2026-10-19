import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PosterLab } from '@/components/lobby/poster-lab';

export const metadata: Metadata = { title: 'Lobby posters', robots: { index: false, follow: false } };

export default function LobbyPostersPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PosterLab />;
}
