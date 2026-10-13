import type { Metadata } from 'next';
import { VerifyPanel } from '@/components/verify-panel';
export const metadata: Metadata = { title: 'Tur doğrulama', description: 'Sunucu doğrulamalı DEMO slot turlarını açıklanan tohumla tarayıcında yeniden hesapla.' };
export default function Page() { return <VerifyPanel />; }
