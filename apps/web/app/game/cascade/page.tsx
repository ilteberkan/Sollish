import type { Metadata } from 'next';
import { CascadeGame } from '@/components/cascade/cascade-game';
export const metadata: Metadata = { title: 'Candy Cascade' };
export default function Page() { return <CascadeGame/>; }
