'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { autoplayNetLossCents, createAutoplay, nextDecision, recordRound, type AutoplayConfig, type AutoplayState, type AutoplayStopCode } from '@/lib/slot-kit/autoplay';

/**
 * Otomatik tab of the local Coinflip / Crash practice: the slot-kit autoplay controller (pure, loss limit mandatory and
 * checked BEFORE every round, stops when the tab is hidden). Each automatic round is the game's own normal DEMO round —
 * the same reserve/settle path as a manual press — so autoplay never changes a result or a payout.
 */
export interface InstantAutoplay {
  state: AutoplayState | null;
  start: (config: AutoplayConfig) => void;
  stop: (code?: AutoplayStopCode) => void;
  /** Report a finished round (call once, when it settles). */
  record: (round: { costCents: number; payoutCents: number; balanceAfterCents: number }) => void;
}

export function useInstantAutoplay({ ready, play, balanceCents, costCents, gapMs = 600, onStopped }: {
  /** True when no round is in flight and a new one may start. */
  ready: boolean;
  /** Start one normal round; false when it could not start. */
  play: () => boolean;
  balanceCents: number;
  costCents: number | null;
  gapMs?: number;
  onStopped: (code: AutoplayStopCode, state: AutoplayState) => void;
}): InstantAutoplay {
  const [state, setState] = useState<AutoplayState | null>(null);
  const ref = useRef<AutoplayState | null>(null);
  const stoppedRef = useRef(onStopped); stoppedRef.current = onStopped;
  const playRef = useRef(play); playRef.current = play;
  const balanceRef = useRef(balanceCents); balanceRef.current = balanceCents;
  const costRef = useRef(costCents); costRef.current = costCents;

  const stop = useCallback((code: AutoplayStopCode = 'cancelled') => {
    const current = ref.current;
    if (!current) return;
    ref.current = null; setState(null);
    stoppedRef.current(code, current);
  }, []);
  const start = useCallback((config: AutoplayConfig) => {
    if (ref.current) return;
    const next = createAutoplay(config, balanceRef.current);
    ref.current = next; setState(next);
  }, []);
  const record = useCallback((round: { costCents: number; payoutCents: number; balanceAfterCents: number }) => {
    const current = ref.current;
    if (!current) return;
    const next = recordRound(current, { ...round, balanceAfterCents: Math.max(0, round.balanceAfterCents), featureTriggered: false });
    ref.current = next; setState(next);
  }, []);

  useEffect(() => {
    if (!state || !ready) return;
    const timer = window.setTimeout(() => {
      const current = ref.current;
      if (!current) return;
      const cost = costRef.current;
      const decision = nextDecision(current, { balanceCents: balanceRef.current, nextCostCents: cost ?? 0, tabHidden: document.hidden });
      if (!decision.continue) { stop(decision.code); return; }
      if (!playRef.current()) stop('invalid-input');
    }, state.spinsDone === 0 ? 0 : gapMs);
    return () => window.clearTimeout(timer);
  }, [state, ready, gapMs, stop]);

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stop('tab-hidden'); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stop]);
  useEffect(() => () => { ref.current = null; }, []);

  return { state, start, stop, record };
}

/** Net result of an autoplay run in cents (won − spent). */
export function autoplayNet(state: AutoplayState): number { return -autoplayNetLossCents(state); }
