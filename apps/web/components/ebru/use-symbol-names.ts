'use client';
import { useMemo } from 'react';
import type { EbruSymbol } from '@sollish/protocol';
import { useT } from '@/lib/i18n/client';
import { inlineName } from '@/lib/slot-kit/inline-name';

/** Translated symbol names (symbols.tsx keeps the legacy Turkish `EBRU_SYMBOL_LABELS` for tests and the art lab). */
export function useEbruSymbolNames() {
  const t = useT('ebru');
  return useMemo(() => {
    const label = (symbol: EbruSymbol): string => t(`symbols.${symbol}`);
    return {
      label,
      /** Accessible name of a board cell: a stained cell carries its stain multiplier. */
      cell: (cell: { symbol: EbruSymbol; stain?: number }): string => (cell.stain ? t('symbols.stained', { name: label(cell.symbol), stain: String(cell.stain) }) : label(cell.symbol)),
      /** Mid-sentence form: lower-cased per language, but not in German (nouns stay capitalised). */
      inline: (symbol: EbruSymbol): string => inlineName(t.locale, label(symbol)),
    };
  }, [t]);
}
