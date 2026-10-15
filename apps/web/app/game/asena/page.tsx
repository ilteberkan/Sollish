import type { Metadata } from 'next';
import { AsenaGame } from '@/components/asena/asena-game';
export const metadata: Metadata = { title: 'Asena: Yıldız Kurdu', description: 'Asena: Yıldız Kurdu — özgün DEMO küme oyunu. Kümeler gökte takımyıldız çizer, Gök Kurt yürüyüp yıldız izi bırakır; Ergenekon haritası genel çarpanı ×5’e kadar açar.' };
export default function Page() { return <AsenaGame />; }
