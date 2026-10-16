'use client';
import { useCallback } from 'react';
import { useT } from '@/lib/i18n/client';

const two = (n: number) => String(n).padStart(2, '0');

/** Localized session length: "45 s", "12 min", "1 h 05 min" (en) / "45 sn", "12 dk", "1 sa 05 dk" (tr). */
export function useDuration(): (ms: number) => string {
  const t = useT('common');
  return useCallback((ms: number) => {
    const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0) return t('duration.hoursMinutes', { h: String(hours), mm: two(minutes) });
    if (minutes > 0) return t('duration.minutes', { m: String(minutes) });
    return t('duration.seconds', { s: String(total) });
  }, [t]);
}
