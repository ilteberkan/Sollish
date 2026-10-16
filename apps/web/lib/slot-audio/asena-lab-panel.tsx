'use client';
/**
 * Development-only listening panel for the Asena: Yıldız Kurdu sound (rendered by /lab/audio?game=asena, which 404s in
 * production). Every scene, stinger, effect, tier, callout, constellation and voice slot can be triggered by hand.
 * The constellation buttons use the art layer's real stroke plan (components/asena/geometry.ts).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { asenaConstellationPlan } from '@/components/asena/geometry';
import { ASENA_CALLOUT_VALUES, createAsenaSound, type AsenaSound, type LoadProgress } from './asena-sound';
import { ASENA_SCORES, type AsenaScoreId } from './scores/asena';
import { ASENA_SFX } from './sfx/asena';
import { ASENA_CALLOUT_CLASSES, ASENA_MOTIFS, ASENA_SYMBOL_IDS, ASENA_TEMPLATE_MULTIPLIER, ASENA_TEMPLATE_ORDER, ASENA_VOICE_TEXT, type AsenaTemplateId } from './asena-tiers';
import { MULTIPLIER_CLASS_MIN, WIN_TIERS, WIN_TIER_NAMES, WIN_TIER_THRESHOLDS, type WinTier } from './win-tiers';
import { DEFAULT_MIX, type MixSettings, type SceneId } from './timing';
import { voiceBankFolder } from './voice-locale';

const card: CSSProperties = { border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--surface)', display: 'grid', gap: 10 };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
const btn: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', font: 'inherit', fontSize: 14 };
const on: CSSProperties = { ...btn, border: '1px solid var(--accent)', color: 'var(--accent)' };
const small: CSSProperties = { color: 'var(--muted)', fontSize: 13, margin: 0 };

const SCENES: SceneId[] = ['idle', 'base', 'feature', 'bigwin', 'none'];
const STINGERS: AsenaScoreId[] = ['fsIntro', 'retrigger', 'fsOutro', 'totalWin', 'bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'bed1', 'bed2', 'bed3', 'bed4', 'bedMax'];
const VOICE_FOLDER = '/audio/voice/asena';
const NAMES: Record<AsenaTemplateId, string> = { 'kurt-basi': 'Kurt Başı', yay: 'Yay', at: 'At', kartal: 'Kartal', 'hayat-agaci': 'Hayat Ağacı', hilal: 'Hilal' };
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Semitones around E5 (MIDI 76) → note name. */
const noteName = (semi: number) => { const m = 76 + semi; return `${NOTE[m % 12]}${Math.floor(m / 12) - 1}`; };

export function AsenaAudioLab() {
  const sound = useRef<AsenaSound | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mix, setMix] = useState<MixSettings>({ ...DEFAULT_MIX });
  const [scene, setSceneState] = useState<SceneId>('none');
  const [counting, setCounting] = useState(false);
  const [tease, setTease] = useState(false);
  const [status, setStatus] = useState('');
  const [ladder, setLadder] = useState<string | null>(null);
  const [voiceBank, setVoiceBank] = useState('');
  const [traceMs, setTraceMs] = useState(1400);
  const [transform, setTransform] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const s = createAsenaSound();
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
  const ignite = (t: AsenaTemplateId) => {
    const plan = asenaConstellationPlan({ templateId: t, transform, origin: [0, 0] }, traceMs);
    s()?.constellation(t, { nodeAt: plan.nodeAt, durationMs: plan.duration, cols: plan.nodes.map(n => n[0]) });
  };

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
    for (let c = 0; c < 6; c++) later(250 + c * 80, () => x.dropIn(c));
    later(900, () => x.moonLand(1));
    later(1300, () => { x.winHighlight(3); x.clusterWin('h1', 9); });
    later(1450, () => ignite('kurt-basi'));
    later(1450 + traceMs + 2400, () => x.starBurst('h1', 9));
    later(1450 + traceMs + 2700, () => x.fall());
    later(1450 + traceMs + 3300, () => x.wolfWalk({ ms: 640 }));
    later(1450 + traceMs + 4300, () => { x.clusterWin('l3', 6); x.starBurst('l3', 6); });
  };
  const ergenekonDemo = () => {
    const x = s(); if (!x) return;
    [0, 3, 5].forEach((t, i) => later(i * 700, () => x.mapPiece(t, 1)));
    later(2300, () => { x.globalMultiplier(2); x.mapSpins(5); });
    later(5000, () => x.globalMultiplier(3));
    later(8500, () => x.globalMultiplier(5));
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
          {slider('master', 'Ana')}{slider('music', 'Müzik')}{slider('sfx', 'Efekt')}{slider('ambience', 'Ortam (bozkır gecesi)')}
          <label style={row}><input type="checkbox" checked={mix.muted} onChange={e => changeMix({ muted: e.target.checked })} /> Sessiz</label>
        </div>
        <div style={row}><button type="button" style={btn} onClick={() => s()?.duck(12, 1500)}>Ducking −12 dB / 1,5 sn</button></div>
      </section>

      <section style={card} aria-labelledby="a-scene">
        <h2 id="a-scene" style={{ margin: 0, fontSize: 18 }}>Sahne müziği</h2>
        <div style={row}>{SCENES.map(id => <button key={id} type="button" style={scene === id ? on : btn} onClick={() => scenePick(id)}>{id}</button>)}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {(['base', 'idle', 'feature', 'ambience'] as const).map(id => <li key={id} style={small}><strong>{id}</strong>: {ASENA_SCORES[id].about}</li>)}
        </ul>
      </section>

      <section style={card} aria-labelledby="a-const">
        <h2 id="a-const" style={{ margin: 0, fontSize: 18 }}>Takımyıldız (imza sesi)</h2>
        <p style={small}>Sanat katmanının çizgi planı (nodeAt) her yıldızı yandığı anda çaldırır: şablona özgü yükselen motif, aynı anda yanan düğümler akor, sonda şablonun tutuşma çiçeği ve kurt uluması (Kurt Başı’nda büyük uluma).</p>
        <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}>süre {traceMs} ms <input type="range" min={600} max={3000} step={50} value={traceMs} onChange={e => setTraceMs(Number(e.target.value))} /></label>
        <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}>dönüşüm {transform} <input type="range" min={0} max={7} step={1} value={transform} onChange={e => setTransform(Number(e.target.value))} /></label>
        <div style={row}>
          {ASENA_TEMPLATE_ORDER.map(t => <button key={t} type="button" style={btn} onClick={() => ignite(t)} title={ASENA_MOTIFS[t].map(noteName).join(' ')}>{NAMES[t]} ×{ASENA_TEMPLATE_MULTIPLIER[t]}</button>)}
          <button type="button" style={btn} onClick={() => s()?.howl(1)}>uluma</button>
          <button type="button" style={btn} onClick={() => s()?.howl(1.4)}>büyük uluma</button>
        </div>
      </section>

      <section style={card} aria-labelledby="a-game">
        <h2 id="a-game" style={{ margin: 0, fontSize: 18 }}>Oyun olayları (API)</h2>
        <div style={row}>
          <button type="button" style={btn} onClick={spinDemo}>Dönüş demosu (düşüş, ay, küme, takımyıldız, patlama, kurt)</button>
          <button type="button" style={btn} onClick={() => s()?.spinStart()}>spinStart</button>
          <button type="button" style={btn} onClick={() => { for (let c = 0; c < 6; c++) later(c * 80, () => s()?.dropIn(c)); }}>dropIn 0…5</button>
          <button type="button" style={btn} onClick={() => s()?.symbolLand()}>symbolLand</button>
          <button type="button" style={btn} onClick={() => s()?.winHighlight(3)}>winHighlight</button>
          <button type="button" style={btn} onClick={() => s()?.fall()}>fall</button>
          <button type="button" style={btn} onClick={() => s()?.wolfWalk({ ms: 640 })}>wolfWalk</button>
        </div>
        <div style={row}>
          {ASENA_SYMBOL_IDS.map(c => <button key={c} type="button" style={btn} onClick={() => s()?.starBurst(c, 6)}>burst {c}</button>)}
          {[5, 9, 14].map(n => <button key={n} type="button" style={btn} onClick={() => s()?.starBurst('h3', n)}>burst {n} hücre</button>)}
        </div>
        <div style={row}>
          {[1, 2, 3, 4, 5, 6].map(n => <button key={n} type="button" style={btn} onClick={() => s()?.moonLand(n)}>Ay Ata {n}</button>)}
          <button type="button" style={tease ? on : btn} onClick={() => { s()?.moonTease(!tease); setTease(t => !t); }}>moon tease</button>
          <button type="button" style={btn} onClick={() => s()?.featureTrigger()}>featureTrigger</button>
          <button type="button" style={btn} onClick={() => { s()?.freeSpinsIntro(); s()?.setScene('feature'); setSceneState('feature'); }}>freeSpinsIntro → feature</button>
          <button type="button" style={btn} onClick={() => s()?.retrigger()}>retrigger (+3)</button>
          <button type="button" style={btn} onClick={() => s()?.totalWinFanfare()}>totalWinFanfare</button>
          <button type="button" style={btn} onClick={() => { s()?.featureOutro(); s()?.setScene('base'); setSceneState('base'); }}>featureOutro → base</button>
        </div>
        <div style={row}>
          {ASENA_TEMPLATE_ORDER.map((t, i) => <button key={t} type="button" style={btn} onClick={() => s()?.mapPiece(i, 1)}>parça {NAMES[t]}</button>)}
          {[2, 3, 5].map(m => <button key={m} type="button" style={btn} onClick={() => s()?.globalMultiplier(m)}>dağ ×{m}</button>)}
          <button type="button" style={btn} onClick={() => s()?.mapSpins(5)}>+5 dönüş</button>
          <button type="button" style={btn} onClick={ergenekonDemo}>Ergenekon demosu</button>
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

      <section style={card} aria-labelledby="a-tiers">
        <h2 id="a-tiers" style={{ margin: 0, fontSize: 18 }}>Kazanç kademeleri</h2>
        <p style={small}>Kademeler yukarı ton değiştirir (E → F# → G# → B, azami C#; majör pentatonik “gün ışığı”). Sayaç çalışırken daha yüksek kademe gelirse geçiş vuruşa hizalanır; sayaç durunca kademeye özgü iniş çalar.</p>
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

      <section style={card} aria-labelledby="a-callout">
        <h2 id="a-callout" style={{ margin: 0, fontSize: 18 }}>Çarpan anonsu ve ses</h2>
        <p style={small}>Yıldız çanı + kopuz motifi; sınıf büyüdükçe motif uzar, koro, çıngırak ve uluma eklenir. Kayıt yoksa sözsüz “gök sesi” yer tutucu; {VOICE_FOLDER}/&lt;ad&gt;.mp3 varsa kayıt çalar.</p>
        <div style={row}>
          {ASENA_CALLOUT_CLASSES.map(c => <button key={c} type="button" style={btn} onClick={() => s()?.multiplierCallout(ASENA_CALLOUT_VALUES[c])} title={ASENA_VOICE_TEXT[c === 'x2' ? 'x2-9' : c]}>{c === 'x2' ? '<10×' : `≥${MULTIPLIER_CLASS_MIN[c]}×`} ({ASENA_CALLOUT_VALUES[c]}×)</button>)}
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.nice()}>nice (20 sn’de bir)</button>
          {(['vo-breath', 'vo-call', 'vo-joy'] as const).map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playSfx(id)}>{id}</button>)}
          <button type="button" style={btn} onClick={() => void loadVoices()}>Ses bankasını yükle ({VOICE_FOLDER})</button>
          <span style={small} aria-live="polite">{voiceBank}</span>
        </div>
      </section>

      <section style={card} aria-labelledby="a-raw">
        <h2 id="a-raw" style={{ margin: 0, fontSize: 18 }}>Ham kayıtlar</h2>
        <div style={row}>{STINGERS.map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playStinger(id)} title={ASENA_SCORES[id].about}>{id}</button>)}</div>
        <div style={row}>{ASENA_SFX.map(d => <button key={d.id} type="button" style={btn} onClick={() => s()?.playSfx(d.id)} title={`${d.variations} varyasyon · ${d.level}`}>{d.id}</button>)}</div>
      </section>
    </div>
  );
}
