'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/icons';
import { useFormat, useT } from '@/lib/i18n/client';
import { LOBBY_GAME_BY_ID, gameForPath, similarGames, type LobbyGameId } from '@/lib/lobby/games';
import { lobbyStats } from '@/lib/lobby/stats';
import { useFavorites } from '@/lib/lobby/store';
import { GameTile, maxWinText, rtpText } from '@/components/lobby/lobby-tile';
import { Row } from '@/components/lobby/lobby-row';
import s from '@/components/lobby/lobby.module.css';

/**
 * Info strip under a game: "Sollish Original · RTP · Max win · Provably fair", read from the game registry
 * (lib/lobby/games.ts) and lib/lobby/stats.ts — the same simulated DEMO figures as the lobby tiles, never certified.
 * RTP and max win appear only when the registry has them; the fair link appears only for games whose result the player
 * can re-compute. Presentation only: nothing here reads or changes a round.
 */
export function GameInfoStrip({ id }: { id: LobbyGameId }) {
  const t = useT('lobby');
  const f = useFormat();
  const game = LOBBY_GAME_BY_ID[id];
  const stats = lobbyStats(id);
  return <section className={s.infoStrip} aria-label={t('gameInfo.aria')} data-testid="game-info-strip">
    <ul className={s.infoItems}>
      <li className={s.infoItem} data-kind="original"><Icon name="spark" size={16} />{t('gameInfo.original')}</li>
      {stats.rtp !== null && <li className={s.infoItem}>{t('gameInfo.rtp', { value: rtpText(f, stats.rtp) })}</li>}
      {stats.maxWin !== null && <li className={s.infoItem}>{t('gameInfo.maxWin', { value: maxWinText(f, stats.maxWin) })}</li>}
      {stats.poolFee !== null && <li className={s.infoItem}>{t('tile.poolFee', { value: f.percent(stats.poolFee) })}</li>}
      {game.provablyFair
        ? <li className={s.infoItem} data-kind="fair"><Link href="/verify" prefetch={false} className={s.infoLink}><Icon name="shield" size={16} />{t('gameInfo.fair')}<Icon name="arrow" size={14} /></Link></li>
        : <li className={s.infoItem} data-kind="practice"><Icon name="info" size={16} />{t('gameInfo.notFair')}</li>}
      <li className={s.infoItem} data-kind="demo">{t('tile.demo')}</li>
    </ul>
    <p className={s.infoNote}>{t('gameInfo.note')}</p>
  </section>;
}

/** "Similar games" row at the end of a game page (route from the registry; nothing on unknown routes). */
export function SimilarGames() {
  const t = useT('lobby');
  const favorites = useFavorites();
  const game = gameForPath(usePathname());
  if (!game) return null;
  const list = similarGames(game.id);
  return <div className={s.similar}>
    <Row id="row-similar" title={t('gameInfo.similar')} subtitle={t('gameInfo.similarSubtitle')}>
      {list.map(g => <li key={g.id}><GameTile game={g} favorite={favorites.includes(g.id)} /></li>)}
    </Row>
  </div>;
}
