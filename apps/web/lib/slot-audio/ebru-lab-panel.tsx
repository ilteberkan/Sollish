'use client';
/**
 * Development-only listening panel for the Ebru: Mürekkep Bahçesi sound (rendered by /lab/audio, which 404s in
 * production). Every scene, stinger, effect, tier, callout, comb sweep and voice slot can be triggered by hand.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { EBRU_CALLOUT_VALUES, createEbruSound, type EbruSound, type LoadProgress } from './ebru-sound';
import { EBRU_SCORES, type EbruScoreId } from './scores/ebru';
import { EBRU_SFX } from './sfx/ebru';
import { EBRU_CALLOUT_CLASSES, EBRU_INKS, EBRU_VOICE_TEXT } from './ebru-tiers';
import { MULTIPLIER_CLASS_MIN, WIN_TIERS, WIN_TIER_NAMES, WIN_TIER_THRESHOLDS, type WinTier } from './win-tiers';
import { DEFAULT_MIX, type MixSettings, type SceneId } from './timing';

const card: CSSProperties = { border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--surface)', display: 'grid', gap: 10 };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
const btn: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', font: 'inherit', fontSize: 14 };
const on: CSSProperties = { ...btn, border: '1px solid var(--accent)', color: 'var(--accent)' };
const small: CSSProperties = { color: 'var(--muted)', fontSize: 13, margin: 0 };

const SCENES: SceneId[] = ['idle', 'base', 'feature', 'bigwin', 'none'];
const STINGERS: EbruScoreId[] = ['fsIntro', 'retrigger', 'fsOutro', 'totalWin', 'bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'bed1', 'bed2', 'bed3', 'bed4', 'bedMax'];
const VOICE_FOLDER = '/audio/voice/ebru';
const SIN = Array.from({ length: 64 }, (_, i) => Math.round(1000 * Math.sin((2 * Math.PI * i) / 64)));
/** The engine's comb shifts for amplitude A, phase p and row step q (same integer formula as packages/protocol/src/ebru.ts). */
const combShifts = (A: number, p: number, q: number) => Array.from({ length: 7 }, (_, r) => { const x = (A * SIN[(p + r * q) % 64]!) / 1000; return Math.sign(x) * Math.round(Math.abs(x)); });
const COMBS: { label: string; shifts: number[] }[] = [
  { label: 'A1 p0 q4 (dar)', shifts: combShifts(1, 0, 4) },
  { label: 'A2 p8 q6', shifts: combShifts(2, 8, 6) },
  { label: 'A3 p0 q10 (geniş)', shifts: combShifts(3, 0, 10) },
  { label: 'A3 p16 q3', shifts: combShifts(3, 16, 3) },
];

export function EbruAudioLab() {
  const sound = useRef<EbruSound | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mix, setMix] = useState<MixSettings>({ ...DEFAULT_MIX });
  const [scene, setSceneState] = useState<SceneId>('none');
  const [counting, setCounting] = useState(false);
  const [tease, setTease] = useState(false);
  const [status, setStatus] = useState('');
  const [ladder, setLadder] = useState<string | null>(null);
  const [voiceBank, setVoiceBank] = useState('');
  const [combMs, setCombMs] = useState(1400);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const s = createEbruSound();
    sound.current = s;
    return () => { s.dispose(); sound.current = null; };
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      const s = sound.current?.status(); if (!s) return;
      setStatus(`core ${s.core ? 'ready' : '…'} · all ${s.extended ? 'ready' : '…'} · workers ${s.workers} (${s.workerJobs} jobs${s.workerFailure ? `, fell back: ${s.workerFailure}` : ''}) · kutlama: kademe ${s.celebration.tier}${s.celebration.max ? ' + azami' : ''}${s.celebration.counting ? ' · sayıyor' : ''}${s.celebration.bed ? ` · ${s.celebration.bed}` : ''} · ses: ${s.voice.speaking ?? '—'} (${s.voice.loaded} kayıt) · ${Object.entries(s.renderMs).map(([k, v]) => `${k} ${v} ms`).join(' · ')}`);
    }, 500);
    return () => { clearInterval(id); for (const t of timers.current) clearTimeout(t); };
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
  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

  const runLadder = (withMax: boolean) => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    const x = s(); if (!x) return;
    x.countUp(false);
    const plan: [number, string, () => void][] = [
      [0, 'Büyük', () => { x.bigWin(1); x.countUp(true); setCounting(true); }],
      [3000, 'Mega', () => x.bigWin(2)],
      [5500, 'Süper', () => x.bigWin(3)],
      [8000, 'Efsane', () => x.bigWin(4)],
      ...(withMax ? [[11000, 'Azami kazanç', () => x.maxWin()] as [number, string, () => void]] : []),
      [withMax ? 18000 : 12500, 'iniş', () => { x.countUp(false); setCounting(false); }],
      [withMax ? 20000 : 14500, '', () => {}],
    ];
    for (const [ms, label, fn] of plan) later(ms, () => { fn(); setLadder(label || null); });
  };
  /** A base-game spin as the game would drive it from the engine steps. */
  const spinDemo = () => {
    const x = s(); if (!x) return;
    x.spinStart();
    for (let c = 0; c < 7; c++) later(250 + c * 70, () => x.dropIn(c));
    later(850, () => x.bleed('c3', 3));
    later(1250, () => { x.winHighlight(2); x.clusterDissolve('c3', 7); });
    later(1500, () => x.clusterDissolve('c1', 12));
    later(1900, () => x.fall());
    later(2500, () => x.combSweep(COMBS[2]!.shifts, combMs, { pass: 1, createsWin: true }));
    later(2500 + combMs + 200, () => x.clusterDissolve('c5', 9));
    later(2500 + combMs + 600, () => x.fall());
    later(2500 + combMs + 1200, () => x.combSweep(COMBS[1]!.shifts, combMs, { pass: 2, createsWin: false }));
  };
  const freeDemo = () => {
    const x = s(); if (!x) return;
    for (const [i, v] of [2, 4, 8, 16, 32, 64, 128, 256].entries()) later(i * 350, () => x.stainGrow(v));
    later(3000, () => x.multiplierCallout(64));
  };
  const loadVoices = async () => {
    const x = s(); if (!x) return;
    setVoiceBank('yükleniyor…');
    const r = await x.setVoiceBank(VOICE_FOLDER);
    setVoiceBank(`yüklü: ${r.loaded.join(', ') || 'yok'} · eksik (sessizce atlandı, yerine sözsüz yer tutucu): ${r.missing.length}`);
  };
  const slider = (key: keyof Omit<MixSettings, 'muted'>, label: string) => (
    <label style={{ display: 'grid', gap: 4, minWidth: 150, flex: '1 1 150px' }}>
      <span style={small}>{label}: {Math.round(mix[key] * 100)}</span>
      <input type="range" min={0} max={1} step={0.01} value={mix[key]} onChange={e => changeMix({ [key]: Number(e.target.value) })} />
    </label>
  );
  const pct = progress ? Math.round((100 * progress.done) / Math.max(1, progress.total)) : 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={card} aria-labelledby="e-start">
        <h2 id="e-start" style={{ margin: 0, fontSize: 18 }}>Başlat ve yükle</h2>
        <div style={row}>
          <button type="button" style={enabled ? on : btn} onClick={() => void start()}>{enabled ? 'Ses açık' : 'Sesi aç (dokunuş)'}</button>
          <button type="button" style={btn} onClick={() => { s()?.setEnabled(false); setEnabled(false); }}>Sesi kapat</button>
          <span style={small} aria-live="polite">{progress ? `${progress.phase} ${pct}% · ${progress.label} · ${Math.round(progress.ms)} ms` : 'Henüz yüklenmedi'}</span>
        </div>
        <progress max={100} value={pct} style={{ width: '100%' }} aria-label="Yükleme ilerlemesi" />
        <p style={small}>{status}</p>
      </section>

      <section style={card} aria-labelledby="e-mix">
        <h2 id="e-mix" style={{ margin: 0, fontSize: 18 }}>Miks</h2>
        <div style={row}>
          {slider('master', 'Ana')}{slider('music', 'Müzik')}{slider('sfx', 'Efekt')}{slider('ambience', 'Ortam (su teknesi)')}
          <label style={row}><input type="checkbox" checked={mix.muted} onChange={e => changeMix({ muted: e.target.checked })} /> Sessiz</label>
        </div>
        <div style={row}><button type="button" style={btn} onClick={() => s()?.duck(12, 1500)}>Ducking −12 dB / 1,5 sn</button></div>
      </section>

      <section style={card} aria-labelledby="e-scene">
        <h2 id="e-scene" style={{ margin: 0, fontSize: 18 }}>Sahne müziği</h2>
        <div style={row}>{SCENES.map(id => <button key={id} type="button" style={scene === id ? on : btn} onClick={() => scenePick(id)}>{id}</button>)}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {(['base', 'idle', 'feature', 'ambience'] as const).map(id => <li key={id} style={small}><strong>{id}</strong>: {EBRU_SCORES[id].about}</li>)}
        </ul>
      </section>

      <section style={card} aria-labelledby="e-comb">
        <h2 id="e-comb" style={{ margin: 0, fontSize: 18 }}>Tarak geçişi (imza sesi)</h2>
        <p style={small}>Cam armonika süzülmesi satır kaymalarını (shifts[7]) izler: her satır G pentatoniğinde bir basamak, aralar sinüs biçimli kayar; satır başına bir kanun teli, ıslak kıl dokusu ve sonda kazanç varsa altın çözülme. 2. ve 3. geçiş bir/iki basamak yukarıda.</p>
        <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}>süre {combMs} ms <input type="range" min={400} max={3000} step={50} value={combMs} onChange={e => setCombMs(Number(e.target.value))} /></label>
        <div style={row}>
          {COMBS.map(c => <button key={c.label} type="button" style={btn} onClick={() => s()?.combSweep(c.shifts, combMs, { pass: 1, createsWin: false })} title={c.shifts.join(' ')}>{c.label} [{c.shifts.join(' ')}]</button>)}
          {[1, 2, 3].map(p => <button key={p} type="button" style={btn} onClick={() => s()?.combSweep(COMBS[2]!.shifts, combMs, { pass: p, createsWin: true })}>geçiş {p} + kazanç</button>)}
        </div>
      </section>

      <section style={card} aria-labelledby="e-game">
        <h2 id="e-game" style={{ margin: 0, fontSize: 18 }}>Oyun olayları (API)</h2>
        <div style={row}>
          <button type="button" style={btn} onClick={spinDemo}>Dönüş demosu (düşüş, sızma, kümeler, tarak)</button>
          <button type="button" style={btn} onClick={() => s()?.spinStart()}>spinStart</button>
          <button type="button" style={btn} onClick={() => { for (let c = 0; c < 7; c++) later(c * 70, () => s()?.dropIn(c)); }}>dropIn 0…6</button>
          <button type="button" style={btn} onClick={() => s()?.symbolLand()}>symbolLand</button>
          <button type="button" style={btn} onClick={() => s()?.bleed('c2', 4)}>bleed</button>
          <button type="button" style={btn} onClick={() => s()?.winHighlight(3)}>winHighlight</button>
          <button type="button" style={btn} onClick={() => s()?.fall()}>fall</button>
        </div>
        <div style={row}>
          {EBRU_INKS.map(c => <button key={c} type="button" style={btn} onClick={() => s()?.clusterDissolve(c, 6)}>bloom {c}</button>)}
          {[5, 9, 14].map(n => <button key={n} type="button" style={btn} onClick={() => s()?.clusterDissolve('c4', n)}>bloom {n} hücre</button>)}
        </div>
        <div style={row}>
          {[2, 4, 8, 16, 32, 64, 128, 256].map(v => <button key={v} type="button" style={btn} onClick={() => s()?.stainGrow(v)}>stain ×{v}</button>)}
          <button type="button" style={btn} onClick={freeDemo}>leke tırmanışı</button>
        </div>
        <div style={row}>
          {[1, 2, 3, 4, 5, 6].map(n => <button key={n} type="button" style={btn} onClick={() => s()?.scatterLand(n)}>altın tarak {n}</button>)}
          <button type="button" style={tease ? on : btn} onClick={() => { s()?.scatterTease(!tease); setTease(t => !t); }}>scatter tease</button>
          <button type="button" style={btn} onClick={() => s()?.featureTrigger()}>featureTrigger</button>
          <button type="button" style={btn} onClick={() => { s()?.freeSpinsIntro(); s()?.setScene('feature'); setSceneState('feature'); }}>freeSpinsIntro → feature</button>
          <button type="button" style={btn} onClick={() => s()?.retrigger()}>retrigger (+4)</button>
          <button type="button" style={btn} onClick={() => s()?.totalWinFanfare()}>totalWinFanfare</button>
          <button type="button" style={btn} onClick={() => { s()?.featureOutro(); s()?.setScene('base'); setSceneState('base'); }}>featureOutro → base</button>
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

      <section style={card} aria-labelledby="e-tiers">
        <h2 id="e-tiers" style={{ margin: 0, fontSize: 18 }}>Kazanç kademeleri</h2>
        <p style={small}>Kademeler yukarı ton değiştirir (G → A → B → D, azami E; hepsi Rast-majör). Sayaç çalışırken daha yüksek kademe gelirse geçiş vuruşa hizalanır; sayaç durunca kademeye özgü iniş çalar.</p>
        <div style={row}>
          {WIN_TIERS.map((t: WinTier) => <button key={t} type="button" style={btn} onClick={() => s()?.bigWin(t)}>bigWin {t} · {WIN_TIER_NAMES[t]} ≥{WIN_TIER_THRESHOLDS[t]}×</button>)}
          <button type="button" style={btn} onClick={() => s()?.maxWin()}>maxWin · Azami</button>
          <button type="button" style={counting ? on : btn} onClick={() => { s()?.countUp(!counting); setCounting(c => !c); }}>{counting ? 'countUp: durdur (iniş)' : 'countUp: başlat'}</button>
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => runLadder(false)}>Tırmanış 1→2→3→4 + countUp</button>
          <button type="button" style={btn} onClick={() => runLadder(true)}>Tırmanış 1→2→3→4→azami</button>
          <span style={small} aria-live="polite">{ladder ? `şimdi: ${ladder}` : ''}</span>
        </div>
      </section>

      <section style={card} aria-labelledby="e-callout">
        <h2 id="e-callout" style={{ margin: 0, fontSize: 18 }}>Çarpan / leke anonsu ve ses</h2>
        <p style={small}>Kanun motifi + su bardağı + kabarcık; sınıf büyüdükçe motif uzar, koro ve zil eklenir. Kayıt yoksa sözsüz “ah” yer tutucu; {VOICE_FOLDER}/&lt;ad&gt;.mp3 varsa kayıt çalar.</p>
        <div style={row}>
          {EBRU_CALLOUT_CLASSES.map(c => <button key={c} type="button" style={btn} onClick={() => s()?.multiplierCallout(EBRU_CALLOUT_VALUES[c])} title={EBRU_VOICE_TEXT[c === 'x2' ? 'x2-9' : c]}>{c === 'x2' ? '<10×' : `≥${MULTIPLIER_CLASS_MIN[c]}×`} ({EBRU_CALLOUT_VALUES[c]}×)</button>)}
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.nice()}>nice (20 sn’de bir)</button>
          {(['vo-sigh', 'vo-bloom', 'vo-joy'] as const).map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playSfx(id)}>{id}</button>)}
          <button type="button" style={btn} onClick={() => void loadVoices()}>Ses bankasını yükle ({VOICE_FOLDER})</button>
          <span style={small} aria-live="polite">{voiceBank}</span>
        </div>
      </section>

      <section style={card} aria-labelledby="e-raw">
        <h2 id="e-raw" style={{ margin: 0, fontSize: 18 }}>Ham kayıtlar</h2>
        <div style={row}>{STINGERS.map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playStinger(id)} title={EBRU_SCORES[id].about}>{id}</button>)}</div>
        <div style={row}>{EBRU_SFX.map(d => <button key={d.id} type="button" style={btn} onClick={() => s()?.playSfx(d.id)} title={`${d.variations} varyasyon · ${d.level}`}>{d.id}</button>)}</div>
      </section>
    </div>
  );
}
