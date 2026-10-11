import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/components/providers';
import { Shell } from '@/components/shell';
import './globals.css';
const barlow = localFont({ src: [
  { path: '../public/fonts/Barlow-Regular.woff2', weight: '400', style: 'normal' },
  { path: '../public/fonts/Barlow-Medium.woff2', weight: '500', style: 'normal' },
  { path: '../public/fonts/Barlow-SemiBold.woff2', weight: '600', style: 'normal' },
], variable: '--font-barlow', display: 'swap' });
export const metadata: Metadata = { title: { default: 'Sollish — Oyun sende', template: '%s · Sollish' }, description: 'Sollish özgün oyun alanı: Ringside canlı boks, Crash ve Coinflip. Yerel demoda gerçek para veya token kullanılmaz.', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#10171F' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="tr" className={barlow.variable}><body><Providers><Shell>{children}</Shell></Providers></body></html>; }
