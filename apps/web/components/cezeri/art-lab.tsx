'use client';

import { CezeriBoard } from './board';
import type { CezeriSymbol } from '@sollish/protocol';
import { CEZERI_SYMBOLS, CEZERI_SYMBOL_LABELS, CezeriSymbolArt, CezeriSymbolSprites, CezeriSymbolUse } from './symbols';

export function CezeriArtLab() {
  return (
    <main style={{ position: 'fixed', inset: 0, zIndex: 60, overflow: 'auto', background: '#120c08', color: '#f4ead6', padding: 20 }}>
      <CezeriSymbolSprites />
      <div style={{ width: 760 }}><CezeriBoard initial={Array.from({ length: 4 }, (_, r) => Array.from({ length: 12 }, (_, i) => CEZERI_SYMBOLS[(i * 3 + r * 5) % 10] as CezeriSymbol))} hubValue={3} /></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {CEZERI_SYMBOLS.map((s) => (
          <figure key={s} style={{ margin: 0, padding: 10, background: 'radial-gradient(#173a44,#08161c)', borderRadius: 12 }}>
            <CezeriSymbolArt symbol={s} size={150} />
            <figcaption style={{ textAlign: 'center', fontSize: 12 }}>{CEZERI_SYMBOL_LABELS[s]}</figcaption>
          </figure>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, background: '#0c1a40', padding: 8 }}>{CEZERI_SYMBOLS.map((s) => <div key={s} style={{ width: 28, height: 28 }}><CezeriSymbolUse symbol={s} /></div>)}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, background: '#0c1a40', padding: 8, filter: 'grayscale(1)' }}>{CEZERI_SYMBOLS.map((s) => <div key={s} style={{ width: 30, height: 30 }}><CezeriSymbolUse symbol={s} /></div>)}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, background: '#0c1a40', padding: 8 }}>{CEZERI_SYMBOLS.map((s) => <div key={s} style={{ width: 48, height: 48 }}><CezeriSymbolUse symbol={s} /></div>)}</div>
    </main>
  );
}
