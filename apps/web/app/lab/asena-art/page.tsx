import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AsenaArtLab } from '@/components/asena/art-lab';

export const metadata: Metadata = { title: 'Asena sanat galerisi', robots: { index: false, follow: false } };

export default function AsenaArtPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AsenaArtLab />;
}
