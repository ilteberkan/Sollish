'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { Heart, Info, Play, X } from 'lucide-react';
import { useFormat, useT } from '@/lib/i18n/client';
import { poster } from '@/lib/lobby/posters';
import { lobbyStats } from '@/lib/lobby/stats';
import { toggleFavoriteGame } from '@/lib/lobby/store';
import type { LobbyGame } from '@/lib/lobby/games';
import { useProduct } from '@/components/providers';
import { StatChips, maxWinText, usePrefetch } from './lobby-tile';
import s from './lobby.module.css';

const tone = (game: LobbyGame) => ({ '--tone-a': game.tone[0], '--tone-b': game.tone[1] }) as CSSProperties;

/**
 * Small info popover behind the lime "i" button (bet365 "Only at" tiles): RTP, max win and volatility from the lobby
 * stats, a favorite toggle and the play link. Native popover API: top layer (never clipped by the scrolling row),
 * light dismiss, Escape and the button's expanded state come from the browser. It is placed next to its button when
 * it opens and closes when the page scrolls (it would otherwise drift away from the tile).
 */
function InfoPopover({ game, favorite, title }: { game: LobbyGame; favorite: boolean; title: string }) {
  const t = useT('lobby');
  const { activeDemo } = useProduct();
  const id = useId();
  const popId = `${id}-pop`.replace(/:/g, '');
  const pop = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const close = () => { try { el.hidePopover(); } catch {} };
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') { window.removeEventListener('scroll', close, true); return; }
      const anchor = button.current?.getBoundingClientRect();
      if (!anchor) return;
      const box = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8));
      const above = anchor.top - box.height - 8;
      const top = above >= 8 ? above : Math.min(anchor.bottom + 8, window.innerHeight - box.height - 8);
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      window.addEventListener('scroll', close, { capture: true, passive: true, once: true });
    };
    el.addEventListener('toggle', onToggle);
    return () => { el.removeEventListener('toggle', onToggle); window.removeEventListener('scroll', close, true); };
  }, []);
  return <>
    <button ref={button} type="button" className={s.infoButton} popoverTarget={popId} aria-label={t('sx.info.open', { name: title })}>
      <Info size={18} strokeWidth={2.6} aria-hidden="true" />
    </button>
    <div ref={pop} id={popId} popover="auto" className={s.infoPop} role="dialog" aria-labelledby={`${popId}-t`}>
      <div className={s.infoPopHead}>
        <span className={s.infoPopTitles}><small>{t('sx.info.title')}</small><b id={`${popId}-t`}>{title}</b></span>
        <button type="button" className={s.infoPopClose} popoverTarget={popId} popoverTargetAction="hide" aria-label={t('sx.info.close')}><X size={16} aria-hidden="true" /></button>
      </div>
      <p className={s.infoPopType}>{t(`cards.${game.id}.type`)}</p>
      <StatChips stats={lobbyStats(game.id)} />
      <div className={s.infoPopActions}>
        <Link href={game.href} prefetch={false} className={s.limePill} aria-disabled={activeDemo || undefined} onClick={event => { if (activeDemo) event.preventDefault(); }}>
          <Play size={14} aria-hidden="true" />{game.kind === 'live' ? t('tile.watch') : t('sx.info.play')}
        </Link>
        <button type="button" className={s.ghostPill} aria-pressed={favorite} onClick={() => toggleFavoriteGame(game.id)}
          aria-label={favorite ? t('tile.favRemove', { name: title }) : t('tile.favAdd', { name: title })}>
          <Heart size={15} aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  </>;
}

/** bet365 "Only at" tile: full-bleed square poster, lime "EXCLUSIVE" badge top-left, lime "i" button bottom-right. */
export function ExclusiveTile({ game, favorite, title, priority = false, badge = true }: { game: LobbyGame; favorite: boolean; title: string; priority?: boolean; badge?: boolean }) {
  const t = useT('lobby');
  const { activeDemo } = useProduct();
  const id = useId();
  const art = poster(game.id, 'tile');
  const prefetch = usePrefetch(game.href, game.kind !== 'live');
  return <article className={s.xTile} style={tone(game)}>
    <Link href={game.href} prefetch={false} className={s.xLink} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} aria-disabled={activeDemo || undefined}
      onClick={event => { if (activeDemo) event.preventDefault(); }} onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}>
      {art && <img src={art.src} width={art.width} height={art.height} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" draggable={false} />}
      {badge && <span className={s.xBadge}>{t('sx.exclusive.badge')}</span>}
      <span id={`${id}-t`} className="sr-only">{title}</span>
      <span id={`${id}-d`} className="sr-only"><StatChips stats={lobbyStats(game.id)} compact /></span>
    </Link>
    <InfoPopover game={game} favorite={favorite} title={title} />
  </article>;
}

/** 888 "Featured games" tile: circular art, the name and the max win under it. */
export function RoundTile({ game, title }: { game: LobbyGame; title: string }) {
  const t = useT('lobby');
  const f = useFormat();
  const { activeDemo } = useProduct();
  const id = useId();
  const art = poster(game.id, 'tile');
  const stats = lobbyStats(game.id);
  const prefetch = usePrefetch(game.href, game.kind !== 'live');
  return <Link href={game.href} prefetch={false} className={s.round} style={tone(game)} aria-labelledby={`${id}-t`} aria-describedby={stats.maxWin !== null ? `${id}-d` : undefined} aria-disabled={activeDemo || undefined}
    onClick={event => { if (activeDemo) event.preventDefault(); }} onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}>
    <span className={s.roundArt}>{art && <img src={art.src} width={art.width} height={art.height} alt="" loading="lazy" decoding="async" draggable={false} />}</span>
    <b id={`${id}-t`} className={s.roundName}>{title}</b>
    {stats.maxWin !== null && <span id={`${id}-d`} className={s.roundAmount}>{t('tile.maxWin', { value: maxWinText(f, stats.maxWin) })}</span>}
  </Link>;
}

/** "Lucky" Originals tile: colourful card, ribbon top-right, big caption band at the bottom. */
export function BandTile({ game, title }: { game: LobbyGame; title: string }) {
  const t = useT('lobby');
  const { activeDemo } = useProduct();
  const id = useId();
  const art = poster(game.id, 'tile');
  const prefetch = usePrefetch(game.href);
  return <Link href={game.href} prefetch={false} className={s.band} style={tone(game)} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} aria-disabled={activeDemo || undefined}
    onClick={event => { if (activeDemo) event.preventDefault(); }} onPointerEnter={prefetch} onFocus={prefetch} onTouchStart={prefetch}>
    <span className={s.bandArt}>{art && <img src={art.src} width={art.width} height={art.height} alt="" loading="lazy" decoding="async" draggable={false} />}</span>
    <span className={s.ribbon} data-tone={game.isNew ? 'new' : 'original'}>{game.isNew ? t('tile.new') : t('tile.original')}</span>
    <span className={s.bandCaption} aria-hidden="true">{game.short}</span>
    <span id={`${id}-t`} className="sr-only">{title}</span>
    <span id={`${id}-d`} className="sr-only"><StatChips stats={lobbyStats(game.id)} compact /></span>
  </Link>;
}
