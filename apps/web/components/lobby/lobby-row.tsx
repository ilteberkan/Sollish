'use client';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import s from './lobby.module.css';

export type RowVariant = 'poster' | 'square' | 'round' | 'band' | 'mini';

/**
 * Horizontal row (888 / bet365 pattern): bold caps title left, "View all" pill and round prev/next buttons right, a
 * scroll-snap strip with an edge arrow over the last visible card (pointer devices). Arrow keys move between the
 * row's games; the edge arrow repeats the "next" button for the mouse and is hidden from assistive tech.
 */
export function Row({ id, title, subtitle, count, onViewAll, children, wide = false, action, variant = 'poster', icon }: {
  id: string; title: string; subtitle?: string; count?: number; onViewAll?: () => void; children: ReactNode; wide?: boolean; action?: ReactNode; variant?: RowVariant; icon?: ReactNode;
}) {
  const t = useT('lobby');
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const left = Math.abs(el.scrollLeft);
    setEdges({ start: left < 4, end: left + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  const page = (direction: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.9 * (document.dir === 'rtl' ? -1 : 1), behavior: reduce ? 'auto' : 'smooth' });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>(':scope > li > * > a, :scope > li > a'));
    const at = links.findIndex(a => a === document.activeElement || a.contains(document.activeElement));
    if (at < 0) return;
    const rtl = document.dir === 'rtl';
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : at + ((event.key === 'ArrowRight') !== rtl ? 1 : -1);
    if (next < 0 || next >= links.length) return;
    event.preventDefault();
    links[next]!.focus();
    links[next]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const titleId = `${id}-title`;
  const rowVariant = wide ? 'wide' : variant;
  return <section className={s.row} aria-labelledby={titleId} data-variant={rowVariant}>
    <div className={s.rowHead}>
      <div className={s.rowTitles}>
        <h2 id={titleId}>{icon}<span className={s.rowTitleText}>{title}</span>{count !== undefined && <span className={s.count}>{t('row.count', { count })}</span>}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className={s.rowActions}>
        {action}
        {onViewAll && <button type="button" className={s.viewAll} onClick={onViewAll} aria-label={t('row.viewAllAria', { title })}>{t('row.viewAll')}</button>}
        <button type="button" className={s.scrollButton} aria-label={t('row.prev', { title })} aria-controls={`${id}-list`} disabled={edges.start} onClick={() => page(-1)}><ChevronLeft size={18} className={s.dirIcon} aria-hidden="true" /></button>
        <button type="button" className={s.scrollButton} aria-label={t('row.next', { title })} aria-controls={`${id}-list`} disabled={edges.end} onClick={() => page(1)}><ChevronRight size={18} className={s.dirIcon} aria-hidden="true" /></button>
      </div>
    </div>
    <div className={s.rowViewport}>
      <ul id={`${id}-list`} ref={list} className={s.rowList} data-variant={rowVariant} onScroll={measure} onKeyDown={onKeyDown}>{children}</ul>
      {!edges.end && <div className={s.edgeArrow} aria-hidden="true" onClick={() => page(1)}><ChevronRight size={22} className={s.dirIcon} /></div>}
    </div>
  </section>;
}
