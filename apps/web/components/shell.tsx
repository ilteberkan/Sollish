'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandMark, Icon } from './icons';
import { useProduct } from './providers';
import { shortAddress } from '@/lib/demo';
import { ChatPanel } from './chat-panel';
import { containDialogFocus } from '@/lib/dialog';
import { useT } from '@/lib/i18n/client';
import { LocaleSwitcher } from './locale-switcher';
const WalletDialog = dynamic(() => import('./wallet-dialog'), { ssr: false });
const devnetConfigured = process.env.NEXT_PUBLIC_COINFLIP_ENABLED === 'true' || process.env.NEXT_PUBLIC_INCENTIVES_ENABLED === 'true';
const links = [{ href: '/live/ringside', label: 'Ringside', icon: 'boxing', live: true }, { href: '/game/crash', label: 'Crash', icon: 'crash' }, { href: '/game/coinflip', label: 'Coinflip', icon: 'coin' }, { href: '/game/cascade', label: 'Candy Cascade', icon: 'candy' }, { href: '/game/tarhun', label: 'Tarhun', icon: 'storm' }, { href: '/game/ebru', label: 'Ebru', icon: 'ink' }, { href: '/game/cezeri', label: 'Cezeri', icon: 'gears' }, { href: '/game/asena', label: 'Asena', icon: 'stars' }, { href: '/rewards', label: 'nav.rewards', icon: 'gift' }, { href: '/stake', label: 'nav.stake', icon: 'stake' }] as const;
/** Game names are brand names and stay as written; the two site sections are translated. */
const NAV_KEYS = { 'nav.rewards': 'shell.nav.rewards', 'nav.stake': 'shell.nav.stake' } as const;
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const arenaFocus = pathname === '/live/ringside';
  const { wallet, walletOpen, setWalletOpen, activeDemo } = useProduct();
  const t = useT('common');
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHidden, setChatHidden] = useState(false);
  // The arena needs the full width for the stage and the bet slip; chat stays one click away.
  useEffect(() => { setChatHidden(arenaFocus); }, [arenaFocus]);
  const chatDialog = useRef<HTMLDialogElement>(null);
  const restoreChat = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (walletOpen) setWalletLoaded(true); }, [walletOpen]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 769px)');
    const closeOnDesktop = () => { if (desktop.matches) setChatOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  useEffect(() => { if (chatOpen && !activeDemo) chatDialog.current?.showModal(); else chatDialog.current?.close(); }, [chatOpen, activeDemo]);
  const openWallet = () => { setWalletLoaded(true); setWalletOpen(true); };
  return <>
    <a className="skip-link" href="#main-content">{t('shell.skipLink')}</a>
    <header className={`site-header ${arenaFocus ? 'arena-header' : ''}`}>
      <Link href="/games" className="brand" aria-label={t('shell.home')} onClick={event => { if (activeDemo) event.preventDefault(); }}><BrandMark/><span>sollish<span className="brand-period">.</span></span></Link>
      <nav className="primary-nav" aria-label={t('shell.primaryNav')}>{links.map(link => <Link key={link.href} href={link.href} prefetch={link.href === '/live/ringside' ? false : undefined} aria-current={pathname === link.href ? 'page' : undefined} aria-disabled={activeDemo && pathname !== link.href} onClick={event => { if (activeDemo && pathname !== link.href) event.preventDefault(); }}>{'live' in link ? <span className="live-dot" aria-hidden="true"/> : <Icon name={link.icon} size={18}/>}{link.label in NAV_KEYS ? t(NAV_KEYS[link.label as keyof typeof NAV_KEYS]) : link.label}{'live' in link && <span className="sr-only">{t('shell.liveSuffix')}</span>}</Link>)}</nav>
      <div className="header-actions"><LocaleSwitcher/><span className="network-label"><span className="status-dot"/>{devnetConfigured ? t('shell.network.devnet') : t('shell.network.demo')}</span><button className="wallet-button" onClick={openWallet} disabled={activeDemo}><Icon name="wallet" size={18}/><span>{wallet ? shortAddress(wallet.address) : t('shell.connectWallet')}</span></button><button className={`icon-button chat-toggle ${chatOpen ? 'selected' : ''}`} aria-label={chatOpen ? t('shell.closeChat') : t('shell.openChat')} aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)} disabled={activeDemo}><Icon name="chat"/></button></div>
    </header>
    <div className={`workspace ${chatHidden ? 'chat-collapsed' : ''} ${arenaFocus ? 'arena-workspace' : ''}`}>
      <main id="main-content" className="main-content" tabIndex={-1}>{children}<footer className="page-footer"><BrandMark/><p>{t('shell.footer.tagline')}</p><span>{devnetConfigured ? t('shell.footer.devnet') : t('shell.footer.demo')}</span></footer></main>
      {!chatHidden && <aside className="desktop-chat" aria-label={t('shell.communityChat')}><ChatPanel onClose={() => { setChatHidden(true); requestAnimationFrame(() => restoreChat.current?.focus()); }} openWallet={openWallet}/></aside>}
      {chatHidden && <button ref={restoreChat} className="restore-chat icon-button" aria-label={t('shell.restoreChat')} onClick={() => setChatHidden(false)}><Icon name="chat"/></button>}
    </div>
    {chatOpen && !activeDemo && <dialog ref={chatDialog} className="mobile-chat-overlay" aria-label={t('shell.communityChat')} onKeyDown={containDialogFocus} onCancel={() => setChatOpen(false)} onClick={event => { if (event.target === chatDialog.current) setChatOpen(false); }}><div className="mobile-chat-panel"><ChatPanel onClose={() => setChatOpen(false)} openWallet={() => { setChatOpen(false); openWallet(); }}/></div></dialog>}
    {(walletLoaded || walletOpen) && <WalletDialog/>}
  </>;
}
