'use client';
import Link from 'next/link';
import { useId } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Gem, Radio, Sparkles, Trophy, User, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useFormat, useT } from '@/lib/i18n/client';
import { poster } from '@/lib/lobby/posters';
import { LIVE_TABLES, LIVE_TABS, inLiveTab, type LiveTab, type LiveTable } from '@/lib/lobby/live';
import { useProduct } from '@/components/providers';
import s from './lobby.module.css';

const TAB_ICONS: Readonly<Record<LiveTab, LucideIcon>> = { featured: Trophy, exclusive: Gem, new: Sparkles, pool: Wallet };

/**
 * 888 "Live Casino" card: 16:9 art, bet range chip top-left, host and audience bottom-left, recent result chips
 * bottom-right (red = KOR, white = AYAZ / draw), title strip under the art. No invented numbers: the audience shows
 * "shared match" and the results chip says results are in the arena until a public feed exists (lib/lobby/live.ts).
 */
function LiveTableCard({ table }: { table: LiveTable }) {
  const t = useT('lobby');
  const tc = useT('common');
  const f = useFormat();
  const { activeDemo } = useProduct();
  const id = useId();
  const { game } = table;
  const art = poster(game.id, 'narrow') ?? poster(game.id, 'tile');
  const title = tc(`games.${game.id}`);
  const min = f.number(table.stakeCents.min / 100, 0), max = f.number(table.stakeCents.max / 100, 0);
  return <article className={s.liveCard}>
    <Link href={game.href} prefetch={false} className={s.liveCardLink} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} aria-disabled={activeDemo || undefined}
      onClick={event => { if (activeDemo) event.preventDefault(); }} data-testid={`live-table-${game.id}`}>
      <span className={s.liveCardArt} style={{ '--tone-a': game.tone[0], '--tone-b': game.tone[1] } as React.CSSProperties}>
        {art && <img src={art.src} width={art.width} height={art.height} alt="" loading="lazy" decoding="async" draggable={false} />}
        <span className={s.betRange} data-testid="live-bet-range"><span aria-hidden="true">{t('sx.live.range', { min, max })}</span><span className="sr-only">{t('sx.live.rangeAria', { min, max })}</span></span>
        <span className={s.liveHost} data-testid="live-host">
          <span title={t('sx.live.hostAria')}><User size={13} aria-hidden="true" />{t('sx.live.host')}<span className="sr-only"> ({t('sx.live.hostAria')})</span></span>
          <span><Users size={13} aria-hidden="true" />{t('sx.live.shared')}</span>
        </span>
        <span className={s.liveResults} data-testid="live-results" aria-label={t('sx.live.results')} role="group">
          {table.results.length > 0
            ? table.results.slice(0, 5).map((r, i) => <span key={i} className={s.resultChip} data-result={r}>{r === 'kor' ? 'K' : r === 'ayaz' ? 'A' : '='}</span>)
            : <span className={s.resultChip} data-result="none">{t('sx.live.resultsEmpty')}</span>}
        </span>
      </span>
      <span className={s.liveStrip}>
        <b id={`${id}-t`}>{title}</b>
        <span className={s.liveStatus} data-testid="live-status"><span className="live-dot" aria-hidden="true" />{t('sx.live.status')}</span>
      </span>
      <span id={`${id}-d`} className="sr-only">{t(`cards.${game.id}.tagline`)}</span>
    </Link>
  </article>;
}

/** Live casino section: tab bar (Featured, Exclusive, New, Pool betting) over a 16:9 card grid. */
export function LiveGrid({ onViewAll }: { onViewAll: () => void }) {
  const t = useT('lobby');
  return <section className={s.liveSection} aria-labelledby="row-live-title">
    <div className={s.rowHead}>
      <div className={s.rowTitles}><h2 id="row-live-title"><Radio size={18} className={s.rowIcon} aria-hidden="true" /><span className={s.rowTitleText}>{t('sx.live.title')}</span></h2></div>
      <div className={s.rowActions}><button type="button" className={s.viewAll} onClick={onViewAll} aria-label={t('row.viewAllAria', { title: t('sx.live.title') })}>{t('row.viewAll')}</button></div>
    </div>
    <Tabs.Root defaultValue="featured" className={s.liveTabs}>
      <Tabs.List className={s.liveTabList} aria-label={t('sx.live.tabs')}>
        {LIVE_TABS.map(tab => { const TabIcon = TAB_ICONS[tab]; return <Tabs.Trigger key={tab} value={tab} className={s.liveTab}><TabIcon size={15} aria-hidden="true" />{t(`sx.live.${tab}`)}</Tabs.Trigger>; })}
      </Tabs.List>
      {LIVE_TABS.map(tab => {
        const tables = LIVE_TABLES.filter(table => inLiveTab(table, tab));
        return <Tabs.Content key={tab} value={tab} className={s.liveGrid}>
          {tables.length > 0
            ? <ul>{tables.map(table => <li key={table.game.id}><LiveTableCard table={table} /></li>)}</ul>
            : <p className={s.liveEmpty}>{t('sx.live.empty')}</p>}
        </Tabs.Content>;
      })}
    </Tabs.Root>
  </section>;
}
