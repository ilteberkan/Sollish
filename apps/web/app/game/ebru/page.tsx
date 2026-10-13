import type { Metadata } from 'next';
import { EbruGame } from '@/components/ebru/ebru-game';
export const metadata: Metadata = { title: 'Ebru: Mürekkep Bahçesi', description: 'Ebru: Mürekkep Bahçesi — özgün DEMO küme oyunu. Tarak suyu tarar, mürekkep yeniden dizilir; Lale Ebrusu’nda boya lekeleri çarpanla birlikte kayar.' };
export default function Page() { return <EbruGame />; }
