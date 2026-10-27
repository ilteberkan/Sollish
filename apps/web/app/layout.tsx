import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/components/providers';
import { Shell } from '@/components/shell';
import { HTML_LANG, localeDir } from '@/lib/i18n/config';
import { getLocale, getMessages, getTranslator } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';
import { LOBBY_HEAD_SCRIPT } from '@/lib/lobby/keys';
import './globals.css';
import './shell.css';
// Fonts are local OFL woff2 files (public/fonts/LICENSE-notes.md). next/font/local has no unicode-range per file, so the
// latin and latin-ext subsets are separate families; globals.css stacks them (plus a CJK system stack for zh/ko) into
// `--font-sans` (IBM Plex Sans, UI) and `--font-accent` (Playfair Display italic, one-word headline accent).
// `--font-barlow-face` stays for game art lettering (logos, symbols, boards) that is part of each game's own look.
// No generated metric fallback on the latin faces: it would sit between latin and latin-ext and draw ş/ğ/İ in Arial.
const plex = localFont({ src: [
  { path: '../public/fonts/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../public/fonts/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
  { path: '../public/fonts/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  { path: '../public/fonts/ibm-plex-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
], variable: '--font-plex-face', display: 'swap', adjustFontFallback: false });
const plexExt = localFont({ src: [
  { path: '../public/fonts/ibm-plex-sans-latin-ext-400-normal.woff2', weight: '400', style: 'normal' },
  { path: '../public/fonts/ibm-plex-sans-latin-ext-500-normal.woff2', weight: '500', style: 'normal' },
  { path: '../public/fonts/ibm-plex-sans-latin-ext-600-normal.woff2', weight: '600', style: 'normal' },
  { path: '../public/fonts/ibm-plex-sans-latin-ext-700-normal.woff2', weight: '700', style: 'normal' },
], variable: '--font-plex-ext-face', display: 'swap', preload: false, adjustFontFallback: false });
const playfair = localFont({ src: [
  { path: '../public/fonts/playfair-display-latin-600-italic.woff2', weight: '600', style: 'italic' },
  { path: '../public/fonts/playfair-display-latin-700-italic.woff2', weight: '700', style: 'italic' },
], variable: '--font-playfair-face', display: 'swap', preload: false, adjustFontFallback: false });
const playfairExt = localFont({ src: [
  { path: '../public/fonts/playfair-display-latin-ext-600-italic.woff2', weight: '600', style: 'italic' },
  { path: '../public/fonts/playfair-display-latin-ext-700-italic.woff2', weight: '700', style: 'italic' },
], variable: '--font-playfair-ext-face', display: 'swap', preload: false, adjustFontFallback: false });
const barlow = localFont({ src: [
  { path: '../public/fonts/Barlow-Regular.woff2', weight: '400', style: 'normal' },
  { path: '../public/fonts/Barlow-Medium.woff2', weight: '500', style: 'normal' },
  { path: '../public/fonts/Barlow-SemiBold.woff2', weight: '600', style: 'normal' },
], variable: '--font-barlow-face', display: 'swap', preload: false });
const fontVars = `${plex.variable} ${plexExt.variable} ${playfair.variable} ${playfairExt.variable} ${barlow.variable}`;
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator('common');
  return { title: { default: t('meta.title'), template: '%s · Sollish' }, description: t('meta.description'), robots: { index: false, follow: false } };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#000000' };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const { messages } = await getMessages(['common']);
  // The head script only adds data-sidebar / data-recent to <html> before paint (per-browser layout preferences).
  return <html lang={HTML_LANG[locale]} dir={localeDir(locale)} className={fontVars} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: LOBBY_HEAD_SCRIPT }} /></head><body><I18nProvider locale={locale} messages={messages}><Providers><Shell>{children}</Shell></Providers></I18nProvider></body></html>;
}
