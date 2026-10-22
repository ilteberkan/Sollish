'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { EBRU_FREE_SPINS_TRIGGER, EBRU_MAX_WIN_MULTIPLIER, EBRU_RTP, playEbruRound, type EbruMode, type EbruRound, type EbruStains } from '@sollish/protocol';
import { DEMO_START_CENTS } from '@/lib/demo';
import { useFormat, useT } from '@/lib/i18n/client';
import { percentOf } from '@/lib/slot-kit/percent';
import {
  buildEbruTimeline, ebruCalloutTier, ebruCents, ebruHistoryDetail,
  type EbruCalloutTier, type EbruEvent, type EbruMeter, type EbruTimeline,
} from '@/lib/ebru-timeline';
import { WIN_TIER_INFO, countUpSchedule, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { TimelinePlayer } from '@/lib/slot-kit/timeline-player';
import { autoplayNetLossCents, createAutoplay, type AutoplayConfig, type AutoplayState, type AutoplayStopCode } from '@/lib/slot-kit/autoplay';
import { SPIN_SPEEDS, type SpinSpeed } from '@/lib/slot-kit/settings';
import {
  EBRU_AUTOPLAY_GAP, EBRU_BET_LADDER, EBRU_COST_MODES, EBRU_DEFAULT_BET_CENTS, EBRU_MAX_BET_CENTS, EBRU_MIN_BET_CENTS,
  ebruAutoplayAfterRound, ebruAutoplayBeforeSpin, ebruBuyBlock, ebruCost, ebruLedgerLimits, ebruRoundId, ebruTimelineOptions,
} from '@/lib/ebru-controls';
import { markRoundShown, rgsErrorMessage, type RemoteReceipt, type RemoteRoundSource } from '@/lib/rgs-client';
import { EBRU_ENGINE } from '@/lib/slot-engines/ebru';
import { localSourceFor, useRoundSource } from '@/lib/use-round-source';
import { useEbruSound } from '@/lib/slot-audio/use-ebru-sound';
import { useProduct, type DemoRecord } from '../providers';
import { DemoNotice, GameHeading, Rules, type Mode } from '../game-common';
import { Icon } from '../icons';
import {
  AutoplayPanel, AutoplayStopButton, BetSelector, BuyFeatureDialog, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, useSession, useSlotSettings,
} from '../slot-kit';
import kit from '../slot-kit/kit.module.css';
import { useViewportTop } from '../slot-kit/use-viewport-top';
import { EbruBoard, type EbruBoardHandle } from './ebru-board';
import { EbruCelebration, EbruFeatureTotal, EbruFreeIntro } from './ebru-celebration';
import { EbruHistory } from './ebru-history';
import { ebruInfoPages } from './ebru-info-pages';
import { EbruFrame } from './frame';
import { EbruLogo } from './logo';
import { EbruScene, type EbruSceneHandle } from './scene';
import { EbruStainArt, EbruSymbolArt, EbruSymbolSprites } from './symbols';
import { useEbruSymbolNames } from './use-symbol-names';
import { EbruWater, type EbruMood } from './water';
import styles from './ebru-game.module.css';
import { GameInfoStrip } from '@/components/game-info-strip';

/* Lifecycle: entropy -> engine ebru-ink-1 resolves the whole round (bet + mode) -> one reservation of the mode cost ->
   the timeline replays it -> exactly one settlement with the engine payout (at the end, or on unmount).
   Spin lock (game-standards §6): once a round starts the spin button and Space stay locked until the whole round —
   every tumble, comb pass and free spin — has played; there is no skip. Speed comes from the quick/turbo setting; only
   the hold screens may be tapped (that moves the presentation clock, never a result). A replay from the history uses
   the same engine call and never touches the ledger.
   Remote (RGS) mode, lib/rgs-client.ts: the server resolves AND settles the round before the browser sees it; the game
   presents the returned round, records it in the history and shows the server balance. It never reserves or settles
   locally, so leaving mid-round needs nothing; a reload re-presents the last unseen server round.
   The water FX (EbruWater), the board and the sound are all driven from the same timeline event, so the comb's sweep
   sound, the water shear and the sliding rows start together; the water's own timers only decorate. */

type LiveRound = {
  id: string | null; replayOf: string | null;
  bet: number; cost: number; mode: EbruMode; balanceBefore: number;
  round: EbruRound; timeline: EbruTimeline; prefix: string; reduced: boolean; lite: boolean; settled: boolean;
  remote: { receipt: RemoteReceipt; balanceAfter: number } | null;
};
type Phase = 'idle' | 'playing' | 'done';
type Card =
  | { kind: 'intro'; awarded: number; at: number; dur: number }
  | { kind: 'outro'; spins: number; total: number; maxStain: number; stainedClusters: number; combWins: number; celebration: boolean; capped: boolean; bet: number; at: number; dur: number }
  | { kind: 'big'; schedule: CountUpSchedule; bet: number; at: number; dur: number };
type Callout = { key: number; value: number; tier: EbruCalloutTier; x: number; y: number; life: number };
type Banner = { key: number; text: string; tone: 'gold' | 'ink' };
type Toast = { key: number; text: string; tone: 'info' | 'warn' };
type StainInfo = { cells: number; max: number };
type ModalId = 'settings' | 'info' | 'autoplay' | 'buy' | null;
type Boot = { phase: 'loading' | 'ready' | 'done'; progress: number };

/** Why autoplay stopped: a slot-kit code, or one of this game's own. The text is translated where it is shown. */
type StopCode = AutoplayStopCode | 'server-failed' | 'spin-failed' | 'quit';
const SPEED_KEYS = { normal: 'settings.speedNormal', quick: 'settings.speedQuick', turbo: 'settings.speedTurbo' } as const satisfies Record<SpinSpeed, string>;
const ZERO: EbruMeter = { spin: 0, total: 0 };
const BET_KEY = 'sollish:ebru:bet';
/** The local DEMO source over ebru's engine only (lib/slot-engines/ebru.ts); the other games' engines are not in this route. */
const localRoundSource = localSourceFor(EBRU_ENGINE);
/** Largest clock step per frame. The water shear and the sliding rows run on the wall clock (WAAPI / EbruWater), so on
 * a slow device the timeline must keep near wall-clock pace or the comb sweep, its sound and the next step drift apart;
 * a hidden tab gets no frames at all, and the first frame after it is still capped. Presentation only. */
const EBRU_PLAYER_MAX_STEP_MS = 250;
let bootedOnce = false;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
function realityIntervalOverride(): number | undefined {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return undefined;
  const value = (window as unknown as { __ebruRealityMs?: unknown }).__ebruRealityMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? value : undefined;
}
const stainInfoOf = (stains: EbruStains | null): StainInfo => {
  let cells = 0, max = 0;
  if (stains) for (const column of stains) for (const v of column) if (v > 0) { cells++; if (v > max) max = v; }
  return { cells, max };
};

/** Count-up number that writes its own text node (no React re-render per frame). */
function CountUp({ cents, duration, format }: { cents: number; duration: number; format: (cents: number) => string }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(cents);
  const [initial] = useState(() => format(cents));
  useEffect(() => {
    const el = node.current; if (!el) return;
    const from = shown.current, to = cents;
    if (duration <= 0 || from === to || typeof requestAnimationFrame === 'undefined') { shown.current = to; el.textContent = format(to); return; }
    const start = performance.now(); let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      shown.current = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
      el.textContent = format(shown.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); shown.current = to; el.textContent = format(to); };
  }, [cents, duration, format]);
  return <span ref={node}>{initial}</span>;
}

/* ------------------------------------------------------------------ icons (original, inline) */
const svg = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, focusable: false } as const;
/** Spin seal: a marbled ink drop (three concentric pigment rings pulled into a tulip point) inside a ring of comb teeth. */
function SpinSeal() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="ebSpinInk" cx=".42" cy=".36" r=".7"><stop offset="0" stopColor="#ffffff" /><stop offset=".35" stopColor="#ffe7a0" /><stop offset="1" stopColor="#f2a93c" /></radialGradient>
      </defs>
      <g className={styles.sealTeeth}>
        {Array.from({ length: 24 }, (_, i) => <rect key={i} x="48.6" y="5" width="2.8" height="9" rx="1.4" transform={`rotate(${i * 15} 50 50)`} fill="#2a1406" opacity=".6" />)}
      </g>
      <path d="M50 18C60 30 70 40 70 54A20 20 0 0 1 30 54C30 40 40 30 50 18Z" fill="#3a1004" opacity=".45" transform="translate(1.5 3)" />
      <path d="M50 18C60 30 70 40 70 54A20 20 0 0 1 30 54C30 40 40 30 50 18Z" fill="url(#ebSpinInk)" stroke="#2a1406" strokeWidth="3" strokeLinejoin="round" />
      <path d="M50 30C56 38 61 45 61 54A11 11 0 0 1 39 54C39 45 44 38 50 30Z" fill="#e0283c" stroke="#5a0a14" strokeWidth="1.6" />
      <path d="M50 40C53 45 55 49 55 54A5 5 0 0 1 45 54C45 49 47 45 50 40Z" fill="#1d3a8a" />
      <path d="M38 46Q40 38 46 33" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity=".8" />
    </svg>
  );
}
function SpeedDrops({ count }: { count: number }) {
  return (
    <span className={styles.drops} aria-hidden="true">
      {[0, 1, 2].map(i => <svg key={i} {...svg} width={10} height={14} viewBox="0 0 10 14" data-on={i < count || undefined}><path d="M5 1C7.3 4 9 6.3 9 8.6a4 4 0 0 1-8 0C1 6.3 2.7 4 5 1Z" fill="currentColor" /></svg>)}
    </span>
  );
}
function CombPip({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 28 16" width="28" height="16" aria-hidden="true" focusable="false" data-on={on || undefined}>
      <path d="M2 3h24v4H2z" fill="currentColor" />
      {Array.from({ length: 7 }, (_, i) => <rect key={i} x={3 + i * 3.4} y="6" width="1.8" height="8" rx=".9" fill="currentColor" />)}
    </svg>
  );
}
function SoundIcon({ on }: { on: boolean }) {
  return <svg {...svg}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{on ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /> : <path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />}</svg>;
}
function LockIcon() { return <svg {...svg} width={14} height={14}><rect x="5" y="10.5" width="14" height="10" rx="2.6" fill="currentColor" /><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>; }
function GearIcon() { return <svg {...svg}><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function InfoIcon() { return <svg {...svg}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M12 11v6M12 7.4h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; }
function LoopIcon() { return <svg {...svg}><path d="M17 3.5 20 6.5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5 4 17.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 12.5v1a4 4 0 0 1-4 4H4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>; }
function RefillIcon() { return <svg {...svg} width={16} height={16}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

const StaticFooter = memo(function StaticFooter({ remote }: { remote: boolean }) { return <><DemoNotice remote={remote} /><Rules game="Ebru" /></>; });

export function EbruGame() {
  const { reserveDemo, settleDemo, recordRemote, setActiveDemo, demoBalance, resetDemoBalance } = useProduct();
  const router = useRouter();
  const t = useT('ebru');
  const tc = useT('common');
  const tk = useT('slotKit');
  const format = useFormat();
  const names = useEbruSymbolNames();
  const money = format.amount;
  const gameTitle = tc('games.ebru');
  const { settings, update: updateSettings, reset: resetSettings } = useSlotSettings('ebru');
  const [realityMs] = useState(realityIntervalOverride);
  const session = useSession(realityMs ? { realityIntervalMs: realityMs } : {});
  const recordSession = session.recordRound;
  const { sound, loadState: soundLoad } = useEbruSound(settings);
  const [mode, setMode] = useState<Mode>('demo');
  const [bet, setBet] = useState(EBRU_DEFAULT_BET_CENTS);
  const [ante, setAnte] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [free, setFree] = useState(false);
  const [freeInfo, setFreeInfo] = useState<{ number: number; left: number } | null>(null);
  const [meter, setMeter] = useState<EbruMeter>(ZERO);
  const [meterDur, setMeterDur] = useState(0);
  const [roundBet, setRoundBet] = useState<number | null>(null);
  const [combPass, setCombPass] = useState(0);
  const [combing, setCombing] = useState(false);
  const [stainInfo, setStainInfo] = useState<StainInfo>({ cells: 0, max: 0 });
  const [stainPunch, setStainPunch] = useState(0);
  const [card, setCard] = useState<Card | null>(null);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [flourish, setFlourish] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [announce, setAnnounce] = useState('');
  const [lastWin, setLastWin] = useState<{ payout: number; total: number; replay: boolean } | null>(null);
  const [auto, setAuto] = useState<AutoplayState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [modal, setModal] = useState<ModalId>(null);
  const [infoPage, setInfoPage] = useState('how');
  const [replaying, setReplaying] = useState<{ recordId: string; seed: string } | null>(null);
  const [boot, setBoot] = useState<Boot>(() => ({ phase: bootedOnce ? 'done' : 'loading', progress: 0 }));
  const [mood, setMood] = useState<EbruMood>('base');
  const reducedMotion = usePrefersReducedMotion();
  const sourceView = useRoundSource(EBRU_ENGINE);
  const remote: RemoteRoundSource | null = sourceView.status === 'remote' ? sourceView.source : null;
  const sourcePending = sourceView.status === 'pending';
  const [remoteBalance, setRemoteBalance] = useState<number | null>(null);
  useEffect(() => { if (sourceView.status === 'remote') setRemoteBalance(sourceView.balanceCents); }, [sourceView]);
  const balance = remote ? (remoteBalance ?? 0) : demoBalance;
  const pendingRemote = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const scene = useRef<EbruSceneHandle>(null);
  const board = useRef<EbruBoardHandle>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const water = useRef<EbruWater | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLElement>(null);
  useViewportTop(tableRef);
  const layerRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const player = useRef<TimelinePlayer<EbruEvent> | null>(null);
  const live = useRef<LiveRound | null>(null);
  const settledIds = useRef(new Set<string>());
  const sequence = useRef(0);
  const bannerKey = useRef(0);
  const toastKey = useRef(0);
  const calloutKey = useRef(0);
  const celebrateFx = useRef({ reduced: false, lite: false });
  const autoRef = useRef<AutoplayState | null>(null);
  autoRef.current = auto;
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------------------------------------------------------------- setup */
  useEffect(() => {
    const host = wellRef.current, canvas = waterRef.current;
    if (!host || !canvas) return;
    const w = new EbruWater({ host, canvas, front: frontRef.current, mood: 'base' });
    water.current = w;
    return () => { w.destroy(); water.current = null; };
  }, []);
  useEffect(() => { water.current?.setMood(mood); }, [mood]);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(BET_KEY));
      if (EBRU_BET_LADDER.includes(stored)) setBet(stored);
    } catch { /* storage blocked: default bet */ }
  }, []);
  const chooseBet = useCallback((cents: number) => {
    setBet(prev => { if (cents !== prev) sound.betChange(cents > prev ? 1 : -1); return cents; });
    try { window.localStorage.setItem(BET_KEY, String(cents)); } catch { /* not remembered */ }
  }, [sound]);

  // Loading screen once per page load (art settles, sound renders after the first gesture in the background).
  useEffect(() => {
    let cancelled = false;
    sound.scene('base');
    if (bootedOnce) return;
    let progress = 0.1;
    setBoot({ phase: 'loading', progress });
    const ticker = window.setInterval(() => { progress = Math.min(1, progress + 0.15); if (!cancelled) setBoot(b => (b.phase === 'loading' ? { ...b, progress } : b)); }, 110);
    const timer = window.setTimeout(() => {
      window.clearInterval(ticker);
      if (cancelled) return;
      bootedOnce = true;
      setBoot({ phase: settingsRef.current.introScreen ? 'ready' : 'done', progress: 1 });
    }, 800);
    return () => { cancelled = true; window.clearInterval(ticker); window.clearTimeout(timer); };
  }, [sound]);

  useEffect(() => {
    const once = () => { sound.unlock(); window.removeEventListener('pointerdown', once, true); window.removeEventListener('keydown', once, true); };
    window.addEventListener('pointerdown', once, true);
    window.addEventListener('keydown', once, true);
    return () => { window.removeEventListener('pointerdown', once, true); window.removeEventListener('keydown', once, true); };
  }, [sound]);

  const showToast = useCallback((text: string, tone: Toast['tone'] = 'info') => setToast({ key: ++toastKey.current, text, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(t => (t?.key === toast.key ? null : t)), toast.tone === 'warn' ? 7000 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* ---------------------------------------------------------------- settlement */
  const settle = useCallback((current: LiveRound) => {
    if (current.id === null) { current.settled = true; return; }
    if (current.settled || settledIds.current.has(current.id)) return;
    current.settled = true; settledIds.current.add(current.id);
    const { round } = current;
    const record: DemoRecord = {
      id: current.id, game: 'Ebru', stake: current.cost, payout: round.payoutCents, detail: ebruHistoryDetail(round), at: Date.now(), kind: 'round',
      ebru: { engine: round.engine, seedHex: round.seedHex, betCents: current.bet, mode: current.mode, costCents: current.cost },
    };
    if (current.remote) {
      const { receipt } = current.remote;
      recordRemote({ ...record, at: receipt.at, remote: { roundId: receipt.roundId, nonce: receipt.fair.nonce, serverSeedHash: receipt.fair.serverSeedHash, clientSeed: receipt.fair.clientSeed } });
      setRemoteBalance(current.remote.balanceAfter);
    } else settleDemo(record);
    recordSession({ costCents: current.cost, payoutCents: round.payoutCents });
    setActiveDemo(false);
  }, [settleDemo, recordRemote, setActiveDemo, recordSession]);

  // Leaving the page mid-show still closes the round once, with the full engine payout.
  const settleRef = useRef(settle); settleRef.current = settle;
  useEffect(() => () => {
    player.current?.stop(); player.current = null;
    const current = live.current;
    if (current && !current.settled) settleRef.current(current);
  }, []);

  const stopAutoplay = useCallback((code: StopCode, tone: Toast['tone'] = 'warn') => {
    const state = autoRef.current;
    if (!state) return;
    autoRef.current = null;
    setAuto(null);
    sound.autoplay(false);
    const net = -autoplayNetLossCents(state);
    const reason = code === 'server-failed' ? t('autoplay.serverFailed') : code === 'spin-failed' ? t('autoplay.spinFailed') : code === 'quit' ? t('autoplay.quit') : tk(`autoplay.reasons.${code}`);
    showToast(t('autoplay.stopped', { reason, spins: state.spinsDone, net: format.signedDemo(net) }), tone);
    setAnnounce(t('autoplay.stoppedShort', { reason }));
  }, [showToast, sound, t, tk, format]);

  const finishRound = useCallback((current: LiveRound) => {
    settle(current);
    if (current.remote) markRoundShown('ebru', current.remote.receipt.roundId);
    setPhase('done');
    sound.countUp(false);
    setMood('base');
    const { round } = current;
    setLastWin({ payout: round.payoutCents, total: round.totalHundredths, replay: current.id === null });
    sound.scene('base');
    if (current.id === null) {
      setReplaying(null);
      setAnnounce(t('announce.replayDone', { amount: format.demo(round.payoutCents), times: money(round.totalHundredths) }));
      return;
    }
    const state = autoRef.current;
    if (state) {
      const next = ebruAutoplayAfterRound(state, { costCents: current.cost, payoutCents: round.payoutCents, featureTriggered: round.freeSpinsTriggered, balanceBeforeCents: current.balanceBefore });
      autoRef.current = next;
      setAuto(next);
    }
    setAnnounce(round.payoutCents > 0 ? t('announce.roundEnd', { amount: format.demo(round.payoutCents), times: money(round.totalHundredths) }) : t('announce.roundEndNoWin'));
  }, [settle, sound, t, format, money]);

  /* ---------------------------------------------------------------- presentation helpers */
  /** A point in cell units (col + 0.5 = cell centre) relative to the stage, plus the cell size. */
  const cellPoint = useCallback((x: number, y: number) => {
    const stage = stageRef.current, cells = stage?.querySelector('[data-cells]');
    if (!stage || !cells) return { x: 0, y: 0, cell: 60 };
    const a = cells.getBoundingClientRect(), b = stage.getBoundingClientRect();
    return { x: a.left - b.left + (x / 7) * a.width, y: a.top - b.top + (y / 7) * a.height, cell: a.width / 7 };
  }, []);
  const floatLabel = useCallback((x: number, y: number, text: string, className: string, life: number, reduced: boolean) => {
    const layer = layerRef.current; if (!layer) return;
    const el = document.createElement('span');
    el.className = className; el.textContent = text;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    layer.appendChild(el);
    const frames: Keyframe[] = reduced
      ? [{ opacity: 0, transform: 'translate(-50%, -50%)' }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -50%)' }]
      : [{ opacity: 0, transform: 'translate(-50%, -20%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.12)', offset: 0.18 }, { opacity: 1, transform: 'translate(-50%, -60%) scale(1)', offset: 0.7 }, { opacity: 0, transform: 'translate(-50%, -110%) scale(.96)' }];
    el.animate(frames, { duration: life, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
  }, []);

  const shake = useCallback((strength: number, duration = 360) => {
    const frames: Keyframe[] = [
      { transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-strength}px, ${strength * 0.6}px, 0)` }, { transform: `translate3d(${strength}px, ${-strength * 0.4}px, 0)` },
      { transform: `translate3d(${-strength * 0.7}px, ${-strength * 0.5}px, 0)` }, { transform: `translate3d(${strength * 0.5}px, ${strength * 0.3}px, 0)` }, { transform: 'translate3d(0,0,0)' },
    ];
    shakeRef.current?.animate(frames, { duration, easing: 'ease-out' });
    stageRef.current?.querySelectorAll('[data-shake]').forEach(el => el.animate(frames, { duration, easing: 'ease-out' }));
  }, []);

  /** Big stain-multiplier announcement over the board (game-standards §6), with its own sound and voice line. */
  const showCallout = useCallback((value: number, reduced: boolean, lite: boolean, life = 1900) => {
    const tier = ebruCalloutTier(value);
    const c = cellPoint(3.5, 3.5);
    setCallout({ key: ++calloutKey.current, value, tier, x: c.x, y: c.y, life });
    sound.multiplierCallout(value);
    scene.current?.glow(Math.min(1, 0.5 + tier * 0.12));
    if (!lite) { water.current?.goldLeaf(20 + tier * 18); for (let i = 0; i < 2 + tier; i++) water.current?.sprinkle(); }
    if (!reduced) shake(tier <= 1 ? 4 : 4 + tier * 2.2, 360 + tier * 60);
  }, [cellPoint, shake, sound]);

  const openCelebration = useCallback((schedule: CountUpSchedule, betCents: number, at: number, dur: number, reduced: boolean, lite: boolean) => {
    celebrateFx.current = { reduced, lite };
    setCard({ kind: 'big', schedule, bet: betCents, at, dur });
    setMood('bigwin');
    sound.scene('bigwin');
    setAnnounce(t('announce.bigWin', { tier: tk(`winTier.${WIN_TIER_INFO[schedule.finalLevel].id}.title`), amount: format.demo(ebruCents(betCents, schedule.totalHundredths)), times: money(schedule.totalHundredths) }));
  }, [sound, t, tk, format, money]);
  const onCelebrationLevel = useCallback((level: CelebrationLevel, first: boolean) => {
    const { reduced, lite } = celebrateFx.current;
    if (level === 5) sound.maxWin(); else sound.bigWin(level);
    if (first) sound.countUp(true);
    scene.current?.glow(0.6 + level * 0.1);
    if (!lite) { void water.current?.bloom(0.8 + level * 0.15); water.current?.goldLeaf(40 + level * 20); }
    if (!lite && !reduced) shake(first ? 5 : 6 + level * 2.2, first ? 380 : 540);
  }, [shake, sound]);
  const onCelebrationCounted = useCallback(() => { sound.countUp(false); }, [sound]);

  /* ---------------------------------------------------------------- timeline events */
  const handle = useCallback((event: EbruEvent) => {
    const current = live.current; if (!current) return;
    const reduced = current.reduced, lite = current.lite, b = board.current, w = water.current;
    const betCents = current.bet;
    switch (event.type) {
      case 'spin-start':
        setCombPass(0);
        if (event.kind === 'free') { setFreeInfo({ number: event.freeSpinNumber, left: event.freeSpinsLeft }); setMeterDur(0); setMeter(event.meter); sound.spinStart(); }
        break;
      case 'clear':
        b?.clear(event.ids, event.dur, reduced);
        if (event.spin === 0) { b?.setStains(null, [], reduced); w?.setStains(null); setStainInfo({ cells: 0, max: 0 }); }
        break;
      case 'deal':
        b?.deal(current.prefix, event.cells, event.stains, reduced);
        if (event.stains) { w?.setStains(event.stains); setStainInfo(stainInfoOf(event.stains)); }
        break;
      case 'land':
        sound.dropIn(event.col);
        w?.land(event.rows.map(row => ({ col: event.col, row })), 14, 0.55);
        break;
      case 'scatter-land':
        sound.scatterLand(event.count);
        if (!lite) for (const id of event.ids) { const el = b?.symbolOf(id); if (el) { const box = el.getBoundingClientRect(), s = stageRef.current!.getBoundingClientRect(); floatLabel(box.left - s.left + box.width / 2, box.top - s.top + box.height * 0.2, '✦', styles.sparkLabel, 700, reduced); } }
        break;
      case 'scatter-tease': b?.tease(event.ids); sound.scatterTease(true); break;
      case 'bleed':
        w?.bleed(event.col, event.row, event.colour, event.targets, event.dur);
        sound.bleed(event.colour, event.targets.length);
        setAnnounce(t('announce.bleed', { n: event.targets.length, name: names.inline(event.colour) }));
        break;
      case 'bleed-apply': b?.recolour(event.id, event.colour, event.recoloured.map(r => r.id), reduced); break;
      case 'highlight':
        b?.highlight(event.clusters.flatMap(cl => cl.ids), event.dur, reduced);
        sound.winHighlight(event.stepHundredths / 100);
        setAnnounce(event.clusters.map(cl => (cl.stainSum > 0
          ? t('announce.clusterStain', { size: cl.size, name: names.inline(cl.colour), stain: String(cl.stainSum), times: money(cl.winHundredths) })
          : t('announce.cluster', { size: cl.size, name: names.inline(cl.colour), times: money(cl.winHundredths) }))).join('; '));
        break;
      case 'stain-hit': {
        b?.stainHit(event.clusters.flatMap(cl => cl.cells), event.dur, reduced);
        for (const cl of event.clusters) {
          const p = cellPoint(cl.centroid.x, cl.centroid.y);
          floatLabel(p.x, p.y, `×${cl.multiplier}`, styles.stainLabel, Math.max(900, event.dur + 300), reduced);
        }
        if (event.best >= 10) showCallout(event.best, reduced, lite, Math.max(1100, Math.min(2300, Math.round(event.dur * 1.4))));
        setAnnounce(t('announce.stainMultiplier', { best: String(event.best) }));
        break;
      }
      case 'dissolve': {
        b?.dissolve(event.clusters.flatMap(cl => cl.ids), event.dur, reduced);
        w?.dissolve(event.clusters.flatMap(cl => cl.cells.map(c => ({ col: c.col, row: c.row, colour: cl.colour }))), { duration: Math.max(500, event.dur + 300), intensity: lite ? 0.7 : 1 });
        for (const cl of event.clusters) {
          sound.clusterDissolve(cl.colour, cl.size);
          const p = cellPoint(cl.centroid.x, cl.centroid.y);
          floatLabel(p.x, p.y, `+${money(ebruCents(betCents, cl.winHundredths))}`, styles.floatLabel, reduced ? 800 : 1300, reduced);
        }
        setMeterDur(Math.min(520, event.dur + 160)); setMeter(event.meter);
        if (event.stepHundredths >= 500) scene.current?.glow(0.5);
        break;
      }
      case 'stains':
        b?.setStains(event.stains, event.changes, reduced);
        w?.setStains(event.stains);
        setStainInfo(stainInfoOf(event.stains)); setStainPunch(k => k + 1);
        sound.stainGrow(event.maxValue);
        break;
      case 'fall': b?.fall(current.prefix, event.cells, event.removed, reduced); sound.fall(); break;
      case 'comb':
        setCombPass(event.pass); setCombing(true);
        b?.comb(event.shifts, event.dur, reduced);
        void w?.combPass({ shifts: event.shifts, amplitude: event.amplitude, duration: event.dur });
        sound.combSweep(event.shifts, event.dur, event.pass, event.createsWin);
        setAnnounce(t('announce.comb', { pass: event.pass, shifts: event.shifts.map(s => (s > 0 ? `+${s}` : `${s}`)).join(', ') }));
        break;
      case 'comb-end':
        b?.combEnd(event.grid, event.stains);
        if (event.stains) { w?.setStains(event.stains); setStainInfo(stainInfoOf(event.stains)); }
        setCombing(false);
        if (event.createsWin) { setBanner({ key: ++bannerKey.current, text: t('banner.combCluster'), tone: 'ink' }); setAnnounce(t('announce.combCluster')); }
        break;
      case 'scatter-pay':
        setMeterDur(500); setMeter(event.meter);
        setBanner({ key: ++bannerKey.current, text: t('banner.scatterPay', { count: event.count, amount: money(ebruCents(betCents, event.hundredths)) }), tone: 'gold' });
        break;
      case 'scatter-trigger': {
        b?.dim(true); b?.flare(event.ids, event.dur, reduced);
        scene.current?.glow(1);
        if (!lite) w?.goldLeaf(70);
        if (event.retrigger) {
          sound.retrigger();
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          setBanner({ key: ++bannerKey.current, text: t('banner.retrigger', { n: event.awarded }), tone: 'ink' });
          setAnnounce(t('announce.retrigger', { count: event.count, awarded: event.awarded }));
        } else {
          sound.featureTrigger();
          setAnnounce(t('announce.trigger', { count: event.count }));
        }
        break;
      }
      case 'free-intro':
        setCard({ kind: 'intro', awarded: event.awarded, at: event.at, dur: event.dur });
        sound.freeSpinsIntro();
        setMood('feature');
        setAnnounce(t('announce.freeIntro', { awarded: event.awarded }));
        break;
      case 'free-mode':
        setCard(null); b?.dim(false); setFree(event.on); setFreeInfo({ number: 0, left: event.freeSpinsLeft });
        setStainInfo({ cells: 0, max: 0 });
        sound.scene('feature');
        break;
      case 'spin-end': {
        b?.dim(false);
        sound.scatterTease(false);
        setMeterDur(300); setMeter(event.meter);
        if (event.kind === 'free') {
          const m = meterRef.current, s = stageRef.current;
          if (m && s && event.winHundredths > 0) { const a = m.getBoundingClientRect(), o = s.getBoundingClientRect(); floatLabel(a.left - o.left + a.width / 2, a.top - o.top - 6, `+${money(ebruCents(betCents, event.winHundredths))}`, styles.floatSpin, reduced ? 900 : 1400, reduced); }
          setAnnounce(event.winHundredths > 0 ? t('announce.freeSpinWin', { win: money(event.winHundredths), total: money(event.meter.total) }) : t('announce.freeSpinNoWin'));
        } else {
          if (event.winHundredths === 0) setAnnounce(t('announce.noWin'));
          else if (event.winHundredths >= 300 && event.winHundredths < 1000) sound.nice();
        }
        break;
      }
      case 'total-win': {
        setFlourish(k => k + 1);
        sound.totalWinFanfare();
        const m = meterRef.current;
        if (!reduced) m?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.3 }, { transform: 'scale(.98)', offset: 0.65 }, { transform: 'scale(1)' }], { duration: 620, easing: 'ease-out' });
        if (!lite) w?.goldLeaf(30);
        setAnnounce(t('announce.totalWin', { amount: format.demo(ebruCents(betCents, event.totalHundredths)), times: money(event.totalHundredths) }));
        break;
      }
      case 'free-outro':
        setCard({ kind: 'outro', spins: event.spins, total: event.totalHundredths, maxStain: event.maxStain, stainedClusters: event.stainedClusters, combWins: event.combWins, celebration: event.celebration, capped: event.capped, bet: betCents, at: event.at, dur: event.dur });
        sound.featureOutro();
        setMood('base');
        if (!lite) w?.goldLeaf(50);
        setAnnounce(t('announce.freeOutro', { amount: format.demo(ebruCents(betCents, event.totalHundredths)), spins: event.spins, stain: String(event.maxStain) }));
        break;
      case 'big-win':
        openCelebration(event.schedule, betCents, event.at, event.dur, reduced, lite);
        break;
      case 'end':
        setCard(null); setBanner(null); setFree(false); setFreeInfo(null); setCombPass(0); setCombing(false);
        player.current = null;
        finishRound(current);
        break;
    }
  }, [cellPoint, finishRound, floatLabel, openCelebration, showCallout, sound, t, format, money, names]);

  /* ---------------------------------------------------------------- starting rounds */
  const begin = useCallback((current: LiveRound, text: string) => {
    live.current = current;
    setError(''); setPhase('playing'); setRoundBet(current.bet);
    setFree(false); setFreeInfo(null); setMeterDur(0); setMeter(ZERO); setCard(null); setBanner(null); setCallout(null); setFlourish(0); setMood('base'); setCombPass(0);
    setAnnounce(text);
    sound.unlock();
    sound.scene('base');
    sound.spinStart();
    const next = new TimelinePlayer<EbruEvent>(current.timeline, event => { if (live.current === current) handle(event); }, undefined, EBRU_PLAYER_MAX_STEP_MS);
    player.current = next;
    next.start();
  }, [handle, sound]);

  const gated = mode === 'live';
  const busy = phase === 'playing';
  const booting = boot.phase !== 'done';

  const makeLive = useCallback((fields: Omit<LiveRound, 'timeline' | 'prefix' | 'reduced' | 'lite' | 'settled'>): LiveRound => {
    const s = settingsRef.current;
    return { ...fields, timeline: buildEbruTimeline(fields.round, ebruTimelineOptions(s, reducedMotion)), prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects, settled: false };
  }, [reducedMotion]);

  /** Remote round: the server resolves and settles it; the spin stays locked until its round has been presented. */
  const startRemote = useCallback((source: RemoteRoundSource, roundMode: EbruMode, cost: number, balanceBefore: number) => {
    const betCents = bet;
    pendingRemote.current = true;
    setError(''); setPhase('playing'); setActiveDemo(true); setReplaying(null);
    setRemoteBalance(balanceBefore - cost);
    setAnnounce(t('announce.sent', { amount: format.demo(cost) }));
    source.client.play('ebru', betCents, roundMode).then(play => {
      pendingRemote.current = false;
      const current = makeLive({ id: `remote:${play.receipt.roundId}`, replayOf: null, bet: betCents, cost: play.receipt.costCents, mode: roundMode, balanceBefore, round: play.round, remote: { receipt: play.receipt, balanceAfter: play.receipt.balanceCents } });
      if (!mounted.current) { settleRef.current(current); return; }
      begin(current, t(roundMode === 'buy' ? 'announce.buyStarted' : 'announce.spinStarted', { amount: format.demo(cost) }));
    }, (failure: unknown) => {
      pendingRemote.current = false;
      setActiveDemo(false);
      if (!mounted.current) return;
      setPhase('idle'); setError(rgsErrorMessage(failure)); sound.denied();
      if (autoRef.current) stopAutoplay('server-failed');
      source.client.state().then(state => { if (mounted.current) setRemoteBalance(state.balanceCents); }, () => undefined);
    });
  }, [bet, begin, makeLive, setActiveDemo, sound, stopAutoplay, t, format]);

  const startRound = useCallback((kind: 'spin' | 'buy'): boolean => {
    if ((live.current && !live.current.settled) || pendingRemote.current || gated || booting || sourcePending) return false;
    const roundMode: EbruMode = kind === 'buy' ? 'buy' : ante ? 'ante' : 'standard';
    if (kind === 'buy' && ante) return false;
    const cost = ebruCost(bet, roundMode);
    const balanceBefore = balanceRef.current;
    if (cost > balanceBefore) {
      setError(t(roundMode === 'buy' ? 'error.insufficientBuy' : 'error.insufficientSpin', { cost: format.demo(cost) }));
      sound.denied();
      return false;
    }
    if (remote) { startRemote(remote, roundMode, cost, balanceBefore); return true; }
    let round: EbruRound;
    try { round = localRoundSource.resolve('ebru', bet, roundMode); } catch { setError(t('error.entropy')); return false; }
    let id: string | null;
    try { id = reserveDemo(cost, ebruLedgerLimits(bet, roundMode)); } catch { setError(t('error.entropy')); return false; }
    if (!id) { setError(t('error.noCredit')); sound.denied(); return false; }
    setActiveDemo(true);
    const current = makeLive({ id, replayOf: null, bet, cost, mode: roundMode, balanceBefore, round, remote: null });
    setReplaying(null);
    begin(current, t(roundMode === 'buy' ? 'announce.buyStarted' : 'announce.spinStarted', { amount: format.demo(cost) }));
    return true;
  }, [ante, bet, begin, booting, gated, makeLive, reserveDemo, setActiveDemo, sound, remote, sourcePending, startRemote, t, format]);

  // Reload recovery (remote): the last unseen server round of this game is shown again exactly as resolved.
  const recoveredOnce = useRef(false);
  useEffect(() => {
    if (sourceView.status !== 'remote' || !sourceView.recovered || recoveredOnce.current || booting || live.current || pendingRemote.current) return;
    recoveredOnce.current = true;
    const { receipt, round } = sourceView.recovered;
    const after = sourceView.recoveredBalanceCents ?? receipt.balanceCents;
    const current = makeLive({ id: `remote:${receipt.roundId}`, replayOf: null, bet: receipt.betCents, cost: receipt.costCents, mode: receipt.mode, balanceBefore: after + receipt.costCents - receipt.payoutCents, round, remote: { receipt, balanceAfter: after } });
    setActiveDemo(true);
    setRemoteBalance(current.balanceBefore - current.cost);
    begin(current, t('announce.recovered', { amount: format.demo(receipt.payoutCents) }));
  }, [sourceView, booting, begin, makeLive, setActiveDemo, t, format]);

  /** Remote only: publish the signed replay of a server round and hand out its link ("Kazancını paylaş"). */
  const shareRound = useCallback((record: DemoRecord) => {
    const id = record.remote?.roundId;
    if (!remote || !id) return;
    remote.client.share(id).then(async ({ path }) => {
      const url = `${window.location.origin}${path}`;
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard blocked: show the link */ }
      showToast(t(copied ? 'toast.shareCopied' : 'toast.shareLink', { url }));
    }, (failure: unknown) => showToast(t('toast.shareFailed', { reason: rgsErrorMessage(failure) }), 'warn'));
  }, [remote, showToast, t]);
  const startRef = useRef(startRound); startRef.current = startRound;

  const replay = useCallback((record: DemoRecord) => {
    const meta = record.ebru;
    if (!meta || (live.current && !live.current.settled) || autoRef.current || booting) return;
    let round: EbruRound;
    try { round = playEbruRound(meta.seedHex, meta.betCents, meta.mode); } catch { showToast(t('toast.replayFailed'), 'warn'); return; }
    if (round.payoutCents !== record.payout || round.costCents !== meta.costCents) { showToast(t('toast.replayMismatch'), 'warn'); return; }
    const current = makeLive({ id: null, replayOf: record.id, bet: meta.betCents, cost: meta.costCents, mode: meta.mode, balanceBefore: balanceRef.current, round, remote: null });
    setReplaying({ recordId: record.id, seed: meta.seedHex });
    stageRef.current?.scrollIntoView({ block: 'start' });
    begin(current, t('announce.replaying', { id: ebruRoundId(meta.seedHex) }));
  }, [begin, booting, makeLive, showToast, t]);

  /** Tap on a hold screen: the first tap on a celebration finishes the count-up, the next closes. Never touches a result. */
  const advanceHold = useCallback(() => {
    const p = player.current; if (!p) return;
    const holdEvent = p.currentHold(); if (!holdEvent) return;
    if (holdEvent.type === 'big-win' && p.time < holdEvent.at + holdEvent.countUp - 1) { p.jumpTo(holdEvent.at + holdEvent.countUp); return; }
    p.jumpTo(holdEvent.at + holdEvent.dur);
  }, []);
  const cardAt = card?.at ?? null;
  const cardElapsed = useCallback(() => {
    const p = player.current;
    return p && cardAt !== null ? p.time - cardAt : Number.POSITIVE_INFINITY;
  }, [cardAt]);

  useEffect(() => {
    if (!callout) return;
    const timer = window.setTimeout(() => setCallout(c => (c?.key === callout.key ? null : c)), callout.life);
    return () => window.clearTimeout(timer);
  }, [callout]);
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(x => (x?.key === banner.key ? null : x)), 2200);
    return () => window.clearTimeout(timer);
  }, [banner]);

  /* Development-only preview of the celebration screens and callouts (visual QA). It never builds a round, reserves
     or settles anything; production builds drop it (NODE_ENV is inlined). */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const win = window as unknown as { __ebruPreview?: unknown };
    const idle = () => !(live.current && !live.current.settled) && !player.current;
    win.__ebruPreview = {
      celebrate: (totalHundredths: number, capped = false, betCents = 1000) => {
        if (!idle()) return false;
        const s = settingsRef.current, opts = ebruTimelineOptions(s, reducedMotion);
        const schedule = countUpSchedule(totalHundredths, capped, opts);
        const dur = schedule.countUp + schedule.hold;
        const timeline = { events: [
          { type: 'big-win', at: 0, dur, tier: schedule.finalLevel, totalHundredths, capped, countUp: schedule.countUp, schedule, hold: true } as EbruEvent,
          { type: 'end', at: dur, dur: 0, totalHundredths, payoutCents: ebruCents(betCents, totalHundredths), capped } as EbruEvent,
        ] };
        const preview = new TimelinePlayer<EbruEvent>(timeline, event => {
          if (event.type === 'big-win') openCelebration(event.schedule, betCents, event.at, event.dur, reducedMotion, reducedMotion || s.reducedEffects);
          else if (event.type === 'end') { setCard(null); setMood('base'); sound.countUp(false); player.current = null; }
        });
        player.current = preview;
        preview.start();
        return true;
      },
      callout: (value: number) => { showCallout(value, reducedMotion, reducedMotion || settingsRef.current.reducedEffects); return true; },
    };
    return () => { delete win.__ebruPreview; };
  }, [openCelebration, reducedMotion, showCallout, sound]);

  /* ---------------------------------------------------------------- autoplay */
  const startAutoplay = useCallback((config: AutoplayConfig) => {
    if (busy || gated) return;
    const state = createAutoplay(config, balanceRef.current);
    autoRef.current = state;
    setAuto(state);
    setModal(null);
    sound.unlock(); sound.autoplay(true);
    showToast(t('toast.autoplay', { spins: config.spins, limit: format.demo(config.lossLimitCents) }));
  }, [busy, gated, showToast, sound, t, format]);

  const realityDue = session.realityDue;
  useEffect(() => {
    if (!auto || phase === 'playing' || modal !== null || realityDue || booting || gated) return;
    const gap = EBRU_AUTOPLAY_GAP[settingsRef.current.spinSpeed];
    const timer = window.setTimeout(() => {
      const state = autoRef.current; if (!state) return;
      const decision = ebruAutoplayBeforeSpin(state, { balanceCents: balanceRef.current, betCents: bet, ante, tabHidden: document.hidden });
      if (!decision.continue) { stopAutoplay(decision.code, decision.code === 'completed' ? 'info' : 'warn'); return; }
      if (!startRef.current('spin')) stopAutoplay('spin-failed');
    }, phase === 'idle' ? 0 : gap);
    return () => window.clearTimeout(timer);
  }, [auto, phase, modal, realityDue, booting, gated, bet, ante, stopAutoplay]);

  useEffect(() => {
    const onVisibility = () => { if (document.hidden && autoRef.current) stopAutoplay('tab-hidden'); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stopAutoplay]);

  /* ---------------------------------------------------------------- keyboard */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, summary, [contenteditable="true"], dialog, [role="switch"]')) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.key === ' ' && !settingsRef.current.spaceToSpin) return;
      event.preventDefault();
      // Spin lock: during a round Space/Enter only act on a hold screen (tap-to-continue); they never skip play.
      if (player.current?.active) { if (player.current.currentHold()) advanceHold(); return; }
      if (!autoRef.current) startRef.current('spin');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advanceHold]);

  /* ---------------------------------------------------------------- derived view */
  const roundMode: EbruMode = ante ? 'ante' : 'standard';
  const spinCost = ebruCost(bet, roundMode);
  const buyPrice = ebruCost(bet, 'buy');
  const block = ebruBuyBlock({ betCents: bet, balanceCents: balance, ante, autoplay: auto !== null, busy, gated });
  const buyReason = block ? (block.code === 'balance' ? t('buyBlock.balance', { price: format.demo(block.priceCents) }) : t(`buyBlock.${block.code}`)) : null;
  const rtpOf = (ratio: number) => percentOf(format.intl, ratio);
  const locked = busy || auto !== null || gated || booting || sourcePending;
  const amountCents = (h: number) => (roundBet === null ? 0 : ebruCents(roundBet, h));
  const boardLabel = t(free ? 'board.labelFree' : 'board.label');
  const boardElement = useMemo(() => (
    <EbruFrame mood={free ? 'feature' : 'base'} wellRef={wellRef}>
      <canvas ref={waterRef} className={styles.water} aria-hidden="true" />
      <EbruBoard ref={board} label={boardLabel} />
      <canvas ref={frontRef} className={styles.front} aria-hidden="true" />
    </EbruFrame>
  ), [boardLabel, free]);
  const celebrating = card?.kind === 'big' || card?.kind === 'outro' || card?.kind === 'intro';
  const infoPages = useMemo(() => ebruInfoPages(bet, { t, tc, tk, format, symbol: names.label }), [bet, t, tc, tk, format, names]);
  const outOfCredit = !busy && balance < EBRU_MIN_BET_CENTS;
  const deckWin = busy ? amountCents(meter.total) : (lastWin?.payout ?? 0);
  const speedIndex = SPIN_SPEEDS.indexOf(settings.spinSpeed);
  const replayInfo = replaying ? t('replay.ribbon', { id: ebruRoundId(replaying.seed) }) : null;

  const openInfo = (page = 'how') => { setInfoPage(page); setModal('info'); sound.click(); };
  const refill = () => {
    if (busy || auto) return;
    if (remote) {
      if (pendingRemote.current) return;
      remote.client.resetBalance().then(cents => {
        setRemoteBalance(cents);
        const at = Date.now();
        recordRemote({ id: `remote-reset:${at}`, game: 'Ebru', stake: 0, payout: 0, detail: 'Bakiye yenilendi (sunucu)', at, kind: 'reset' });
        const amount = format.demo(DEMO_START_CENTS, { trimZeros: true });
        showToast(t('toast.refilled', { amount })); setError(''); setAnnounce(t('announce.refilledRemote', { amount }));
      }, (failure: unknown) => showToast(rgsErrorMessage(failure), 'warn'));
      return;
    }
    if (resetDemoBalance('Ebru')) { const amount = format.demo(DEMO_START_CENTS, { trimZeros: true }); showToast(t('toast.refilled', { amount })); setError(''); setAnnounce(t('announce.refilled', { amount })); }
  };
  const toggleSound = () => { const muted = !settings.muted; updateSettings({ muted }); if (!muted) sound.unlock(); };
  const cycleSpeed = () => {
    const next = SPIN_SPEEDS[(speedIndex + 1) % SPIN_SPEEDS.length]!;
    updateSettings({ spinSpeed: next });
    sound.click();
    setAnnounce(t('announce.speed', { speed: tk(SPEED_KEYS[next]) }));
  };
  const toggleAnte = () => {
    if (locked) return;
    const next = !ante;
    setAnte(next);
    sound.click();
    setAnnounce(next ? t('announce.anteOn', { cost: format.demo(ebruCost(bet, 'ante')) }) : t('announce.anteOff', { cost: format.demo(bet) }));
  };
  const onSpinClick = () => { if (busy) return; startRound('spin'); };
  const confirmBuy = () => { if (buyReason) return; setModal(null); startRound('buy'); };

  const deck = (
    <BetSelector
      ladder={EBRU_BET_LADDER}
      valueCents={bet}
      onChange={chooseBet}
      balanceCents={balance}
      maxBetCents={EBRU_MAX_BET_CENTS}
      costMode={EBRU_COST_MODES[roundMode]}
      modeLabel={ante ? tc('modes.ante') : undefined}
      disabled={locked}
      classNames={{ minus: styles.stepBtn, plus: styles.stepBtn, value: styles.betValue, max: styles.maxChip }}
      render={parts => (
        <div className={`${kit.kit} ${styles.deck}`} data-auto={auto ? '' : undefined} role="group" aria-label={t('deck.aria')}>
          <div className={styles.cellBalance}>
            <span className={styles.cellLabel}>{t('deck.balance')}</span>
            <strong className={styles.cellValue} data-testid="ebru-balance">{money(balance)}<small> DEMO</small></strong>
            <button type="button" className={styles.refill} onClick={refill} disabled={busy || auto !== null || gated} aria-label={t('deck.refill')}><RefillIcon /><span aria-hidden="true">{t('deck.refill')}</span></button>
          </div>
          <div className={styles.cellWin}>
            <span className={styles.cellLabel}>{busy ? (replaying ? t('deck.replay') : t('deck.win')) : lastWin?.replay ? t('deck.replayWin') : t('deck.lastWin')}</span>
            <strong className={`${styles.cellValue} ${deckWin > 0 ? styles.cellWinOn : ''}`}>{money(deckWin)}<small> DEMO</small></strong>
          </div>
          <div className={styles.cellBet}>
            {parts.label}
            {parts.value}
            <span className={styles.costLine} data-testid="ebru-cost">{tk('bet.cost')} <strong>{money(spinCost)} DEMO</strong>{ante && <em> · {format.factor(EBRU_COST_MODES.ante.num, EBRU_COST_MODES.ante.den)}</em>}</span>
          </div>
          <div className={styles.areaMinus}>{parts.minus}</div>
          <div className={styles.areaPlus}>{parts.plus}</div>
          <div className={styles.areaMax}>{parts.max}</div>
          <div className={styles.areaSpin}>
            {auto ? (
              <AutoplayStopButton className={styles.stop} remaining={auto.spinsRemaining} onStop={() => stopAutoplay('cancelled', 'info')} />
            ) : (
              <button type="button" className={`${styles.spin} ${busy ? styles.spinning : ''}`} onClick={onSpinClick} disabled={busy || gated || booting || sourcePending}
                aria-label={t('deck.spin')} aria-describedby="eb-spin-cost" data-locked={busy || undefined} data-testid="ebru-spin">
                <span className={styles.spinFace}><SpinSeal /></span>
                {busy && <span className={styles.spinLock} aria-hidden="true"><LockIcon /></span>}
              </button>
            )}
            <span id="eb-spin-cost" className="sr-only">{busy ? t('deck.spinLocked') : `${tk('bet.cost')} ${format.demo(spinCost)}`}</span>
          </div>
          <button type="button" className={`${styles.tool} ${styles.areaAuto}`} onClick={() => { sound.click(); setModal('autoplay'); }} disabled={locked} aria-haspopup="dialog">
            <LoopIcon /><span>{t('deck.auto')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaInfo}`} onClick={() => openInfo()} aria-haspopup="dialog" aria-label={tk('info.title')}>
            <InfoIcon /><span>{t('deck.info')}</span>
          </button>
          <button type="button" role="switch" aria-checked={ante} className={`${styles.feature} ${styles.areaAnte} ${ante ? styles.featureOn : ''}`} onClick={toggleAnte} disabled={locked}
            aria-label={tc('modes.ante')} aria-describedby="eb-ante-desc">
            <span className={styles.featureTitle}>{tc('modes.ante')}</span>
            <span className={styles.featureState}>{ante ? t('deck.on') : t('deck.off')}<span className={styles.featureFactor}> · {format.factor(EBRU_COST_MODES.ante.num, EBRU_COST_MODES.ante.den)}</span></span>
            <span id="eb-ante-desc" className={styles.featureDesc}>{t('deck.anteDesc')}</span>
          </button>
          <button type="button" className={`${styles.feature} ${styles.featureBuy} ${styles.areaBuy}`} aria-disabled={buyReason ? true : undefined}
            onClick={() => { if (buyReason) sound.denied(); else sound.click(); setModal('buy'); }} aria-haspopup="dialog" aria-describedby="eb-buy-desc">
            <span className={styles.featureTitle}>{tk('buy.title')}</span>
            <span className={styles.featureState}>{format.amount(buyPrice, { trimZeros: true })} DEMO</span>
            <span id="eb-buy-desc" className={styles.featureDesc}>{buyReason ?? t('deck.buyDesc', { spins: EBRU_FREE_SPINS_TRIGGER, rtp: rtpOf(EBRU_RTP.buy.rtp) })}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSet}`} onClick={() => { sound.click(); setModal('settings'); }} aria-haspopup="dialog" aria-label={tk('settings.title')}>
            <GearIcon /><span>{tk('settings.title')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSpeed} ${speedIndex > 0 ? styles.toolOn : ''}`} onClick={cycleSpeed} aria-label={t('deck.speed', { speed: tk(SPEED_KEYS[settings.spinSpeed]) })}>
            <SpeedDrops count={speedIndex + 1} /><span>{tk(SPEED_KEYS[settings.spinSpeed])}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSound} ${!settings.muted ? styles.toolOn : ''}`} onClick={toggleSound} aria-pressed={!settings.muted} aria-label={tk('settings.sound')}>
            <SoundIcon on={!settings.muted} /><span>{tk('settings.sound')}</span>
          </button>
          <div className={styles.areaMsg}>
            {soundLoad.started && !soundLoad.ready && !settings.muted && <p className={styles.msgHint} role="status">{t('deck.soundLoading', { percent: format.percent(soundLoad.percent / 100) })}</p>}
            {error ? <p className={styles.msgError} role="alert">{error}</p>
              : outOfCredit ? <p className={styles.msgHint}>{t('msg.outOfCredit')} <button type="button" className={styles.inlineLink} onClick={refill}>{t('deck.refill')}</button></p>
              : <p className={styles.msgHint}>{lastWin && !busy ? (lastWin.payout > 0 ? t.rich('msg.lastRound', { b: chunk => <strong key={chunk}>{chunk}</strong> }, { amount: money(lastWin.payout), times: money(lastWin.total) }) : t('msg.lastRoundNoWin')) : settings.spaceToSpin ? t('msg.spaceHint') : t('msg.fixedBefore')}</p>}
          </div>
        </div>
      )}
    />
  );

  return (
    <div className={`game-page ${styles.page}`}>
      <EbruSymbolSprites />
      <GameHeading title={gameTitle} subtitle={t('subtitle')} mode={mode} setMode={setMode} active={busy || auto !== null}
        badge={remote ? tk('rgs.source.remote') : sourcePending ? t('badge.checking') : tk('rgs.source.local')} />
      <section ref={tableRef} className={`game-table ${styles.table}`} aria-label={t('table.aria')} data-free={free || undefined}>
        <EbruScene ref={scene} mood={mood} className={styles.scene}>
          <div className={styles.layout}>
            <div ref={stageRef} className={styles.stage} data-phase={phase} data-celebrate={celebrating || undefined} data-combing={combing || undefined}>
              <div ref={shakeRef} className={styles.column}>
                <div className={styles.top}>
                  <div className={styles.logo}><EbruLogo subtitle={false} /></div>
                </div>
                <div className={styles.hud}>
                  {freeInfo ? (
                    <div className={styles.freeCounter} aria-label={t('free.counterAria', { number: freeInfo.number, left: freeInfo.left })} data-testid="ebru-free-counter">
                      <span className={styles.freeTag}>{freeInfo.number > 0 ? t('free.spinNumber', { n: freeInfo.number }) : t('free.tag')}</span>
                      <span className={styles.freeLeft}><small>{t('free.left')}</small><strong key={freeInfo.left}>{freeInfo.left}</strong></span>
                    </div>
                  ) : (
                    <div className={styles.combPips} data-on={busy || undefined} aria-label={busy ? t('comb.passAria', { pass: combPass }) : t('comb.maxAria')} data-testid="ebru-comb-pips">
                      <span>{t('comb.label')}</span>
                      {[1, 2, 3].map(i => <CombPip key={i} on={combPass >= i} />)}
                    </div>
                  )}
                  {free ? (
                    <div key={stainPunch} className={styles.stainChip} data-testid="ebru-stains" aria-label={t('stain.aria', { cells: stainInfo.cells, max: String(stainInfo.max) })}>
                      <span className={styles.stainChipArt} aria-hidden="true"><EbruStainArt value={Math.max(2, stainInfo.max)} size="100%" /></span>
                      <span><small>{t('stain.stains')}</small><strong>{stainInfo.cells}</strong></span>
                      <span><small>{t('stain.highest')}</small><strong>{stainInfo.max > 0 ? `×${stainInfo.max}` : '—'}</strong></span>
                    </div>
                  ) : freeInfo ? null : (
                    <div className={styles.combPips} data-side="" aria-hidden="true"><span>{t.rich('stain.max', { b: chunk => <strong key={chunk}>{chunk}</strong> }, { n: format.number(EBRU_MAX_WIN_MULTIPLIER, 0) })}</span></div>
                  )}
                </div>
                <div className={styles.boardWrap}>{boardElement}</div>
                {/* One cumulative meter: never resets inside a round (tumbles, comb wins, every free spin add up). */}
                <div ref={meterRef} className={`${styles.meter} ${free ? styles.meterFree : ''}`} data-testid="ebru-meter">
                  {phase === 'idle' ? (
                    <div className={styles.meterIdle}><span>{t.rich('meter.idleA', { b: chunk => <strong key={chunk}>{chunk}</strong> })}</span><span aria-hidden="true" className={styles.wideOnly}>·</span><span className={styles.wideOnly}>{t('meter.idleB')}</span><span aria-hidden="true">·</span><span>{t.rich('meter.idleC', { b: chunk => <strong key={chunk}>{chunk}</strong> })}</span></div>
                  ) : (
                    <div className={styles.meterPart}>
                      <small>{free || phase === 'done' ? t('meter.totalWin') : t('meter.win')}</small>
                      <strong data-testid="ebru-meter-total"><CountUp cents={amountCents(meter.total)} duration={meterDur} format={money} /><em> DEMO</em></strong>
                    </div>
                  )}
                  {flourish > 0 && phase !== 'idle' && <span key={flourish} className={styles.meterShine} aria-hidden="true" />}
                </div>
              </div>
              <div ref={layerRef} className={styles.fxLayer} aria-hidden="true" />
              {replayInfo && <div className={styles.replayRibbon} data-testid="ebru-replay"><Icon name="history" size={15} /><span>{replayInfo}</span></div>}
              {auto && !replayInfo && <div className={styles.autoRibbon} aria-hidden="true"><LoopIcon /><span>{t('auto.ribbon', { n: auto.spinsRemaining })}</span></div>}
              {toast && (
                <div key={`toast-${toast.key}`} className={`${styles.toast} ${toast.tone === 'warn' ? styles.toastWarn : ''}`} data-testid="ebru-toast">
                  <span>{toast.text}</span>
                  <button type="button" className={styles.toastClose} onClick={() => setToast(null)} aria-label={t('toast.close')}><svg {...svg} width={16} height={16}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
                </div>
              )}
              {banner && <div key={`banner-${banner.key}`} className={`${styles.banner} ${banner.tone === 'ink' ? styles.bannerInk : ''}`} data-testid="ebru-banner" aria-hidden="true">{banner.text}</div>}
              {callout && (
                <div key={`callout-${callout.key}`} className={styles.callout} data-tier={callout.tier} style={{ left: `${callout.x}px`, top: `${callout.y}px`, animationDuration: `${callout.life}ms` }} aria-hidden="true" data-testid="ebru-callout" data-key={callout.key}>
                  <span className={styles.calloutGlow} />
                  <span className={styles.calloutTag}>{t(`callout.tags.${callout.tier}`)}</span>
                  <span className={styles.calloutText} data-text={`×${callout.value}`}><span className={styles.calloutFill}>×{callout.value}</span></span>
                </div>
              )}
              {card?.kind === 'intro' && <EbruFreeIntro key={`intro-${card.at}`} awarded={card.awarded} dur={card.dur} reducedMotion={reducedMotion} onTap={advanceHold} />}
              {card?.kind === 'outro' && (
                <EbruFeatureTotal key={`outro-${card.at}`} spins={card.spins} totalHundredths={card.total} maxStain={card.maxStain} stainedClusters={card.stainedClusters} combWins={card.combWins} betCents={card.bet}
                  celebration={card.celebration} capped={card.capped} dur={card.dur} elapsed={cardElapsed} reducedMotion={reducedMotion} onTap={advanceHold} />
              )}
              {card?.kind === 'big' && (
                <EbruCelebration key={`big-${card.at}`} schedule={card.schedule} betCents={card.bet} elapsed={cardElapsed} reducedMotion={reducedMotion}
                  onLevel={onCelebrationLevel} onCountDone={onCelebrationCounted} onTap={advanceHold} />
              )}
              {gated && (
                <div className={styles.gated}>
                  <div className={styles.gatedCard}>
                    <Icon name="lock" size={26} />
                    <h2>{t('gated.title')}</h2>
                    <p>{t('gated.text')}</p>
                    <button className="text-button" onClick={() => setMode('demo')}>{t('gated.back')}<Icon name="arrow" size={17} /></button>
                  </div>
                </div>
              )}
            </div>
            <div className={styles.side}>
              <div className={styles.sideLogo}><EbruLogo /></div>
              {deck}
            </div>
          </div>
        </EbruScene>
        {boot.phase !== 'done' && (
          <div className={styles.splash} data-testid="ebru-splash">
            <div className={styles.splashCard}>
              <div className={styles.splashLogo}><EbruLogo /></div>
              <ul className={styles.splashFeatures}>
                <li><span aria-hidden="true"><EbruSymbolArt symbol="c1" size="100%" /></span><strong>{t('splash.f1Title')}</strong><small>{t('splash.f1Text')}</small></li>
                <li><span aria-hidden="true"><EbruSymbolArt symbol="comb" size="100%" /></span><strong>{names.label('comb')}</strong><small>{t('splash.f2Text')}</small></li>
                <li><span aria-hidden="true"><EbruStainArt value={256} size="100%" /></span><strong>{t('splash.f3Title', { max: format.number(EBRU_MAX_WIN_MULTIPLIER, 0) })}</strong><small>{t('splash.f3Text')}</small></li>
              </ul>
              {boot.phase === 'loading' ? (
                <div className={styles.loadBar} role="progressbar" aria-label={t('splash.loading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(boot.progress * 100)}>
                  <span style={{ transform: `scaleX(${boot.progress})` } as CSSProperties} />
                </div>
              ) : (
                <div className={styles.splashActions}>
                  <button type="button" className={styles.playButton} autoFocus onClick={() => { sound.unlock(); sound.click(); setBoot(b => ({ ...b, phase: 'done' })); }}>{t('splash.play')}</button>
                  <button type="button" className={styles.splashSkip} onClick={() => { updateSettings({ introScreen: false }); setBoot(b => ({ ...b, phase: 'done' })); }}>{t('splash.skip')}</button>
                </div>
              )}
              <p className={styles.splashNote}>{t('splash.note', { rtp: rtpOf(EBRU_RTP.standard.rtp) })}</p>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <SessionBar className={styles.sessionBar} nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <GameInfoStrip id="ebru" />
      <EbruHistory onReplay={replay} replayDisabled={busy || auto !== null || booting} replayingId={replaying?.recordId ?? null} onShare={remote ? shareRound : undefined} />
      <StaticFooter remote={remote !== null} />

      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title={tk('settings.title')} size="md">
        <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
        <p className={styles.modalNote} role="status">{soundLoad.ready ? t('settings.soundReady') : soundLoad.started ? t('settings.soundLoading', { percent: format.percent(soundLoad.percent / 100) }) : t('settings.soundOnTouch')}</p>
        <section className={styles.demoBox} aria-labelledby="eb-demo-title">
          <h3 id="eb-demo-title">{t('settings.demoTitle')}</h3>
          <p>{t('settings.demoText', { balance: format.demo(balance), server: remote ? 'yes' : 'no', amount: format.demo(DEMO_START_CENTS, { trimZeros: true }), label: t('history.refilled') })}</p>
          <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={refill} disabled={busy || auto !== null || gated}>{t('deck.refill')}</button>
        </section>
      </Modal>
      <GameInfo open={modal === 'info'} onClose={() => setModal(null)} pages={infoPages} title={t('info.windowTitle')} initialPageId={infoPage} />
      <Modal open={modal === 'autoplay'} onClose={() => setModal(null)} title={t('autoplay.title')} size="md">
        <AutoplayPanel onStart={startAutoplay} spinCostCents={spinCost} balanceCents={balance} disabled={busy || gated} />
        <p className={styles.modalNote}>{t('autoplay.note', { cost: format.demo(spinCost), ante: ante ? 'yes' : 'no' })}</p>
      </Modal>
      <BuyFeatureDialog
        open={modal === 'buy'}
        onClose={() => setModal(null)}
        onConfirm={confirmBuy}
        featureName={t('buy.feature', { spins: EBRU_FREE_SPINS_TRIGGER, bet: format.demo(bet) })}
        priceCents={buyPrice}
        balanceCents={balance}
        rtpText={t('buy.rtp', { buy: rtpOf(EBRU_RTP.buy.rtp), standard: rtpOf(EBRU_RTP.standard.rtp) })}
        description={<>{t.rich('buy.description', { b: chunk => <strong key={chunk}>{chunk}</strong> }, { spins: EBRU_FREE_SPINS_TRIGGER, bet: format.demo(bet), max: format.demo(bet * EBRU_MAX_WIN_MULTIPLIER) })}</>}
        disabledReason={buyReason ?? undefined}
      />
      <RealityCheckDialog
        open={realityDue && modal === null}
        elapsedMs={session.elapsedMs}
        netCents={session.netCents}
        onContinue={() => session.acknowledge()}
        onQuit={() => { stopAutoplay('quit', 'info'); session.acknowledge(); router.push('/games'); }}
      />
    </div>
  );
}
