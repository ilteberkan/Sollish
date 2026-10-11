import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { SlotKitLab } from '@/components/slot-kit/lab-demo';

export const metadata: Metadata = { title: 'Slot kiti', robots: { index: false, follow: false } };

export default function SlotKitLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SlotKitLab />;
}
