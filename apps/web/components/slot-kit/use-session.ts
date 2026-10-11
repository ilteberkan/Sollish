'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_REALITY_INTERVAL_MS, acknowledgeRealityCheck, createRealityCheck, createSession, realityCheckDue, rebaseRealityCheck, recordSessionRound,
  sessionElapsedMs, sessionNetCents, type RealityCheckState, type SessionState,
} from '@/lib/slot-kit/session';

export interface UseSession {
  /** null until mounted (keeps server and first client render identical). */
  nowMs: number | null;
  elapsedMs: number;
  netCents: number;
  rounds: number;
  /** True when a reality check is due; keep it showing until `acknowledge`. */
  realityDue: boolean;
  recordRound: (round: { costCents: number; payoutCents: number }) => void;
  acknowledge: () => void;
  /** Start a fresh session (e.g. after the player leaves and returns). */
  restart: () => void;
}

interface Live { session: SessionState; reality: RealityCheckState }

/** Session clock + net result + reality-check schedule. Ticks once per second and on tab focus. */
export function useSession(options: { realityIntervalMs?: number; tickMs?: number } = {}): UseSession {
  const { realityIntervalMs = DEFAULT_REALITY_INTERVAL_MS, tickMs = 1000 } = options;
  const [live, setLive] = useState<Live | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    setLive({ session: createSession(now), reality: createRealityCheck(now, realityIntervalMs) });
    setNowMs(now);
    const tick = () => {
      const t = Date.now();
      setNowMs(t);
      setLive(prev => (prev ? { ...prev, reality: rebaseRealityCheck(prev.reality, t) } : prev));
    };
    const timer = window.setInterval(tick, tickMs);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [realityIntervalMs, tickMs]);

  const recordRound = useCallback((round: { costCents: number; payoutCents: number }) => {
    setLive(prev => (prev ? { ...prev, session: recordSessionRound(prev.session, round) } : prev));
  }, []);
  const acknowledge = useCallback(() => {
    setLive(prev => (prev ? { ...prev, reality: acknowledgeRealityCheck(prev.reality, Date.now()) } : prev));
  }, []);
  const restart = useCallback(() => {
    const now = Date.now();
    setLive({ session: createSession(now), reality: createRealityCheck(now, realityIntervalMs) });
    setNowMs(now);
  }, [realityIntervalMs]);

  return {
    nowMs,
    elapsedMs: live && nowMs !== null ? sessionElapsedMs(live.session, nowMs) : 0,
    netCents: live ? sessionNetCents(live.session) : 0,
    rounds: live?.session.rounds ?? 0,
    realityDue: live !== null && nowMs !== null && realityCheckDue(live.reality, nowMs),
    recordRound,
    acknowledge,
    restart,
  };
}
