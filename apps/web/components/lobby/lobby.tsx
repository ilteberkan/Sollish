'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import { LOBBY_GAMES, LOBBY_GAME_BY_ID, inCategory, isLobbyCategory, matchesQuery, searchText, type LobbyCategory, type LobbyGame } from '@/lib/lobby/games';
import { clearRecentGames, setLobbyQuery, useFavorites, useLobbyQuery, useRecent } from '@/lib/lobby/store';
import { poster } from '@/lib/lobby/posters';
import { useProduct } from '@/components/providers';
import { LobbyHero } from './lobby-hero';
import { FeatureTile, GameTile, MiniTile, WideTile, usePrefetch } from './lobby-tile';
import s from './lobby.module.css';

const CHIPS: ReadonlyArray<{ category: LobbyCategory; icon: string; label: MessageKey<'common'> | null }> = [
  { category: 'all', icon: 'grid', label: null },
  { category: 'slots', icon: 'slots', label: 'shell.nav.slots' },
  { category: 'live', icon: 'broadcast', label: 'shell.nav.live' },
  { category: 'instant', icon: 'bolt', label: 'shell.nav.instant' },
  { category: 'new', icon: 'spark', label: 'shell.nav.new' },
  { category: 'fair', icon: 'shield', label: 'shell.nav.fair' },
  { category: 'favorites', icon: 'heart', label: 'shell.nav.favorites' },
];
const SLOTS = LOBBY_GAMES.filter(g => g.kind === 'slot');
const INSTANT = LOBBY_GAMES.filter(g => g.kind === 'instant');
const NEW = LOBBY_GAMES.filter(g => g.isNew);
const FAIR = LOBBY_GAMES.filter(g => g.provablyFair);

/** Category in the URL (?c=), so Back, reload and shared links keep it; switching only rewrites history (no fetch). */
function useCategory(): [LobbyCategory, (next: LobbyCategory) => void] {
  const c = useSearchParams().get('c');
  const category = isLobbyCategory(c) ? c : 'all';
  const set = useCallback((next: LobbyCategory) => {
    const url = new URL(window.location.href);
    if (next === 'all') url.searchParams.delete('c'); else url.searchParams.set('c', next);
    url.searchParams.delete('q');
    window.history.pushState(null, '', `${url.pathname}${url.search}`);
  }, []);
  return [category, set];
}

/** Horizontal row: heading, "View all", scroll buttons; arrow keys move between the row's games. */
function Row({ id, title, subtitle, count, onViewAll, children, wide = false, action }: { id: string; title: string; subtitle?: string; count?: number; onViewAll?: () => void; children: ReactNode; wide?: boolean; action?: ReactNode }) {
  const t = useT('lobby');
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const left = Math.abs(el.scrollLeft);
    setEdges({ start: left < 4, end: left + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  const page = (direction: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.9 * (document.dir === 'rtl' ? -1 : 1), behavior: reduce ? 'auto' : 'smooth' });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>(':scope > li > * > a, :scope > li > a'));
    const at = links.findIndex(a => a === document.activeElement || a.contains(document.activeElement));
    if (at < 0) return;
    const rtl = document.dir === 'rtl';
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : at + ((event.key === 'ArrowRight') !== rtl ? 1 : -1);
    if (next < 0 || next >= links.length) return;
    event.preventDefault();
    links[next]!.focus();
    links[next]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const titleId = `${id}-title`;
  return <section className={s.row} aria-labelledby={titleId}>
    <div className={s.rowHead}>
      <div className={s.rowTitles}>
        <h2 id={titleId}>{title}{count !== undefined && <span className={s.count}>{t('row.count', { count })}</span>}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className={s.rowActions}>
        {action}
        {onViewAll && <button type="button" className={s.viewAll} onClick={onViewAll} aria-label={t('row.viewAllAria', { title })}>{t('row.viewAll')}<Icon name="arrow" size={16} /></button>}
        <button type="button" className={s.scrollButton} aria-label={t('row.prev', { title })} aria-controls={`${id}-list`} disabled={edges.start} onClick={() => page(-1)}><Icon name="chevron" size={18} className={s.flip} /></button>
        <button type="button" className={s.scrollButton} aria-label={t('row.next', { title })} aria-controls={`${id}-list`} disabled={edges.end} onClick={() => page(1)}><Icon name="chevron" size={18} /></button>
      </div>
    </div>
    <ul id={`${id}-list`} ref={list} className={s.rowList} data-wide={wide || undefined} onScroll={measure} onKeyDown={onKeyDown}>{children}</ul>
  </section>;
}

/** Ringside feature card in the Live row: the arena art with the pool facts. */
function LiveCard() {
  const t = useT('lobby');
  const tc = useT('common');
  const { activeDemo } = useProduct();
  const game = LOBBY_GAME_BY_ID.ringside;
  const wide = poster('ringside', 'wide'), narrow = poster('ringside', 'narrow');
  return <article className={s.live}>
    <Link href={game.href} prefetch={false} className={s.liveLink} aria-label={t('liveCard.aria')} aria-disabled={activeDemo || undefined} onClick={event => { if (activeDemo) event.preventDefault(); }}>
      <picture className={s.liveArt}>
        {wide && <source media="(min-width: 1200px)" srcSet={wide.src} width={wide.width} height={wide.height} />}
        {narrow && <img src={narrow.src} width={narrow.width} height={narrow.height} alt="" loading="lazy" decoding="async" draggable={false} />}
      </picture>
      <span className={s.liveCopy}>
        <span className={s.liveTag}><span className="live-dot" aria-hidden="true" />{t('liveCard.tag')}</span>
        <b className={s.liveTitle}>{tc('games.ringside')}</b>
        <span className={s.liveText}>{t('cards.ringside.tagline')}</span>
        <span className={s.facts}>
          <span><b>{t('liveCard.factWindowValue')}</b>{t('liveCard.factWindow')}</span>
          <span><b>{t('liveCard.factRoundsValue')}</b>{t('liveCard.factRounds')}</span>
          <span><b>{t('liveCard.factMarketsValue')}</b>{t('liveCard.factMarkets')}</span>
          <span><b>{t('liveCard.factFeeValue')}</b>{t('liveCard.factFee')}</span>
        </span>
        <span className={`button primary ${s.cta}`}>{t('liveCard.cta')}<Icon name="arrow" size={16} /></span>
      </span>
    </Link>
  </article>;
}

/** The way into the verifier from the provably-fair panel. */
function VerifyLink() {
  const t = useT('lobby');
  const prefetch = usePrefetch('/verify');
  return <Link href="/verify" prefetch={false} className={`button primary ${s.cta}`} onPointerEnter={prefetch} onFocus={prefetch}><Icon name="shield" size={16} />{t('rows.fair.cta')}</Link>;
}

export function Lobby() {
  const t = useT('lobby');
  const tc = useT('common');
  const [category, setCategory] = useCategory();
  const query = useLobbyQuery();
  const favorites = useFavorites();
  const recent = useRecent();
  const resultsId = useId();
  const isFav = (g: LobbyGame) => favorites.includes(g.id);
  const filtered = useMemo(() => {
    const q = query.trim();
    return LOBBY_GAMES.filter(g => inCategory(g, q ? 'all' : category, favorites) && (!q || matchesQuery(searchText(g, tc(`games.${g.id}`), [tc(`shell.kind.${g.kind}`), t(`cards.${g.id}.type`)]), q)));
  }, [query, category, favorites, t, tc]);
  const searching = query.trim().length > 0;
  const chipLabel = (c: LobbyCategory) => c === 'all' ? t('chips.all') : tc(CHIPS.find(x => x.category === c)!.label!);
  const tile = (g: LobbyGame, priority = false) => <li key={g.id}><GameTile game={g} favorite={isFav(g)} priority={priority} /></li>;
  const recentGames = recent.map(id => LOBBY_GAME_BY_ID[id]).filter(Boolean);

  return <div className={s.lobby}>
    <h1 className="sr-only">{t('heading')}</h1>
    {!searching && category === 'all' && <LobbyHero />}

    <div className={s.toolbar}>
      <div className={s.chipRow} role="group" aria-label={t('chips.label')}>
        {CHIPS.map(chip => <button key={chip.category} type="button" className={s.chip} aria-pressed={!searching && category === chip.category}
          onClick={() => { setLobbyQuery(''); setCategory(chip.category); }}>
          <Icon name={chip.icon} size={16} />{chipLabel(chip.category)}
          {chip.category === 'favorites' && favorites.length > 0 && <span className={s.chipCount}>{favorites.length}</span>}
        </button>)}
      </div>
    </div>

    {searching || category !== 'all' ? <section id="lobby-results" className={s.results} aria-labelledby={resultsId}>
      <div className={s.rowHead}>
        <div className={s.rowTitles}>
          <h2 id={resultsId}>{searching ? t('grid.results') : chipLabel(category)}{!searching && <span className={s.count}>{t('row.count', { count: filtered.length })}</span>}</h2>
          {searching && <p role="status">{t('grid.resultsCount', { count: filtered.length, query: query.trim() })}</p>}
        </div>
        <div className={s.rowActions}><button type="button" className={s.viewAll} onClick={() => { setLobbyQuery(''); setCategory('all'); }}><Icon name="arrow" size={16} className={s.flip} />{t('grid.back')}</button></div>
      </div>
      {filtered.length > 0
        ? <ul className={s.grid}>{filtered.map(g => tile(g))}</ul>
        : <div className={s.empty}>
          <Icon name={category === 'favorites' && !searching ? 'heart' : 'search'} size={28} />
          <p>{category === 'favorites' && !searching ? t('grid.favoritesEmpty') : t('grid.empty', { query: query.trim() })}</p>
          <button type="button" className="button" onClick={() => { setLobbyQuery(''); setCategory('all'); }}>{t('grid.reset')}</button>
        </div>}
      {category === 'fair' && !searching && <p className={s.fairNote}><Link href="/verify" className="text-button">{t('rows.fair.cta')}<Icon name="arrow" size={16} /></Link></p>}
    </section> : <>
      {/* Reserved before hydration when this browser has a list (html[data-recent], set by the head script). */}
      <div className={s.recentSlot}>
        {recentGames.length > 0 && <Row id="row-recent" title={t('rows.recent.title')} subtitle={t('rows.recent.subtitle')} action={<button type="button" className={s.viewAll} onClick={clearRecentGames}>{t('rows.recent.clear')}</button>}>
          {recentGames.map(g => <li key={g.id}><MiniTile game={g} /></li>)}
        </Row>}
      </div>
      <Row id="row-originals" title={t('rows.originals.title')} subtitle={t('rows.originals.subtitle')} count={SLOTS.length} onViewAll={() => setCategory('slots')}>
        {SLOTS.map(g => tile(g, true))}
      </Row>
      <div className={s.deferred}>
        <section className={s.row} aria-labelledby="row-live-title">
          <div className={s.rowHead}><div className={s.rowTitles}><h2 id="row-live-title">{t('rows.live.title')}</h2><p>{t('rows.live.subtitle')}</p></div>
            <div className={s.rowActions}><button type="button" className={s.viewAll} onClick={() => setCategory('live')} aria-label={t('row.viewAllAria', { title: t('rows.live.title') })}>{t('row.viewAll')}<Icon name="arrow" size={16} /></button></div></div>
          <LiveCard />
        </section>
      </div>
      <div className={s.deferred}>
        <Row id="row-instant" title={t('rows.instant.title')} subtitle={t('rows.instant.subtitle')} count={INSTANT.length} onViewAll={() => setCategory('instant')} wide>
          {INSTANT.map(g => <li key={g.id}><WideTile game={g} favorite={isFav(g)} /></li>)}
        </Row>
      </div>
      <div className={s.deferred}>
        <Row id="row-new" title={t('rows.new.title')} subtitle={t('rows.new.subtitle')} count={NEW.length} onViewAll={() => setCategory('new')} wide>
          {NEW.map(g => <li key={g.id}><FeatureTile game={g} favorite={isFav(g)} /></li>)}
        </Row>
      </div>
      <div className={s.deferred}>
        <section className={s.fairPanel} aria-labelledby="row-fair-title">
          <div className={s.fairCopy}>
            <span className={s.verifyIcon}><Icon name="shield" size={26} /></span>
            <h2 id="row-fair-title">{t('rows.fair.title')}<span className={s.count}>{t('row.count', { count: FAIR.length })}</span></h2>
            <p>{t('rows.fair.subtitle')}</p>
            <div className={s.fairActions}>
              <VerifyLink />
              <button type="button" className={s.viewAll} onClick={() => setCategory('fair')} aria-label={t('row.viewAllAria', { title: t('rows.fair.title') })}>{t('row.viewAll')}<Icon name="arrow" size={16} /></button>
            </div>
          </div>
          <ul className={s.fairList}>{FAIR.map(g => <li key={g.id}><MiniTile game={g} /></li>)}</ul>
        </section>
      </div>
    </>}
    <p className={s.footnote}>{t('footnote')}</p>
  </div>;
}
