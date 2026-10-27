'use client';
import type { MouseEvent } from 'react';
import { usePathname } from 'next/navigation';
import { Gem, Radio, ShieldCheck, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { poster } from '@/lib/lobby/posters';
import type { LobbyCategory, LobbyGameId } from '@/lib/lobby/games';
import s from './lobby.module.css';

type SquareCategory = 'live' | 'slots' | 'new' | 'fair' | 'exclusive' | 'instant';

/** Slot reels mark (lucide has none that reads as a slot machine at this size). Decorative. */
function Reels({ size = 26 }: { size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M9 5v14M15 5v14" /><path d="M5 12h1.5M11.2 12h1.6M17.5 12H19" />
  </svg>;
}

/* 888 order: Live, Slots, New, (Jackpots →) Provably fair, Exclusive, Instant. Each square shows one of our own game
   posters behind a category mark; the art is decorative and the caption is the link's name. */
const SQUARES: ReadonlyArray<{ category: SquareCategory; art: LobbyGameId; Icon: LucideIcon | typeof Reels }> = [
  { category: 'live', art: 'ringside', Icon: Radio },
  { category: 'slots', art: 'goreme', Icon: Reels },
  { category: 'new', art: 'asena', Icon: Sparkles },
  { category: 'fair', art: 'cezeri', Icon: ShieldCheck },
  { category: 'exclusive', art: 'ebru', Icon: Gem },
  { category: 'instant', art: 'damla', Icon: Zap },
];

/** 888 category squares under the hero. Real links to `?c=<category>` (new tab, no JS); a plain click filters in place. */
export function CategoryTiles({ onSelect }: { onSelect: (category: Exclude<LobbyCategory, 'all'>) => void }) {
  const t = useT('lobby');
  const pathname = usePathname();
  const click = (category: SquareCategory) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(category);
  };
  return <nav className={s.categories} aria-label={t('categories.label')}>
    <ul>
      {SQUARES.map(({ category, art, Icon }) => {
        const img = poster(art, 'tile');
        return <li key={category}>
          <a href={`${pathname}?c=${category}`} className={s.square} data-category={category} onClick={click(category)}>
            <span className={s.squareArt}>
              {img && <img src={img.src} width={img.width} height={img.height} alt="" loading="lazy" decoding="async" draggable={false} />}
              <span className={s.squareMark}><Icon size={26} aria-hidden="true" /></span>
            </span>
            <span className={s.squareCaption}>{t(`sx.cat.${category}`)}</span>
          </a>
        </li>;
      })}
    </ul>
  </nav>;
}
