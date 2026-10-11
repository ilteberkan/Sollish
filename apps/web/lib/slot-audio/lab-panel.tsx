'use client';
/**
 * Development-only listening panel for the slot audio (rendered by /lab/audio, which 404s in production).
 * Every sound, scene, stinger and bus can be triggered and mixed by hand.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createCascadeSound, type CascadeSound, type LoadProgress } from './cascade-sound';
import { CASCADE_SCORES, type CascadeScoreId } from './scores/cascade';
import { CASCADE_SFX } from './sfx/cascade';
import { DEFAULT_MIX, type MixSettings, type SceneId } from './timing';

const card: CSSProperties = { border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--surface)', display: 'grid', gap: 10 };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
const btn: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', font: 'inherit', fontSize: 14 };
const on: CSSProperties = { ...btn, border: '1px solid var(--accent)', color: 'var(--accent)' };
const small: CSSProperties = { color: 'var(--muted)', fontSize: 13, margin: 0 };

const SCENES: SceneId[] = ['idle', 'base', 'feature', 'bigwin', 'none'];
const STINGERS: CascadeScoreId[] = ['fsIntro', 'fsOutro', 'bigWin1', 'bigWin2', 'bigWin3', 'maxWin', 'bed1', 'bed2', 'bed3'];

export function AudioLab() {
  const sound = useRef<CascadeSound | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mix, setMix] = useState<MixSettings>({ ...DEFAULT_MIX });
  const [scene, setSceneState] = useState<SceneId>('none');
  const [demo, setDemo] = useState(false);
  const [counting, setCounting] = useState(false);
  const [tease, setTease] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const s = createCascadeSound();
    sound.current = s;
    return () => { s.dispose(); sound.current = null; };
  }, []);
  useEffect(() => {
    const id = setInterval(() => { const s = sound.current?.status(); if (s) setStatus(`core ${s.core ? 'ready' : '…'} · all ${s.extended ? 'ready' : '…'} · workers ${s.workers} (${s.workerJobs} jobs${s.workerFailure ? `, fell back: ${s.workerFailure}` : ''}) · ${Object.entries(s.renderMs).map(([k, v]) => `${k} ${v} ms`).join(' · ')}`); }, 500);
    return () => clearInterval(id);
  }, []);

  const s = () => sound.current;
  const start = useCallback(async () => {
    const x = s(); if (!x) return;
    x.setMix({ ...mix, muted: false }); x.setEnabled(true); setEnabled(true);
    await x.resume();
    void x.load(setProgress);
  }, [mix]);
  const changeMix = (patch: Partial<MixSettings>) => { const next = { ...mix, ...patch }; setMix(next); s()?.setMix(next); };
  const scenePick = (id: SceneId) => { s()?.setScene(id); setSceneState(id); };

  // cross-fade demo: idle → base → feature → base, one switch every 6 s (each lands on the next bar line)
  useEffect(() => {
    if (!demo) return;
    const order: SceneId[] = ['idle', 'base', 'feature', 'base'];
    let i = 0;
    scenePick(order[0]!);
    const id = setInterval(() => { i = (i + 1) % order.length; scenePick(order[i]!); }, 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const landSweep = () => { for (let c = 0; c < 6; c++) setTimeout(() => s()?.land(c), c * 70); };
  const slider = (key: keyof Omit<MixSettings, 'muted'>, label: string) => (
    <label style={{ display: 'grid', gap: 4, minWidth: 150, flex: '1 1 150px' }}>
      <span style={small}>{label}: {Math.round(mix[key] * 100)}</span>
      <input type="range" min={0} max={1} step={0.01} value={mix[key]} onChange={e => changeMix({ [key]: Number(e.target.value) })} />
    </label>
  );
  const pct = progress ? Math.round((100 * progress.done) / Math.max(1, progress.total)) : 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={card} aria-labelledby="a-start">
        <h2 id="a-start" style={{ margin: 0, fontSize: 18 }}>Başlat ve yükle</h2>
        <div style={row}>
          <button type="button" style={enabled ? on : btn} onClick={() => void start()}>{enabled ? 'Ses açık' : 'Sesi aç (dokunuş)'}</button>
          <button type="button" style={btn} onClick={() => { s()?.setEnabled(false); setEnabled(false); }}>Sesi kapat</button>
          <span style={small} aria-live="polite">{progress ? `${progress.phase} ${pct}% · ${progress.label} · ${Math.round(progress.ms)} ms` : 'Henüz yüklenmedi'}</span>
        </div>
        <progress max={100} value={pct} style={{ width: '100%' }} aria-label="Yükleme ilerlemesi" />
        <p style={small}>{status}</p>
      </section>

      <section style={card} aria-labelledby="a-mix">
        <h2 id="a-mix" style={{ margin: 0, fontSize: 18 }}>Miks</h2>
        <div style={row}>
          {slider('master', 'Ana')}{slider('music', 'Müzik')}{slider('sfx', 'Efekt')}{slider('ambience', 'Ortam')}
          <label style={row}><input type="checkbox" checked={mix.muted} onChange={e => changeMix({ muted: e.target.checked })} /> Sessiz</label>
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.duck(12, 1500)}>Ducking −12 dB / 1,5 sn</button>
        </div>
      </section>

      <section style={card} aria-labelledby="a-scene">
        <h2 id="a-scene" style={{ margin: 0, fontSize: 18 }}>Sahne müziği</h2>
        <div style={row}>
          {SCENES.map(id => <button key={id} type="button" style={scene === id ? on : btn} onClick={() => scenePick(id)}>{id}</button>)}
          <button type="button" style={demo ? on : btn} onClick={() => setDemo(d => !d)}>{demo ? 'Crossfade demosu: açık' : 'Crossfade demosu'}</button>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {(['base', 'idle', 'feature', 'ambience'] as const).map(id => <li key={id} style={small}><strong>{id}</strong>: {CASCADE_SCORES[id].about}</li>)}
        </ul>
      </section>

      <section style={card} aria-labelledby="a-game">
        <h2 id="a-game" style={{ margin: 0, fontSize: 18 }}>Oyun olayları (API)</h2>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.spinStart()}>spinStart</button>
          <button type="button" style={btn} onClick={landSweep}>land 0…5</button>
          <button type="button" style={btn} onClick={() => s()?.symbolLand()}>symbolLand</button>
          <button type="button" style={btn} onClick={() => s()?.pop(8, 0)}>pop 8</button>
          <button type="button" style={btn} onClick={() => s()?.pop(10, 1)}>pop 10</button>
          <button type="button" style={btn} onClick={() => s()?.pop(14, 2)}>pop 14</button>
          <button type="button" style={btn} onClick={() => s()?.win(2)}>win 2×</button>
          <button type="button" style={btn} onClick={() => s()?.win(60)}>win 60×</button>
          <button type="button" style={btn} onClick={() => s()?.tumble()}>tumble</button>
          <button type="button" style={btn} onClick={() => s()?.crystal(5)}>crystal land</button>
          <button type="button" style={btn} onClick={() => s()?.collect()}>crystal fly</button>
          <button type="button" style={btn} onClick={() => s()?.crystalArrive(25)}>crystal arrive</button>
          <button type="button" style={btn} onClick={() => s()?.multiplierApply(12)}>multiplier ×12</button>
          {[1, 2, 3, 4, 5, 6].map(n => <button key={n} type="button" style={btn} onClick={() => s()?.scatter(n)}>scatter {n}</button>)}
          <button type="button" style={tease ? on : btn} onClick={() => { s()?.scatterTease(!tease); setTease(t => !t); }}>scatter tease</button>
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.freeSpinsIntro()}>freeSpinsIntro</button>
          <button type="button" style={btn} onClick={() => { s()?.freeSpinsIntro(); s()?.setScene('feature'); setSceneState('feature'); }}>intro → feature</button>
          <button type="button" style={btn} onClick={() => { s()?.featureOutro(); s()?.setScene('base'); setSceneState('base'); }}>outro → base</button>
          {[1, 2, 3].map(t => <button key={t} type="button" style={btn} onClick={() => s()?.bigWin(t as 1 | 2 | 3)}>bigWin {t}</button>)}
          <button type="button" style={btn} onClick={() => s()?.maxWin()}>maxWin</button>
          <button type="button" style={counting ? on : btn} onClick={() => { s()?.countUp(!counting); setCounting(c => !c); }}>{counting ? 'countUp: durdur' : 'countUp: başlat'}</button>
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.click()}>click</button>
          <button type="button" style={btn} onClick={() => s()?.betChange(1)}>bet +</button>
          <button type="button" style={btn} onClick={() => s()?.betChange(-1)}>bet −</button>
          <button type="button" style={btn} onClick={() => s()?.denied()}>denied</button>
          <button type="button" style={btn} onClick={() => s()?.autoplay(true)}>autoplay on</button>
          <button type="button" style={btn} onClick={() => s()?.autoplay(false)}>autoplay off</button>
        </div>
      </section>

      <section style={card} aria-labelledby="a-raw">
        <h2 id="a-raw" style={{ margin: 0, fontSize: 18 }}>Ham kayıtlar</h2>
        <div style={row}>
          {STINGERS.map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playStinger(id)} title={CASCADE_SCORES[id].about}>{id}</button>)}
        </div>
        <div style={row}>
          {CASCADE_SFX.map(d => <button key={d.id} type="button" style={btn} onClick={() => s()?.playSfx(d.id)} title={`${d.variations} varyasyon · ${d.level}`}>{d.id}</button>)}
        </div>
      </section>
    </div>
  );
}
