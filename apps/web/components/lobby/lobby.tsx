'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { ArrowLeft, Gem, Grid2x2, Heart, Radio, Search, ShieldCheck, Sparkles, Star, Zap, type LucideIcon } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { LOBBY_GAMES, LOBBY_GAME_BY_ID, gamesIn, inCategory, isLobbyCategory, matchesQuery, searchText, type LobbyCategory, type LobbyGame } from '@/lib/lobby/games';
import { clearRecentGames, setLobbyQuery, useFavorites, useLobbyQuery, useRecent } from '@/lib/lobby/store';
import { LobbyHero } from './lobby-hero';
import { CategoryTiles } from './lobby-categories';
import { Row } from './lobby-row';
import { GameTile, MiniTile } from './lobby-tile';
import { BandTile, ExclusiveTile, RoundTile } from './lobby-cards';
import { LiveGrid } from './lobby-live';
import s from './lobby.module.css';

/* Category filter bar of the grid view (888 Live Casino tab pattern): every category plus favorites. */
const FILTERS: ReadonlyArray<{ category: LobbyCategory; Icon: LucideIcon }> = [
  { category: 'all', Icon: Grid2x2 },
  { category: 'live', Icon: Radio },
  { category: 'slots', Icon: Star },
  { category: 'new', Icon: Sparkles },
  { category: 'fair', Icon: ShieldCheck },
  { category: 'exclusive', Icon: Gem },
  { category: 'instant', Icon: Zap },
  { category: 'favorites', Icon: Heart },
];
const EXCLUSIVE = gamesIn('exclusive');
/* Featured: the hero order first, then the other slots (888 round "Featured games" row). */
const FEATURED = [...LOBBY_GAMES.filter(g => g.hero !== null).sort((a, b) => a.hero! - b.hero!), ...gamesIn('slots').filter(g => g.hero === null)];
const INSTANT = gamesIn('instant');

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

export function Lobby() {
  const t = useT('lobby');
  const tc = useT('common');
  const [category, setCategory] = useCategory();
  const query = useLobbyQuery();
  const favorites = useFavorites();
  const recent = useRecent();
  const resultsId = useId();
  const isFav = (g: LobbyGame) => favorites.includes(g.id);
  const title = (g: LobbyGame) => tc(`games.${g.id}`);
  const filtered = useMemo(() => {
    const q = query.trim();
    return LOBBY_GAMES.filter(g => inCategory(g, q ? 'all' : category, favorites) && (!q || matchesQuery(searchText(g, tc(`games.${g.id}`), [tc(`shell.kind.${g.kind}`), t(`cards.${g.id}.type`)]), q)));
  }, [query, category, favorites, t, tc]);
  const searching = query.trim().length > 0;
  const label = (c: LobbyCategory) => c === 'all' ? t('chips.all') : c === 'favorites' ? tc('shell.nav.favorites') : t(`sx.cat.${c}`);
  const recentGames = recent.map(id => LOBBY_GAME_BY_ID[id]).filter(Boolean);
  const favoriteGames = favorites.map(id => LOBBY_GAME_BY_ID[id]).filter(Boolean);
  // "View all" and the category squares open the category grid; when the click came from further down the page, bring
  // the grid's heading into view (the rows above it are gone).
  const reveal = useRef(false);
  const openCategory = useCallback((next: LobbyCategory) => { reveal.current = true; setLobbyQuery(''); setCategory(next); }, [setCategory]);
  useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    const el = document.getElementById('lobby-results');
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  }, [category]);

  return <div className={s.lobby}>
    <h1 className="sr-only">{t('heading')}</h1>
    {!searching && category === 'all' && <>
      <LobbyHero />
      <CategoryTiles onSelect={openCategory} />
    </>}

    {searching || category !== 'all' ? <section id="lobby-results" className={s.results} aria-labelledby={resultsId}>
      <div className={s.toolbar}>
        <div className={s.chipRow} role="group" aria-label={t('chips.label')}>
          {FILTERS.map(({ category: c, Icon }) => <button key={c} type="button" className={s.chip} aria-pressed={!searching && category === c}
            onClick={() => { setLobbyQuery(''); setCategory(c); }}>
            <Icon size={15} aria-hidden="true" />{label(c)}
            {c === 'favorites' && favorites.length > 0 && <span className={s.chipCount}>{favorites.length}</span>}
          </button>)}
        </div>
      </div>
      <div className={s.rowHead}>
        <div className={s.rowTitles}>
          <h2 id={resultsId}><span className={s.rowTitleText}>{searching ? t('grid.results') : label(category)}</span>{!searching && <span className={s.count}>{t('row.count', { count: filtered.length })}</span>}</h2>
          {searching && <p role="status">{t('grid.resultsCount', { count: filtered.length, query: query.trim() })}</p>}
        </div>
        <div className={s.rowActions}><button type="button" className={s.viewAll} onClick={() => { setLobbyQuery(''); setCategory('all'); }}><ArrowLeft size={15} className={s.dirIcon} aria-hidden="true" />{t('grid.back')}</button></div>
      </div>
      {filtered.length > 0
        ? <ul className={s.grid}>{filtered.map(g => <li key={g.id}><GameTile game={g} favorite={isFav(g)} /></li>)}</ul>
        : <div className={s.empty}>
          {category === 'favorites' && !searching ? <Heart size={28} aria-hidden="true" /> : <Search size={28} aria-hidden="true" />}
          <p>{category === 'favorites' && !searching ? t('grid.favoritesEmpty') : t('grid.empty', { query: query.trim() })}</p>
          <button type="button" className={s.ghostPill} onClick={() => { setLobbyQuery(''); setCategory('all'); }}>{t('grid.reset')}</button>
        </div>}
      {category === 'fair' && !searching && <p className={s.fairNote}><Link href="/verify" className={s.limePill}><ShieldCheck size={15} aria-hidden="true" />{t('rows.fair.cta')}</Link></p>}
    </section> : <>
      {/* Reserved before hydration when this browser has a list (html[data-recent], set by the head script). */}
      <div className={s.recentSlot}>
        {recentGames.length > 0 && <Row id="row-recent" variant="mini" title={t('rows.recent.title')} action={<button type="button" className={s.viewAll} onClick={clearRecentGames}>{t('rows.recent.clear')}</button>}>
          {recentGames.map(g => <li key={g.id}><MiniTile game={g} /></li>)}
        </Row>}
      </div>
      <Row id="row-exclusive" variant="square" title={t('sx.exclusive.title')} onViewAll={() => openCategory('exclusive')}>
        {EXCLUSIVE.map((g, i) => <li key={g.id}><ExclusiveTile game={g} favorite={isFav(g)} title={title(g)} priority={i < 4} /></li>)}
      </Row>
      {favoriteGames.length > 0 && <Row id="row-favorites" variant="square" title={t('sx.favorites.title')} onViewAll={() => openCategory('favorites')}>
        {favoriteGames.map(g => <li key={g.id}><ExclusiveTile game={g} favorite title={title(g)} badge={g.exclusive === true} /></li>)}
      </Row>}
      <Row id="row-featured" variant="round" title={t('sx.featured.title')} icon={<Star size={18} className={s.rowIcon} aria-hidden="true" />} onViewAll={() => openCategory('slots')}>
        {FEATURED.map(g => <li key={g.id}><RoundTile game={g} title={title(g)} /></li>)}
      </Row>
      <div className={s.deferred}>
        <LiveGrid onViewAll={() => openCategory('live')} />
      </div>
      <div className={s.deferred}>
        <Row id="row-instant" variant="band" title={t('rows.instant.title')} icon={<Zap size={18} className={s.rowIcon} aria-hidden="true" />} onViewAll={() => openCategory('instant')}>
          {INSTANT.map(g => <li key={g.id}><BandTile game={g} title={title(g)} /></li>)}
        </Row>
      </div>
    </>}
    <p className={s.footnote}>{t('footnote')}</p>
  </div>;
}
