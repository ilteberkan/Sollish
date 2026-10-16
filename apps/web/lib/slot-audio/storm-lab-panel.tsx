'use client';
/**
 * Development-only listening panel for the Tarhun: Fırtına Tahtı sound (rendered by /lab/audio, which 404s
 * in production). Every scene, stinger, effect, tier, callout and voice slot can be triggered by hand.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { STORM_CALLOUT_VALUES, createStormSound, type LoadProgress, type StormSound } from './storm-sound';
import { STORM_SCORES, type StormScoreId } from './scores/storm';
import { STORM_SFX } from './sfx/storm';
import { STORM_MULTIPLIER_CLASSES, STORM_MULTIPLIER_CLASS_MIN } from './storm-tiers';
import { DEFAULT_MIX, type MixSettings, type SceneId } from './timing';
import { WIN_TIERS, WIN_TIER_NAMES, WIN_TIER_THRESHOLDS, type WinTier } from './win-tiers';
import { voiceBankFolder } from './voice-locale';

const card: CSSProperties = { border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--surface)', display: 'grid', gap: 10 };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
const btn: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', font: 'inherit', fontSize: 14 };
const on: CSSProperties = { ...btn, border: '1px solid var(--accent)', color: 'var(--accent)' };
const small: CSSProperties = { color: 'var(--muted)', fontSize: 13, margin: 0 };

const SCENES: SceneId[] = ['idle', 'base', 'feature', 'bigwin', 'none'];
const STINGERS: StormScoreId[] = ['fsIntro', 'retrigger', 'fsOutro', 'totalWin', 'bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'bed1', 'bed2', 'bed3', 'bed4', 'bedMax'];
const ORB_VALUES = [2, 10, 25, 50, 100, 250, 500];
const VOICE_FOLDER = '/audio/voice/storm';

export function StormAudioLab() {
  const sound = useRef<StormSound | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mix, setMix] = useState<MixSettings>({ ...DEFAULT_MIX });
  const [scene, setSceneState] = useState<SceneId>('none');
  const [counting, setCounting] = useState(false);
  const [tease, setTease] = useState(false);
  const [status, setStatus] = useState('');
  const [ladder, setLadder] = useState<string | null>(null);
  const [voiceBank, setVoiceBank] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const s = createStormSound();
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
  /** A base-game tumble sequence as the game would drive it. */
  const tumbleDemo = () => {
    const x = s(); if (!x) return;
    x.spinStart();
    for (let c = 0; c < 6; c++) later(250 + c * 90, () => x.land(c));
    later(900, () => { x.orbLand(10); });
    later(1250, () => { x.winHighlight(2); });
    later(1700, () => { x.shatter(9, 0); });
    later(2050, () => { x.tumble(); });
    later(2500, () => { x.shatter(12, 2); });
    later(2850, () => { x.tumble(); });
    later(3400, () => { x.lightningStrike(2); x.orbCollect(); });
    later(3900, () => { x.orbArrive(10); });
    later(4300, () => { x.multiplierCallout(12); });
  };
  const loadVoices = async () => {
    const x = s(); if (!x) return;
    setVoiceBank('yükleniyor…');
    const r = await x.setVoiceBank(voiceBankFolder(VOICE_FOLDER));
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
      <section style={card} aria-labelledby="s-start">
        <h2 id="s-start" style={{ margin: 0, fontSize: 18 }}>Başlat ve yükle</h2>
        <div style={row}>
          <button type="button" style={enabled ? on : btn} onClick={() => void start()}>{enabled ? 'Ses açık' : 'Sesi aç (dokunuş)'}</button>
          <button type="button" style={btn} onClick={() => { s()?.setEnabled(false); setEnabled(false); }}>Sesi kapat</button>
          <span style={small} aria-live="polite">{progress ? `${progress.phase} ${pct}% · ${progress.label} · ${Math.round(progress.ms)} ms` : 'Henüz yüklenmedi'}</span>
        </div>
        <progress max={100} value={pct} style={{ width: '100%' }} aria-label="Yükleme ilerlemesi" />
        <p style={small}>{status}</p>
      </section>

      <section style={card} aria-labelledby="s-mix">
        <h2 id="s-mix" style={{ margin: 0, fontSize: 18 }}>Miks</h2>
        <div style={row}>
          {slider('master', 'Ana')}{slider('music', 'Müzik')}{slider('sfx', 'Efekt')}{slider('ambience', 'Ortam (yağmur, rüzgâr, gök gürültüsü)')}
          <label style={row}><input type="checkbox" checked={mix.muted} onChange={e => changeMix({ muted: e.target.checked })} /> Sessiz</label>
        </div>
        <div style={row}><button type="button" style={btn} onClick={() => s()?.duck(12, 1500)}>Ducking −12 dB / 1,5 sn</button></div>
      </section>

      <section style={card} aria-labelledby="s-scene">
        <h2 id="s-scene" style={{ margin: 0, fontSize: 18 }}>Sahne müziği</h2>
        <div style={row}>{SCENES.map(id => <button key={id} type="button" style={scene === id ? on : btn} onClick={() => scenePick(id)}>{id}</button>)}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {(['base', 'idle', 'feature', 'ambience'] as const).map(id => <li key={id} style={small}><strong>{id}</strong>: {STORM_SCORES[id].about}</li>)}
        </ul>
      </section>

      <section style={card} aria-labelledby="s-game">
        <h2 id="s-game" style={{ margin: 0, fontSize: 18 }}>Oyun olayları (API)</h2>
        <div style={row}>
          <button type="button" style={btn} onClick={tumbleDemo}>Düşme zinciri demosu</button>
          <button type="button" style={btn} onClick={() => s()?.spinStart()}>spinStart</button>
          <button type="button" style={btn} onClick={() => { for (let c = 0; c < 6; c++) later(c * 80, () => s()?.land(c)); }}>land 0…5</button>
          <button type="button" style={btn} onClick={() => s()?.symbolLand()}>symbolLand</button>
          <button type="button" style={btn} onClick={() => s()?.winHighlight(3)}>winHighlight</button>
          <button type="button" style={btn} onClick={() => s()?.shatter(8, 0)}>shatter 8</button>
          <button type="button" style={btn} onClick={() => s()?.shatter(10, 1)}>shatter 10</button>
          <button type="button" style={btn} onClick={() => s()?.shatter(14, 2)}>shatter 12+</button>
          <button type="button" style={btn} onClick={() => s()?.tumble()}>tumble</button>
        </div>
        <div style={row}>
          {ORB_VALUES.map(v => <button key={v} type="button" style={btn} onClick={() => s()?.orbLand(v)}>orbLand ×{v}</button>)}
          <button type="button" style={btn} onClick={() => s()?.orbCollect()}>orbCollect</button>
          <button type="button" style={btn} onClick={() => s()?.orbArrive(25)}>orbArrive</button>
          {[0, 5].map(c => <button key={c} type="button" style={btn} onClick={() => s()?.lightningStrike(c)}>lightningStrike sütun {c}</button>)}
          {[8, 40, 200].map(t => <button key={t} type="button" style={btn} onClick={() => s()?.totalMultiplier(t)}>totalMultiplier ×{t}</button>)}
        </div>
        <div style={row}>
          {[1, 2, 3, 4, 5, 6].map(n => <button key={n} type="button" style={btn} onClick={() => s()?.scatterLand(n)}>scatter {n}</button>)}
          <button type="button" style={tease ? on : btn} onClick={() => { s()?.scatterTease(!tease); setTease(t => !t); }}>scatter tease</button>
          <button type="button" style={btn} onClick={() => s()?.featureTrigger()}>featureTrigger</button>
          <button type="button" style={btn} onClick={() => { s()?.freeSpinsIntro(); s()?.setScene('feature'); setSceneState('feature'); }}>freeSpinsIntro → feature</button>
          <button type="button" style={btn} onClick={() => s()?.retrigger()}>retrigger (+5)</button>
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

      <section style={card} aria-labelledby="s-tiers">
        <h2 id="s-tiers" style={{ margin: 0, fontSize: 18 }}>Kazanç kademeleri</h2>
        <p style={small}>Kademeler yukarı ton değiştirir (A → B → C# → E, azami F#; hepsi Hicaz-majör, bII → I kadansı). Sayaç çalışırken daha yüksek kademe gelirse şimşek + vuruş vuruşa hizalanır, yeni kademenin döngüsü girer; sayaç durunca kademeye özgü iniş vuruşu çalar.</p>
        <div style={row}>
          {WIN_TIERS.map((t: WinTier) => <button key={t} type="button" style={btn} onClick={() => s()?.bigWin(t)}>bigWin {t} · {WIN_TIER_NAMES[t]} ≥{WIN_TIER_THRESHOLDS[t]}×</button>)}
          <button type="button" style={btn} onClick={() => s()?.maxWin()}>maxWin · Azami</button>
          <button type="button" style={counting ? on : btn} onClick={() => { s()?.countUp(!counting); setCounting(c => !c); }}>{counting ? 'countUp: durdur (iniş)' : 'countUp: başlat'}</button>
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => runLadder(false)}>Tırmanış demosu 1→2→3→4 + countUp</button>
          <button type="button" style={btn} onClick={() => runLadder(true)}>Tırmanış demosu 1→2→3→4→azami</button>
          <span style={small} aria-live="polite">{ladder ? `şimdi: ${ladder}` : ''}</span>
        </div>
      </section>

      <section style={card} aria-labelledby="s-callout">
        <h2 id="s-callout" style={{ margin: 0, fontSize: 18 }}>Çarpan anonsu ve karakter sesi</h2>
        <p style={small}>Şimşek + gök gürültüsü + yükselen boru + koro; sınıf büyüdükçe motif uzar, çakma sayısı ve katman artar. Kayıt yoksa sözsüz yer tutucu (mırıltı / “hah!” / kahkaha) çalar; {VOICE_FOLDER}/&lt;ad&gt;.mp3 varsa yerine kayıt çalar ve müzik kısılır.</p>
        <div style={row}>
          {STORM_MULTIPLIER_CLASSES.map(c => <button key={c} type="button" style={btn} onClick={() => s()?.multiplierCallout(STORM_CALLOUT_VALUES[c])}>{c === 'x2' ? '<10×' : c === 'x500' ? '×500' : `≥${STORM_MULTIPLIER_CLASS_MIN[c]}×`} ({STORM_CALLOUT_VALUES[c]}×)</button>)}
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.laugh()}>laugh</button>
          <button type="button" style={btn} onClick={() => s()?.nice()}>nice (20 sn’de bir)</button>
          {(['vo-hum', 'vo-grunt', 'vo-laugh'] as const).map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playSfx(id)}>{id}</button>)}
          <button type="button" style={btn} onClick={() => void loadVoices()}>Ses bankasını yükle ({VOICE_FOLDER})</button>
          <span style={small} aria-live="polite">{voiceBank}</span>
        </div>
      </section>

      <section style={card} aria-labelledby="s-raw">
        <h2 id="s-raw" style={{ margin: 0, fontSize: 18 }}>Ham kayıtlar</h2>
        <div style={row}>{STINGERS.map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playStinger(id)} title={STORM_SCORES[id].about}>{id}</button>)}</div>
        <div style={row}>{STORM_SFX.map(d => <button key={d.id} type="button" style={btn} onClick={() => s()?.playSfx(d.id)} title={`${d.variations} varyasyon · ${d.level}`}>{d.id}</button>)}</div>
      </section>
    </div>
  );
}
