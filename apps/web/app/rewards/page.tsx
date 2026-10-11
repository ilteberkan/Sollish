import type { Metadata } from 'next';
import { RewardsPage } from '@/components/rewards-page';
export const metadata: Metadata = { title: 'Ödüller' };
export default function Page() { return <RewardsPage/>; }
