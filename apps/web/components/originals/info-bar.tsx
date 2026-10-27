'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Maximize2, Minimize2, Settings, ShieldCheck, Star, Tv, Info } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { LOBBY_GAME_BY_ID, type LobbyGameId } from '@/lib/lobby/games';
import { toggleFavoriteGame, useFavorites } from '@/lib/lobby/store';
import { BrandMark } from '../icons';
import { useOriginalsFrame } from './originals-page';
import { GameStrip, type GameStripProps } from './game-strip';
import s from './originals.module.css';

/**
 * Info bar under the stage: settings (only when the game has settings), theatre, full screen, favourite; our wordmark
 * in the middle; on the right the "Kanıtlanabilir adil" link — only for games whose result the player can re-compute
 * (registry `provablyFair`). The local Coinflip/Crash practice uses browser randomness and says so instead.
 */
export function InfoBar({ gameId, onSettings }: { gameId: LobbyGameId; onSettings?: () => void }) {
  const t = useT('slotKit');
  const { theatre, setTheatre, pageRef } = useOriginalsFrame();
  const favorites = useFavorites();
  const favorite = favorites.includes(gameId);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  useEffect(() => {
    setCanFullscreen(typeof document !== 'undefined' && !!document.fullscreenEnabled);
    const update = () => setFullscreen(!!document.fullscreenElement && !!pageRef.current?.contains(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [pageRef]);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return; }
    const target = pageRef.current?.querySelector<HTMLElement>('[data-originals-table]');
    void target?.requestFullscreen?.().catch(() => undefined);
  };
  const fair = LOBBY_GAME_BY_ID[gameId].provablyFair;
  return (
    <div className={s.bar} role="toolbar" aria-label={t('originals.bar.label')} data-testid="originals-bar">
      <div className={s.tools}>
        {onSettings && <button type="button" className={s.iconBtn} onClick={onSettings} aria-label={t('originals.bar.settings')} title={t('originals.bar.settings')} aria-haspopup="dialog"><Settings size={18} aria-hidden="true" /></button>}
        <button type="button" className={s.iconBtn} onClick={() => setTheatre(!theatre)} aria-pressed={theatre} aria-label={t('originals.bar.theatre')} title={t('originals.bar.theatre')}><Tv size={18} aria-hidden="true" /></button>
        {canFullscreen && <button type="button" className={s.iconBtn} onClick={toggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen ? t('originals.bar.exitFullscreen') : t('originals.bar.fullscreen')} title={t('originals.bar.fullscreen')}>{fullscreen ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}</button>}
        <button type="button" className={s.iconBtn} onClick={() => toggleFavoriteGame(gameId)} aria-pressed={favorite} data-fav={favorite || undefined} aria-label={favorite ? t('originals.bar.unfavorite') : t('originals.bar.favorite')} title={t('originals.bar.favorite')} data-testid="originals-favorite"><Star size={18} aria-hidden="true" /></button>
      </div>
      <Link href="/" prefetch={false} className={s.wordmark} aria-label={t('originals.bar.home')}><BrandMark />sollish</Link>
      {fair
        ? <Link href="/verify" prefetch={false} className={s.fair} data-testid="originals-fair"><ShieldCheck size={16} aria-hidden="true" />{t('originals.bar.fair')}</Link>
        : <span className={s.fair} data-practice="" data-testid="originals-fair"><Info size={16} aria-hidden="true" />{t('originals.bar.notFair')}</span>}
    </div>
  );
}

/** Info bar + game card in one block (reference: the strip under the stage). */
export function OriginalsInfo({ onSettings, ...strip }: GameStripProps & { onSettings?: () => void }) {
  return (
    <div className={s.info} data-testid="originals-info">
      <InfoBar gameId={strip.gameId} onSettings={onSettings} />
      <GameStrip {...strip} />
    </div>
  );
}
