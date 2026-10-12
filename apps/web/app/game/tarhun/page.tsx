import type { Metadata } from 'next';
import { TarhunGame } from '@/components/storm/tarhun-game';
export const metadata: Metadata = { title: 'Tarhun: Fırtına Tahtı', description: 'Tarhun: Fırtına Tahtı — özgün DEMO tumble oyunu. Fırtına tanrısı taşlara yıldırım atar, çarpanlar bedava dönüşte birikir.' };
export default function Page() { return <TarhunGame />; }
