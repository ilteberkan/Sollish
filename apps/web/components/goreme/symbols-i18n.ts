'use client';
import { useMemo } from 'react';
import type { GoremeSymbol as EngineSymbol } from '@sollish/protocol';
import { useT } from '@/lib/i18n/client';

export { GR_PALETTE, GoremeSymbol, GoremeSymbolArt, GoremeSymbolSprites } from './symbols';

const IDS: readonly EngineSymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5', 'balloon', 'sun'];
/** Symbol names in the active language (`goreme.symbols.<id>`); the art keeps its Turkish defaults for the lab only. */
export function useGoremeSymbolLabels(): Readonly<Record<EngineSymbol, string>> {
  const t = useT('goreme');
  return useMemo(() => Object.fromEntries(IDS.map(id => [id, t(`symbols.${id}`)])) as Record<EngineSymbol, string>, [t]);
}
