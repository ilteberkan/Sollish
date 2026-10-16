'use client';
/**
 * Development-only listening panel for the Cezeri: Zamanın Çarkları sound (rendered by /lab/audio?game=cezeri, which 404s in
 * production). Every scene, stinger, effect, tier, callout, ring rotation, spoke beam, respin chain and voice slot can be
 * triggered by hand.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CEZERI_CALLOUT_VALUES, createCezeriSound, type CezeriSound, type LoadProgress } from './cezeri-sound';
import { CEZERI_SCORES, type CezeriScoreId } from './scores/cezeri';
import { CEZERI_SFX } from './sfx/cezeri';
import { CEZERI_CALLOUT_CLASSES, CEZERI_MAX_RESPINS, CEZERI_SYMBOLS, CEZERI_VOICE_TEXT, RING_EASES, type RingEase } from './cezeri-tiers';
import { MULTIPLIER_CLASS_MIN, WIN_TIERS, WIN_TIER_NAMES, WIN_TIER_THRESHOLDS, type WinTier } from './win-tiers';
import { DEFAULT_MIX, type MixSettings, type SceneId } from './timing';
import { voiceBankFolder } from './voice-locale';

const card: CSSProperties = { border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--surface)', display: 'grid', gap: 10 };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
const btn: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', font: 'inherit', fontSize: 14 };
const on: CSSProperties = { ...btn, border: '1px solid var(--accent)', color: 'var(--accent)' };
const small: CSSProperties = { color: 'var(--muted)', fontSize: 13, margin: 0 };

const SCENES: SceneId[] = ['idle', 'base', 'feature', 'bigwin', 'none'];
const STINGERS: CezeriScoreId[] = ['fsIntro', 'retrigger', 'fsOutro', 'totalWin', 'bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'bed1', 'bed2', 'bed3', 'bed4', 'bedMax', 'chainBed', 'chainBedHi'];
const VOICE_FOLDER = '/audio/voice/cezeri';
const EASES = Object.keys(RING_EASES) as RingEase[];
/** A rotate step as the board would animate it: rings 0..3 staggered, each passing a strip-length worth of slices. */
const ROTATION = (ms: number, ease: RingEase) => [0, 1, 2, 3].map(ring => ({ ring, distance: 30 + ring * 9, ms: ms + ring * 220, delayMs: ring * 60, ease }));

export function CezeriAudioLab() {
  const sound = useRef<CezeriSound | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mix, setMix] = useState<MixSettings>({ ...DEFAULT_MIX });
  const [scene, setSceneState] = useState<SceneId>('none');
  const [counting, setCounting] = useState(false);
  const [tease, setTease] = useState(false);
  const [status, setStatus] = useState('');
  const [ladder, setLadder] = useState<string | null>(null);
  const [voiceBank, setVoiceBank] = useState('');
  const [ringMs, setRingMs] = useState(1300);
  const [ease, setEase] = useState<RingEase>('outCubic');
  const [respins, setRespins] = useState(6);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const s = createCezeriSound();
    sound.current = s;
    return () => { s.dispose(); sound.current = null; };
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      const s = sound.current?.status(); if (!s) return;
      setStatus(`core ${s.core ? 'ready' : '…'} · all ${s.extended ? 'ready' : '…'} · workers ${s.workers} (${s.workerJobs} jobs${s.workerFailure ? `, fell back: ${s.workerFailure}` : ''}) · zincir: ${s.chain.active ? `açık, tur ${s.chain.round}, filtre ${s.chain.cutoff} Hz` : '—'} · kutlama: kademe ${s.celebration.tier}${s.celebration.max ? ' + azami' : ''}${s.celebration.counting ? ' · sayıyor' : ''}${s.celebration.bed ? ` · ${s.celebration.bed}` : ''} · ses: ${s.voice.speaking ?? '—'} (${s.voice.loaded} kayıt) · ${Object.entries(s.renderMs).map(([k, v]) => `${k} ${v} ms`).join(' · ')}`);
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
  const clear = () => { for (const t of timers.current) clearTimeout(t); timers.current = []; };

  const runLadder = (withMax: boolean) => {
    clear();
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
  /** A base spin with a Dişli Kilidi chain of `n` respins, as the game would drive it from the engine steps. */
  const chainDemo = (n: number, hub = 2) => {
    clear();
    const x = s(); if (!x) return;
    x.spinStart();
    later(150, () => x.hubReveal(hub));
    let t = 450;
    const rotate = () => x.rotate(ROTATION(ringMs, ease));
    later(t, rotate);
    t += ringMs + 900;
    for (let k = 1; k <= n; k++) {
      const spoke = (k * 5) % 12;
      later(t, () => x.spokeWin(spoke, k % 3 === 0 ? 4 : 3, ['l2', 'h4', 'l1', 'h2', 'gear', 'h1'][k % 6]!, { startRing: k % 2 }));
      later(t + 450, () => x.gearLock(3 + (k % 2), { respin: true }));
      later(t + 900, () => x.hubTick(hub + k, k));
      later(t + 1250, () => { x.respin(k); x.rotate(ROTATION(Math.round(ringMs * 0.8), ease)); });
      t += 1250 + Math.round(ringMs * 0.8) + 1100;
    }
    later(t - 600, () => x.chainEnd({ respins: n, capped: n >= CEZERI_MAX_RESPINS }));
  };
  const featureDemo = () => {
    clear();
    const x = s(); if (!x) return;
    for (const [i, l] of [1, 2, 3].entries()) later(i * 1800, () => x.reservoirFill(l));
    later(5600, () => x.falconFlight());
    later(6900, () => x.falconDrop(2, 3));
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
      <section style={card} aria-labelledby="c-start">
        <h2 id="c-start" style={{ margin: 0, fontSize: 18 }}>Başlat ve yükle</h2>
        <div style={row}>
          <button type="button" style={enabled ? on : btn} onClick={() => void start()}>{enabled ? 'Ses açık' : 'Sesi aç (dokunuş)'}</button>
          <button type="button" style={btn} onClick={() => { s()?.setEnabled(false); setEnabled(false); }}>Sesi kapat</button>
          <span style={small} aria-live="polite">{progress ? `${progress.phase} ${pct}% · ${progress.label} · ${Math.round(progress.ms)} ms` : 'Henüz yüklenmedi'}</span>
        </div>
        <progress max={100} value={pct} style={{ width: '100%' }} aria-label="Yükleme ilerlemesi" />
        <p style={small}>{status}</p>
      </section>

      <section style={card} aria-labelledby="c-mix">
        <h2 id="c-mix" style={{ margin: 0, fontSize: 18 }}>Miks</h2>
        <div style={row}>
          {slider('master', 'Ana')}{slider('music', 'Müzik')}{slider('sfx', 'Efekt')}{slider('ambience', 'Ortam (avlu, su saati)')}
          <label style={row}><input type="checkbox" checked={mix.muted} onChange={e => changeMix({ muted: e.target.checked })} /> Sessiz</label>
        </div>
        <div style={row}><button type="button" style={btn} onClick={() => s()?.duck(12, 1500)}>Ducking −12 dB / 1,5 sn</button></div>
      </section>

      <section style={card} aria-labelledby="c-scene">
        <h2 id="c-scene" style={{ margin: 0, fontSize: 18 }}>Sahne müziği</h2>
        <div style={row}>{SCENES.map(id => <button key={id} type="button" style={scene === id ? on : btn} onClick={() => scenePick(id)}>{id}</button>)}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {(['base', 'idle', 'feature', 'chainBed', 'ambience'] as const).map(id => <li key={id} style={small}><strong>{id}</strong>: {CEZERI_SCORES[id].about}</li>)}
        </ul>
      </section>

      <section style={card} aria-labelledby="c-chain">
        <h2 id="c-chain" style={{ margin: 0, fontSize: 18 }}>Dişli Kilidi zinciri (imza sesi)</h2>
        <p style={small}>Kazanan dilimler kilitlenir (pirinç dişli + her dilime bir pim), göbek +1 (tik sahnenin makamında bir derece tırmanır: temel oyunda C Nikriz, Fil Saati&apos;nde C Çargah; her turda yeni katman), gerilim yatağı her turda filtresini açar ve üst katmanı yükseltir; zincir sonunda açık beşli çözülme, 10 turda saat vuruşu.</p>
        <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}>yeniden dönüş {respins} <input type="range" min={1} max={CEZERI_MAX_RESPINS} step={1} value={respins} onChange={e => setRespins(Number(e.target.value))} /></label>
        <div style={row}>
          <button type="button" style={btn} onClick={() => chainDemo(respins)}>Zincir demosu ({respins} yeniden dönüş)</button>
          <button type="button" style={btn} onClick={() => chainDemo(CEZERI_MAX_RESPINS, 10)}>Tam zincir (10, göbek ×10 → ×20)</button>
          {Array.from({ length: CEZERI_MAX_RESPINS }, (_, i) => i + 1).map(k => <button key={k} type="button" style={btn} onClick={() => s()?.hubTick(1 + k, k)}>hubTick {k}</button>)}
          <button type="button" style={btn} onClick={() => s()?.gearLock(4, { respin: true })}>gearLock (4)</button>
          <button type="button" style={btn} onClick={() => s()?.respin(3)}>respin</button>
          {[1, 3, 10].map(n => <button key={n} type="button" style={btn} onClick={() => s()?.chainEnd({ respins: n, capped: n >= 10 })}>chainEnd {n}</button>)}
        </div>
        <div style={row}>{[1, 2, 3, 5, 10, 14].map(v => <button key={v} type="button" style={btn} onClick={() => s()?.hubReveal(v)}>hubReveal ×{v}</button>)}</div>
      </section>

      <section style={card} aria-labelledby="c-rings">
        <h2 id="c-rings" style={{ margin: 0, fontSize: 18 }}>Halkalar ve ışınlar</h2>
        <p style={small}>Mandal tıkları geçen her dilimde bir kez, tahtanın yumuşatma eğrisiyle (hızlıyken vızıltıya karışır, yavaşladıkça seyrekleşir); halka durunca pirinç oturma sesi. Işın: göbekten dışa her halkaya bir çan, sembole göre perde.</p>
        <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}>süre {ringMs} ms <input type="range" min={500} max={3000} step={50} value={ringMs} onChange={e => setRingMs(Number(e.target.value))} /></label>
        <div style={row}>{EASES.map(e => <button key={e} type="button" style={ease === e ? on : btn} onClick={() => setEase(e)}>{e}</button>)}</div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.rotate(ROTATION(ringMs, ease))}>rotate (4 halka)</button>
          {[0, 1, 2, 3].map(r => <button key={r} type="button" style={btn} onClick={() => s()?.ringRotate(r, 36, ringMs, { ease })}>halka {r}</button>)}
          {[0, 3].map(r => <button key={r} type="button" style={btn} onClick={() => s()?.ringStop(r)}>ringStop {r}</button>)}
          <button type="button" style={btn} onClick={() => s()?.spinStart()}>spinStart</button>
        </div>
        <div style={row}>
          {CEZERI_SYMBOLS.map((sym, i) => <button key={sym} type="button" style={btn} onClick={() => s()?.spokeWin(i, 4, sym)}>ışın {sym}</button>)}
          <button type="button" style={btn} onClick={() => { for (let k = 0; k < 6; k++) s()?.spokeWin(k * 2, 3, 'h3', { startRing: k % 2 }); }}>6 ışın birden (sıralanır)</button>
          <button type="button" style={btn} onClick={() => s()?.winHighlight(4)}>winHighlight</button>
        </div>
      </section>

      <section style={card} aria-labelledby="c-feature">
        <h2 id="c-feature" style={{ margin: 0, fontSize: 18 }}>Su kapları ve Fil Saati</h2>
        <div style={row}>
          {[1, 2, 3, 4, 5, 6].map(n => <button key={n} type="button" style={btn} onClick={() => s()?.vesselLand(n)}>su kabı {n}</button>)}
          <button type="button" style={tease ? on : btn} onClick={() => { s()?.scatterTease(!tease); setTease(t => !t); }}>scatter tease</button>
          <button type="button" style={btn} onClick={() => s()?.featureTrigger()}>featureTrigger</button>
          <button type="button" style={btn} onClick={() => { s()?.freeSpinsIntro(); s()?.setScene('feature'); setSceneState('feature'); }}>freeSpinsIntro → feature</button>
          <button type="button" style={btn} onClick={() => s()?.retrigger()}>retrigger (+4)</button>
        </div>
        <div style={row}>
          {[1, 2, 3].map(l => <button key={l} type="button" style={btn} onClick={() => s()?.reservoirFill(l)}>hazne {l}</button>)}
          <button type="button" style={btn} onClick={() => s()?.falconFlight()}>falconFlight</button>
          <button type="button" style={btn} onClick={() => s()?.falconDrop(1, 3)}>falconDrop (3)</button>
          <button type="button" style={btn} onClick={featureDemo}>hazne 1→3 + şahin</button>
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

      <section style={card} aria-labelledby="c-tiers">
        <h2 id="c-tiers" style={{ margin: 0, fontSize: 18 }}>Kazanç kademeleri</h2>
        <p style={small}>Kademeler yukarı ton değiştirir (C → D → E → G, azami A; hepsi Çargah-majör). Sayaç çalışırken daha yüksek kademe gelirse geçiş vuruşa hizalanır (dişli vites değiştirir); sayaç durunca kademeye özgü iniş çalar.</p>
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

      <section style={card} aria-labelledby="c-callout">
        <h2 id="c-callout" style={{ margin: 0, fontSize: 18 }}>Çarpan anonsu ve ses</h2>
        <p style={small}>Santur motifi + çan çubukları + kös; sınıf büyüdükçe motif uzar, koro, zil, su orgu ve nakkare eklenir. Kayıt yoksa sözsüz erkek sesi yer tutucu; {VOICE_FOLDER}/&lt;ad&gt;.mp3 varsa kayıt çalar.</p>
        <div style={row}>
          {CEZERI_CALLOUT_CLASSES.map(c => <button key={c} type="button" style={btn} onClick={() => s()?.multiplierCallout(CEZERI_CALLOUT_VALUES[c])} title={c === 'x2' ? '' : CEZERI_VOICE_TEXT[c]}>{c === 'x2' ? '<10×' : `≥${MULTIPLIER_CLASS_MIN[c]}×`} ({CEZERI_CALLOUT_VALUES[c]}×)</button>)}
        </div>
        <div style={row}>
          <button type="button" style={btn} onClick={() => s()?.nice()}>nice (20 sn’de bir)</button>
          {(['vo-hum', 'vo-hey', 'vo-joy'] as const).map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playSfx(id)}>{id}</button>)}
          <button type="button" style={btn} onClick={() => void loadVoices()}>Ses bankasını yükle ({VOICE_FOLDER})</button>
          <span style={small} aria-live="polite">{voiceBank}</span>
        </div>
      </section>

      <section style={card} aria-labelledby="c-raw">
        <h2 id="c-raw" style={{ margin: 0, fontSize: 18 }}>Ham kayıtlar</h2>
        <div style={row}>{STINGERS.map(id => <button key={id} type="button" style={btn} onClick={() => s()?.playStinger(id)} title={CEZERI_SCORES[id].about}>{id}</button>)}</div>
        <div style={row}>{CEZERI_SFX.map(d => <button key={d.id} type="button" style={btn} onClick={() => s()?.playSfx(d.id)} title={`${d.variations} varyasyon · ${d.level}`}>{d.id}</button>)}</div>
      </section>
    </div>
  );
}
