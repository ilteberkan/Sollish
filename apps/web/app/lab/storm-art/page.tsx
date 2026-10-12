import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { StormArtLab } from '@/components/storm/art-lab';

export const metadata: Metadata = { title: 'Fırtına Tahtı sanat galerisi', robots: { index: false, follow: false } };

export default function StormArtPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <StormArtLab />;
}
