import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { EbruArtLab } from '@/components/ebru/art-lab';
import { I18nMessages } from '@/lib/i18n/messages';

export const metadata: Metadata = { title: 'Ebru sanat galerisi', robots: { index: false, follow: false } };

export default function EbruArtPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <I18nMessages namespaces={['ebru']}><EbruArtLab /></I18nMessages>;
}
