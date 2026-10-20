'use client';
import { useMemo } from 'react';
import { useT } from './i18n/client';
import { rgsErrorCode } from './rgs-client';

/**
 * Translated texts for the server (RGS) path of the slot games, from the shared `slotKit` namespace
 * (loaded for every /game page): the error line of a failed request and the source badge of the heading.
 */
export function useRgsText() {
  const t = useT('slotKit');
  return useMemo(() => ({
    /** Player-facing text for a failed RGS request (`rgs.errors.<code>`). */
    error: (failure: unknown) => t(`rgs.errors.${rgsErrorCode(failure)}`),
    /** Heading badge: 'remote' = server-verified rounds, 'local' = local demo. */
    source: (kind: 'local' | 'remote') => t(`rgs.source.${kind}`),
  }), [t]);
}
