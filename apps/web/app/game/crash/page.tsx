import type { Metadata } from 'next';
import { CrashGame } from '@/components/crash-game';
export const metadata: Metadata = { title: 'Crash' };
export default function Page() { return <CrashGame/>; }
