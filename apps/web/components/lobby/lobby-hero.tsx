'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { poster } from '@/lib/lobby/posters';
import { lobbyStats } from '@/lib/lobby/stats';
import { LOBBY_GAMES } from '@/lib/lobby/games';
import { useProduct } from '@/components/providers';
import { StatChips, usePrefetch } from './lobby-tile';
import s from './lobby.module.css';

const SLIDES = LOBBY_GAMES.filter(g => g.hero !== null).sort((a, b) => a.hero! - b.hero!);
const ROTATE_MS = 7000;

/** 888 promo headline: the brand word in the accent italic, the rest plain ("Göreme: Şafak Balonları" → *Göreme*
 * Şafak Balonları). Names without a colon accent their first word. */
export function splitHeadline(title: string): [string, string] {
  const at = title.search(/[:：]/);
  if (at > 0) return [title.slice(0, at).trim(), title.slice(at + 1).trim()];
  const space = title.indexOf(' ');
  return space > 0 ? [title.slice(0, space), title.slice(space + 1)] : [title, ''];
}

/**
 * Featured carousel (WAI-ARIA APG "auto-rotating carousel"): a scroll-snap strip (native swipe), previous/next and one
 * picker button per slide. Rotation runs only while the strip is on screen, the tab is visible, nothing inside has hover
 * or focus and the player has not paused it; reduced motion never rotates. Slides are fixed aspect boxes (no shift);
 * only the first poster loads eagerly (LCP), the others lazily.
 */
export function LobbyHero() {
  const t = useT('lobby');
  const tc = useT('common');
  const { activeDemo } = useProduct();
  const strip = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting) && document.visibilityState === 'visible'), { threshold: 0.5 });
    io.observe(el);
    const onVis = () => { if (document.visibilityState !== 'visible') setVisible(false); else io.takeRecords(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const goTo = useCallback((next: number, smooth = true) => {
    const el = strip.current;
    if (!el) return;
    const n = (next + SLIDES.length) % SLIDES.length;
    el.scrollTo({ left: n * el.clientWidth * (document.dir === 'rtl' ? -1 : 1), behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    setIndex(n);
  }, []);
  // The visible slide follows the scroll position (swipe, keyboard scroll, buttons).
  const onScroll = () => {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    const n = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    if (n !== index && n >= 0 && n < SLIDES.length) setIndex(n);
  };
  const rotating = !paused && !held && visible && !reduced;
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => goTo(index + 1), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [rotating, index, goTo]);
  const game = SLIDES[index]!;
  const prefetch = usePrefetch(game.href);
  // The active slide's route is the likeliest next click: prefetch it once the hero has been on screen a while, but
  // never on Save-Data or slow connections.
  useEffect(() => {
    if (!visible) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || (connection?.effectiveType && connection.effectiveType !== '4g')) return;
    const timer = window.setTimeout(prefetch, 2500);
    return () => window.clearTimeout(timer);
  }, [visible, prefetch]);

  return <section ref={root} className={s.hero} aria-roledescription="carousel" aria-label={t('hero.region')}
    onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
    onFocus={() => setHeld(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHeld(false); }}>
    <div ref={strip} className={s.heroStrip} onScroll={onScroll} aria-live={rotating ? 'off' : 'polite'}>
      {SLIDES.map((slide, i) => {
        const wide = poster(slide.id, 'wide'), narrow = poster(slide.id, 'narrow');
        const title = tc(`games.${slide.id}`);
        return <div key={slide.id} className={s.slide} role="group" aria-roledescription="slide" aria-label={t('hero.slide', { index: i + 1, total: SLIDES.length })} inert={i !== index ? true : undefined}
          style={{ '--tone-a': slide.tone[0], '--tone-b': slide.tone[1] } as React.CSSProperties}>
          <picture className={s.slideArt}>
            {wide && <source media="(min-width: 800px)" srcSet={wide.src} width={wide.width} height={wide.height} />}
            {narrow && <img src={narrow.src} width={narrow.width} height={narrow.height} alt="" loading={i === 0 ? 'eager' : 'lazy'} fetchPriority={i === 0 ? 'high' : 'low'} decoding="async" draggable={false} />}
          </picture>
          <div className={s.slideCopy}>
            <h2 className={s.slideTitle}>{(() => { const [accent, rest] = splitHeadline(title); return <><em className="accent">{accent}</em>{rest && <> {rest}</>}</>; })()}</h2>
            <p className={s.slideText}>{t(`cards.${slide.id}.tagline`)}</p>
            <StatChips stats={lobbyStats(slide.id)} />
            <div className={s.slideActions}>
              <Link href={slide.href} prefetch={false} className={s.limeCta} aria-disabled={activeDemo || undefined} onClick={event => { if (activeDemo) event.preventDefault(); }}
                onPointerEnter={i === index ? prefetch : undefined} onFocus={i === index ? prefetch : undefined}>
                {t('hero.play')}<span className="sr-only">: {title}</span>
              </Link>
              <span className={s.demoNote}>{t('tile.demo')} · {t('tile.provider')}</span>
            </div>
          </div>
        </div>;
      })}
    </div>
    <button type="button" className={s.heroArrow} data-side="prev" aria-label={t('hero.prev')} onClick={() => goTo(index - 1)}><ChevronLeft size={22} className={s.dirIcon} aria-hidden="true" /></button>
    <button type="button" className={s.heroArrow} data-side="next" aria-label={t('hero.next')} onClick={() => goTo(index + 1)}><ChevronRight size={22} className={s.dirIcon} aria-hidden="true" /></button>
    <div className={s.heroControls}>
      <div className={s.dots}>{SLIDES.map((slide, i) => <button key={slide.id} type="button" className={s.dot} aria-current={i === index ? 'true' : undefined} aria-label={t('hero.goTo', { name: tc(`games.${slide.id}`) })} onClick={() => goTo(i)}><span /></button>)}</div>
      <button type="button" className={s.heroPause} aria-label={paused ? t('hero.resume') : t('hero.pause')} onClick={() => setPaused(p => !p)} hidden={reduced}>{paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</button>
    </div>
  </section>;
}
