'use client';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Modal } from './modal';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { cx } from './cx';
import styles from './kit.module.css';

export interface GameInfoPage { id: string; title: string; content: ReactNode }

export interface GameInfoProps {
  open: boolean;
  onClose: () => void;
  pages: ReadonlyArray<GameInfoPage>;
  title?: string;
  /** Page id shown first each time the dialog opens. */
  initialPageId?: string;
}

function GameInfoBody({ pages, initialPageId }: { pages: ReadonlyArray<GameInfoPage>; initialPageId?: string }) {
  const start = Math.max(0, pages.findIndex(page => page.id === initialPageId));
  const [index, setIndex] = useState(start);
  const base = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const last = pages.length - 1;
  const go = (next: number, focusTab = false) => {
    const clamped = Math.min(last, Math.max(0, next));
    setIndex(clamped);
    if (focusTab) tabRefs.current[clamped]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const onTab = target.getAttribute('role') === 'tab';
    if (event.key === 'ArrowRight' || (event.key === 'ArrowDown' && onTab)) { event.preventDefault(); go(index + 1, onTab); }
    else if (event.key === 'ArrowLeft' || (event.key === 'ArrowUp' && onTab)) { event.preventDefault(); go(index - 1, onTab); }
    else if (event.key === 'Home' && onTab) { event.preventDefault(); go(0, true); }
    else if (event.key === 'End' && onTab) { event.preventDefault(); go(last, true); }
    else if (event.key === 'PageDown') { event.preventDefault(); go(index + 1); }
    else if (event.key === 'PageUp') { event.preventDefault(); go(index - 1); }
  };
  const page = pages[index];
  if (!page) return null;
  return (
    <div className={styles.info} onKeyDown={onKeyDown}>
      <div className={styles.tabs} role="tablist" aria-label="Bilgi bölümleri">
        {pages.map((p, i) => (
          <button
            key={p.id}
            ref={node => { tabRefs.current[i] = node; }}
            id={`${base}-tab-${p.id}`}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={i === index}
            aria-controls={`${base}-panel`}
            tabIndex={i === index ? 0 : -1}
            data-autofocus={i === start ? '' : undefined}
            onClick={() => go(i)}
          >{p.title}</button>
        ))}
      </div>
      <div id={`${base}-panel`} className={styles.infoPanel} role="tabpanel" aria-labelledby={`${base}-tab-${page.id}`} tabIndex={0}>
        {page.content}
      </div>
      <nav className={styles.pager} aria-label="Sayfa gezintisi">
        <button type="button" className={cx(styles.btn, styles.btnGhost, styles.pagerBtn)} onClick={() => go(index - 1)} disabled={index === 0} aria-label="Önceki sayfa"><ChevronLeftIcon /><span className={styles.pagerText}>Önceki</span></button>
        <ol className={styles.dots}>
          {pages.map((p, i) => (
            <li key={p.id}>
              <button type="button" className={styles.dot} aria-label={`Sayfa ${i + 1} / ${pages.length}: ${p.title}`} aria-current={i === index ? 'page' : undefined} onClick={() => go(i)}><span /></button>
            </li>
          ))}
        </ol>
        <button type="button" className={cx(styles.btn, styles.btnGhost, styles.pagerBtn)} onClick={() => go(index + 1)} disabled={index === last} aria-label="Sonraki sayfa"><span className={styles.pagerText}>Sonraki</span><ChevronRightIcon /></button>
      </nav>
      <p className={styles.srOnly} role="status" aria-live="polite">{`Sayfa ${index + 1} / ${pages.length}: ${page.title}`}</p>
    </div>
  );
}

/** Multi-page game information dialog: tab strip, previous/next, page dots, arrow/PageUp/PageDown keys. */
export function GameInfo({ open, onClose, pages, title = 'Oyun bilgisi', initialPageId }: GameInfoProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {pages.length > 0 ? <GameInfoBody pages={pages} initialPageId={initialPageId} /> : <p className={styles.note}>Bilgi sayfası yok.</p>}
    </Modal>
  );
}
