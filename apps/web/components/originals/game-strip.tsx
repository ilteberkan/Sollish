'use client';
import { useMemo } from 'react';
import { useFormat, useT } from '@/lib/i18n/client';
import { LOBBY_GAME_BY_ID, type LobbyGameId } from '@/lib/lobby/games';
import { lobbyStats } from '@/lib/lobby/stats';
import { poster } from '@/lib/lobby/posters';
import { Icon } from '../icons';
import s from './originals.module.css';

export interface GameStripProps {
  gameId: LobbyGameId;
  /** RTP shown on the chip as a ratio. Defaults to the registry figure (lib/lobby/stats.ts); Damla passes the exact RTP
   * of the selected mode. */
  rtp?: number;
  rtpTitle?: string;
  /** "Şansımı dene": plays one normal DEMO round at the current bet (the game decides what that means). */
  onTry: () => void;
  tryDisabled?: boolean;
  tryHint: string;
}

/** Game card: icon, name, "Original" chip, real RTP chip, lime "Şansımı dene". */
export function GameStrip({ gameId, rtp, rtpTitle, onTry, tryDisabled, tryHint }: GameStripProps) {
  const t = useT('slotKit');
  const tc = useT('common');
  const f = useFormat();
  const game = LOBBY_GAME_BY_ID[gameId];
  const ratio = rtp ?? lobbyStats(gameId).rtp;
  const rtpText = useMemo(() => ratio === null ? null : new Intl.NumberFormat(f.intl, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ratio), [ratio, f.intl]);
  const name = tc(`games.${gameId}`);
  const art = poster(gameId, 'tile');
  return (
    <div className={s.card} role="group" aria-label={t('originals.strip.label', { name })} data-testid="originals-strip">
      <span className={s.cardIcon} aria-hidden="true">{art ? <img src={art.src} alt="" width={52} height={69} loading="lazy" decoding="async" /> : <Icon name={game.icon} size={26} />}</span>
      <span className={s.cardName}>{name}</span>
      <span className={s.cardChips}>
        <span className={`${s.pill} ${s.pillOriginal}`}>{t('originals.strip.original')}</span>
        {rtpText && <span className={s.pill} title={rtpTitle} data-testid="originals-rtp">{t('originals.strip.rtp', { value: rtpText })}</span>}
        <button type="button" className={s.try} onClick={onTry} disabled={tryDisabled} aria-describedby={`${gameId}-try-hint`} data-testid="originals-try">{t('originals.strip.try')}</button>
        <span id={`${gameId}-try-hint`} className="sr-only">{tryHint}</span>
      </span>
    </div>
  );
}
