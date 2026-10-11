import type { Metadata } from 'next';
import { CoinflipGame } from '@/components/coinflip-game';
export const metadata: Metadata = { title: 'Coinflip' };
export default function Page() { return <CoinflipGame/>; }
