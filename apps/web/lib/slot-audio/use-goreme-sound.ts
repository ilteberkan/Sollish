'use client';
/**
 * React hook for the Göreme game screen: the only place it needs to talk to its sound engine (goreme-sound.ts,
 * `createGoremeSound`). Presentation only: nothing here can read or change a result. The engine module is imported lazily
 * (it is large and renders its bank in workers), every method is feature-detected and every call swallows engine
 * errors, so the game plays silently if the module, a method or Web Audio is missing. Recorded voice lines load from
 * /audio/voice/goreme/<tr|en>/<stem>.mp3 in the site's voice language; until those files exist (they wait for the
 * owner's approval of the voice credits) the folder has no build-time version and the bank is skipped without a single
 * request, so every line falls back to its wordless placeholder or the effect alone. Same pattern as use-asena-sound.ts.
 *
 * Engine steps (packages/protocol/src/goreme.ts) map one-to-one to `step(...)`, or the screen can call the atomic events.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlotSettings } from '@/lib/slot-kit/settings';
import { onVoiceLanguageChange, voiceBankFolder, voiceLanguage, type VoiceLanguage } from '@/lib/slot-audio/voice-locale';
import { voicePolicyInput } from '@/lib/slot-audio/voice-policy';

export type GoremeSoundScene = 'idle' | 'base' | 'feature' | 'bigwin' | 'none';
export interface GoremeSoundLoadState { started: boolean; ready: boolean; percent: number }
type Engine = Record<string, unknown>;
type Progress = { done: number; total: number };

export const GOREME_VOICE_BANK = '/audio/voice/goreme';

/** Structural shapes of the engine steps the sound reads (a subset of packages/protocol GoremeStep). */
export interface GoremeBalloonLike { col: number; multiplier: number }
export type GoremeStepLike =
  | { type: 'spin'; balloons: readonly GoremeBalloonLike[] }
  | { type: 'respin'; balloons: readonly GoremeBalloonLike[] }
  | { type: 'ways'; wins: readonly { symbol: string; multiplierProduct: number; payTenThousandths: number }[]; winHundredths: number; skyMultiplier?: number }
  | { type: 'lift'; lift: number; wind: string; merges: readonly { multiplier: number }[]; exits: readonly { multiplier: number; moored: boolean }[]; balloons: readonly unknown[] }
  | { type: 'scatter'; count: number; freeSpins: number }
  | { type: 'sky'; skyBefore: number; skyAfter: number };

export interface GoremeStepContext {
  /** 'base' or 'free' spin (a scatter in a free spin is a retrigger). */
  kind?: 'base' | 'free';
  /** Animate the reel stops of a spin step (default true). */
  reels?: boolean;
}

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

export interface GoremeSoundControls {
  /** From a user gesture: resumes the audio context, starts rendering the bank and loads the voice bank once. */
  unlock: () => void;
  scene: (scene: GoremeSoundScene) => void;
  /** Drive the sound straight from one engine step (spin, ways, lift, respin, scatter, sky). Returns seconds of sound it scheduled (0 if none). */
  step: (step: GoremeStepLike, ctx?: GoremeStepContext) => number;
  spinStart: () => void;
  /** One reel stops (0..5). */
  reelStop: (reel: number) => void;
  symbolLand: () => void;
  /** A landed balloon: its multiplier and reel. */
  balloonLand: (multiplier: number, reel?: number) => void;
  /** A board's ways win: the best symbol and the step win in multiples of the bet. */
  waysWin: (symbol: string | null, winMultiple: number) => void;
  /** A lift step: burner, wind, merges, fly-aways / moorings. Returns its length in seconds. */
  lift: (step: { wind?: string; balloons?: number; lift?: number; merges?: readonly number[]; exits?: readonly { multiplier: number; moored: boolean }[] }) => number;
  burner: (heat?: number) => void;
  wind: (direction: 'left' | 'calm' | 'right') => void;
  merge: (multiplier: number) => void;
  flyAway: () => void;
  moor: (sky?: number) => void;
  respin: () => void;
  skyMultiplier: (before: number, after: number) => void;
  /** Suns in landing order, n = 1..6; the tease starts at 2. */
  sunLand: (n: number) => void;
  sunTease: (on: boolean) => void;
  /** Multiplier announcement (≥×10 has its own sound and line). */
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

async function loadEngine(): Promise<Engine | null> {
  try {
    const mod = (await import('./goreme-sound')) as unknown as { createGoremeSound?: () => unknown };
    return typeof mod.createGoremeSound === 'function' ? (mod.createGoremeSound() as Engine) : null;
  } catch { return null; }
}

/** Pure mapping of one engine step to sound calls on `c` (exported for the lab and the tests). */
export function playGoremeStep(c: (name: string, ...args: unknown[]) => unknown, step: GoremeStepLike, ctx: GoremeStepContext = {}): number {
  switch (step.type) {
    case 'spin': {
      if (ctx.reels !== false) { c('spinStart'); for (let r = 0; r < 6; r++) c('reelStop', r); }
      for (const b of step.balloons) c('balloonLand', b.multiplier, b.col);
      return 0;
    }
    case 'respin': {
      c('respin');
      for (const b of step.balloons) c('balloonLand', b.multiplier, b.col);
      return 0;
    }
    case 'ways': {
      if (!step.wins.length) return 0;
      const best = step.wins.reduce((m, w) => (w.payTenThousandths > m.payTenThousandths ? w : m));
      c('waysWin', best.symbol, step.winHundredths / 100);
      const product = Math.max(...step.wins.map(w => w.multiplierProduct)) * Math.max(1, step.skyMultiplier ?? 1);
      if (product >= 2) c('multiplierCallout', product);
      return 0;
    }
    case 'lift': {
      const r = c('lift', { wind: step.wind, lift: step.lift, balloons: step.balloons.length, merges: step.merges.map(m => m.multiplier), exits: step.exits });
      return typeof r === 'number' ? r : 0;
    }
    case 'scatter': {
      if (step.count >= 3) { if (ctx.kind === 'free') c('retrigger'); else c('featureTrigger'); }
      else c('sunTease', false);
      return 0;
    }
    case 'sky': {
      c('skyMultiplier', step.skyBefore, step.skyAfter);
      return 0;
    }
  }
}

export function useGoremeSound(settings: SlotSettings): { sound: GoremeSoundControls; loadState: GoremeSoundLoadState } {
  const engine = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pendingScene = useRef<GoremeSoundScene>('idle');
  const unlocked = useRef(false);
  const loadStarted = useRef(false);
  const autoplayOn = useRef(false);
  const voiceLang = useRef<VoiceLanguage | null>(null);
  const [loadState, setLoadState] = useState<GoremeSoundLoadState>({ started: false, ready: false, percent: 0 });

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
    call(e, 'setVoiceBank', voiceBankFolder(GOREME_VOICE_BANK, voiceLang.current), { requireVersion: true });
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

  useEffect(() => {
    applyMix();
    document.addEventListener('visibilitychange', applyMix);
    return () => document.removeEventListener('visibilitychange', applyMix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.master, settings.music, settings.sfx, settings.ambience, settings.muted, settings.voice, settings.spinSpeed]);

  useEffect(() => onVoiceLanguageChange(lang => {
    if (!loadStarted.current || voiceLang.current === lang) return;
    voiceLang.current = lang;
    call(engine.current, 'setVoiceBank', voiceBankFolder(GOREME_VOICE_BANK, lang), { requireVersion: true });
  }), []);

  const sound = useMemo<GoremeSoundControls>(() => {
    const e = () => engine.current;
    const c = (name: string, ...args: unknown[]) => { call(e(), name, ...args); };
    return {
      unlock: () => { unlocked.current = true; c('resume'); startLoad(); },
      scene: scene => { pendingScene.current = scene; c('setScene', scene); },
      step: (step, ctx) => { try { return playGoremeStep((name, ...args) => call(e(), name, ...args), step, ctx); } catch { return 0; } },
      spinStart: () => c('spinStart'),
      reelStop: reel => c('reelStop', reel),
      symbolLand: () => c('symbolLand'),
      balloonLand: (multiplier, reel) => c('balloonLand', multiplier, reel),
      waysWin: (symbol, winMultiple) => c('waysWin', symbol, winMultiple),
      lift: step => { const r = call(e(), 'lift', step); return typeof r === 'number' ? r : 0; },
      burner: heat => c('burner', heat),
      wind: direction => c('wind', direction),
      merge: multiplier => c('merge', multiplier),
      flyAway: () => c('flyAway'),
      moor: sky => c('moor', sky),
      respin: () => c('respin'),
      skyMultiplier: (before, after) => c('skyMultiplier', before, after),
      sunLand: n => c('sunLand', n),
      sunTease: on => c('sunTease', on),
      multiplierCallout: value => c('multiplierCallout', value),
      nice: () => c('nice'),
      featureTrigger: () => { c('sunTease', false); c('featureTrigger'); },
      freeSpinsIntro: () => { c('sunTease', false); c('freeSpinsIntro'); },
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
