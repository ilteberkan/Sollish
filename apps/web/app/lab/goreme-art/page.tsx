import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { GoremeArtLab } from '@/components/goreme/art-lab';

export const metadata: Metadata = { title: 'Göreme sanat galerisi', robots: { index: false, follow: false } };

export default function GoremeArtPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <GoremeArtLab />;
}
