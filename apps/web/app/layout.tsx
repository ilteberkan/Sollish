import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/components/providers';
import { Shell } from '@/components/shell';
import { HTML_LANG, localeDir } from '@/lib/i18n/config';
import { getLocale, getMessages, getTranslator } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';
import './globals.css';
// `--font-barlow-face` is only the Barlow face; globals.css builds `--font-barlow` from it plus a per-language
// fallback stack (CJK system fonts for zh/ko), so every `var(--font-barlow)` in the app gets the right glyphs.
const barlow = localFont({ src: [
  { path: '../public/fonts/Barlow-Regular.woff2', weight: '400', style: 'normal' },
  { path: '../public/fonts/Barlow-Medium.woff2', weight: '500', style: 'normal' },
  { path: '../public/fonts/Barlow-SemiBold.woff2', weight: '600', style: 'normal' },
], variable: '--font-barlow-face', display: 'swap' });
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('common');
  return { title: { default: t('meta.title'), template: '%s · Sollish' }, description: t('meta.description'), robots: { index: false, follow: false } };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#10171F' };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const { messages } = await getMessages(['common']);
  return <html lang={HTML_LANG[locale]} dir={localeDir(locale)} className={barlow.variable}><body><I18nProvider locale={locale} messages={messages}><Providers><Shell>{children}</Shell></Providers></I18nProvider></body></html>;
}
