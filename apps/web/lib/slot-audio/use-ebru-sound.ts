'use client';
/**
 * React hook for the Ebru game screen: the only place it needs to talk to its sound engine (ebru-sound.ts,
 * `createEbruSound`). Presentation only: nothing here can read or change a result. The engine module is imported
 * lazily (it is large and renders its bank in workers), every method is feature-detected and every call swallows
 * engine errors, so the game plays silently if the module, a method or Web Audio is missing. Recorded voice lines
 * load from /audio/voice/ebru (missing files are skipped by the engine). Same pattern as components/storm/use-storm-sound.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlotSettings } from '@/lib/slot-kit/settings';

export type EbruSoundScene = 'idle' | 'base' | 'feature' | 'bigwin' | 'none';
export interface EbruSoundLoadState { started: boolean; ready: boolean; percent: number }
type Engine = Record<string, unknown>;
type Progress = { done: number; total: number };

export const EBRU_VOICE_BANK = '/audio/voice/ebru';

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

export interface EbruSoundControls {
  /** From a user gesture: resumes the audio context, starts rendering the bank and the voice bank once. */
  unlock: () => void;
  scene: (scene: EbruSoundScene) => void;
  spinStart: () => void;
  /** drop-in step: one call per landing column 0..6. */
  dropIn: (column: number) => void;
  symbolLand: () => void;
  /** bleed step: the colour the drop became and how many neighbours it recoloured. */
  bleed: (colour: string, spread: number) => void;
  /** clusters step: one call per cluster. */
  clusterDissolve: (colour: string, size: number) => void;
  winHighlight: (multiple: number) => void;
  /** stains step: the highest new stain value of the burst. */
  stainGrow: (value: number) => void;
  /** fall step. */
  fall: () => void;
  /** comb step: shifts[7], the sweep's animation length in ms, pass 1..3 and whether it creates a win. Returns seconds. */
  combSweep: (shifts: readonly number[], ms: number, pass?: number, createsWin?: boolean) => number;
  /** final-grid combs (scatters), n = 1..6 in landing order; the tease starts at 2. */
  scatterLand: (n: number) => void;
  scatterTease: (on: boolean) => void;
  multiplierCallout: (value: number) => void;
  nice: () => void;
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

/** Lazy loader. Resolves to null when the module or Web Audio is unavailable. */
async function loadEngine(): Promise<Engine | null> {
  try {
    const mod = (await import('./ebru-sound')) as unknown as { createEbruSound?: () => unknown };
    return typeof mod.createEbruSound === 'function' ? (mod.createEbruSound() as Engine) : null;
  } catch { return null; }
}

export function useEbruSound(settings: SlotSettings): { sound: EbruSoundControls; loadState: EbruSoundLoadState } {
  const engine = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pendingScene = useRef<EbruSoundScene>('idle');
  const unlocked = useRef(false);
  const loadStarted = useRef(false);
  const [loadState, setLoadState] = useState<EbruSoundLoadState>({ started: false, ready: false, percent: 0 });

  const applyMix = () => {
    const s = settingsRef.current, e = engine.current;
    const hidden = typeof document !== 'undefined' && document.hidden;
    call(e, 'setMix', { master: s.master, music: s.music, sfx: s.sfx, ambience: s.ambience, muted: s.muted });
    call(e, 'setEnabled', !s.muted && !hidden);
  };
  const startLoad = () => {
    const e = engine.current;
    if (loadStarted.current || !e || !unlocked.current) return;
    loadStarted.current = true;
    call(e, 'setVoiceBank', EBRU_VOICE_BANK);
    if (typeof e.load !== 'function') { setLoadState({ started: true, ready: true, percent: 100 }); return; }
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
  }, [settings.master, settings.music, settings.sfx, settings.ambience, settings.muted]);

  const sound = useMemo<EbruSoundControls>(() => {
    const e = () => engine.current;
    const c = (name: string, ...args: unknown[]) => { call(e(), name, ...args); };
    return {
      unlock: () => { unlocked.current = true; c('resume'); startLoad(); },
      scene: scene => { pendingScene.current = scene; c('setScene', scene); },
      spinStart: () => c('spinStart'),
      dropIn: column => c('dropIn', column),
      symbolLand: () => c('symbolLand'),
      bleed: (colour, spread) => c('bleed', colour, spread),
      clusterDissolve: (colour, size) => c('clusterDissolve', colour, size),
      winHighlight: multiple => c('winHighlight', multiple),
      stainGrow: value => c('stainGrow', value),
      fall: () => c('fall'),
      combSweep: (shifts, ms, pass, createsWin) => { const r = call(e(), 'combSweep', shifts, ms, { pass, createsWin }); return typeof r === 'number' ? r : 0; },
      scatterLand: n => c('scatterLand', n),
      scatterTease: on => c('scatterTease', on),
      multiplierCallout: value => c('multiplierCallout', value),
      nice: () => c('nice'),
      featureTrigger: () => { c('scatterTease', false); c('featureTrigger'); },
      freeSpinsIntro: () => { c('scatterTease', false); c('freeSpinsIntro'); },
      retrigger: () => c('retrigger'),
      featureOutro: () => c('featureOutro'),
      totalWinFanfare: () => c('totalWinFanfare'),
      bigWin: tier => c('bigWin', tier),
      maxWin: () => c('maxWin'),
      countUp: start => c('countUp', start),
      click: () => c('click'),
      betChange: direction => c('betChange', direction),
      denied: () => c('denied'),
      autoplay: on => c('autoplay', on),
      duck: (db, ms) => c('duck', db, ms),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { sound, loadState };
}
