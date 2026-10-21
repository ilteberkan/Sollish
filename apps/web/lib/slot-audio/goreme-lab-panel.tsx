'use client';
/**
 * Development-only listening panel for the Göreme: Şafak Balonları sound (rendered on /lab/goreme-art, which 404s in
 * production). Every scene, stinger, effect, tier, callout, lift and voice slot can be triggered by hand, and a real
 * round of the engine (playGoremeRound, DEMO seed) can be played through the same step mapping the game screen uses.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { playGoremeRound } from '@sollish/protocol';
import { createGoremeSound, type GoremeSound, type LoadProgress } from './goreme-sound';
import { GOREME_SCORES, type GoremeScoreId } from './scores/goreme';
import { GOREME_SFX } from './sfx/goreme';
import { GOREME_CALLOUT_CLASSES, GOREME_CALLOUT_VALUES, GOREME_SYMBOL_IDS, GOREME_VOCALS, GOREME_VOICE_LINES, GOREME_VOICE_TEXT, GOREME_VOICE_TEXT_EN } from './goreme-tiers';
import { playGoremeStep, type GoremeStepLike } from './use-goreme-sound';
import { WIN_TIERS, WIN_TIER_NAMES, WIN_TIER_THRESHOLDS, winTierFor, type WinTier } from './win-tiers';
import { DEFAULT_MIX, type MixSettings, type SceneId } from './timing';
import { voiceBankFolder } from './voice-locale';

const card: CSSProperties = { border: '1px solid var(--line, rgba(127,127,127,.35))', borderRadius: 12, padding: 16, display: 'grid', gap: 10 };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
const btn: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line, rgba(127,127,127,.45))', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 14 };
const on: CSSProperties = { ...btn, border: '1px solid var(--accent, #e08a3c)', color: 'var(--accent, #e08a3c)' };
const small: CSSProperties = { opacity: 0.75, fontSize: 13, margin: 0 };
const h2: CSSProperties = { margin: 0, fontSize: 18 };

const SCENES: SceneId[] = ['idle', 'base', 'feature', 'bigwin', 'none'];
const STINGERS: GoremeScoreId[] = ['fsIntro', 'retrigger', 'fsOutro', 'totalWin', 'bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'bed1', 'bed2', 'bed3', 'bed4', 'bedMax'];
const VOICE_FOLDER = '/audio/voice/goreme';

export function GoremeAudioLab() {
  const sound = useRef<GoremeSound | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mix, setMix] = useState<MixSettings>({ ...DEFAULT_MIX });
  const [scene, setSceneState] = useState<SceneId>('none');
  const [counting, setCounting] = useState(false);
  const [tease, setTease] = useState(false);
  const [status, setStatus] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [voiceBank, setVoiceBank] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const s = createGoremeSound();
    sound.current = s;
    return () => { s.dispose(); sound.current = null; };
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      const s = sound.current?.status(); if (!s) return;
      setStatus(`core ${s.core ? 'hazır' : '…'} · tümü ${s.extended ? 'hazır' : '…'} · worker ${s.workers} (${s.workerJobs} iş${s.workerFailure ? `, satır içi: ${s.workerFailure}` : ''}) · kutlama: kademe ${s.celebration.tier}${s.celebration.max ? ' + azami' : ''}${s.celebration.counting ? ' · sayıyor' : ''}${s.celebration.bed ? ` · ${s.celebration.bed}` : ''} · ses: ${s.voice.speaking ?? '—'} (${s.voice.loaded} kayıt; son: ${s.voice.last ? `${s.voice.last.line} → ${s.voice.last.kind === 'line' ? 'kayıt' : 'sözsüz'}` : '—'})`);
    }, 500);
    return () => { clearInterval(id); for (const t of timers.current) clearTimeout(t); };
  }, []);

  const s = () => sound.current;
  const start = async () => {
    const x = s(); if (!x) return;
    x.setMix({ ...mix, muted: false }); x.setEnabled(true); setEnabled(true);
    x.setVoicePolicy({ level: 'full' });
    await x.resume();
    void x.load(setProgress);
  };
  const changeMix = (patch: Partial<MixSettings>) => { const next = { ...mix, ...patch }; setMix(next); s()?.setMix(next); };
  const scenePick = (id: SceneId) => { s()?.setScene(id); setSceneState(id); };
  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const clearTimers = () => { for (const t of timers.current) clearTimeout(t); timers.current = []; };
  const c = (name: string, ...args: unknown[]) => {
    const x = s() as unknown as Record<string, (...a: unknown[]) => unknown> | null;
    return x && typeof x[name] === 'function' ? x[name]!(...args) : undefined;
  };

  /** A real round of the engine (DEMO seed), played step by step through the game screen's mapping. */
  const roundDemo = (mode: 'standard' | 'buy') => {
    clearTimers();
    const x = s(); if (!x) return;
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    const seed = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    const round = playGoremeRound(seed, 100, mode);
    const lines: string[] = [`seed ${seed.slice(0, 12)}… · ${mode} · ${round.spins.length} dönüş · toplam ${(round.totalHundredths / 100).toFixed(2)}× bahis`];
    let t = 0, inFeature = false;
    for (const spin of round.spins.slice(0, 14)) {
      if (spin.kind === 'free' && !inFeature) {
        inFeature = true;
        later(t, () => { x.freeSpinsIntro(); x.setScene('feature'); setSceneState('feature'); });
        t += 3400;
      }
      for (const step of spin.steps) {
        const st = step as unknown as GoremeStepLike;
        later(t, () => playGoremeStep(c, st, { kind: spin.kind }));
        lines.push(`${spin.kind} #${spin.index} ${step.type}`);
        t += step.type === 'spin' ? 900 : step.type === 'lift' ? 1300 : step.type === 'ways' ? (step.wins.length ? 900 : 150) : step.type === 'scatter' ? 1400 : 600;
      }
    }
    const tierOf = winTierFor(round.totalHundredths / 100);
    if (inFeature) { later(t, () => { x.totalWinFanfare(); x.setScene('base'); setSceneState('base'); }); t += 4200; }
    if (round.capped) later(t, () => { x.maxWin(); x.countUp(true); later(5000, () => x.countUp(false)); });
    else if (tierOf) later(t, () => { x.bigWin(tierOf as WinTier); x.countUp(true); later(4000, () => x.countUp(false)); });
    setLog(lines.slice(0, 60));
  };
  const runLadder = (withMax: boolean) => {
    clearTimers();
    const x = s(); if (!x) return;
    x.countUp(false);
    const plan: [number, () => void][] = [
      [0, () => { x.bigWin(1); x.countUp(true); setCounting(true); }], [3000, () => x.bigWin(2)], [5500, () => x.bigWin(3)], [8000, () => x.bigWin(4)],
      ...(withMax ? [[11000, () => x.maxWin()] as [number, () => void]] : []),
      [withMax ? 18000 : 12500, () => { x.countUp(false); setCounting(false); }],
    ];
    for (const [ms, fn] of plan) later(ms, fn);
  };
  const liftDemo = (moored: boolean) => {
    const x = s(); if (!x) return;
    x.lift({ wind: ['left', 'calm', 'right'][Math.floor(Math.random() * 3)], balloons: 3, lift: 1, merges: [7], exits: [{ multiplier: 4, moored }] });
    if (moored) later(900, () => x.skyMultiplier(1, 4));
  };
  const loadVoices = async () => {
    const x = s(); if (!x) return;
    setVoiceBank('yükleniyor…');
    const r = await x.setVoiceBank(voiceBankFolder(VOICE_FOLDER), { requireVersion: true });
    setVoiceBank(`yüklü: ${r.loaded.join(', ') || 'yok'} · eksik (sessizce atlandı → sözsüz yer tutucu / yalnız efekt): ${r.missing.length}`);
  };
  const slider = (key: keyof Omit<MixSettings, 'muted'>, label: string) => (
    <label style={{ display: 'grid', gap: 4, minWidth: 150, flex: '1 1 150px' }}>
      <span style={small}>{label}: {Math.round(mix[key] * 100)}</span>
      <input type="range" min={0} max={1} step={0.01} value={mix[key]} onChange={e => changeMix({ [key]: Number(e.target.value) })} />
    </label>
  );
  const pct = progress ? Math.round((100 * progress.done) / Math.max(1, progress.total)) : 0;
  const b = (label: string, fn: () => void, title?: string) => <button key={label} type="button" style={btn} onClick={fn} title={title}>{label}</button>;

  return (
    <section aria-labelledby="g-audio" style={{ display: 'grid', gap: 16, maxWidth: 1180, margin: '32px auto', padding: '0 16px' }}>
      <h2 id="g-audio" style={{ margin: 0, fontSize: 22 }}>Ses laboratuvarı (özgün sentez, DEMO)</h2>
      <div style={card}>
        <h3 style={h2}>Başlat ve yükle</h3>
        <div style={row}>
          <button type="button" style={enabled ? on : btn} onClick={() => void start()}>{enabled ? 'Ses açık' : 'Sesi aç (dokunuş)'}</button>
          {b('Sesi kapat', () => { s()?.setEnabled(false); setEnabled(false); })}
          <span style={small} aria-live="polite">{progress ? `${progress.phase} ${pct}% · ${progress.label} · ${Math.round(progress.ms)} ms` : 'Henüz yüklenmedi'}</span>
        </div>
        <progress max={100} value={pct} style={{ width: '100%' }} aria-label="Yükleme ilerlemesi" />
        <p style={small}>{status}</p>
      </div>

      <div style={card}>
        <h3 style={h2}>Miks</h3>
        <div style={row}>
          {slider('master', 'Ana')}{slider('music', 'Müzik')}{slider('sfx', 'Efekt')}{slider('ambience', 'Ortam (vadi şafağı)')}
          <label style={row}><input type="checkbox" checked={mix.muted} onChange={e => changeMix({ muted: e.target.checked })} /> Sessiz</label>
        </div>
      </div>

      <div style={card}>
        <h3 style={h2}>Sahne müziği</h3>
        <div style={row}>{SCENES.map(id => <button key={id} type="button" style={scene === id ? on : btn} onClick={() => scenePick(id)}>{id}</button>)}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {(['base', 'idle', 'feature', 'ambience'] as const).map(id => <li key={id} style={small}><strong>{id}</strong>: {GOREME_SCORES[id].about}</li>)}
        </ul>
      </div>

      <div style={card}>
        <h3 style={h2}>Gerçek motor turu</h3>
        <p style={small}>playGoremeRound (rastgele DEMO tohumu) adımlarını oyun ekranının kullanacağı eşlemeyle (playGoremeStep) çalar: spin, ways, lift, respin, scatter, sky.</p>
        <div style={row}>{b('Taban tur', () => roundDemo('standard'))}{b('Satın alma turu (özellik)', () => roundDemo('buy'))}{b('Durdur', clearTimers)}</div>
        {log.length ? <pre style={{ ...small, maxHeight: 160, overflow: 'auto', margin: 0 }}>{log.join('\n')}</pre> : null}
      </div>

      <div style={card}>
        <h3 style={h2}>Oyun olayları (API)</h3>
        <div style={row}>
          {b('spinStart', () => s()?.spinStart())}
          {b('reelStop 0…5', () => { for (let r = 0; r < 6; r++) later(r * 110, () => s()?.reelStop(r)); })}
          {b('symbolLand', () => s()?.symbolLand())}
          {b('respin', () => s()?.respin())}
          {[1, 2, 3, 5, 10, 25].map(m => b(`balon ×${m}`, () => s()?.balloonLand(m, 2)))}
        </div>
        <div style={row}>
          {[0.5, 2, 8, 30].map(w => b(`ways ${w}×`, () => s()?.waysWin('h1', w)))}
          {GOREME_SYMBOL_IDS.map(sym => b(`ways ${sym}`, () => s()?.waysWin(sym, 2)))}
        </div>
        <div style={row}>
          {b('brülör (kalkış)', () => s()?.burner(0.5))}
          {b('rüzgâr ←', () => s()?.wind('left'))}{b('rüzgâr durgun', () => s()?.wind('calm'))}{b('rüzgâr →', () => s()?.wind('right'))}
          {[3, 8, 14, 25].map(m => b(`birleşme ×${m}`, () => s()?.merge(m)))}
          {b('uçup gitme', () => s()?.flyAway())}
          {b('demirleme', () => s()?.moor(3))}
          {b('gök ×1→×6', () => s()?.skyMultiplier(1, 6))}{b('gök ×7→×12', () => s()?.skyMultiplier(7, 12))}
          {b('kalkış demosu (taban)', () => liftDemo(false))}{b('kalkış demosu (şölen)', () => liftDemo(true))}
        </div>
        <div style={row}>
          {[1, 2, 3, 4, 5, 6].map(n => b(`güneş ${n}`, () => s()?.sunLand(n)))}
          <button type="button" style={tease ? on : btn} onClick={() => { s()?.sunTease(!tease); setTease(t => !t); }}>sun tease</button>
          {b('featureTrigger', () => s()?.featureTrigger())}
          {b('freeSpinsIntro → feature', () => { s()?.freeSpinsIntro(); s()?.setScene('feature'); setSceneState('feature'); })}
          {b('retrigger (+5)', () => s()?.retrigger())}
          {b('totalWinFanfare', () => s()?.totalWinFanfare())}
          {b('featureOutro → base', () => { s()?.featureOutro(); s()?.setScene('base'); setSceneState('base'); })}
        </div>
        <div style={row}>
          {b('click', () => s()?.click())}{b('bet +', () => s()?.betChange(1))}{b('bet −', () => s()?.betChange(-1))}{b('denied', () => s()?.denied())}
          {b('autoplay on', () => s()?.autoplay(true))}{b('autoplay off', () => s()?.autoplay(false))}
        </div>
      </div>

      <div style={card}>
        <h3 style={h2}>Kazanç kademeleri</h3>
        <p style={small}>Kademeler yukarı ton değiştirir (F → G → A → C, azami D). Sayaç çalışırken daha yüksek kademe gelirse geçiş vuruşa hizalanır; sayaç durunca kademeye özgü iniş çalar.</p>
        <div style={row}>
          {WIN_TIERS.map((t: WinTier) => b(`bigWin ${t} · ${WIN_TIER_NAMES[t]} ≥${WIN_TIER_THRESHOLDS[t]}×`, () => s()?.bigWin(t)))}
          {b('maxWin · Azami', () => s()?.maxWin())}
          <button type="button" style={counting ? on : btn} onClick={() => { s()?.countUp(!counting); setCounting(v => !v); }}>{counting ? 'countUp: durdur (iniş)' : 'countUp: başlat'}</button>
          {b('Tırmanış 1→4', () => runLadder(false))}{b('Tırmanış 1→4→azami', () => runLadder(true))}
        </div>
      </div>

      <div style={card}>
        <h3 style={h2}>Çarpan anonsu ve ses</h3>
        <p style={small}>≥×10 kendi sesine sahiptir (brülör kükremesi + kanun/çan motifi). Kayıtlar henüz yok (kredi onayı bekliyor): {VOICE_FOLDER}/&lt;tr|en&gt;/&lt;ad&gt;.mp3 eklenince çalar, yoksa sözsüz yer tutucu ya da yalnız efekt.</p>
        <div style={row}>
          {GOREME_CALLOUT_CLASSES.map(cl => b(`${cl === 'x2' ? '<10×' : `≥${cl.slice(1)}×`} (${GOREME_CALLOUT_VALUES[cl]}×)`, () => s()?.multiplierCallout(GOREME_CALLOUT_VALUES[cl]), GOREME_VOICE_TEXT[cl === 'x2' ? 'x2-9' : cl]))}
          {b('nice', () => s()?.nice())}
          {GOREME_VOCALS.map(id => b(id, () => s()?.playSfx(id)))}
          {b(`Ses bankasını yükle (${VOICE_FOLDER})`, () => void loadVoices())}
          <span style={small} aria-live="polite">{voiceBank}</span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, columns: 2, fontSize: 13 }}>
          {GOREME_VOICE_LINES.map(l => <li key={l} style={small}><code>{l}</code>: {GOREME_VOICE_TEXT[l]} / {GOREME_VOICE_TEXT_EN[l]}</li>)}
        </ul>
      </div>

      <div style={card}>
        <h3 style={h2}>Ham kayıtlar</h3>
        <div style={row}>{STINGERS.map(id => b(id, () => s()?.playStinger(id), GOREME_SCORES[id].about))}</div>
        <div style={row}>{GOREME_SFX.map(d => b(d.id, () => s()?.playSfx(d.id), `${d.variations} varyasyon · ${d.level}`))}</div>
      </div>
    </section>
  );
}
