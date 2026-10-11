import type { Metadata } from 'next';
import { RingsideArena } from '@/components/ringside-arena';
export const metadata: Metadata = { title: 'Ringside · Canlı', description: 'Maç içinde öğrenen iki dövüşçü ve canlı Jev köşe planları; her rauntta ayrı demo havuzları ve canlı işlem defteri.' };
export default function Page(){return <RingsideArena/>;}
