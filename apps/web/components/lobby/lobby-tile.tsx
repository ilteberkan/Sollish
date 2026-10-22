'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId } from 'react';
import { Icon } from '@/components/icons';
import { useFormat, useT } from '@/lib/i18n/client';
import type { Formatter } from '@/lib/i18n/format';
import { poster } from '@/lib/lobby/posters';
import { lobbyStats, type LobbyStats } from '@/lib/lobby/stats';
import { toggleFavoriteGame } from '@/lib/lobby/store';
import type { LobbyGame } from '@/lib/lobby/games';
import { useProduct } from '@/components/providers';
import s from './lobby.module.css';

/** Prefetch a game route once, on intent (hover, focus, touch): the lobby never downloads game code it is not about to
 * open. Ringside is a live socket page and is not prefetched. */
const prefetched = new Set<string>();
export function usePrefetch(href: string, enabled = true) {
  const router = useRouter();
  return useCallback(() => {
    if (!enabled || prefetched.has(href)) return;
    prefetched.add(href);
    router.prefetch(href);
  }, [router, href, enabled]);
}

const percentFormats = new Map<string, Intl.NumberFormat>();
/** RTP and house edge: always exactly two decimals, locale-aware (96.47% / %96,47). */
export function rtpText(f: Formatter, ratio: number) {
  let nf = percentFormats.get(f.intl);
  if (!nf) { nf = new Intl.NumberFormat(f.intl, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }); percentFormats.set(f.intl, nf); }
  return nf.format(ratio);
}
export const houseEdgeText = rtpText;
export const maxWinText = (f: Formatter, maxWin: number) => `×${f.number(maxWin, 2)}`;

/** RTP / max win / volatility chips (or the pool fee for Ringside). */
export function StatChips({ stats, compact = false }: { stats: LobbyStats; compact?: boolean }) {
  const t = useT('lobby');
  const f = useFormat();
  return <span className={s.chips} data-compact={compact || undefined}>
    {stats.rtp !== null && <span className={s.stat}>{t('tile.rtp', { value: rtpText(f, stats.rtp) })}</span>}
    {stats.maxWin !== null && <span className={s.stat}>{t('tile.maxWin', { value: maxWinText(f, stats.maxWin) })}</span>}
    {stats.poolFee !== null && <span className={s.stat}>{t('tile.poolFee', { value: f.percent(stats.poolFee) })}</span>}
    {stats.volatility !== null && <span className={s.stat} data-vol={stats.volatility} title={t('tile.volatility', { level: t(`tile.vol.${stats.volatility}`) })}>
      <span className={s.volBars} aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="sr-only">{t('tile.volatility', { level: '' })}</span>{t(`tile.vol.${stats.volatility}`)}
    </span>}
    {stats.poolFee !== null && <span className={s.stat}>{t('tile.poolNote')}</span>}
  </span>;
}

export function FavoriteButton({ game, favorite, title }: { game: LobbyGame; favorite: boolean; title: string }) {
  const t = useT('lobby');
  return <button type="button" className={s.fav} aria-pressed={favorite} aria-label={favorite ? t('tile.favRemove', { name: title }) : t('tile.favAdd', { name: title })} onClick={() => toggleFavoriteGame(game.id)}>
    <Icon name="heart" size={18} />
  </button>;
}

/** Portrait game tile: poster, badges, favorite, title, provider and stat chips; hover/focus shows the pitch. */
export function GameTile({ game, favorite, priority = false }: { game: LobbyGame; favorite: boolean; priority?: boolean }) {
  const t = useT('lobby');
  const tc = useT('common');
  const { activeDemo } = useProduct();
  const id = useId();
  const title = tc(`games.${game.id}`);
  const art = poster(game.id, 'tile');
  const stats = lobbyStats(game.id);
  const prefetch = usePrefetch(game.href, game.kind !== 'live');
  return <article className={s.tile} style={{ '--tone-a': game.tone[0], '--tone-b': game.tone[1] } as React.CSSProperties}>
    <Link href={game.href} prefetch={false} className={s.tileLink} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} aria-disabled={activeDemo || undefined}
      onClick={event => { if (activeDemo) event.preventDefault(); }} onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}>
      <span className={s.art}>
        {art && <img src={art.src} width={art.width} height={art.height} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" draggable={false} />}
        <span className={s.badges}>
          {game.kind === 'live' ? <span className={s.badge} data-tone="live"><span className="live-dot" aria-hidden="true" />{t('tile.live')}</span> : game.isNew ? <span className={s.badge} data-tone="new">{t('tile.new')}</span> : <span className={s.badge}>{t('tile.original')}</span>}
          {game.original && <span className={s.badge} data-tone="original">{t('tile.sollishOriginal')}</span>}
          <span className={s.badge} data-tone="demo">{t('tile.demo')}</span>
        </span>
        <span className={s.preview} aria-hidden="true">
          <span className={s.previewType}>{t(`cards.${game.id}.type`)}</span>
          <span className={s.previewText}>{t(`cards.${game.id}.tagline`)}</span>
          <span className={s.playPill}><Icon name="play" size={14} />{game.kind === 'live' ? t('tile.watch') : t('tile.play')}</span>
        </span>
      </span>
      <span className={s.tileBody}>
        <b id={`${id}-t`} className={s.tileTitle}>{title}</b>
        <span className={s.provider}>{t('tile.provider')}</span>
        <span id={`${id}-d`} className={s.tileStats}><StatChips stats={stats} compact /></span>
      </span>
    </Link>
    <FavoriteButton game={game} favorite={favorite} title={title} />
  </article>;
}

/** Landscape card (instant games row): poster left, pitch and chips right. */
export function WideTile({ game, favorite }: { game: LobbyGame; favorite: boolean }) {
  const t = useT('lobby');
  const tc = useT('common');
  const { activeDemo } = useProduct();
  const id = useId();
  const title = tc(`games.${game.id}`);
  const art = poster(game.id, 'land') ?? poster(game.id, 'tile');
  const prefetch = usePrefetch(game.href);
  return <article className={s.wideTile} style={{ '--tone-a': game.tone[0], '--tone-b': game.tone[1] } as React.CSSProperties}>
    <Link href={game.href} prefetch={false} className={s.wideLink} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} aria-disabled={activeDemo || undefined}
      onClick={event => { if (activeDemo) event.preventDefault(); }} onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}>
      <span className={s.wideArt}>{art && <img src={art.src} width={art.width} height={art.height} alt="" loading="lazy" decoding="async" draggable={false} />}
        <span className={s.badges}>{game.isNew && <span className={s.badge} data-tone="new">{t('tile.new')}</span>}<span className={s.badge} data-tone={game.original ? 'original' : undefined}>{game.original ? t('tile.sollishOriginal') : t('tile.original')}</span><span className={s.badge} data-tone="demo">{t('tile.demo')}</span></span>
      </span>
      <span className={s.wideBody}>
        <b id={`${id}-t`} className={s.tileTitle}>{title}</b>
        <span className={s.provider}>{t('tile.provider')} · {t(`cards.${game.id}.type`)}</span>
        <span className={s.wideText}>{t(`cards.${game.id}.text`)}</span>
        <span id={`${id}-d`}><StatChips stats={lobbyStats(game.id)} /></span>
      </span>
    </Link>
    <FavoriteButton game={game} favorite={favorite} title={title} />
  </article>;
}

/** Compact "recently played" chip: fixed height so the reserved row never shifts. */
export function MiniTile({ game }: { game: LobbyGame }) {
  const tc = useT('common');
  const { activeDemo } = useProduct();
  const art = poster(game.id, 'tile');
  const prefetch = usePrefetch(game.href, game.kind !== 'live');
  return <Link href={game.href} prefetch={false} className={s.mini} aria-disabled={activeDemo || undefined} onClick={event => { if (activeDemo) event.preventDefault(); }} onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}
    style={{ '--tone-a': game.tone[0], '--tone-b': game.tone[1] } as React.CSSProperties}>
    <span className={s.miniArt}>{art && <img src={art.src} width={art.width} height={art.height} alt="" loading="lazy" decoding="async" draggable={false} />}</span>
    <span className={s.miniBody}><b>{tc(`games.${game.id}`)}</b><small>{tc(`shell.kind.${game.kind}`)} · Sollish</small></span>
  </Link>;
}

/** "New" row card: the 3:2 key art with the pitch below (a different rhythm from the portrait rows). */
export function FeatureTile({ game, favorite }: { game: LobbyGame; favorite: boolean }) {
  const t = useT('lobby');
  const tc = useT('common');
  const { activeDemo } = useProduct();
  const id = useId();
  const title = tc(`games.${game.id}`);
  const art = poster(game.id, 'narrow') ?? poster(game.id, 'tile');
  const prefetch = usePrefetch(game.href, game.kind !== 'live');
  return <article className={s.feature} style={{ '--tone-a': game.tone[0], '--tone-b': game.tone[1] } as React.CSSProperties}>
    <Link href={game.href} prefetch={false} className={s.featureLink} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} aria-disabled={activeDemo || undefined}
      onClick={event => { if (activeDemo) event.preventDefault(); }} onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}>
      <span className={s.featureArt}>{art && <img src={art.src} width={art.width} height={art.height} alt="" loading="lazy" decoding="async" draggable={false} />}
        <span className={s.badges}>{game.isNew && <span className={s.badge} data-tone="new">{t('tile.new')}</span>}{game.original && <span className={s.badge} data-tone="original">{t('tile.sollishOriginal')}</span>}<span className={s.badge} data-tone="demo">{t('tile.demo')}</span></span>
      </span>
      <span className={s.featureBody}>
        <b id={`${id}-t`} className={s.tileTitle}>{title}</b>
        <span className={s.provider}>{t('tile.provider')} · {t(`cards.${game.id}.type`)}</span>
        <span className={s.featureText}>{t(`cards.${game.id}.tagline`)}</span>
        <span id={`${id}-d`}><StatChips stats={lobbyStats(game.id)} compact /></span>
      </span>
    </Link>
    <FavoriteButton game={game} favorite={favorite} title={title} />
  </article>;
}
