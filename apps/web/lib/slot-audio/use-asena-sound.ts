'use client';
/**
 * React hook for the Asena game screen: the only place it needs to talk to its sound engine (asena-sound.ts,
 * `createAsenaSound`). Presentation only: nothing here can read or change a result. The engine module is imported
 * lazily (it is large and renders its bank in workers), every method is feature-detected and every call swallows
 * engine errors, so the game plays silently if the module, a method or Web Audio is missing. Recorded voice lines
 * load from /audio/voice/asena (missing files are skipped by the engine). Same pattern as use-ebru-sound.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlotSettings } from '@/lib/slot-kit/settings';
import { onVoiceLanguageChange, voiceBankFolder, voiceLanguage, type VoiceLanguage } from '@/lib/slot-audio/voice-locale';
import { voicePolicyInput } from '@/lib/slot-audio/voice-policy';

export type AsenaSoundScene = 'idle' | 'base' | 'feature' | 'bigwin' | 'none';
export interface AsenaSoundLoadState { started: boolean; ready: boolean; percent: number }
type Engine = Record<string, unknown>;
type Progress = { done: number; total: number };

export const ASENA_VOICE_BANK = '/audio/voice/asena';

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

export interface AsenaConstellationPlanLike {
  templateId: string;
  /** Per-node lighting times (ms), template cell order. */
  nodeAt?: readonly number[];
  /** Trace length (ms). */
  duration?: number;
  /** Board cells [col, row] in the same order as nodeAt. */
  nodes?: readonly (readonly [number, number])[];
}

export interface AsenaSoundControls {
  /** From a user gesture: resumes the audio context, starts rendering the bank and the voice bank once. */
  unlock: () => void;
  scene: (scene: AsenaSoundScene) => void;
  spinStart: () => void;
  /** steps[0].grid drop-in: one call per landing column 0..5. */
  dropIn: (column: number) => void;
  symbolLand: () => void;
  /** steps[k].clusters: one call per cluster at the highlight. */
  clusterWin: (symbol: string, size: number) => void;
  winHighlight: (multiple: number) => void;
  /**
   * cluster.constellation: pass the art plan (components/asena/geometry.ts asenaConstellationPlan) so every star sounds as
   * it lights. Returns the seconds until the howl starts (0 when silent) — the moment to call scene.howl() / fx.howl().
   */
  constellation: (plan: AsenaConstellationPlanLike) => number;
  /** The howl alone (big-win sky gate); power ≥ 1.2 = the great howl. */
  howl: (power?: number) => void;
  /** steps[k].burst: one call per cluster. */
  starBurst: (symbol: string, size: number) => void;
  /** steps[k].fall. */
  fall: () => void;
  /** steps[k].wolfWalks[i]: one call per walk, with its animation length (ms). */
  wolfWalk: (ms?: number) => void;
  /** Moons in landing order, n = 1..6; the tease starts at 2. */
  moonLand: (n: number) => void;
  moonTease: (on: boolean) => void;
  /** steps[k].map.unlocked[i]: template index 0..5 and its count after the step (1..2). */
  mapPiece: (template: number, count: number) => void;
  /** steps[k].map.globalMultiplierAfter when it rose (2, 3, 5). */
  globalMultiplier: (value: number) => void;
  /** steps[k].map.freeSpinsAwarded. */
  mapSpins: (n: number) => void;
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
    const mod = (await import('./asena-sound')) as unknown as { createAsenaSound?: () => unknown };
    return typeof mod.createAsenaSound === 'function' ? (mod.createAsenaSound() as Engine) : null;
  } catch { return null; }
}

export function useAsenaSound(settings: SlotSettings): { sound: AsenaSoundControls; loadState: AsenaSoundLoadState } {
  const engine = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pendingScene = useRef<AsenaSoundScene>('idle');
  const unlocked = useRef(false);
  const loadStarted = useRef(false);
  const autoplayOn = useRef(false);
  const voiceLang = useRef<VoiceLanguage | null>(null);
  const [loadState, setLoadState] = useState<AsenaSoundLoadState>({ started: false, ready: false, percent: 0 });

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
    call(e, 'setVoiceBank', voiceBankFolder(ASENA_VOICE_BANK, voiceLang.current));
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
  }, [settings.master, settings.music, settings.sfx, settings.ambience, settings.muted, settings.voice, settings.spinSpeed]);

  // Site language switch: reload the voice bank in the new language (the engine disposes the old buffers).
  useEffect(() => onVoiceLanguageChange(lang => {
    if (!loadStarted.current || voiceLang.current === lang) return;
    voiceLang.current = lang;
    call(engine.current, 'setVoiceBank', voiceBankFolder(ASENA_VOICE_BANK, lang));
  }), []);

  const sound = useMemo<AsenaSoundControls>(() => {
    const e = () => engine.current;
    const c = (name: string, ...args: unknown[]) => { call(e(), name, ...args); };
    return {
      unlock: () => { unlocked.current = true; c('resume'); startLoad(); },
      scene: scene => { pendingScene.current = scene; c('setScene', scene); },
      spinStart: () => c('spinStart'),
      dropIn: column => c('dropIn', column),
      symbolLand: () => c('symbolLand'),
      clusterWin: (symbol, size) => c('clusterWin', symbol, size),
      winHighlight: multiple => c('winHighlight', multiple),
      constellation: plan => {
        const r = call(e(), 'constellation', plan.templateId, { nodeAt: plan.nodeAt, durationMs: plan.duration, cols: plan.nodes?.map(n => n[0]) }) as { howlAt?: number } | null | undefined;
        return r && typeof r.howlAt === 'number' ? r.howlAt : 0;
      },
      howl: power => c('howl', power),
      starBurst: (symbol, size) => c('starBurst', symbol, size),
      fall: () => c('fall'),
      wolfWalk: ms => c('wolfWalk', { ms }),
      moonLand: n => c('moonLand', n),
      moonTease: on => c('moonTease', on),
      mapPiece: (template, count) => c('mapPiece', template, count),
      globalMultiplier: value => c('globalMultiplier', value),
      mapSpins: n => c('mapSpins', n),
      multiplierCallout: value => c('multiplierCallout', value),
      nice: () => c('nice'),
      featureTrigger: () => { c('moonTease', false); c('featureTrigger'); },
      freeSpinsIntro: () => { c('moonTease', false); c('freeSpinsIntro'); },
      retrigger: () => c('retrigger'),
      featureOutro: () => c('featureOutro'),
      totalWinFanfare: () => c('totalWinFanfare'),
      bigWin: tier => c('bigWin', tier),
      maxWin: () => c('maxWin'),
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
