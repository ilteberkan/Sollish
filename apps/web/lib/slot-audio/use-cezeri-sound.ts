'use client';
/**
 * React hook for the Cezeri game screen: the only place it needs to talk to its sound engine (cezeri-sound.ts,
 * `createCezeriSound`). Presentation only: nothing here can read or change a result. The engine module is imported
 * lazily (it is large and renders its bank in workers), every method is feature-detected and every call swallows
 * engine errors, so the game plays silently if the module, a method or Web Audio is missing. Recorded voice lines
 * load from /audio/voice/cezeri (missing files are skipped by the engine). Same pattern as use-ebru-sound.ts.
 *
 * Engine step → call (packages/protocol/src/cezeri.ts, one spin):
 *   spin start → spinStart() · hub r0 → hubReveal(value) · rotate → rotate([{ ring, distance, ms, delayMs, ease, held: held.length }] ×4) ·
 *   win → spokeWin(spoke, length, symbol, startRing) · lock → gearLock(newHeld.length, respin) ·
 *   hub rk → hubTick(value, k) · rotate rk → respin(k) + rotate(...) · end → chainEnd(respins, chainCapped, heldSlices) ·
 *   scatter → vesselLand(n)… + featureTrigger() / retrigger() · after a free spin → reservoirFill(level) ·
 *   falcon → falconFlight() then falconDrop(ring, slices.length).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlotSettings } from '@/lib/slot-kit/settings';
import { onVoiceLanguageChange, voiceBankFolder, voiceLanguage, type VoiceLanguage } from '@/lib/slot-audio/voice-locale';
import { voicePolicyInput } from '@/lib/slot-audio/voice-policy';

export type CezeriSoundScene = 'idle' | 'base' | 'feature' | 'bigwin' | 'none';
export interface CezeriSoundLoadState { started: boolean; ready: boolean; percent: number }
type Engine = Record<string, unknown>;
type Progress = { done: number; total: number };
export type CezeriRingEase = 'linear' | 'outQuad' | 'outCubic' | 'outQuart' | 'outExpo' | 'inOutCubic';
/** One ring of a rotate step: slices passed (the board's animation distance), animation ms, start delay, easing, and `held` = that ring's rotate.rings[i].held.length. */
export interface CezeriRingSound { ring: number; distance: number; ms: number; delayMs?: number; ease?: CezeriRingEase; held?: number }

export const CEZERI_VOICE_BANK = '/audio/voice/cezeri';

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

export interface CezeriSoundControls {
  /** From a user gesture: resumes the audio context, starts rendering the bank and the voice bank once. */
  unlock: () => void;
  scene: (scene: CezeriSoundScene) => void;
  spinStart: () => void;
  /** hub step, round 0: the value the hub shows for the first rotation. */
  hubReveal: (value: number) => void;
  /** rotate step: every ring with the slices it passes (distance), its animation ms, start delay and easing. Returns seconds until the last stop. */
  rotate: (rings: readonly CezeriRingSound[]) => number;
  /** One ring (same as rotate with one entry). Returns seconds. */
  ringRotate: (ring: number, distance: number, ms: number, ease?: CezeriRingEase) => number;
  ringStop: (ring: number) => void;
  /** win step: one call per spoke win (queued 90 ms apart). Returns seconds. */
  spokeWin: (spoke: number, length: number, symbol: string, startRing?: number) => number;
  winHighlight: (multiple: number) => void;
  /** lock step: newly held slices and whether a respin follows. */
  gearLock: (newHeld: number, respin: boolean) => void;
  /** hub step with reason "respin": the new hub value and the respin index 1..10. */
  hubTick: (value: number, round: number) => void;
  /** the rotate step of respin k starts (before rotate()). */
  respin: (round: number) => void;
  /** end step. */
  chainEnd: (respins: number, capped?: boolean, heldSlices?: number) => void;
  /** scatter: the n-th vessel shown (1..6); the tease starts at 2. */
  vesselLand: (n: number) => void;
  scatterTease: (on: boolean) => void;
  multiplierCallout: (value: number) => void;
  nice: () => void;
  featureTrigger: () => void;
  freeSpinsIntro: () => void;
  retrigger: () => void;
  /** after each free spin: the reservoir level 1..3. */
  reservoirFill: (level: number) => void;
  falconFlight: () => void;
  /** falcon step: ring and number of pinned slices. */
  falconDrop: (ring: number, count: number) => void;
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
    const mod = (await import('./cezeri-sound')) as unknown as { createCezeriSound?: () => unknown };
    return typeof mod.createCezeriSound === 'function' ? (mod.createCezeriSound() as Engine) : null;
  } catch { return null; }
}

export function useCezeriSound(settings: SlotSettings): { sound: CezeriSoundControls; loadState: CezeriSoundLoadState } {
  const engine = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pendingScene = useRef<CezeriSoundScene>('idle');
  const unlocked = useRef(false);
  const loadStarted = useRef(false);
  const autoplayOn = useRef(false);
  const voiceLang = useRef<VoiceLanguage | null>(null);
  const [loadState, setLoadState] = useState<CezeriSoundLoadState>({ started: false, ready: false, percent: 0 });

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
    call(e, 'setVoiceBank', voiceBankFolder(CEZERI_VOICE_BANK, voiceLang.current));
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
    call(engine.current, 'setVoiceBank', voiceBankFolder(CEZERI_VOICE_BANK, lang));
  }), []);

  const sound = useMemo<CezeriSoundControls>(() => {
    const e = () => engine.current;
    const c = (name: string, ...args: unknown[]) => { call(e(), name, ...args); };
    const n = (r: unknown) => (typeof r === 'number' && Number.isFinite(r) ? r : 0);
    return {
      unlock: () => { unlocked.current = true; c('resume'); startLoad(); },
      scene: scene => { pendingScene.current = scene; c('setScene', scene); },
      spinStart: () => c('spinStart'),
      hubReveal: value => c('hubReveal', value),
      rotate: rings => n(call(e(), 'rotate', rings)),
      ringRotate: (ring, distance, ms, ease) => n(call(e(), 'ringRotate', ring, distance, ms, { ease })),
      ringStop: ring => c('ringStop', ring),
      spokeWin: (spoke, length, symbol, startRing) => n(call(e(), 'spokeWin', spoke, length, symbol, { startRing })),
      winHighlight: multiple => c('winHighlight', multiple),
      gearLock: (newHeld, respin) => c('gearLock', newHeld, { respin }),
      hubTick: (value, round) => c('hubTick', value, round),
      respin: round => c('respin', round),
      chainEnd: (respins, capped, heldSlices) => c('chainEnd', { respins, capped, heldSlices }),
      vesselLand: k => c('vesselLand', k),
      scatterTease: on => c('scatterTease', on),
      multiplierCallout: value => c('multiplierCallout', value),
      nice: () => c('nice'),
      featureTrigger: () => { c('scatterTease', false); c('featureTrigger'); },
      freeSpinsIntro: () => { c('scatterTease', false); c('freeSpinsIntro'); },
      retrigger: () => c('retrigger'),
      reservoirFill: level => c('reservoirFill', level),
      falconFlight: () => c('falconFlight'),
      falconDrop: (ring, count) => c('falconDrop', ring, count),
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
