import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export const CloseIcon = (p: IconProps) => <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const MinusIcon = (p: IconProps) => <svg {...base} {...p}><path d="M5 12h14" /></svg>;
export const PlusIcon = (p: IconProps) => <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const ChevronLeftIcon = (p: IconProps) => <svg {...base} {...p}><path d="M15 5l-7 7 7 7" /></svg>;
export const ChevronRightIcon = (p: IconProps) => <svg {...base} {...p}><path d="M9 5l7 7-7 7" /></svg>;
export const GridIcon = (p: IconProps) => <svg {...base} {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></svg>;
export const ClockIcon = (p: IconProps) => <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
export const InfoIcon = (p: IconProps) => <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>;
export const WarnIcon = (p: IconProps) => <svg {...base} {...p}><path d="M12 4l9 16H3L12 4z" /><path d="M12 10v4.5M12 17.5h.01" /></svg>;
