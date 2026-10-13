import type { CSSProperties } from 'react';
export function Icon({ name, size = 20, className = '', style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const paths: Record<string, React.ReactNode> = {
    crash: <><path d="M3 18h18M4 15l5-3 4 1 7-9"/><path d="m15 4 5 0 0 5"/></>,
    coin: <><ellipse cx="12" cy="12" rx="8" ry="9"/><path d="M12 7v10m-3-8h4a2 2 0 0 1 0 4h-2a2 2 0 0 0 0 4h3"/></>,
    candy: <><circle cx="12" cy="12" r="5"/><path d="M7.2 9.4 3 7.5l1.2 4.5L3 16.5l4.2-1.9M16.8 9.4 21 7.5l-1.2 4.5 1.2 4.5-4.2-1.9"/><path d="M10 10.5a3 3 0 0 1 3-1.2"/></>,
    storm: <><path d="M5 9.5a4.5 4.5 0 0 1 8.6-1.9A3.6 3.6 0 0 1 19.5 10a3 3 0 0 1-1 5.5H6.8A3.3 3.3 0 0 1 5 9.5Z"/><path d="m12.5 12.5-2.2 4h3l-1.8 4.5"/><path d="M7 4.5 5.5 3M17 4.5 18.5 3"/></>,
    ink: <><path d="M12 3c2.8 3.6 4.6 6 4.6 8.4a4.6 4.6 0 0 1-9.2 0C7.4 9 9.2 6.6 12 3Z"/><path d="M10 12.2a2 2 0 0 0 2 1.8"/><path d="M4 20.5h16M6 20.5v-2.5M9.3 20.5v-2.5M12.6 20.5v-2.5M15.9 20.5v-2.5M19 20.5v-2.5"/></>,
    boxing: <><path d="M8 16 5 12a3 3 0 0 1 0-4l1-1a2 2 0 0 1 3 0V6a3 3 0 0 1 3-3h4a4 4 0 0 1 4 4v4a6 6 0 0 1-3 5"/><path d="M8 16h9v5H8zm1-9v5m-1 7h9"/></>,
    gift: <><rect x="4" y="10" width="16" height="11" rx="1"/><path d="M3 6h18v4H3zm9 0v15"/><path d="M12 6H8a2.5 2.5 0 1 1 2.5-2.5L12 6Zm0 0h4a2.5 2.5 0 1 0-2.5-2.5L12 6Z"/></>,
    stake: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></>,
    wallet: <><path d="M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M15 11h6v6h-6z"/><path d="M17.5 14h.1"/></>,
    chat: <><path d="M20 15a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z"/><path d="M7 8h9M7 12h6"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    shield: <><path d="m12 3 8 3v6c0 4-4 7-8 10-4-3-8-6-8-10V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/></>,
    history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    link: <><path d="m9 15 6-6m-6 1-2-2 4-4a4 4 0 0 1 6 6l-2 2m0 2 2 2-4 4a4 4 0 0 1-6-6l2-2"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    exit: <><path d="M10 4H4v16h6m4-5 4-3-4-3m-5 3h12"/></>,
    sound: <><path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name] ?? paths.info}</svg>;
}
export function BrandMark({ className = '' }: { className?: string }) {
  return <svg className={className} width="30" height="32" viewBox="0 0 30 32" fill="none" aria-hidden="true"><path d="M25 5H10L4 12h16l6 7-7 8H4" stroke="currentColor" strokeWidth="4" strokeLinecap="square" strokeLinejoin="bevel"/><path d="M25 5 4 27" stroke="currentColor" strokeWidth="1.4"/></svg>;
}
