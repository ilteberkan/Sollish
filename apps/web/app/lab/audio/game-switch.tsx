'use client';
/** Game switcher for the development audio lab: Candy Cascade, Tarhun: Fırtına Tahtı or Ebru: Mürekkep Bahçesi (one engine at a time). */
import { useEffect, useState, type CSSProperties } from 'react';
import { AudioLab } from '@/lib/slot-audio/lab-panel';
import { StormAudioLab } from '@/lib/slot-audio/storm-lab-panel';
import { EbruAudioLab } from '@/lib/slot-audio/ebru-lab-panel';

type Game = 'cascade' | 'storm' | 'ebru';
const GAMES: { id: Game; label: string; note: string }[] = [
  { id: 'cascade', label: 'Candy Cascade', note: 'Gece pastanesi: F majör temel tema, D minör özellik teması.' },
  { id: 'storm', label: 'Tarhun: Fırtına Tahtı', note: 'Tunç çağı fırtına tanrısı: A Hicaz temel tema, D Hicaz özellik teması; zurna, ney, bağlama, davul, darbuka, boru, erkek korosu, yağmur ve gök gürültüsü.' },
  { id: 'ebru', label: 'Ebru: Mürekkep Bahçesi', note: 'Su üstünde renkler: G Rast temel tema (Uşşak ve Hüzzam renkli bölümler), D Rast özellik teması; kanun, ud, ney, cam armonika, su bardakları, kudüm, bendir, zil, “ah” korosu ve su dokuları. İmza: satır kaymalarını izleyen tarak süzülmesi.' },
];
const tab: CSSProperties = { padding: '8px 14px', borderRadius: 999, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', font: 'inherit', fontSize: 15 };
const active: CSSProperties = { ...tab, border: '1px solid var(--accent)', color: 'var(--accent)' };

export function AudioLabSwitch() {
  const [game, setGame] = useState<Game>('cascade');
  useEffect(() => {
    try { const g = new URLSearchParams(window.location.search).get('game'); if (g === 'storm' || g === 'cascade' || g === 'ebru') setGame(g); } catch { /* no location */ }
  }, []);
  const pick = (g: Game) => {
    setGame(g);
    try { const url = new URL(window.location.href); url.searchParams.set('game', g); window.history.replaceState(null, '', url); } catch { /* ignore */ }
  };
  const current = GAMES.find(g => g.id === game)!;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div role="tablist" aria-label="Oyun" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {GAMES.map(g => <button key={g.id} type="button" role="tab" aria-selected={game === g.id} style={game === g.id ? active : tab} onClick={() => pick(g.id)}>{g.label}</button>)}
      </div>
      <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>{current.note}</p>
      {/* the key remounts the panel so the previous game's audio engine is disposed before the next one starts */}
      {game === 'cascade' ? <AudioLab key="cascade" /> : game === 'storm' ? <StormAudioLab key="storm" /> : <EbruAudioLab key="ebru" />}
    </div>
  );
}
