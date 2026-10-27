'use client';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import type { LobbyGameId } from '@/lib/lobby/games';
import { poster } from '@/lib/lobby/posters';
import { originalsGames } from '@/lib/originals';
import s from './originals.module.css';

/** "Originals" row: colourful tiles (the lobby key art) linking to every Sollish Original; the open game is marked. */
export function OriginalsRow({ current }: { current: LobbyGameId }) {
  const t = useT('slotKit');
  const tc = useT('common');
  const games = originalsGames();
  return (
    <section className={s.row} aria-labelledby="originals-row-title" data-testid="originals-row">
      <div className={s.rowHead}>
        <h2 id="originals-row-title"><Sparkles size={18} aria-hidden="true" />{t('originals.row.title')}</h2>
        <Link href="/games" prefetch={false} className={s.rowAll}>{t('originals.row.all')}</Link>
      </div>
      <ul className={s.tiles} aria-label={t('originals.row.label')}>
        {games.map(game => {
          const art = poster(game.id, 'tile');
          const name = tc(`games.${game.id}`);
          const here = game.id === current;
          return (
            <li key={game.id} className={s.tile}>
              <Link href={game.href} prefetch={false} className={s.tileLink} aria-current={here ? 'page' : undefined} aria-label={here ? `${name} · ${t('originals.row.current')}` : name}
                style={{ '--tone-a': game.tone[0], '--tone-b': game.tone[1] } as CSSProperties}>
                {art && <img src={art.src} alt="" width={art.width} height={art.height} loading="lazy" decoding="async" />}
                {here && <span className={s.tileNow} aria-hidden="true">{t('originals.row.current')}</span>}
                <span className={s.tileName} aria-hidden="true">{game.short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
