'use client';
import { useLayoutEffect, type RefObject } from 'react';

/**
 * Writes the element's page offset (px from the document top) to `--fit-top` on it, so phone CSS can size a game
 * table to the first screen: `height: calc(100svh - var(--fit-top))`. Presentation only; it never touches game state.
 */
export function useViewportTop(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = '';
    const update = () => {
      const top = `${Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY))}px`;
      if (top !== last) { last = top; el.style.setProperty('--fit-top', top); }
    };
    update();
    window.addEventListener('resize', update);
    // the heading above can change height (mode badge, locale); its size moves the table's top
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const parent = el.parentElement;
    if (observer && parent) for (const child of Array.from(parent.children)) if (child !== el) observer.observe(child);
    return () => { window.removeEventListener('resize', update); observer?.disconnect(); };
  }, [ref]);
}
