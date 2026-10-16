'use client';
/**
 * The only place Candy Cascade talks to its sound engine. Presentation only: nothing here can read or change
 * a result. The core methods (resume, setEnabled, spinStart, land, pop, win, crystal, collect, scatter,
 * freeSpinsIntro, bigWin, dispose) exist on every engine version; the richer API (load, setMix, setScene,
 * duck, countUp, click, betChange, denied, tumble, multiplierApply, multiplierCallout, scatterTease, featureOutro,
 * maxWin, totalWinFanfare, autoplay …) is feature-detected and called only when the object provides it, so the game works with the
 * old synthesizer and picks the new engine up without changes here.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createCascadeAudio } from '@/lib/cascade-audio';
import type { SlotSettings } from '@/lib/slot-kit/settings';
import { onVoiceLanguageChange, voiceBankFolder, voiceLanguage, type VoiceLanguage } from '@/lib/slot-audio/voice-locale';
import { voicePolicyInput, type VoiceLevel } from '@/lib/slot-audio/voice-policy';

/** Recorded callout lines live in /audio/voice/cascade/<tr|en>/ (missing files are skipped by the engine). */
export const CASCADE_VOICE_BANK = '/audio/voice/cascade';

export type SoundScene = 'idle' | 'base' | 'feature' | 'bigwin' | 'none';
export interface SoundLoadProgress { done: number; total: number; label?: string; phase?: string }

/** Core methods every engine has. */
interface CoreSound {
  resume: () => Promise<void>;
  setEnabled: (on: boolean) => void;
  spinStart: () => void;
  land: (column: number) => void;
  pop: (count: number, tier: number) => void;
  win: (multiplier: number) => void;
  crystal: (value: number) => void;
  collect: () => void;
  scatter: (n: number) => void;
  freeSpinsIntro: () => void;
  /** Older engines know tiers 1..3 and clamp; newer ones take 1..4 (Büyük, Mega, Süper, Efsane). */
  bigWin: (tier: 1 | 2 | 3 | 4) => void;
  dispose: () => void;
}
/** Optional methods of the newer engine; each is called only if present. */
interface RichSound {
  load: (onProgress?: (p: SoundLoadProgress) => void) => Promise<void>;
  setMix: (mix: { master: number; music: number; sfx: number; ambience: number; muted: boolean }) => void;
  setScene: (scene: SoundScene) => void;
  duck: (amountDb: number, ms: number) => void;
  countUp: (start: boolean) => void;
  click: () => void;
  betChange: (direction?: 1 | -1) => void;
  denied: () => void;
  tumble: () => void;
  symbolLand: () => void;
  crystalArrive: (value: number) => void;
  multiplierApply: (total: number) => void;
  multiplierCallout: (value: number) => void;
  totalWinFanfare: () => void;
  scatterTease: (on: boolean) => void;
  featureOutro: () => void;
  maxWin: () => void;
  autoplay: (on: boolean) => void;
  setVoiceBank: (urls: string) => Promise<unknown>;
  setVoicePolicy: (p: { level?: VoiceLevel; fast?: boolean }) => void;
}
type AnySound = CoreSound & Partial<RichSound>;

/** Calls `name` on the engine only if it is a function; swallows engine errors (sound never breaks play). */
function call<K extends keyof AnySound>(engine: AnySound | null, name: K, ...args: unknown[]): unknown {
  if (!engine) return undefined;
  const fn = (engine as unknown as Record<string, unknown>)[name as string];
  if (typeof fn !== 'function') return undefined;
  try { return (fn as (...a: unknown[]) => unknown).apply(engine, args); } catch { return undefined; }
}

/** Sound bank rendering state for a small "Ses yükleniyor %N" indicator. */
export interface SoundLoadState { started: boolean; ready: boolean; percent: number }

export interface CascadeSoundControls {
  /** From a user gesture: resumes the audio context, then starts rendering the sound bank once. */
  unlock: () => void;
  scene: (scene: SoundScene) => void;
  spinStart: () => void;
  land: (column: number, crystal: boolean) => void;
  pop: (count: number, tier: number, multiplier: number) => void;
  tumble: () => void;
  scatterTease: (on: boolean) => void;
  scatter: (count: number) => void;
  collect: () => void;
  crystalArrive: (value: number) => void;
  multiplierApply: (total: number, multiplier: number) => void;
  /** Big multiplier announcement (the board callout); silent on engines without it. */
  multiplierCallout: (value: number) => void;
  freeSpinsIntro: () => void;
  featureOutro: () => void;
  /** Celebration tier (or tier-up): 1 Büyük, 2 Mega, 3 Süper, 4 Efsane. */
  bigWin: (tier: 1 | 2 | 3 | 4) => void;
  maxWin: () => void;
  /** Short total-win flourish for a winning round below the celebration tiers. */
  totalWinFanfare: () => void;
  countUp: (start: boolean) => void;
  click: () => void;
  betChange: (direction: 1 | -1) => void;
  denied: () => void;
  autoplay: (on: boolean) => void;
}

export function useCascadeSound(settings: SlotSettings): { sound: CascadeSoundControls; loadState: SoundLoadState } {
  const engine = useRef<AnySound | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const loadStarted = useRef(false);
  const applyRef = useRef<() => void>(() => {});
  const autoplayOn = useRef(false);
  const voiceLang = useRef<VoiceLanguage | null>(null);
  const [loadState, setLoadState] = useState<SoundLoadState>({ started: false, ready: false, percent: 0 });

  useEffect(() => {
    let created: AnySound | null = null;
    try { created = createCascadeAudio() as AnySound; } catch { created = null; }
    engine.current = created;
    loadStarted.current = false;
    setLoadState({ started: false, ready: false, percent: 0 });
    return () => {
      call(created, 'setScene', 'none');
      call(created, 'dispose');
      if (engine.current === created) engine.current = null;
    };
  }, []);

  // Volume sliders and mute drive the mix; the legacy engine only knows on/off. A hidden tab is silent.
  useEffect(() => {
    const apply = () => {
      const s = settingsRef.current, e = engine.current;
      const hidden = typeof document !== 'undefined' && document.hidden;
      call(e, 'setMix', { master: s.master, music: s.music, sfx: s.sfx, ambience: s.ambience, muted: s.muted });
      call(e, 'setEnabled', !s.muted && !hidden);
      call(e, 'setVoicePolicy', voicePolicyInput(s, autoplayOn.current));
    };
    applyRef.current = apply;
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => document.removeEventListener('visibilitychange', apply);
  }, [settings.master, settings.music, settings.sfx, settings.ambience, settings.muted, settings.voice, settings.spinSpeed]);

  // Site language switch: reload the voice bank in the new language (the engine disposes the old buffers).
  useEffect(() => onVoiceLanguageChange(lang => {
    if (!loadStarted.current || voiceLang.current === lang) return;
    voiceLang.current = lang;
    call(engine.current, 'setVoiceBank', voiceBankFolder(CASCADE_VOICE_BANK, lang));
  }), []);

  const sound = useMemo<CascadeSoundControls>(() => {
    const e = () => engine.current;
    const has = (name: keyof RichSound) => typeof (e() as unknown as Record<string, unknown> | null)?.[name] === 'function';
    const startLoad = () => {
      if (loadStarted.current || !has('load')) return;
      loadStarted.current = true;
      voiceLang.current = voiceLanguage();
      call(e(), 'setVoiceBank', voiceBankFolder(CASCADE_VOICE_BANK, voiceLang.current));
      setLoadState({ started: true, ready: false, percent: 0 });
      const onProgress = (p: SoundLoadProgress) => {
        if (p.total > 0) setLoadState(prev => (prev.ready ? prev : { started: true, ready: false, percent: Math.min(99, Math.round((p.done / p.total) * 100)) }));
      };
      const done = () => setLoadState({ started: true, ready: true, percent: 100 });
      try {
        const pending = call(e(), 'load', onProgress) as Promise<void> | undefined;
        if (pending && typeof pending.then === 'function') pending.then(done, done); else done();
      } catch { done(); }
    };
    return {
      unlock: () => {
        const r = call(e(), 'resume');
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
        startLoad();
      },
      scene: scene => { call(e(), 'setScene', scene); },
      spinStart: () => { call(e(), 'spinStart'); },
      land: (column, crystal) => {
        call(e(), 'land', column);
        if (crystal) call(e(), 'crystal', 2);
      },
      pop: (count, tier, multiplier) => { call(e(), 'pop', count, tier); call(e(), 'win', multiplier); },
      tumble: () => { call(e(), 'tumble'); },
      scatterTease: on => { if (has('scatterTease')) call(e(), 'scatterTease', on); else if (on) call(e(), 'scatter', 3); },
      scatter: count => { call(e(), 'scatterTease', false); call(e(), 'scatter', count); },
      collect: () => { call(e(), 'collect'); },
      crystalArrive: value => { if (has('crystalArrive')) call(e(), 'crystalArrive', value); else call(e(), 'crystal', value); },
      multiplierApply: (total, multiplier) => { if (has('multiplierApply')) call(e(), 'multiplierApply', total); else call(e(), 'win', multiplier); },
      multiplierCallout: value => { call(e(), 'multiplierCallout', value); },
      freeSpinsIntro: () => { call(e(), 'scatterTease', false); call(e(), 'freeSpinsIntro'); },
      featureOutro: () => { call(e(), 'featureOutro'); },
      bigWin: tier => { call(e(), 'bigWin', tier); },
      maxWin: () => { if (has('maxWin')) call(e(), 'maxWin'); else call(e(), 'bigWin', 3); },
      totalWinFanfare: () => { call(e(), 'totalWinFanfare'); },
      countUp: start => { call(e(), 'countUp', start); },
      click: () => { call(e(), 'click'); },
      betChange: direction => { call(e(), 'betChange', direction); },
      denied: () => { call(e(), 'denied'); },
      autoplay: on => { autoplayOn.current = on; applyRef.current(); call(e(), 'autoplay', on); },
    };
  }, []);
  return { sound, loadState };
}
