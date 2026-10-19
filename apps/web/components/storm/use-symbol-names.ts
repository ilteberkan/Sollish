'use client';
import { useMemo } from 'react';
import type { StormSymbol } from '@sollish/protocol';
import { useT } from '@/lib/i18n/client';

/** Translated symbol names (symbols.tsx keeps the legacy Turkish `STORM_SYMBOL_LABELS` for tests). */
export function useStormSymbolNames() {
  const t = useT('tarhun');
  return useMemo(() => {
    const label = (symbol: StormSymbol): string => t(`symbols.${symbol}`);
    return {
      label,
      /** Accessible name of a board cell: the Storm Stone carries its value. */
      cell: (cell: { symbol: StormSymbol; multiplier?: number }): string =>
        cell.symbol === 'orb' && cell.multiplier ? t('symbols.orbValue', { name: label('orb'), value: String(cell.multiplier) }) : label(cell.symbol),
      /** Mid-sentence form: lower-cased per language, but not in German (nouns stay capitalised). */
      inline: (symbol: StormSymbol): string => (t.locale === 'de' ? label(symbol) : label(symbol).toLocaleLowerCase(t.locale === 'tr' ? 'tr-TR' : t.locale)),
    };
  }, [t]);
}
