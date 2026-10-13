import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CezeriArtLab } from '@/components/cezeri/art-lab';

export const metadata: Metadata = { title: 'Cezeri sanat galerisi', robots: { index: false, follow: false } };

export default function CezeriArtPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <CezeriArtLab />;
}
