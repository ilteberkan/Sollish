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
const WalletDialog = dynamic(() => import('./wallet-dialog'), { ssr: false });
const devnetConfigured = process.env.NEXT_PUBLIC_COINFLIP_ENABLED === 'true' || process.env.NEXT_PUBLIC_INCENTIVES_ENABLED === 'true';
const links = [{ href: '/live/ringside', label: 'Ringside', icon: 'boxing', live: true }, { href: '/game/crash', label: 'Crash', icon: 'crash' }, { href: '/game/coinflip', label: 'Coinflip', icon: 'coin' }, { href: '/game/cascade', label: 'Candy Cascade', icon: 'candy' }, { href: '/rewards', label: 'Ödüller', icon: 'gift' }, { href: '/stake', label: 'Stake', icon: 'stake' }];
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const arenaFocus = pathname === '/live/ringside';
  const { wallet, walletOpen, setWalletOpen, activeDemo } = useProduct();
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
    <a className="skip-link" href="#main-content">Oyun alanına geç</a>
    <header className={`site-header ${arenaFocus ? 'arena-header' : ''}`}>
      <Link href="/games" className="brand" aria-label="Sollish ana sayfa" onClick={event => { if (activeDemo) event.preventDefault(); }}><BrandMark/><span>sollish<span className="brand-period">.</span></span></Link>
      <nav className="primary-nav" aria-label="Ana gezinme">{links.map(link => <Link key={link.href} href={link.href} prefetch={link.href === '/live/ringside' ? false : undefined} aria-current={pathname === link.href ? 'page' : undefined} aria-disabled={activeDemo && pathname !== link.href} onClick={event => { if (activeDemo && pathname !== link.href) event.preventDefault(); }}>{'live' in link ? <span className="live-dot" aria-hidden="true"/> : <Icon name={link.icon} size={18}/>}{link.label}{'live' in link && <span className="sr-only"> (canlı)</span>}</Link>)}</nav>
      <div className="header-actions"><span className="network-label"><span className="status-dot"/>{devnetConfigured ? 'Devnet önizleme' : 'Demo önizleme'}</span><button className="wallet-button" onClick={openWallet} disabled={activeDemo}><Icon name="wallet" size={18}/><span>{wallet ? shortAddress(wallet.address) : 'Cüzdan bağla'}</span></button><button className={`icon-button chat-toggle ${chatOpen ? 'selected' : ''}`} aria-label={chatOpen ? 'Chat’i kapat' : 'Chat’i aç'} aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)} disabled={activeDemo}><Icon name="chat"/></button></div>
    </header>
    <div className={`workspace ${chatHidden ? 'chat-collapsed' : ''} ${arenaFocus ? 'arena-workspace' : ''}`}>
      <main id="main-content" className="main-content" tabIndex={-1}>{children}<footer className="page-footer"><BrandMark/><p>Oyunu anla. Kontrol sende kalsın.</p><span>{devnetConfigured ? 'Demo ve devnet · Gerçek para kullanılmaz' : 'Demo · Gerçek varlık kullanılmaz'}</span></footer></main>
      {!chatHidden && <aside className="desktop-chat" aria-label="Topluluk sohbeti"><ChatPanel onClose={() => { setChatHidden(true); requestAnimationFrame(() => restoreChat.current?.focus()); }} openWallet={openWallet}/></aside>}
      {chatHidden && <button ref={restoreChat} className="restore-chat icon-button" aria-label="Chat panelini aç" onClick={() => setChatHidden(false)}><Icon name="chat"/></button>}
    </div>
    {chatOpen && !activeDemo && <dialog ref={chatDialog} className="mobile-chat-overlay" aria-label="Topluluk sohbeti" onKeyDown={containDialogFocus} onCancel={() => setChatOpen(false)} onClick={event => { if (event.target === chatDialog.current) setChatOpen(false); }}><div className="mobile-chat-panel"><ChatPanel onClose={() => setChatOpen(false)} openWallet={() => { setChatOpen(false); openWallet(); }}/></div></dialog>}
    {(walletLoaded || walletOpen) && <WalletDialog/>}
  </>;
}
