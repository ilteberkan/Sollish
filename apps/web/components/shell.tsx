'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { BrandMark, Icon } from './icons';
import { useProduct } from './providers';
import { shortAddress } from '@/lib/demo';
import { ChatPanel } from './chat-panel';
import { containDialogFocus } from '@/lib/dialog';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import { LocaleSwitcher } from './locale-switcher';
import { ShellSearch } from './shell-search';
import { LOBBY_GAMES, gameForPath, isLobbyCategory, type LobbyCategory } from '@/lib/lobby/games';
import { recordRecentGame, setLobbyQuery, setSidebarPref, useSidebarPref } from '@/lib/lobby/store';
const WalletDialog = dynamic(() => import('./wallet-dialog'), { ssr: false });
const devnetConfigured = process.env.NEXT_PUBLIC_COINFLIP_ENABLED === 'true' || process.env.NEXT_PUBLIC_INCENTIVES_ENABLED === 'true';

/* Route kinds: browse pages get the full sidebar and (on phones) the bottom tab bar; game pages default to the icon
   rail and leave the bottom of the screen to the game's own controls. */
type RouteKind = 'browse' | 'game';
const isLobbyPath = (path: string) => path === '/' || path === '/games';
const routeKind = (path: string): RouteKind => (path.startsWith('/game/') || path.startsWith('/live/') ? 'game' : 'browse');

type Category = Exclude<LobbyCategory, 'all' | 'favorites'>;
const CATEGORY_LINKS: ReadonlyArray<{ category: Category; icon: string; label: MessageKey<'common'> }> = [
  { category: 'slots', icon: 'slots', label: 'shell.nav.slots' },
  { category: 'live', icon: 'broadcast', label: 'shell.nav.live' },
  { category: 'instant', icon: 'bolt', label: 'shell.nav.instant' },
  { category: 'new', icon: 'spark', label: 'shell.nav.new' },
];
const MORE_LINKS: ReadonlyArray<{ href: string; icon: string; label: MessageKey<'common'> }> = [
  { href: '/verify', icon: 'shield', label: 'shell.nav.fair' },
  { href: '/rewards', icon: 'gift', label: 'shell.nav.rewards' },
  { href: '/stake', icon: 'stake', label: 'shell.nav.stake' },
];
/* Sidebar game order: live first, then instant, then the slots. Names are brand names and stay as written. */
const NAV_GAMES = ['ringside', 'crash', 'coinflip', 'cascade', 'tarhun', 'ebru', 'cezeri', 'asena'].map(id => LOBBY_GAMES.find(g => g.id === id)!);

/** Same-page category switch: on the lobby a category link only rewrites the URL (no server round trip). */
function lobbyHref(pathname: string, category: LobbyCategory) {
  const base = isLobbyPath(pathname) ? pathname : '/';
  return category === 'all' ? base : `${base}?c=${category}`;
}

function SideNavLinks({ pathname, category, locked, onNavigate, onTip }: { pathname: string; category: LobbyCategory | null; locked: boolean; onNavigate?: () => void; onTip?: (text: string | null, el?: HTMLElement) => void }) {
  const t = useT('common');
  const onLobby = isLobbyPath(pathname);
  const guard = (href: string, inPlace: boolean) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (locked && href !== pathname) { event.preventDefault(); return; }
    if (inPlace && onLobby && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); window.history.pushState(null, '', href); }
    onNavigate?.();
  };
  const tip = (label: string) => ({ onPointerEnter: (e: MouseEvent<HTMLElement>) => onTip?.(label, e.currentTarget), onPointerLeave: () => onTip?.(null), onFocus: (e: React.FocusEvent<HTMLElement>) => onTip?.(label, e.currentTarget), onBlur: () => onTip?.(null) });
  const item = (href: string, icon: ReactNode, label: string, current: boolean, inPlace = false, extra?: ReactNode, prefetch?: false) => (
    <li key={href}><Link href={href} prefetch={prefetch} scroll={!inPlace} className="sb-link" aria-current={current ? 'page' : undefined} aria-disabled={locked && !current ? true : undefined} onClick={guard(href, inPlace)} {...tip(label)}>
      {icon}<span className="sb-label">{label}</span>{extra}
    </Link></li>
  );
  return <>
    <ul className="sb-list">{item(lobbyHref(pathname, 'all'), <Icon name="home" size={20} />, t('shell.nav.lobby'), onLobby && (category === null || category === 'all'), true)}</ul>
    <p className="sb-heading">{t('shell.sections.casino')}</p>
    <ul className="sb-list">{CATEGORY_LINKS.map(link => item(lobbyHref(pathname, link.category), <Icon name={link.icon} size={20} />, t(link.label), onLobby && category === link.category, true))}</ul>
    <p className="sb-heading">{t('shell.sections.games')}</p>
    <ul className="sb-list">{NAV_GAMES.map(game => item(game.href,
      game.kind === 'live' ? <span className="sb-game-icon" data-live=""><span className="live-dot" aria-hidden="true" /></span> : <span className="sb-game-icon" style={{ background: `linear-gradient(135deg, ${game.tone[0]}, ${game.tone[1]})` }}><Icon name={game.icon} size={15} /></span>,
      game.short, pathname === game.href, false, game.kind === 'live' ? <span className="sr-only">{t('shell.liveSuffix')}</span> : undefined, game.kind === 'live' ? false : undefined))}</ul>
    <p className="sb-heading">{t('shell.sections.more')}</p>
    <ul className="sb-list">{MORE_LINKS.map(link => item(link.href, <Icon name={link.icon} size={20} />, t(link.label), pathname === link.href))}</ul>
  </>;
}

/** Reads ?c= for aria-current; the Suspense fallback renders the same links without a current category. */
function SideNav(props: { pathname: string; locked: boolean; onNavigate?: () => void; onTip?: (text: string | null, el?: HTMLElement) => void }) {
  return <Suspense fallback={<SideNavLinks {...props} category={null} />}><SideNavWithParams {...props} /></Suspense>;
}
function SideNavWithParams(props: { pathname: string; locked: boolean; onNavigate?: () => void; onTip?: (text: string | null, el?: HTMLElement) => void }) {
  const c = useSearchParams().get('c');
  return <SideNavLinks {...props} category={isLobbyCategory(c) ? c : null} />;
}
function TabBarWithParams({ pathname, onSearch, onMenu, searchOpen, menuOpen, locked }: { pathname: string; onSearch: () => void; onMenu: () => void; searchOpen: boolean; menuOpen: boolean; locked: boolean }) {
  const c = useSearchParams().get('c');
  const t = useT('common');
  const onLobby = isLobbyPath(pathname);
  const link = (category: LobbyCategory, icon: string, label: string) => {
    const href = lobbyHref(pathname, category);
    const current = onLobby && !searchOpen && !menuOpen && ((category === 'all' && !isLobbyCategory(c)) || c === category);
    return <Link href={href} scroll={false} className="tab" aria-current={current ? 'page' : undefined} aria-disabled={locked || undefined}
      onClick={event => { if (locked) { event.preventDefault(); return; } if (onLobby) { event.preventDefault(); window.history.pushState(null, '', href); window.scrollTo({ top: 0 }); } }}>
      <Icon name={icon} size={22} /><span>{label}</span></Link>;
  };
  return <>
    {link('all', 'home', t('shell.nav.lobby'))}
    {link('slots', 'slots', t('shell.nav.slots'))}
    {link('live', 'broadcast', t('shell.nav.live'))}
    <button type="button" className="tab" aria-pressed={searchOpen} onClick={onSearch} disabled={locked}><Icon name="search" size={22} /><span>{t('shell.search.open')}</span></button>
    <button type="button" className="tab" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={onMenu}><Icon name="menu" size={22} /><span>{t('shell.menu')}</span></button>
  </>;
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const arenaFocus = pathname === '/live/ringside';
  const kind = routeKind(pathname);
  const onLobby = isLobbyPath(pathname);
  const { wallet, walletOpen, setWalletOpen, activeDemo } = useProduct();
  const t = useT('common');
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatHidden, setChatHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const pref = useSidebarPref();
  const sidebarExpanded = pref ? pref === 'open' : kind === 'browse';
  // The arena needs the full width for the stage and the bet slip; chat stays one click away.
  useEffect(() => { setChatHidden(arenaFocus); }, [arenaFocus]);
  // "Recently played" (this browser only) and a fresh search per page.
  useEffect(() => {
    const game = gameForPath(pathname);
    if (game) recordRecentGame(game.id);
    if (!isLobbyPath(pathname)) setLobbyQuery('');
    setMenuOpen(false); setSearchOpen(false); setTip(null);
  }, [pathname]);
  const chatDialog = useRef<HTMLDialogElement>(null);
  const menuDialog = useRef<HTMLDialogElement>(null);
  const restoreChat = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => { if (walletOpen) setWalletLoaded(true); }, [walletOpen]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 769px)'), wide = window.matchMedia('(min-width: 1200px)');
    const closeOnDesktop = () => { if (desktop.matches) { setChatOpen(false); setSearchOpen(false); } if (wide.matches) setMenuOpen(false); };
    desktop.addEventListener('change', closeOnDesktop); wide.addEventListener('change', closeOnDesktop);
    return () => { desktop.removeEventListener('change', closeOnDesktop); wide.removeEventListener('change', closeOnDesktop); };
  }, []);
  useEffect(() => { if (chatOpen && !activeDemo) chatDialog.current?.showModal(); else chatDialog.current?.close(); }, [chatOpen, activeDemo]);
  useEffect(() => { if (menuOpen) menuDialog.current?.showModal(); else menuDialog.current?.close(); }, [menuOpen]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const openWallet = () => { setWalletLoaded(true); setWalletOpen(true); };
  const toggleSidebar = () => setSidebarPref(sidebarExpanded ? 'rail' : 'open');
  /* Rail tooltips: one floating label next to the hovered/focused icon (the link keeps its full accessible name). */
  const showTip = (text: string | null, el?: HTMLElement) => {
    const nav = sidebar.current;
    if (!text || !el || !nav || nav.offsetWidth > 120) { setTip(null); return; }
    const r = el.getBoundingClientRect();
    setTip({ text, top: r.top + r.height / 2 });
  };
  const lobbyPath = onLobby ? pathname : '/';
  return <>
    <a className="skip-link" href="#main-content">{t('shell.skipLink')}</a>
    <header className={`topbar ${arenaFocus ? 'arena-header' : ''}`} data-kind={kind} data-search={searchOpen || undefined}>
      <button type="button" className="icon-button topbar-toggle" aria-label={sidebarExpanded ? t('shell.collapse') : t('shell.expand')} aria-expanded={sidebarExpanded} aria-controls="site-sidebar" onClick={toggleSidebar}><Icon name="sidebar" size={20} /></button>
      <button type="button" className="icon-button topbar-menu" aria-label={t('shell.menu')} aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}><Icon name="menu" size={22} /></button>
      <Link href="/" className="brand" aria-label={t('shell.home')} onClick={event => { if (activeDemo) event.preventDefault(); }}><BrandMark/><span>sollish<span className="brand-period">.</span></span></Link>
      <div className="topbar-search">
        <ShellSearch onLobby={onLobby} lobbyPath={lobbyPath} disabled={activeDemo} inputRef={searchInput} onClose={() => setSearchOpen(false)} />
        <button type="button" className="text-button topbar-search-close" onClick={() => setSearchOpen(false)}>{t('shell.search.close')}</button>
      </div>
      <div className="header-actions"><LocaleSwitcher/><span className="network-label"><span className="status-dot"/>{devnetConfigured ? t('shell.network.devnet') : t('shell.network.demo')}</span><button className="wallet-button" onClick={openWallet} disabled={activeDemo} aria-label={wallet ? undefined : t('shell.connectWallet')}><Icon name="wallet" size={18}/>{wallet ? <span>{shortAddress(wallet.address)}</span> : <><span className="wallet-long">{t('shell.connectWallet')}</span><span className="wallet-short" aria-hidden="true">{t('shell.connectWalletShort')}</span></>}</button><button className={`icon-button chat-toggle ${chatOpen ? 'selected' : ''}`} aria-label={chatOpen ? t('shell.closeChat') : t('shell.openChat')} aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)} disabled={activeDemo}><Icon name="chat"/></button></div>
    </header>
    <div className="app-frame" data-kind={kind}>
      <nav ref={sidebar} id="site-sidebar" className="sidebar" aria-label={t('shell.primaryNav')}>
        <SideNav pathname={pathname} locked={activeDemo} onTip={showTip} />
      </nav>
      <div className={`workspace ${chatHidden ? 'chat-collapsed' : ''} ${arenaFocus ? 'arena-workspace' : ''}`}>
        <main id="main-content" className="main-content" tabIndex={-1}>{children}<footer className="page-footer"><BrandMark/><p>{t('shell.footer.tagline')}</p><span>{devnetConfigured ? t('shell.footer.devnet') : t('shell.footer.demo')}</span></footer></main>
        {!chatHidden && <aside className="desktop-chat" aria-label={t('shell.communityChat')}><ChatPanel onClose={() => { setChatHidden(true); requestAnimationFrame(() => restoreChat.current?.focus()); }} openWallet={openWallet}/></aside>}
        {chatHidden && <button ref={restoreChat} className="restore-chat icon-button" aria-label={t('shell.restoreChat')} onClick={() => setChatHidden(false)}><Icon name="chat"/></button>}
      </div>
    </div>
    {tip && <span className="sb-tip" aria-hidden="true" style={{ top: tip.top }}>{tip.text}</span>}
    {kind === 'browse' && <nav className="tabbar" aria-label={t('shell.tabbar')}>
      <Suspense fallback={null}><TabBarWithParams pathname={pathname} searchOpen={searchOpen} menuOpen={menuOpen} locked={activeDemo} onSearch={() => setSearchOpen(open => !open)} onMenu={() => setMenuOpen(true)} /></Suspense>
    </nav>}
    {menuOpen && <dialog ref={menuDialog} className="menu-drawer" aria-label={t('shell.menu')} onKeyDown={containDialogFocus} onCancel={() => setMenuOpen(false)} onClick={event => { if (event.target === menuDialog.current) setMenuOpen(false); }}>
      <div className="menu-drawer-panel">
        <div className="menu-drawer-head"><span className="brand"><BrandMark/><span>sollish<span className="brand-period">.</span></span></span><button type="button" className="icon-button" aria-label={t('shell.closeMenu')} onClick={() => setMenuOpen(false)}><Icon name="close" /></button></div>
        <nav aria-label={t('shell.primaryNav')}><SideNav pathname={pathname} locked={activeDemo} onNavigate={() => setMenuOpen(false)} /></nav>
      </div>
    </dialog>}
    {chatOpen && !activeDemo && <dialog ref={chatDialog} className="mobile-chat-overlay" aria-label={t('shell.communityChat')} onKeyDown={containDialogFocus} onCancel={() => setChatOpen(false)} onClick={event => { if (event.target === chatDialog.current) setChatOpen(false); }}><div className="mobile-chat-panel"><ChatPanel onClose={() => setChatOpen(false)} openWallet={() => { setChatOpen(false); openWallet(); }}/></div></dialog>}
    {(walletLoaded || walletOpen) && <WalletDialog/>}
  </>;
}
