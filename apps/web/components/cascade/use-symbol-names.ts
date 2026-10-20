'use client';
import { useMemo } from 'react';
import { useT } from '@/lib/i18n/client';
import { inlineName } from '@/lib/slot-kit/inline-name';
import type { CascadeArtSymbol } from './symbols';

/** Translated symbol names (symbols.tsx keeps the legacy Turkish `SYMBOL_LABELS` for tests and the art lab). */
export function useSymbolNames() {
  const t = useT('cascade');
  return useMemo(() => {
    const label = (symbol: CascadeArtSymbol): string => t(`symbols.${symbol}`);
    return {
      label,
      /** Accessible name of a board cell: the crystal carries its value. */
      cell: (cell: { symbol: CascadeArtSymbol; multiplier?: number }): string =>
        cell.symbol === 'crystal' && cell.multiplier ? t('symbols.crystalValue', { name: label('crystal'), value: String(cell.multiplier) }) : label(cell.symbol),
      /** Mid-sentence form: lower-cased per language, but not in German (nouns stay capitalised). */
      inline: (symbol: CascadeArtSymbol): string => inlineName(t.locale, label(symbol)),
    };
  }, [t]);
}
