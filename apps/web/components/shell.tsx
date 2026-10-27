'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { BrandMark, Icon } from './icons';
import { CircleHelp, Gift, Heart, House, Layers, Menu, MessageSquare, PanelLeft, Radio, ShieldCheck, Sparkles, Cherry, Zap, Wallet, type LucideIcon } from 'lucide-react';
import { useProduct } from './providers';
import { shortAddress } from '@/lib/demo';
import { ChatPanel } from './chat-panel';
import { containDialogFocus } from '@/lib/dialog';
import { useFormat, useLocale, useT } from '@/lib/i18n/client';
import { INTL_LOCALE } from '@/lib/i18n/config';
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
/* 888-style pill menu: every item has a round, tinted icon disc. Tints are design tokens (lime / yellow / danger). */
type Tone = 'lime' | 'yellow' | 'danger';
const CATEGORY_LINKS: ReadonlyArray<{ category: Category; icon: LucideIcon; tone: Tone; label: MessageKey<'common'> }> = [
  { category: 'slots', icon: Cherry, tone: 'danger', label: 'shell.nav.slots' },
  { category: 'live', icon: Radio, tone: 'danger', label: 'shell.nav.live' },
  { category: 'new', icon: Sparkles, tone: 'yellow', label: 'shell.nav.new' },
  { category: 'instant', icon: Zap, tone: 'lime', label: 'shell.nav.instant' },
];
const MORE_LINKS: ReadonlyArray<{ href: string; icon: LucideIcon; tone: Tone; label: MessageKey<'common'> }> = [
  { href: '/verify', icon: ShieldCheck, tone: 'lime', label: 'shell.nav.fair' },
  { href: '/stake', icon: Layers, tone: 'yellow', label: 'shell.nav.stake' },
];
/* Sidebar game order: live first, then instant, then the slots. Names are brand names and stay as written. */
const NAV_GAMES = ['ringside', 'crash', 'coinflip', 'cascade', 'tarhun', 'ebru', 'cezeri', 'asena', 'goreme', 'damla'].map(id => LOBBY_GAMES.find(g => g.id === id)!);

/** Same-page category switch: on the lobby a category link only rewrites the URL (no server round trip). */
function lobbyHref(pathname: string, category: LobbyCategory) {
  const base = isLobbyPath(pathname) ? pathname : '/';
  return category === 'all' ? base : `${base}?c=${category}`;
}
const disc = (Glyph: LucideIcon, tone: Tone) => <span className="sb-disc" data-tone={tone} aria-hidden="true"><Glyph size={16} strokeWidth={2.2} /></span>;

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
    <ul className="sb-list sb-card">{item('/rewards', disc(Gift, 'yellow'), t('shell.nav.rewards'), pathname === '/rewards')}</ul>
    <p className="sb-heading">{t('shell.sections.casino')}</p>
    <ul className="sb-list sb-card">
      {item(lobbyHref(pathname, 'all'), disc(House, 'lime'), t('shell.nav.lobby'), onLobby && (category === null || category === 'all'), true)}
      {CATEGORY_LINKS.map(link => item(lobbyHref(pathname, link.category), disc(link.icon, link.tone), t(link.label), onLobby && category === link.category, true))}
    </ul>
    <p className="sb-heading">{t('shell.sections.games')}</p>
    <ul className="sb-list sb-card">{NAV_GAMES.map(game => item(game.href,
      game.kind === 'live' ? <span className="sb-disc sb-game" data-live="" aria-hidden="true"><span className="live-dot" /></span> : <span className="sb-disc sb-game" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${game.tone[0]}, ${game.tone[1]})` }}><Icon name={game.icon} size={15} /></span>,
      game.short, pathname === game.href, false, game.kind === 'live' ? <span className="sr-only">{t('shell.liveSuffix')}</span> : undefined, game.kind === 'live' ? false : undefined))}</ul>
    <p className="sb-heading">{t('shell.sections.more')}</p>
    <ul className="sb-list sb-card">{MORE_LINKS.map(link => item(link.href, disc(link.icon, link.tone), t(link.label), pathname === link.href))}</ul>
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
  const link = (category: LobbyCategory, Glyph: LucideIcon, label: string) => {
    const href = lobbyHref(pathname, category);
    const current = onLobby && !searchOpen && !menuOpen && ((category === 'all' && !isLobbyCategory(c)) || c === category);
    return <Link href={href} scroll={false} className="tab" aria-current={current ? 'page' : undefined} aria-disabled={locked || undefined}
      onClick={event => { if (locked) { event.preventDefault(); return; } if (onLobby) { event.preventDefault(); window.history.pushState(null, '', href); window.scrollTo({ top: 0 }); } }}>
      <Glyph size={22} aria-hidden="true" /><span>{label}</span></Link>;
  };
  return <>
    {link('all', House, t('shell.nav.lobby'))}
    {link('slots', Cherry, t('shell.nav.slots'))}
    {link('live', Radio, t('shell.nav.live'))}
    <button type="button" className="tab" aria-pressed={searchOpen} onClick={onSearch} disabled={locked}><Icon name="search" size={22} /><span>{t('shell.search.open')}</span></button>
    <button type="button" className="tab" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={onMenu}><Menu size={22} aria-hidden="true" /><span>{t('shell.menu')}</span></button>
  </>;
}

/** Sidebar footer clock (888 pattern). Client-only so server HTML never carries a stale time. */
function SidebarClock() {
  const { locale } = useLocale();
  const t = useT('common');
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const id = window.setInterval(() => setNow(new Date()), 15_000); return () => window.clearInterval(id); }, []);
  const text = now ? new Intl.DateTimeFormat(INTL_LOCALE[locale], { hour: '2-digit', minute: '2-digit' }).format(now) : '';
  return <time className="sb-clock" dateTime={now?.toISOString()} aria-label={now ? `${t('shell.clock')} ${text}` : undefined}>{text}</time>;
}

function BrandLink({ className, locked, label }: { className: string; locked: boolean; label: string }) {
  return <Link href="/" className={`brand ${className}`} aria-label={label} onClick={event => { if (locked) event.preventDefault(); }}><BrandMark/><span>sollish<span className="brand-period">.</span></span></Link>;
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const arenaFocus = pathname === '/live/ringside';
  const kind = routeKind(pathname);
  const onLobby = isLobbyPath(pathname);
  const { wallet, walletOpen, setWalletOpen, activeDemo, demoBalance } = useProduct();
  const t = useT('common');
  const format = useFormat();
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Community chat is closed by default (888/bet365 have no right panel); the top-bar button or the sidebar square opens
  // it: inline beside the content on wide desktops (≥1200 px), as a dialog on tablets and phones.
  const [chatHidden, setChatHidden] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const pref = useSidebarPref();
  const sidebarExpanded = pref ? pref === 'open' : kind === 'browse';
  // The arena needs the full width for the stage and the bet slip; chat stays one click away.
  useEffect(() => { if (arenaFocus) setChatHidden(true); }, [arenaFocus]);
  // "Recently played" (this browser only) and a fresh search per page.
  useEffect(() => {
    const game = gameForPath(pathname);
    if (game) recordRecentGame(game.id);
    if (!isLobbyPath(pathname)) setLobbyQuery('');
    setMenuOpen(false); setSearchOpen(false); setTip(null);
  }, [pathname]);
  const chatDialog = useRef<HTMLDialogElement>(null);
  const menuDialog = useRef<HTMLDialogElement>(null);
  const chatButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => { if (walletOpen) setWalletLoaded(true); }, [walletOpen]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 769px)'), wide = window.matchMedia('(min-width: 1200px)');
    const closeOnDesktop = () => { if (desktop.matches) setSearchOpen(false); if (wide.matches) { setMenuOpen(false); setChatOpen(false); } else setChatHidden(true); };
    desktop.addEventListener('change', closeOnDesktop); wide.addEventListener('change', closeOnDesktop);
    return () => { desktop.removeEventListener('change', closeOnDesktop); wide.removeEventListener('change', closeOnDesktop); };
  }, []);
  useEffect(() => { if (chatOpen && !activeDemo) chatDialog.current?.showModal(); else chatDialog.current?.close(); }, [chatOpen, activeDemo]);
  useEffect(() => { if (menuOpen) menuDialog.current?.showModal(); else menuDialog.current?.close(); }, [menuOpen]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const openWallet = () => { setWalletLoaded(true); setWalletOpen(true); };
  const chatInline = () => window.matchMedia('(min-width: 1200px)').matches;
  const chatShown = !chatHidden || chatOpen;
  const toggleChat = () => { if (chatInline()) setChatHidden(hidden => !hidden); else setChatOpen(open => !open); };
  const toggleSidebar = () => setSidebarPref(sidebarExpanded ? 'rail' : 'open');
  /* Rail tooltips: one floating label next to the hovered/focused icon (the link keeps its full accessible name). */
  const showTip = (text: string | null, el?: HTMLElement) => {
    const nav = sidebar.current;
    if (!text || !el || !nav || nav.offsetWidth > 120) { setTip(null); return; }
    const r = el.getBoundingClientRect();
    setTip({ text, top: r.top + r.height / 2 });
  };
  const lobbyPath = onLobby ? pathname : '/';
  const network = devnetConfigured ? t('shell.network.devnet') : t('shell.network.demo');
  const favoritesHref = lobbyHref(pathname, 'favorites');
  return <>
    <a className="skip-link" href="#main-content">{t('shell.skipLink')}</a>
    <div className="app-frame" data-kind={kind}>
      <nav ref={sidebar} id="site-sidebar" className="sidebar" aria-label={t('shell.primaryNav')}>
        <div className="sb-logo"><BrandLink className="sb-brand" locked={activeDemo} label={t('shell.home')} /></div>
        <div className="sb-squares" role="group" aria-label={t('shell.shortcuts')}>
          <Link href={favoritesHref} scroll={false} className="sb-square" aria-disabled={activeDemo || undefined} {...{ onPointerEnter: (e: MouseEvent<HTMLElement>) => showTip(t('shell.nav.favorites'), e.currentTarget), onPointerLeave: () => showTip(null) }}
            onClick={event => { if (activeDemo) { event.preventDefault(); return; } if (onLobby && !event.metaKey && !event.ctrlKey) { event.preventDefault(); window.history.pushState(null, '', favoritesHref); } }}>
            <Heart size={20} aria-hidden="true" /><span className="sb-label">{t('shell.nav.favorites')}</span></Link>
          <button type="button" className="sb-square sb-square-chat" aria-pressed={chatShown} disabled={activeDemo} onClick={toggleChat} {...{ onPointerEnter: (e: MouseEvent<HTMLElement>) => showTip(t('shell.chatShortcut'), e.currentTarget), onPointerLeave: () => showTip(null) }}>
            <MessageSquare size={20} aria-hidden="true" /><span className="sb-label">{t('shell.chatShortcut')}</span></button>
        </div>
        <SideNav pathname={pathname} locked={activeDemo} onTip={showTip} />
        <div className="sb-foot"><span className="sb-network"><span className="status-dot"/>{network}</span><SidebarClock /></div>
      </nav>
      <div className="app-main">
        <header className={`topbar ${arenaFocus ? 'arena-header' : ''}`} data-kind={kind} data-search={searchOpen || undefined}>
          <button type="button" className="icon-button topbar-toggle" aria-label={sidebarExpanded ? t('shell.collapse') : t('shell.expand')} aria-expanded={sidebarExpanded} aria-controls="site-sidebar" onClick={toggleSidebar}><PanelLeft size={20} aria-hidden="true" /></button>
          <button type="button" className="icon-button topbar-menu" aria-label={t('shell.menu')} aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen(true)}><Menu size={22} aria-hidden="true" /></button>
          <BrandLink className="topbar-brand" locked={activeDemo} label={t('shell.home')} />
          <div className="topbar-search">
            <ShellSearch onLobby={onLobby} lobbyPath={lobbyPath} disabled={activeDemo} inputRef={searchInput} onClose={() => setSearchOpen(false)} />
            <button type="button" className="text-button topbar-search-close" onClick={() => setSearchOpen(false)}>{t('shell.search.close')}</button>
          </div>
          <div className="header-actions">
            <Link href="/verify" className="icon-button topbar-round topbar-help" aria-label={t('shell.help')} title={t('shell.help')} onClick={event => { if (activeDemo) event.preventDefault(); }}><CircleHelp size={20} aria-hidden="true" /></Link>
            <LocaleSwitcher className="topbar-round" />
            <button ref={chatButton} className={`icon-button topbar-round chat-toggle ${chatShown ? 'selected' : ''}`} aria-label={chatShown ? t('shell.closeChat') : t('shell.openChat')} aria-expanded={chatShown} onClick={toggleChat} disabled={activeDemo}><MessageSquare size={19} aria-hidden="true" /></button>
            <button className="wallet-button sx-cta" onClick={openWallet} disabled={activeDemo} aria-label={wallet ? undefined : t('shell.connectWallet')}><Wallet size={18} aria-hidden="true" />{wallet ? <span>{shortAddress(wallet.address)}</span> : <><span className="wallet-long">{t('shell.connectWallet')}</span><span className="wallet-short" aria-hidden="true">{t('shell.connectWalletShort')}</span></>}</button>
            <span className="sx-balance" title={t('shell.demoBalance')}><span className="sx-balance-label">{t('shell.demoBalance')}</span><strong>{format.number(demoBalance / 100)}</strong></span>
          </div>
        </header>
        <div className={`workspace ${chatHidden ? 'chat-collapsed' : ''} ${arenaFocus ? 'arena-workspace' : ''}`}>
          <main id="main-content" className="main-content" tabIndex={-1}>{children}<footer className="page-footer"><BrandMark/><p>{t('shell.footer.tagline')}</p><span>{devnetConfigured ? t('shell.footer.devnet') : t('shell.footer.demo')}</span></footer></main>
          {!chatHidden && <aside className="desktop-chat" aria-label={t('shell.communityChat')}><ChatPanel onClose={() => { setChatHidden(true); requestAnimationFrame(() => chatButton.current?.focus()); }} openWallet={openWallet}/></aside>}
        </div>
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
        <div className="sb-foot"><span className="sb-network"><span className="status-dot"/>{network}</span><SidebarClock /></div>
      </div>
    </dialog>}
    {chatOpen && !activeDemo && <dialog ref={chatDialog} className="mobile-chat-overlay" aria-label={t('shell.communityChat')} onKeyDown={containDialogFocus} onCancel={() => setChatOpen(false)} onClick={event => { if (event.target === chatDialog.current) setChatOpen(false); }}><div className="mobile-chat-panel"><ChatPanel onClose={() => setChatOpen(false)} openWallet={() => { setChatOpen(false); openWallet(); }}/></div></dialog>}
    {(walletLoaded || walletOpen) && <WalletDialog/>}
  </>;
}
