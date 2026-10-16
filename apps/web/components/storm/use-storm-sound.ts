'use client';
/**
 * The only place Tarhun talks to its sound engine (lib/slot-audio/storm-sound.ts, `createStormSound`). Presentation
 * only: nothing here can read or change a result. The engine module is imported lazily (it is large and renders
 * its bank in workers), every method is feature-detected and every call swallows engine errors, so the game plays
 * silently if the module, a method or Web Audio is missing. Recorded voice lines load from /audio/voice/storm
 * (missing files are skipped by the engine).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlotSettings } from '@/lib/slot-kit/settings';
import { onVoiceLanguageChange, voiceBankFolder, voiceLanguage, type VoiceLanguage } from '@/lib/slot-audio/voice-locale';
import { voicePolicyInput } from '@/lib/slot-audio/voice-policy';

export type StormSoundScene = 'idle' | 'base' | 'feature' | 'bigwin' | 'none';
export interface StormSoundLoadState { started: boolean; ready: boolean; percent: number }
type Engine = Record<string, unknown>;
type Progress = { done: number; total: number };

export const STORM_VOICE_BANK = '/audio/voice/storm';

function call(engine: Engine | null, name: string, ...args: unknown[]): unknown {
  if (!engine) return undefined;
  const fn = engine[name];
  if (typeof fn !== 'function') return undefined;
  try {
    const out = (fn as (...a: unknown[]) => unknown).apply(engine, args);
    if (out && typeof (out as Promise<unknown>).catch === 'function') (out as Promise<unknown>).catch(() => {});
    return out;
  } catch { return undefined; }
}
const has = (engine: Engine | null, name: string) => !!engine && typeof engine[name] === 'function';

export interface StormSoundControls {
  /** From a user gesture: resumes the audio context, starts rendering the bank and the voice bank once. */
  unlock: () => void;
  scene: (scene: StormSoundScene) => void;
  spinStart: () => void;
  land: (column: number) => void;
  orbLand: (value: number) => void;
  scatterLand: (n: number) => void;
  scatterTease: (on: boolean) => void;
  winHighlight: (multiple: number) => void;
  shatter: (count: number, tier: number) => void;
  tumble: () => void;
  laugh: () => void;
  nice: () => void;
  orbCollect: () => void;
  lightningStrike: (column: number) => void;
  orbArrive: (value: number) => void;
  totalMultiplier: (total: number) => void;
  multiplierCallout: (value: number) => void;
  featureTrigger: () => void;
  freeSpinsIntro: () => void;
  retrigger: () => void;
  featureOutro: () => void;
  totalWinFanfare: () => void;
  bigWin: (tier: 1 | 2 | 3 | 4) => void;
  maxWin: () => void;
  countUp: (start: boolean) => void;
  click: () => void;
  betChange: (direction: 1 | -1) => void;
  denied: () => void;
  autoplay: (on: boolean) => void;
  duck: (db: number, ms: number) => void;
}

/** Lazy loader, swappable for tests. Resolves to null when the module or Web Audio is unavailable. */
async function loadEngine(): Promise<Engine | null> {
  try {
    const mod = (await import('@/lib/slot-audio/storm-sound')) as unknown as { createStormSound?: () => unknown };
    return typeof mod.createStormSound === 'function' ? (mod.createStormSound() as Engine) : null;
  } catch { return null; }
}

export function useStormSound(settings: SlotSettings): { sound: StormSoundControls; loadState: StormSoundLoadState } {
  const engine = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pendingScene = useRef<StormSoundScene>('idle');
  const unlocked = useRef(false);
  const loadStarted = useRef(false);
  const autoplayOn = useRef(false);
  const voiceLang = useRef<VoiceLanguage | null>(null);
  const [loadState, setLoadState] = useState<StormSoundLoadState>({ started: false, ready: false, percent: 0 });

  const applyMix = () => {
    const s = settingsRef.current, e = engine.current;
    const hidden = typeof document !== 'undefined' && document.hidden;
    call(e, 'setMix', { master: s.master, music: s.music, sfx: s.sfx, ambience: s.ambience, muted: s.muted });
    call(e, 'setEnabled', !s.muted && !hidden);
    call(e, 'setVoicePolicy', voicePolicyInput(s, autoplayOn.current));
  };
  const startLoad = () => {
    const e = engine.current;
    if (loadStarted.current || !e || !unlocked.current) return;
    loadStarted.current = true;
    voiceLang.current = voiceLanguage();
    call(e, 'setVoiceBank', voiceBankFolder(STORM_VOICE_BANK, voiceLang.current));
    if (!has(e, 'load')) { setLoadState({ started: true, ready: true, percent: 100 }); return; }
    setLoadState({ started: true, ready: false, percent: 0 });
    const onProgress = (p: Progress) => {
      if (p && p.total > 0) setLoadState(prev => (prev.ready ? prev : { started: true, ready: false, percent: Math.min(99, Math.round((p.done / p.total) * 100)) }));
    };
    const done = () => setLoadState({ started: true, ready: true, percent: 100 });
    const pending = call(e, 'load', onProgress) as Promise<void> | undefined;
    if (pending && typeof pending.then === 'function') pending.then(done, done); else done();
  };

  useEffect(() => {
    let alive = true;
    let created: Engine | null = null;
    void loadEngine().then(e => {
      if (!alive) { call(e, 'dispose'); return; }
      created = e;
      engine.current = e;
      applyMix();
      call(e, 'setScene', pendingScene.current);
      if (unlocked.current) { call(e, 'resume'); startLoad(); }
    });
    return () => {
      alive = false;
      call(created, 'setScene', 'none');
      call(created, 'dispose');
      if (engine.current === created) engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Volume sliders and mute drive the mix; a hidden tab is silent.
  useEffect(() => {
    applyMix();
    document.addEventListener('visibilitychange', applyMix);
    return () => document.removeEventListener('visibilitychange', applyMix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.master, settings.music, settings.sfx, settings.ambience, settings.muted, settings.voice, settings.spinSpeed]);

  // Site language switch: reload the voice bank in the new language (the engine disposes the old buffers).
  useEffect(() => onVoiceLanguageChange(lang => {
    if (!loadStarted.current || voiceLang.current === lang) return;
    voiceLang.current = lang;
    call(engine.current, 'setVoiceBank', voiceBankFolder(STORM_VOICE_BANK, lang));
  }), []);

  const sound = useMemo<StormSoundControls>(() => {
    const e = () => engine.current;
    const c = (name: string, ...args: unknown[]) => { call(e(), name, ...args); };
    return {
      unlock: () => { unlocked.current = true; c('resume'); startLoad(); },
      scene: scene => { pendingScene.current = scene; c('setScene', scene); },
      spinStart: () => c('spinStart'),
      land: column => { if (has(e(), 'land')) c('land', column); else c('symbolLand'); },
      orbLand: value => c('orbLand', value),
      scatterLand: n => { if (has(e(), 'scatterLand')) c('scatterLand', n); else c('scatter', n); },
      scatterTease: on => c('scatterTease', on),
      winHighlight: multiple => { if (has(e(), 'winHighlight')) c('winHighlight', multiple); else c('win', multiple); },
      shatter: (count, tier) => { if (has(e(), 'shatter')) c('shatter', count, tier); else c('pop', count, tier); },
      tumble: () => c('tumble'),
      laugh: () => c('laugh'),
      nice: () => c('nice'),
      orbCollect: () => c('orbCollect'),
      lightningStrike: column => c('lightningStrike', column),
      orbArrive: value => c('orbArrive', value),
      totalMultiplier: total => c('totalMultiplier', total),
      multiplierCallout: value => c('multiplierCallout', value),
      featureTrigger: () => { c('scatterTease', false); c('featureTrigger'); },
      freeSpinsIntro: () => { c('scatterTease', false); c('freeSpinsIntro'); },
      retrigger: () => c('retrigger'),
      featureOutro: () => c('featureOutro'),
      totalWinFanfare: () => c('totalWinFanfare'),
      bigWin: tier => c('bigWin', tier),
      maxWin: () => { if (has(e(), 'maxWin')) c('maxWin'); else c('bigWin', 4); },
      countUp: start => c('countUp', start),
      click: () => c('click'),
      betChange: direction => c('betChange', direction),
      denied: () => c('denied'),
      autoplay: on => { autoplayOn.current = on; applyMix(); c('autoplay', on); },
      duck: (db, ms) => c('duck', db, ms),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { sound, loadState };
}
