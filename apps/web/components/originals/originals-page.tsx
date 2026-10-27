'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import s from './originals.module.css';

/**
 * Page frame of a Sollish Originals game (Coinflip, Crash, Damla). Holds the per-viewer theatre choice and the page
 * element the info bar's full-screen button looks in (`[data-originals-table]`). Presentation only.
 */
interface OriginalsFrame { theatre: boolean; setTheatre: (on: boolean) => void; pageRef: RefObject<HTMLDivElement | null> }
const Frame = createContext<OriginalsFrame | null>(null);
const THEATRE_KEY = 'sollish:originals:theatre';

export function useOriginalsFrame(): OriginalsFrame {
  const frame = useContext(Frame);
  if (!frame) throw new Error('useOriginalsFrame outside <OriginalsPage>');
  return frame;
}

export function OriginalsPage({ children, className = '' }: { children: ReactNode; className?: string }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [theatre, setTheatreState] = useState(false);
  useEffect(() => { try { if (window.localStorage.getItem(THEATRE_KEY) === '1') setTheatreState(true); } catch { /* storage blocked */ } }, []);
  const setTheatre = useCallback((on: boolean) => {
    setTheatreState(on);
    try { window.localStorage.setItem(THEATRE_KEY, on ? '1' : '0'); } catch { /* not remembered */ }
  }, []);
  return (
    <Frame value={{ theatre, setTheatre, pageRef }}>
      <div ref={pageRef} className={`game-page ${s.page} ${className}`} data-theatre={theatre ? '' : undefined} data-originals-page="">{children}</div>
    </Frame>
  );
}

/** Bet panel (left; under the stage on phones) and game stage (right). */
export function OriginalsTable({ label, panel, stage, className = '', panelLabel }: { label: string; panel: ReactNode; stage: ReactNode; className?: string; panelLabel?: string }) {
  return (
    <section className={`${s.table} ${className}`} aria-label={label} data-originals-table="">
      <div className={s.panel} role={panelLabel ? 'group' : undefined} aria-label={panelLabel} data-testid="originals-panel">{panel}</div>
      <div className={s.stage} data-testid="originals-stage">{stage}</div>
    </section>
  );
}
