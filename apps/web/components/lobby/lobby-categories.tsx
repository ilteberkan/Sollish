'use client';
import type { MouseEvent, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import { gamesIn, type LobbyCategory } from '@/lib/lobby/games';
import s from './lobby.module.css';

type TileCategory = Exclude<LobbyCategory, 'all'>;

/* Sollish-drawn category marks (decorative, aria-hidden): simple geometric SVG in the site palette, no imagery. */
const ART: Readonly<Record<TileCategory, ReactNode>> = {
  slots: <>
    <rect x="6" y="14" width="52" height="36" rx="8" fill="#1d2633" stroke="#3a4a5e" strokeWidth="2" />
    <rect x="11" y="19" width="12" height="26" rx="3" fill="#0e131a" /><rect x="26" y="19" width="12" height="26" rx="3" fill="#0e131a" /><rect x="41" y="19" width="12" height="26" rx="3" fill="#0e131a" />
    <path d="M17 25l5 7-5 7-5-7z" fill="#e9b872" />
    <circle cx="32" cy="32" r="4.5" fill="#ff6a8a" /><path d="M44 28h6l-4 8" stroke="#6fd6e6" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M58 22v12" stroke="#e9b872" strokeWidth="3" strokeLinecap="round" /><circle cx="58" cy="20" r="3" fill="#e9b872" />
  </>,
  live: <>
    <circle cx="32" cy="32" r="7" fill="#ff4d4d" />
    <path d="M20 20a17 17 0 0 0 0 24M44 20a17 17 0 0 1 0 24" stroke="#ff8a7a" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M12 12a28 28 0 0 0 0 40M52 12a28 28 0 0 1 0 40" stroke="#7a3a3a" strokeWidth="3" fill="none" strokeLinecap="round" />
  </>,
  instant: <>
    <path d="M8 50h48" stroke="#3a4a5e" strokeWidth="2" strokeLinecap="round" />
    <path d="M10 46c12-2 22-8 30-22" stroke="#6fd6e6" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M36 8 26 30h9l-4 18 14-24h-9l5-16z" fill="#e9b872" stroke="#0e131a" strokeWidth="1.5" strokeLinejoin="round" />
  </>,
  new: <>
    <path d="M32 6l5 17 17 5-17 5-5 17-5-17-17-5 17-5z" fill="#e9b872" />
    <path d="M50 42l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#ff8a7a" /><path d="M14 40l1.5 4.5L20 46l-4.5 1.5L14 52l-1.5-4.5L8 46l4.5-1.5z" fill="#6fd6e6" />
  </>,
  fair: <>
    <path d="M32 6l20 7v15c0 13-8.5 23-20 29C20.5 51 12 41 12 28V13z" fill="#18222e" stroke="#6fd6e6" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M23 31l6.5 6.5L42 25" stroke="#6fd6e6" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  favorites: <>
    <path d="M32 52S10 39 10 24a11 11 0 0 1 22-3 11 11 0 0 1 22 3c0 15-22 28-22 28z" fill="#ff6a8a" />
    <path d="M20 22a5 5 0 0 1 5-4" stroke="#ffd0dc" strokeWidth="2.5" fill="none" strokeLinecap="round" />
  </>,
};

const TILES: ReadonlyArray<{ category: TileCategory; label: MessageKey<'common'> }> = [
  { category: 'slots', label: 'shell.nav.slots' },
  { category: 'live', label: 'shell.nav.live' },
  { category: 'instant', label: 'shell.nav.instant' },
  { category: 'new', label: 'shell.nav.new' },
  { category: 'fair', label: 'shell.nav.fair' },
  { category: 'favorites', label: 'shell.nav.favorites' },
];

/** Category tiles near the top of the lobby. Real links to `?c=<category>` (open in a new tab, work without JS); a plain
 * click switches the filter in place like the chips. */
export function CategoryTiles({ favorites, onSelect }: { favorites: readonly string[]; onSelect: (category: TileCategory) => void }) {
  const t = useT('lobby');
  const tc = useT('common');
  const pathname = usePathname();
  const click = (category: TileCategory) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(category);
  };
  return <nav className={s.categories} aria-label={t('categories.label')}>
    <ul>
      {TILES.map(({ category, label }) => {
        const count = gamesIn(category, favorites).length;
        return <li key={category}>
          <a href={`${pathname}?c=${category}`} className={s.category} data-category={category} onClick={click(category)}>
            <svg className={s.categoryArt} viewBox="0 0 64 64" aria-hidden="true" focusable="false">{ART[category]}</svg>
            <span className={s.categoryText}>
              <b>{tc(label)}</b>
              <small>{category === 'favorites' && count === 0 ? t('categories.favoritesEmpty') : t('row.count', { count })}</small>
            </span>
          </a>
        </li>;
      })}
    </ul>
  </nav>;
}
