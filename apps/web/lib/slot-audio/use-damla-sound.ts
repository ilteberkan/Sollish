'use client';
/**
 * React hook for the Damla game screen: the only place it talks to its sound engine (damla-sound.ts). Presentation only.
 * The engine module is imported lazily, every call is feature-detected and swallows errors, so the game plays silently if
 * Web Audio is missing. Damla has no voice lines. Same pattern as use-asena-sound.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlotSettings } from '@/lib/slot-kit/settings';

export interface DamlaSoundLoadState { started: boolean; ready: boolean; percent: number }
type Engine = Record<string, unknown>;
type Progress = { done: number; total: number };

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

export interface DamlaSoundControls {
  unlock: () => void;
  scene: (scene: 'idle' | 'base' | 'none') => void;
  /** A terrace splash (terrace 0 = top). */
  plink: (terrace: number, rows: number) => void;
  /** A landing in the pool; tier 0..5 grades the chime. */
  land: (tier: number, edge: boolean) => void;
  /** Signature: gold overflow. */
  gold: () => void;
  click: () => void;
  betChange: (direction: 1 | -1) => void;
  denied: () => void;
}

async function loadEngine(): Promise<Engine | null> {
  try {
    const mod = await import('./damla-sound');
    return (mod.createDamlaSound() as unknown as Engine | null) ?? null;
  } catch { return null; }
}

export function useDamlaSound(settings: SlotSettings): { sound: DamlaSoundControls; loadState: DamlaSoundLoadState } {
  const engine = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pendingScene = useRef<'idle' | 'base' | 'none'>('idle');
  const unlocked = useRef(false);
  const loadStarted = useRef(false);
  const [loadState, setLoadState] = useState<DamlaSoundLoadState>({ started: false, ready: false, percent: 0 });

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
    setLoadState({ started: true, ready: false, percent: 0 });
    const done = () => setLoadState({ started: true, ready: true, percent: 100 });
    const pending = call(e, 'load', (p: Progress) => {
      if (p && p.total > 0) setLoadState(prev => (prev.ready ? prev : { started: true, ready: false, percent: Math.min(99, Math.round((p.done / p.total) * 100)) }));
    }) as Promise<void> | undefined;
    if (pending && typeof pending.then === 'function') pending.then(done, done); else done();
  };

  useEffect(() => {
    let alive = true;
    let created: Engine | null = null;
    void loadEngine().then(e => {
      if (!alive) { call(e, 'dispose'); return; }
      created = e; engine.current = e;
      applyMix();
      call(e, 'setScene', pendingScene.current);
      if (unlocked.current) { call(e, 'resume'); startLoad(); }
    });
    return () => {
      alive = false;
      call(created, 'setScene', 'none'); call(created, 'dispose');
      if (engine.current === created) engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyMix();
    document.addEventListener('visibilitychange', applyMix);
    return () => document.removeEventListener('visibilitychange', applyMix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.master, settings.music, settings.sfx, settings.ambience, settings.muted]);

  const sound = useMemo<DamlaSoundControls>(() => {
    const c = (name: string, ...args: unknown[]) => { call(engine.current, name, ...args); };
    return {
      unlock: () => { unlocked.current = true; c('resume'); startLoad(); },
      scene: scene => { pendingScene.current = scene; c('setScene', scene); },
      plink: (terrace, rows) => c('plink', terrace, rows),
      land: (tier, edge) => c('land', tier, edge),
      gold: () => c('gold'),
      click: () => c('click'),
      betChange: direction => c('betChange', direction),
      denied: () => c('denied'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { sound, loadState };
}
