'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { containDialogFocus } from '@/lib/dialog';
import { CloseIcon } from './icons';
import { useT } from '@/lib/i18n/client';
import { cx } from './cx';
import styles from './kit.module.css';

type Phase = 'closed' | 'entering' | 'open' | 'closing';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Sticky footer (action buttons). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** false: Esc, backdrop click and the close button do nothing (use for responsible-play prompts). */
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
  /** id of an element inside the modal that describes it (recommended for alertdialog). */
  descriptionId?: string;
  closeLabel?: string;
  className?: string;
}

let scrollLocks = 0;
let savedOverflow = '';
let savedPadding = '';
function lockScroll() {
  if (scrollLocks++ > 0) return;
  const root = document.documentElement;
  const gutter = window.innerWidth - root.clientWidth;
  savedOverflow = root.style.overflow;
  savedPadding = document.body.style.paddingRight;
  root.style.overflow = 'hidden';
  if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;
}
function unlockScroll() {
  if (scrollLocks === 0 || --scrollLocks > 0) return;
  document.documentElement.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPadding;
}

const EXIT_MS = 220;
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Accessible dialog on the native `<dialog>` (top layer, inert page, Esc, focus return) plus a
 * Tab trap, aria-modal, scroll lock and a phone bottom-sheet layout under 600px.
 * Mark one control with `data-autofocus` to choose the initially focused element.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md', dismissible = true, role = 'dialog', descriptionId, closeLabel, className }: ModalProps) {
  const t = useT('slotKit');
  const ref = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>('closed');
  const titleId = useId();
  const locked = useRef(false);
  const wantOpen = useRef(open);
  const pressedBackdrop = useRef(false);

  useEffect(() => { wantOpen.current = open; }, [open]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open) {
      if (!node.open) node.showModal();
      if (!locked.current) { lockScroll(); locked.current = true; }
      node.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      setPhase('entering');
      let inner = 0;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setPhase('open')); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    if (node.open) {
      setPhase('closing');
      const finish = () => {
        if (node.open) node.close();
        if (locked.current) { unlockScroll(); locked.current = false; }
        setPhase('closed');
      };
      if (prefersReducedMotion()) { finish(); return; }
      const timer = window.setTimeout(finish, EXIT_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => () => {
    const node = ref.current;
    if (node?.open) node.close();
    if (locked.current) { unlockScroll(); locked.current = false; }
  }, []);

  const rendered = open || phase !== 'closed';
  return (
    <dialog
      ref={ref}
      className={cx(styles.kit, styles.modal, styles[`size_${size}`], className)}
      data-state={phase}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={containDialogFocus}
      onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}
      onClose={() => {
        // The browser can close a non-dismissible dialog (double Esc); reopen it while it is still wanted.
        const node = ref.current;
        if (node && wantOpen.current && !node.open) node.showModal();
      }}
      onPointerDown={event => { pressedBackdrop.current = event.target === event.currentTarget; }}
      onClick={event => { if (dismissible && pressedBackdrop.current && event.target === event.currentTarget) onClose(); pressedBackdrop.current = false; }}
    >
      {rendered && (
        <>
          <span className={styles.grip} aria-hidden="true" />
          <header className={styles.modalHead}>
            <h2 id={titleId} className={styles.modalTitle}>{title}</h2>
            {dismissible && (
              <button type="button" className={styles.iconBtn} onClick={onClose} aria-label={closeLabel ?? t('modal.close')}><CloseIcon /></button>
            )}
          </header>
          <div className={styles.modalBody}>{children}</div>
          {footer && <footer className={styles.modalFoot}>{footer}</footer>}
        </>
      )}
    </dialog>
  );
}
