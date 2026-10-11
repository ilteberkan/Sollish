'use client';
import { useState } from 'react';
import { GameHeading, type Mode } from '../game-common';
/** Placeholder until the playable table lands. */
export function CascadeGame() {
  const [mode, setMode] = useState<Mode>('demo');
  return <div className="game-page"><GameHeading title="Candy Cascade" subtitle="Sekiz eşleşmede patlat, düşen şekerlerle zincir kur." mode={mode} setMode={setMode} active={false}/>
    <section className="game-table" aria-label="Candy Cascade oyun masası"><div className="stage-readout gated-readout"><h2>Masa hazırlanıyor</h2><p>Candy Cascade çok yakında burada olacak.</p></div></section>
  </div>;
}
