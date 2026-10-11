import type { Metadata } from 'next';
import { StakePage } from '@/components/stake-page';
export const metadata: Metadata = { title: 'Stake' };
export default function Page() { return <StakePage/>; }
