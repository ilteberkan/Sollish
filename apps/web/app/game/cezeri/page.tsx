import type { Metadata } from 'next';
import { CezeriGame } from '@/components/cezeri/cezeri-game';
export const metadata: Metadata = { title: 'Cezeri: Zamanın Çarkları', description: 'Cezeri: Zamanın Çarkları — özgün DEMO çark oyunu. Kazanan dilimler kenetlenir, dört pirinç çark yeniden döner, göbek çarpanı her turda +1 atar; Fil Saati’nde göbek korunur ve otomat şahin joker bırakır.' };
export default function Page() { return <CezeriGame />; }
