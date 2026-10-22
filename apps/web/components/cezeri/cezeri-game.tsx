'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { CEZERI_MAX_RESPINS, CEZERI_RTP, playCezeriRound, type CezeriMode, type CezeriPos, type CezeriRound } from '@sollish/protocol';
import { DEMO_START_CENTS } from '@/lib/demo';
import { useRgsText } from '@/lib/use-rgs-text';
import { useFormat, useT } from '@/lib/i18n/client';
import { richText } from '../game-rich';
import type { Locale } from '@/lib/i18n/config';
import {
  buildCezeriTimeline, cezeriCents, cezeriFinalBoard, cezeriHistoryDetail, cezeriMoney, cezeriTimes,
  type CezeriEvent, type CezeriMeter, type CezeriTimeline,
} from '@/lib/cezeri-timeline';
import { WIN_TIER_INFO, countUpSchedule, multiplierCalloutTier, type CelebrationLevel, type CountUpSchedule, type WinTier } from '@/lib/slot-kit/win-tiers';
import { TimelinePlayer } from '@/lib/slot-kit/timeline-player';
import { autoplayNetLossCents, createAutoplay, type AutoplayConfig, type AutoplayState, type AutoplayStopCode } from '@/lib/slot-kit/autoplay';
import { SPIN_SPEEDS, type SpinSpeed } from '@/lib/slot-kit/settings';
import {
  CEZERI_AUTOPLAY_GAP, CEZERI_BET_LADDER, CEZERI_COST_MODES, CEZERI_DEFAULT_BET_CENTS, CEZERI_MAX_BET_CENTS, CEZERI_MIN_BET_CENTS,
  cezeriAutoplayAfterRound, cezeriAutoplayBeforeSpin, cezeriBuyBlock, cezeriCost, cezeriLedgerLimits, cezeriRoundId, cezeriRtp, cezeriTimelineOptions,
} from '@/lib/cezeri-controls';
import { markRoundShown, type RemoteReceipt, type RemoteRoundSource } from '@/lib/rgs-client';
import { CEZERI_ENGINE } from '@/lib/slot-engines/cezeri';
import { localSourceFor, useRoundSource } from '@/lib/use-round-source';
import { useCezeriSound } from '@/lib/slot-audio/use-cezeri-sound';
import { useProduct, type DemoRecord } from '../providers';
import { DemoNotice, GameHeading, Rules, type Mode } from '../game-common';
import { Icon } from '../icons';
import {
  AutoplayPanel, AutoplayStopButton, BetSelector, BuyFeatureDialog, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, useSession, useSlotSettings,
} from '../slot-kit';
import kit from '../slot-kit/kit.module.css';
import { useViewportTop } from '../slot-kit/use-viewport-top';
import { CezeriBoard, type CezeriBoardHandle } from './board';
import { CezeriCelebration, CezeriFeatureTotal, CezeriFreeIntro } from './cezeri-celebration';
import { CezeriHistory } from './cezeri-history';
import { cezeriInfoPages } from './cezeri-info-pages';
import { CezeriFrame } from './frame';
import { CezeriFx, type CezeriMood } from './fx';
import { CZ_BOUNDS, CZ_RIM_R, cezeriRotateTiming, polar, sliceAngle } from './geometry';
import { CezeriLogo } from './logo';
import { CezeriReservoir } from './meter';
import { CezeriScene, type CezeriSceneHandle } from './scene';
import { CezeriSymbolArt, CezeriSymbolSprites, useCezeriSymbolLabels } from './symbols';
import styles from './cezeri-game.module.css';

/* Lifecycle: entropy -> engine cezeri-gears-1 resolves the whole round (bet + mode) -> one reservation of the mode cost ->
   the timeline replays it -> exactly one settlement with the engine payout (at the end, or on unmount).
   Spin lock (game-standards §6): once a round starts the spin button and Space stay locked until the whole round —
   every respin of the Dişli Kilidi chain and every Fil Saati free spin — has played; there is no skip. Speed comes
   from the quick/turbo setting; only the hold screens may be tapped (that moves the presentation clock, never a
   result). A replay from the history uses the same engine call and never touches the ledger.
   Remote (RGS) mode, lib/rgs-client.ts: the server resolves AND settles the round before the browser sees it; the game
   presents the returned round, records it in the history and shows the server balance. It never reserves or settles
   locally, so leaving mid-round needs nothing; a reload re-presents the last unseen server round.
   One clock: a rotate event carries the ring plans the board animates (cezeriRotateTiming) and the same numbers drive
   the ratchet sound; the board's own timers only finish what the timeline started. */

type LiveRound = {
  id: string | null; replayOf: string | null;
  bet: number; cost: number; mode: CezeriMode; balanceBefore: number;
  round: CezeriRound; timeline: CezeriTimeline; reduced: boolean; lite: boolean; settled: boolean;
  remote: { receipt: RemoteReceipt; balanceAfter: number } | null;
};
type Phase = 'idle' | 'playing' | 'done';
type Card =
  | { kind: 'intro'; awarded: number; at: number; dur: number }
  | { kind: 'outro'; spins: number; total: number; topHub: number; falconVisits: number; wilds: number; celebration: boolean; capped: boolean; bet: number; at: number; dur: number }
  | { kind: 'big'; schedule: CountUpSchedule; bet: number; at: number; dur: number };
type Callout = { key: number; value: number; tier: WinTier; free: boolean; life: number };
type Banner = { key: number; text: string; tone: 'gold' | 'water' };
type Toast = { key: number; text: string; tone: 'info' | 'warn' };
type Chain = { round: number; capped: boolean } | null;
type ModalId = 'settings' | 'info' | 'autoplay' | 'buy' | null;
type Boot = { phase: 'loading' | 'ready' | 'done'; progress: number };

const CALLOUT_KEY = { 0: 'callout.tier0', 1: 'callout.tier1', 2: 'callout.tier2', 3: 'callout.tier3', 4: 'callout.tier4' } as const satisfies Record<WinTier, string>;
const SPEED_KEY = { normal: 'settings.speedNormal', quick: 'settings.speedQuick', turbo: 'settings.speedTurbo' } as const satisfies Record<SpinSpeed, string>;
type StopCode = AutoplayStopCode | 'server-failed' | 'spin-failed' | 'quit';
const ZERO: CezeriMeter = { spin: 0, total: 0 };
const BET_KEY = 'sollish:cezeri:bet';
/** The local DEMO source over cezeri's engine only (lib/slot-engines/cezeri.ts); the other games' engines are not in this route. */
const localRoundSource = localSourceFor(CEZERI_ENGINE);
/** Largest clock step per frame: the rings turn on the wall clock (WAAPI), so the timeline keeps near wall-clock pace. */
const CEZERI_PLAYER_MAX_STEP_MS = 250;
/** The board shown before the first round: the final board of a fixed no-win engine round (not a result). */
const IDLE_BOARD = cezeriFinalBoard(playCezeriRound('4205a75c4205a75c4205a75c4205a75c', 100, 'standard')).board;
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
  const value = (window as unknown as { __cezeriRealityMs?: unknown }).__cezeriRealityMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? value : undefined;
}

/** Count-up number that writes its own text node (no React re-render per frame). */
function CountUp({ cents, duration, locale }: { cents: number; duration: number; locale: Locale }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(cents);
  const [initial] = useState(() => cezeriMoney(cents, locale));
  useEffect(() => {
    const el = node.current; if (!el) return;
    const from = shown.current, to = cents;
    if (duration <= 0 || from === to || typeof requestAnimationFrame === 'undefined') { shown.current = to; el.textContent = cezeriMoney(to, locale); return; }
    const start = performance.now(); let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      shown.current = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
      el.textContent = cezeriMoney(shown.current, locale);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); shown.current = to; el.textContent = cezeriMoney(to, locale); };
  }, [cents, duration, locale]);
  return <span ref={node}>{initial}</span>;
}

/* ------------------------------------------------------------------ icons (original, inline) */
const svg = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, focusable: false } as const;
const gearPath = (cx: number, cy: number, n: number, r0: number, r1: number) => {
  let d = '';
  for (let i = 0; i < n * 4; i++) { const a = (i / (n * 4)) * Math.PI * 2, r = i % 4 < 2 ? r1 : r0; d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`; }
  return `${d}Z`;
};
/** Spin key: a brass escapement wheel with a winding crank, inside a turquoise enamel ring. */
function SpinSigil() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="czSpinBrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff4c8" /><stop offset=".45" stopColor="#e8b84e" /><stop offset="1" stopColor="#8f5a17" /></linearGradient>
      </defs>
      <g className={styles.sigilRing}>
        <path d={gearPath(50, 50, 14, 30, 37)} fill="url(#czSpinBrass)" stroke="#1a0d05" strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx="50" cy="50" r="22" fill="#0c4f56" stroke="#1a0d05" strokeWidth="2.4" />
        {Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return <circle key={i} cx={(50 + Math.cos(a) * 14).toFixed(1)} cy={(50 + Math.sin(a) * 14).toFixed(1)} r="3.2" fill="#5ff0e0" opacity=".85" />; })}
      </g>
      <path d="M50 50 L70 30" stroke="#1a0d05" strokeWidth="9" strokeLinecap="round" />
      <path d="M50 50 L70 30" stroke="url(#czSpinBrass)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="72" cy="28" r="7" fill="#c8302c" stroke="#1a0d05" strokeWidth="2.4" />
      <circle cx="50" cy="50" r="8" fill="url(#czSpinBrass)" stroke="#1a0d05" strokeWidth="2.4" />
    </svg>
  );
}
function SpeedGears({ count }: { count: number }) {
  return (
    <span className={styles.bolts} aria-hidden="true">
      {[0, 1, 2].map(i => <svg key={i} {...svg} width={14} height={14} viewBox="0 0 24 24" data-on={i < count || undefined}><path d={gearPath(12, 12, 8, 7, 10.5)} fill="currentColor" /><circle cx="12" cy="12" r="3" fill="#1a0d05" /></svg>)}
    </span>
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

const StaticFooter = memo(function StaticFooter({ remote }: { remote: boolean }) { return <><DemoNotice remote={remote} /><Rules game="Cezeri" /></>; });
const MemoScene = memo(CezeriScene);

export function CezeriGame() {
  const { reserveDemo, settleDemo, recordRemote, setActiveDemo, demoBalance, resetDemoBalance } = useProduct();
  const router = useRouter();
  const t = useT('cezeri');
  const tk = useT('slotKit');
  const tc = useT('common');
  const format = useFormat();
  const rgs = useRgsText();
  const loc = format.locale;
  const symbolLabels = useCezeriSymbolLabels();
  const { settings, update: updateSettings, reset: resetSettings } = useSlotSettings('cezeri');
  const [realityMs] = useState(realityIntervalOverride);
  const session = useSession(realityMs ? { realityIntervalMs: realityMs } : {});
  const recordSession = session.recordRound;
  const { sound, loadState: soundLoad } = useCezeriSound(settings);
  const [mode, setMode] = useState<Mode>('demo');
  const [bet, setBet] = useState(CEZERI_DEFAULT_BET_CENTS);
  const [ante, setAnte] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [free, setFree] = useState(false);
  const [freeInfo, setFreeInfo] = useState<{ number: number; left: number } | null>(null);
  const [meter, setMeter] = useState<CezeriMeter>(ZERO);
  const [meterDur, setMeterDur] = useState(0);
  const [roundBet, setRoundBet] = useState<number | null>(null);
  const [hub, setHub] = useState(1);
  const [hubPunch, setHubPunch] = useState(0);
  const [chain, setChain] = useState<Chain>(null);
  const [reservoir, setReservoir] = useState(0);
  const [spinning, setSpinning] = useState(false);
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
  const [mood, setMood] = useState<CezeriMood>('base');
  const reducedMotion = usePrefersReducedMotion();
  const sourceView = useRoundSource(CEZERI_ENGINE);
  const remote: RemoteRoundSource | null = sourceView.status === 'remote' ? sourceView.source : null;
  const sourcePending = sourceView.status === 'pending';
  const [remoteBalance, setRemoteBalance] = useState<number | null>(null);
  useEffect(() => { if (sourceView.status === 'remote') setRemoteBalance(sourceView.balanceCents); }, [sourceView]);
  const balance = remote ? (remoteBalance ?? 0) : demoBalance;
  const pendingRemote = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const scene = useRef<CezeriSceneHandle>(null);
  const board = useRef<CezeriBoardHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLElement>(null);
  useViewportTop(tableRef);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const fx = useRef<CezeriFx | null>(null);
  const player = useRef<TimelinePlayer<CezeriEvent> | null>(null);
  const live = useRef<LiveRound | null>(null);
  const settledIds = useRef(new Set<string>());
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
    const stage = stageRef.current, canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const f = new CezeriFx({ host: stage, canvas, board: board.current?.element ?? null, mood: 'base' });
    fx.current = f;
    return () => { f.destroy(); fx.current = null; };
  }, []);
  useEffect(() => { fx.current?.setLite(reducedMotion || settings.reducedEffects); }, [reducedMotion, settings.reducedEffects]);
  useEffect(() => { fx.current?.setMood(mood); }, [mood]);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(BET_KEY));
      if (CEZERI_BET_LADDER.includes(stored)) setBet(stored);
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
      id: current.id, game: 'Cezeri', stake: current.cost, payout: round.payoutCents, detail: cezeriHistoryDetail(round), at: Date.now(), kind: 'round',
      cezeri: { engine: round.engine, seedHex: round.seedHex, betCents: current.bet, mode: current.mode, costCents: current.cost },
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
    showToast(t('toast.autoplayStopped', { reason, spins: state.spinsDone, net: format.signedDemo(net) }), tone);
    setAnnounce(t('toast.autoplayStoppedShort', { reason }));
  }, [showToast, sound, t, tk, format]);

  const finishRound = useCallback((current: LiveRound) => {
    settle(current);
    if (current.remote) markRoundShown('cezeri', current.remote.receipt.roundId);
    setPhase('done');
    sound.countUp(false);
    setMood('base');
    const { round } = current;
    setLastWin({ payout: round.payoutCents, total: round.totalHundredths, replay: current.id === null });
    sound.scene('base');
    if (current.id === null) {
      setReplaying(null);
      setAnnounce(t('announce.replayDone', { amount: format.number(round.payoutCents / 100), times: cezeriTimes(round.totalHundredths, loc) }));
      return;
    }
    const state = autoRef.current;
    if (state) {
      const next = cezeriAutoplayAfterRound(state, { costCents: current.cost, payoutCents: round.payoutCents, featureTriggered: round.freeSpinsTriggered, balanceBeforeCents: current.balanceBefore });
      autoRef.current = next;
      setAuto(next);
    }
    setAnnounce(round.payoutCents > 0 ? t('announce.roundEnd', { amount: format.number(round.payoutCents / 100), times: cezeriTimes(round.totalHundredths, loc) }) : t('announce.roundEndNone'));
  }, [settle, sound, t, format, loc]);

  /* ---------------------------------------------------------------- presentation helpers */
  /** Board-unit point (1000 × 1000 board space) -> px inside the stage. */
  const boardPoint = useCallback((x: number, y: number) => {
    const stage = stageRef.current, el = board.current?.element;
    if (!stage || !el) return { x: 0, y: 0, size: 400 };
    const a = el.getBoundingClientRect(), b = stage.getBoundingClientRect();
    return { x: a.left - b.left + (x / 1000) * a.width, y: a.top - b.top + (y / 1000) * a.height, size: a.width };
  }, []);
  const floatLabel = useCallback((x: number, y: number, text: string, className: string, ms: number, reduced: boolean) => {
    const layer = layerRef.current; if (!layer) return;
    const el = document.createElement('span');
    el.className = className; el.textContent = text;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    layer.appendChild(el);
    const anim = el.animate(reduced
      ? [{ opacity: 0, transform: 'translate(-50%, -50%)' }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -50%)' }]
      : [{ opacity: 0, transform: 'translate(-50%, -30%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%, -60%) scale(1.08)', offset: 0.18 }, { opacity: 1, transform: 'translate(-50%, -80%) scale(1)', offset: 0.75 }, { opacity: 0, transform: 'translate(-50%, -120%) scale(.96)' }],
      { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    anim.onfinish = () => el.remove();
    window.setTimeout(() => el.remove(), ms + 200);
  }, []);

  /** Big hub announcement over the board (game-standards §6). The sound engine plays its own callout for the hub. */
  const showCallout = useCallback((value: number, isFree: boolean, lite: boolean, life = 1900) => {
    const tier = multiplierCalloutTier(value);
    setCallout({ key: ++calloutKey.current, value, tier, free: isFree, life });
    if (tier >= 2) scene.current?.glow(Math.min(1, 0.4 + tier * 0.15));
    const f = fx.current;
    if (lite || !f) return;
    f.sparksAt({ x: 500, y: 300 }, 18 + tier * 8, 1 + tier * 0.2);
    for (const deg of [30, 150, 210, 330]) f.steam(polar(CZ_RIM_R - 20, deg), deg, 3 + tier, 0.8);
  }, []);

  const openCelebration = useCallback((schedule: CountUpSchedule, betCents: number, at: number, dur: number, reduced: boolean, lite: boolean) => {
    celebrateFx.current = { reduced, lite };
    setCard({ kind: 'big', schedule, bet: betCents, at, dur });
    setMood('bigwin');
    sound.scene('bigwin');
    setAnnounce(t('announce.celebration', { title: tk(`winTier.${WIN_TIER_INFO[schedule.finalLevel].id}.title`), amount: format.number(cezeriCents(betCents, schedule.totalHundredths) / 100), times: cezeriTimes(schedule.totalHundredths, loc) }));
  }, [sound, t, tk, format, loc]);
  const onCelebrationLevel = useCallback((level: CelebrationLevel, first: boolean, remainingMs: number) => {
    const { lite } = celebrateFx.current;
    if (level === 5) sound.maxWin(); else sound.bigWin(level as 1 | 2 | 3 | 4);
    if (first) sound.countUp(true);
    if (!lite) { scene.current?.awaken(Math.max(1800, Math.min(6000, remainingMs))); scene.current?.glow(0.6 + level * 0.1); void fx.current?.awaken(0.6 + level * 0.25, { duration: Math.max(1600, Math.min(4200, remainingMs)) }); }
    board.current?.jolt(first ? 1 : 1.4);
  }, [sound]);
  const onCelebrationCounted = useCallback(() => { sound.countUp(false); }, [sound]);

  /* ---------------------------------------------------------------- timeline events */
  const handle = useCallback((event: CezeriEvent) => {
    const current = live.current; if (!current) return;
    const reduced = current.reduced, lite = current.lite, b = board.current, f = fx.current;
    const betCents = current.bet;
    switch (event.type) {
      case 'spin-start':
        if (b?.element) f?.setBoard(b.element);
        b?.clearWins(); b?.showVessels(null);
        sound.spinStart();
        setChain(null);
        if (event.kind === 'free') {
          setFreeInfo({ number: event.freeSpinNumber, left: event.freeSpinsLeft });
          setMeterDur(0); setMeter(event.meter);
          b?.setPinned(event.wilds);
        }
        break;
      case 'hub': {
        setHub(event.value); setHubPunch(k => k + 1);
        if (event.reason === 'respin') {
          void b?.hub(event.value, 'respin');
          sound.hubTick(event.value, event.round);
          if (!reduced) { b?.jolt(1); scene.current?.strike(); }
          void f?.hubTick(event.value);
          setChain(prev => ({ round: event.round, capped: prev?.capped ?? false }));
          setAnnounce(t('announce.hubRespin', { value: event.value, round: event.round }));
        } else {
          void b?.hub(event.value, 'spin');
          sound.hubReveal(event.value);
          setAnnounce(event.carried > 0 ? t('announce.hubCarried', { value: event.value, carried: event.carried }) : t('announce.hub', { value: event.value }));
        }
        if (event.calloutTier > 0) showCallout(event.value, free, lite, Math.max(1300, Math.min(2200, event.dur * 3)));
        break;
      }
      case 'rotate': {
        b?.clearWins(); b?.showVessels(null);
        if (event.round > 0) sound.respin(event.round);
        sound.rotate(event.timing.map(x => ({ ring: x.ring, distance: x.distance, ms: x.ms, delayMs: 0, ease: 'outCubic' as const, held: x.held })));
        setSpinning(true);
        void b?.rotate(event.rings, { speed: event.speed, timing: reduced ? undefined : cezeriRotateTiming(event.kind, event.speed) });
        break;
      }
      case 'ring-stop':
        if (!reduced && !lite && f) {
          const r = CZ_BOUNDS[event.ring + 1]!;
          for (const deg of [45, 135, 225, 315]) f.sparksAt(polar(r, deg + event.ring * 15), 3, 0.5);
        }
        if (!reduced) b?.jolt(0.3);
        if (event.last) setSpinning(false);
        break;
      case 'vessel-land':
        sound.vesselLand(event.n);
        b?.showVessels(event.cells);
        break;
      case 'win': {
        b?.showWin(event.cells, event.spoke);
        void f?.spokeBeam(event.spoke, event.length, { duration: event.dur, startRing: event.startRing });
        sound.spokeWin(event.spoke, event.length, event.symbol, event.startRing);
        setMeterDur(Math.min(520, event.dur)); setMeter(event.meter);
        const deg = sliceAngle(event.spoke);
        const end = polar(Math.min(CZ_RIM_R + 40, CZ_BOUNDS[event.startRing + event.length]! + 70), deg);
        const p = boardPoint(end.x, end.y);
        floatLabel(p.x, p.y, `+${cezeriMoney(cezeriCents(betCents, event.winHundredths), loc)}`, styles.floatLabel, reduced ? 800 : 1300, reduced);
        setAnnounce(t('announce.win', { spoke: event.spoke + 1, length: event.length, name: symbolLabels[event.symbol as keyof typeof symbolLabels] ?? event.symbol, extended: event.paidBefore > 0 ? 'yes' : 'no', hub: event.hub, times: cezeriTimes(event.winHundredths, loc) }));
        break;
      }
      case 'lock':
        void b?.lock(event.newHeld);
        void f?.lock(event.newHeld);
        if (!reduced) b?.jolt(0.8);
        sound.gearLock(event.newHeld.length, event.respin);
        if (!event.respin) setChain(prev => (prev ? { ...prev, capped: true } : { round: 0, capped: true }));
        setAnnounce(t('announce.lock', { count: event.newHeld.length, total: event.held.length, respin: event.respin ? 'yes' : 'no' }));
        break;
      case 'chain-end':
        sound.chainEnd(event.respins, event.chainCapped, event.heldSlices);
        void b?.release().then(() => { if (live.current === current) b?.clearWins(); });
        if (event.respins >= 2) {
          setBanner({ key: ++bannerKey.current, text: event.chainCapped || event.respins >= CEZERI_MAX_RESPINS ? t('banner.fullChain', { respins: event.respins, hub: event.hub }) : t('banner.respins', { respins: event.respins, hub: event.hub }), tone: 'gold' });
          if (!lite) scene.current?.glow(0.6);
        }
        setChain(null);
        if (event.chainHundredths === 0 && event.respins === 0) setAnnounce(t('announce.noSpokeWin'));
        break;
      case 'scatter': {
        if (event.forged.length) {
          b?.setBoard(event.board);
          if (f && !lite) for (const [r, s] of event.forged) f.sparksAt(f.cell(r, s), 14, 1);
        }
        b?.showVessels(event.cells);
        void f?.scatter(event.cells, { hold: event.dur });
        scene.current?.glow(1);
        if (event.retrigger) {
          sound.retrigger();
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          setBanner({ key: ++bannerKey.current, text: t('banner.extraSpins', { awarded: event.awarded }), tone: 'water' });
          setAnnounce(t('announce.vesselsRetrigger', { count: event.count, awarded: event.awarded }));
        } else if (event.awarded > 0) {
          sound.featureTrigger();
          setAnnounce(t('announce.vesselsTrigger', { count: event.count }));
        }
        break;
      }
      case 'scatter-pay':
        setMeterDur(500); setMeter(event.meter);
        setBanner({ key: ++bannerKey.current, text: t('banner.scatterPay', { count: event.count, money: cezeriMoney(cezeriCents(betCents, event.hundredths), loc) }), tone: 'gold' });
        break;
      case 'free-intro':
        setCard({ kind: 'intro', awarded: event.awarded, at: event.at, dur: event.dur });
        sound.freeSpinsIntro();
        setMood('feature');
        setAnnounce(t('announce.freeIntro', { awarded: event.awarded }));
        break;
      case 'free-mode':
        setCard(null); b?.showVessels(null); setFree(event.on); setFreeInfo({ number: 0, left: event.freeSpinsLeft }); setReservoir(0);
        sound.scene('feature');
        break;
      case 'reservoir':
        setReservoir(event.level);
        sound.reservoirFill(event.level);
        if (event.level >= 3) setAnnounce(t('announce.reservoirFull'));
        break;
      case 'falcon':
        sound.falconFlight();
        void f?.falcon(event.ring, event.order, { speed: event.speed });
        setAnnounce(t('announce.falcon', { ring: event.ring + 1, count: event.order.length }));
        break;
      case 'falcon-drop':
        b?.setPinned(event.pinned, [[event.ring, event.slice] as CezeriPos]);
        if (event.index === 0) sound.falconDrop(event.ring, event.count);
        if (!reduced) b?.jolt(0.5);
        break;
      case 'reservoir-drain': setReservoir(0); break;
      case 'spin-end': {
        b?.showVessels(null);
        setMeterDur(300); setMeter(event.meter);
        if (event.kind === 'free') {
          setFreeInfo(prev => (prev ? { ...prev } : prev));
          const m = meterRef.current, stage = stageRef.current;
          if (m && stage && event.winHundredths > 0) {
            const a = m.getBoundingClientRect(), s = stage.getBoundingClientRect();
            floatLabel(a.left - s.left + a.width / 2, a.top - s.top - 8, `+${cezeriMoney(cezeriCents(betCents, event.winHundredths), loc)}`, styles.floatSpin, reduced ? 900 : 1400, reduced);
          }
          setAnnounce(event.winHundredths > 0 ? t('announce.freeSpinWin', { times: cezeriTimes(event.winHundredths, loc), total: cezeriTimes(event.meter.total, loc), hub: event.hub }) : t('announce.freeSpinNone', { hub: event.hub }));
        } else if (event.winHundredths === 0) setAnnounce(t('announce.noWin'));
        else if (event.winHundredths >= 300 && event.winHundredths < 1000) sound.nice();
        break;
      }
      case 'total-win': {
        setFlourish(k => k + 1);
        if (event.totalHundredths >= 200) sound.totalWinFanfare();
        const m = meterRef.current;
        if (!reduced) m?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.3 }, { transform: 'scale(.98)', offset: 0.65 }, { transform: 'scale(1)' }], { duration: 620, easing: 'ease-out' });
        setAnnounce(t('announce.totalWin', { amount: format.number(cezeriCents(betCents, event.totalHundredths) / 100), times: cezeriTimes(event.totalHundredths, loc) }));
        break;
      }
      case 'free-outro':
        setCard({ kind: 'outro', spins: event.spins, total: event.totalHundredths, topHub: event.topHub, falconVisits: event.falconVisits, wilds: event.wilds, celebration: event.celebration, capped: event.capped, bet: betCents, at: event.at, dur: event.dur });
        if (event.totalHundredths > 0) sound.totalWinFanfare(); else sound.featureOutro();
        setMood('base'); setReservoir(0);
        b?.setPinned([]);
        if (!lite) scene.current?.glow(0.8);
        setAnnounce(t('announce.freeOutro', { amount: format.number(cezeriCents(betCents, event.totalHundredths) / 100), spins: event.spins, topHub: event.topHub }));
        break;
      case 'big-win':
        openCelebration(event.schedule, betCents, event.at, event.dur, reduced, lite);
        break;
      case 'end':
        setCard(null); setBanner(null); setFree(false); setFreeInfo(null); setChain(null); setSpinning(false);
        b?.setPinned([]);
        player.current = null;
        finishRound(current);
        break;
    }
  }, [boardPoint, finishRound, floatLabel, free, openCelebration, showCallout, sound, t, format, loc, symbolLabels]);
  const handleRef = useRef(handle); handleRef.current = handle;

  /* ---------------------------------------------------------------- starting rounds */
  const begin = useCallback((current: LiveRound, text: string) => {
    live.current = current;
    setError(''); setPhase('playing'); setRoundBet(current.bet);
    setFree(false); setFreeInfo(null); setMeterDur(0); setMeter(ZERO); setCard(null); setBanner(null); setCallout(null); setFlourish(0); setMood('base'); setChain(null); setReservoir(0);
    setAnnounce(text);
    board.current?.setPinned([]);
    sound.unlock();
    sound.scene('base');
    const next = new TimelinePlayer<CezeriEvent>(current.timeline, event => { if (live.current === current) handleRef.current(event); }, undefined, CEZERI_PLAYER_MAX_STEP_MS);
    player.current = next;
    next.start();
  }, [sound]);

  const gated = mode === 'live';
  const busy = phase === 'playing';
  const booting = boot.phase !== 'done';

  const makeLive = useCallback((partial: Omit<LiveRound, 'timeline' | 'reduced' | 'lite' | 'settled'>): LiveRound => {
    const s = settingsRef.current;
    return { ...partial, timeline: buildCezeriTimeline(partial.round, cezeriTimelineOptions(s, reducedMotion)), reduced: reducedMotion, lite: reducedMotion || s.reducedEffects, settled: false };
  }, [reducedMotion]);

  /** Remote round: the server resolves and settles it; the spin stays locked until its round has been presented. */
  const startRemote = useCallback((source: RemoteRoundSource, roundMode: CezeriMode, cost: number, balanceBefore: number) => {
    const betCents = bet;
    pendingRemote.current = true;
    setError(''); setPhase('playing'); setActiveDemo(true); setReplaying(null);
    setRemoteBalance(balanceBefore - cost);
    setAnnounce(t('announce.sentToServer', { amount: format.number(cost / 100) }));
    source.client.play('cezeri', betCents, roundMode).then(play => {
      pendingRemote.current = false;
      const current = makeLive({ id: `remote:${play.receipt.roundId}`, replayOf: null, bet: betCents, cost: play.receipt.costCents, mode: roundMode, balanceBefore, round: play.round, remote: { receipt: play.receipt, balanceAfter: play.receipt.balanceCents } });
      if (!mounted.current) { settleRef.current(current); return; }
      begin(current, roundMode === 'buy' ? t('announce.bonusBought', { amount: format.number(cost / 100) }) : t('announce.spinStarted', { amount: format.number(cost / 100) }));
    }, (failure: unknown) => {
      pendingRemote.current = false;
      setActiveDemo(false);
      if (!mounted.current) return;
      setPhase('idle'); setError(rgs.error(failure)); sound.denied();
      if (autoRef.current) stopAutoplay('server-failed');
      source.client.state().then(state => { if (mounted.current) setRemoteBalance(state.balanceCents); }, () => undefined);
    });
  }, [bet, begin, makeLive, setActiveDemo, sound, stopAutoplay, t, format, rgs]);

  const startRound = useCallback((kind: 'spin' | 'buy'): boolean => {
    if ((live.current && !live.current.settled) || pendingRemote.current || gated || booting || sourcePending) return false;
    const roundMode: CezeriMode = kind === 'buy' ? 'buy' : ante ? 'ante' : 'standard';
    if (kind === 'buy' && ante) return false;
    const cost = cezeriCost(bet, roundMode);
    const balanceBefore = balanceRef.current;
    if (cost > balanceBefore) {
      setError(t('errors.insufficient', { kind: roundMode, cost: format.demo(cost) }));
      sound.denied();
      return false;
    }
    if (remote) { startRemote(remote, roundMode, cost, balanceBefore); return true; }
    let round: CezeriRound;
    try {
      round = localRoundSource.resolve('cezeri', bet, roundMode);
    } catch { setError(t('errors.entropy')); return false; }
    let id: string | null;
    try { id = reserveDemo(cost, cezeriLedgerLimits(bet, roundMode)); } catch { setError(t('errors.entropy')); return false; }
    if (!id) { setError(t('errors.noCredit')); sound.denied(); return false; }
    setActiveDemo(true);
    const current = makeLive({ id, replayOf: null, bet, cost, mode: roundMode, balanceBefore, round, remote: null });
    setReplaying(null);
    begin(current, roundMode === 'buy' ? t('announce.bonusBought', { amount: format.number(cost / 100) }) : t('announce.spinStarted', { amount: format.number(cost / 100) }));
    return true;
  }, [ante, bet, begin, booting, gated, makeLive, reserveDemo, setActiveDemo, sound, remote, sourcePending, startRemote, t, format]);

  // Reload recovery (remote): the last server round of this game that this tab did not finish showing is shown again.
  const recoveredOnce = useRef(false);
  useEffect(() => {
    if (sourceView.status !== 'remote' || !sourceView.recovered || recoveredOnce.current || booting || live.current || pendingRemote.current) return;
    recoveredOnce.current = true;
    const { receipt, round } = sourceView.recovered;
    const after = sourceView.recoveredBalanceCents ?? receipt.balanceCents;
    const current = makeLive({
      id: `remote:${receipt.roundId}`, replayOf: null, bet: receipt.betCents, cost: receipt.costCents, mode: receipt.mode, balanceBefore: after + receipt.costCents - receipt.payoutCents, round,
      remote: { receipt, balanceAfter: after },
    });
    setActiveDemo(true);
    setRemoteBalance(current.balanceBefore - current.cost);
    begin(current, t('announce.recovered', { amount: format.number(receipt.payoutCents / 100) }));
  }, [sourceView, booting, begin, makeLive, setActiveDemo, t, format]);

  /** Remote only: publish the signed replay of a server round and hand out its link ("Kazancını paylaş"). */
  const shareRound = useCallback((record: DemoRecord) => {
    const id = record.remote?.roundId;
    if (!remote || !id) return;
    remote.client.share(id).then(async ({ path }) => {
      const url = `${window.location.origin}${path}`;
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard blocked: show the link */ }
      showToast(copied ? t('toast.shareCopied', { url }) : t('toast.shareLink', { url }));
    }, (failure: unknown) => showToast(t('toast.shareFailed', { error: rgs.error(failure) }), 'warn'));
  }, [remote, showToast, t, rgs]);
  const startRef = useRef(startRound); startRef.current = startRound;

  const replay = useCallback((record: DemoRecord) => {
    const meta = record.cezeri;
    if (!meta || (live.current && !live.current.settled) || autoRef.current || booting) return;
    let round: CezeriRound;
    try { round = playCezeriRound(meta.seedHex, meta.betCents, meta.mode); } catch { showToast(t('toast.replayFailed'), 'warn'); return; }
    if (round.payoutCents !== record.payout || round.costCents !== meta.costCents) { showToast(t('toast.replayMismatch'), 'warn'); return; }
    const current = makeLive({ id: null, replayOf: record.id, bet: meta.betCents, cost: meta.costCents, mode: meta.mode, balanceBefore: balanceRef.current, round, remote: null });
    setReplaying({ recordId: record.id, seed: meta.seedHex });
    stageRef.current?.scrollIntoView({ block: 'start' });
    begin(current, t('announce.replaying', { id: cezeriRoundId(meta.seedHex) }));
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
    const timer = window.setTimeout(() => setBanner(x => (x?.key === banner.key ? null : x)), 2400);
    return () => window.clearTimeout(timer);
  }, [banner]);

  /* Development-only preview of the celebration screens and callouts (visual QA). It never builds a round, reserves or
     settles anything; production builds drop it (NODE_ENV is inlined). */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as { __cezeriPreview?: unknown };
    const idle = () => !(live.current && !live.current.settled) && !player.current;
    w.__cezeriPreview = {
      celebrate: (totalHundredths: number, capped = false, betCents = 1000) => {
        if (!idle()) return false;
        const s = settingsRef.current, opts = cezeriTimelineOptions(s, reducedMotion);
        const schedule = countUpSchedule(totalHundredths, capped, opts);
        const dur = schedule.countUp + schedule.hold;
        const timeline = { events: [
          { type: 'big-win', at: 0, dur, tier: schedule.finalLevel, totalHundredths, capped, countUp: schedule.countUp, schedule, hold: true } as CezeriEvent,
          { type: 'end', at: dur, dur: 0, totalHundredths, payoutCents: cezeriCents(betCents, totalHundredths), capped } as CezeriEvent,
        ] };
        const preview = new TimelinePlayer<CezeriEvent>(timeline, event => {
          if (event.type === 'big-win') openCelebration(event.schedule, betCents, event.at, event.dur, reducedMotion, reducedMotion || s.reducedEffects);
          else if (event.type === 'end') { setCard(null); setMood('base'); sound.countUp(false); player.current = null; }
        });
        player.current = preview;
        preview.start();
        return true;
      },
      callout: (value: number, isFree = false) => { showCallout(value, isFree, reducedMotion || settingsRef.current.reducedEffects); return true; },
      /** Pause the presentation clock (screenshots); `resume` continues. The round result is already fixed. */
      pause: () => { player.current?.stop(); return true; },
      resume: () => { player.current?.start(); return true; },
      time: () => player.current?.time ?? -1,
      /** The live round's event list (type, time, round/level) for timed visual QA. */
      events: () => live.current?.timeline.events.map(e => ({ type: e.type, at: e.at, dur: e.dur, round: 'round' in e ? e.round : undefined, level: 'level' in e ? e.level : undefined })) ?? [],
    };
    return () => { delete w.__cezeriPreview; };
  }, [openCelebration, reducedMotion, showCallout, sound]);

  /* ---------------------------------------------------------------- autoplay */
  const startAutoplay = useCallback((config: AutoplayConfig) => {
    if (busy || gated) return;
    const state = createAutoplay(config, balanceRef.current);
    autoRef.current = state;
    setAuto(state);
    setModal(null);
    sound.unlock(); sound.autoplay(true);
    showToast(t('toast.autoplayStarted', { spins: config.spins, limit: format.demo(config.lossLimitCents) }));
  }, [busy, gated, showToast, sound, t, format]);

  const realityDue = session.realityDue;
  useEffect(() => {
    if (!auto || phase === 'playing' || modal !== null || realityDue || booting || gated) return;
    const gap = CEZERI_AUTOPLAY_GAP[settingsRef.current.spinSpeed];
    const timer = window.setTimeout(() => {
      const state = autoRef.current; if (!state) return;
      const decision = cezeriAutoplayBeforeSpin(state, { balanceCents: balanceRef.current, betCents: bet, ante, tabHidden: document.hidden });
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
  const roundMode: CezeriMode = ante ? 'ante' : 'standard';
  const spinCost = cezeriCost(bet, roundMode);
  const buyPrice = cezeriCost(bet, 'buy');
  const buyBlock = cezeriBuyBlock({ betCents: bet, balanceCents: balance, ante, autoplay: auto !== null, busy, gated });
  const buyReason = buyBlock ? t(`buy.block.${buyBlock.code}`, { price: format.demo(buyPrice) }) : null;
  const locked = busy || auto !== null || gated || booting || sourcePending;
  const amountCents = (h: number) => (roundBet === null ? 0 : cezeriCents(roundBet, h));
  const boardLabel = free ? t('board.labelFree') : t('board.label');
  const boardMood = free ? 'feature' : 'base';
  const boardElement = useMemo(() => (
    <CezeriFrame mood={boardMood} spinning={spinning}>
      <CezeriBoard ref={board} initial={IDLE_BOARD} hubValue={1} mood={boardMood} label={boardLabel} />
    </CezeriFrame>
  ), [boardLabel, boardMood, spinning]);
  const celebrating = card?.kind === 'big' || card?.kind === 'outro' || card?.kind === 'intro';
  const infoPages = useMemo(() => cezeriInfoPages(bet, { t, tk, tc, format }), [bet, t, tk, tc, format]);
  const outOfCredit = !busy && balance < CEZERI_MIN_BET_CENTS;
  const deckWin = busy ? amountCents(meter.total) : (lastWin?.payout ?? 0);
  const speedIndex = SPIN_SPEEDS.indexOf(settings.spinSpeed);
  const replayInfo = replaying ? t('replay.ribbon', { id: cezeriRoundId(replaying.seed) }) : null;
  const hubTier = Math.min(4, multiplierCalloutTier(hub));

  const openInfo = (page = 'how') => { setInfoPage(page); setModal('info'); sound.click(); };
  const refill = () => {
    if (busy || auto) return;
    if (remote) {
      if (pendingRemote.current) return;
      remote.client.resetBalance().then(cents => {
        setRemoteBalance(cents);
        const at = Date.now();
        recordRemote({ id: `remote-reset:${at}`, game: 'Cezeri', stake: 0, payout: 0, detail: 'Bakiye yenilendi (sunucu)', at, kind: 'reset' });
        showToast(t('toast.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); setError(''); setAnnounce(t('announce.refilledRemote', { amount: format.number(DEMO_START_CENTS / 100) }));
      }, (failure: unknown) => showToast(rgs.error(failure), 'warn'));
      return;
    }
    if (resetDemoBalance('Cezeri')) { showToast(t('toast.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); setError(''); setAnnounce(t('announce.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); }
  };
  const toggleSound = () => { const muted = !settings.muted; updateSettings({ muted }); if (!muted) sound.unlock(); };
  const cycleSpeed = () => {
    const next = SPIN_SPEEDS[(speedIndex + 1) % SPIN_SPEEDS.length]!;
    updateSettings({ spinSpeed: next });
    sound.click();
    setAnnounce(t('announce.speed', { speed: tk(SPEED_KEY[next]) }));
  };
  const toggleAnte = () => {
    if (locked) return;
    const next = !ante;
    setAnte(next);
    sound.click();
    setAnnounce(next ? t('announce.anteOn', { cost: format.demo(cezeriCost(bet, 'ante')) }) : t('announce.anteOff', { cost: format.demo(bet) }));
  };
  const onSpinClick = () => { if (busy) return; startRound('spin'); };
  const confirmBuy = () => { if (buyReason) return; setModal(null); startRound('buy'); };

  const deck = (
    <BetSelector
      ladder={CEZERI_BET_LADDER}
      valueCents={bet}
      onChange={chooseBet}
      balanceCents={balance}
      maxBetCents={CEZERI_MAX_BET_CENTS}
      costMode={CEZERI_COST_MODES[roundMode]}
      modeLabel={ante ? tc('modes.ante') : undefined}
      disabled={locked}
      classNames={{ minus: styles.stepBtn, plus: styles.stepBtn, value: styles.betValue, max: styles.maxChip }}
      render={parts => (
        <div className={`${kit.kit} ${styles.deck}`} data-auto={auto ? '' : undefined} role="group" aria-label={t('deck.group')}>
          <div className={styles.cellBalance}>
            <span className={styles.cellLabel}>{t('deck.balance')}</span>
            <strong className={styles.cellValue} data-testid="cezeri-balance">{format.amount(balance)}<small> DEMO</small></strong>
            <button type="button" className={styles.refill} onClick={refill} disabled={busy || auto !== null || gated} aria-label={t('deck.refill')}><RefillIcon /><span aria-hidden="true">{t('deck.refill')}</span></button>
          </div>
          <div className={styles.cellWin}>
            <span className={styles.cellLabel}>{busy ? (replaying ? t('deck.winReplay') : t('deck.win')) : lastWin?.replay ? t('deck.winReplayLast') : t('deck.winLast')}</span>
            <strong className={`${styles.cellValue} ${deckWin > 0 ? styles.cellWinOn : ''}`}>{format.amount(deckWin)}<small> DEMO</small></strong>
          </div>
          <div className={styles.cellBet}>
            {parts.label}
            {parts.value}
            <span className={styles.costLine} data-testid="cezeri-cost">{t('deck.cost')} <strong>{format.amount(spinCost)} DEMO</strong>{ante && <em> · {format.factor(CEZERI_COST_MODES.ante.num, CEZERI_COST_MODES.ante.den)}</em>}</span>
          </div>
          <div className={styles.areaMinus}>{parts.minus}</div>
          <div className={styles.areaPlus}>{parts.plus}</div>
          <div className={styles.areaMax}>{parts.max}</div>
          <div className={styles.areaSpin}>
            {auto ? (
              <AutoplayStopButton className={styles.stop} remaining={auto.spinsRemaining} onStop={() => stopAutoplay('cancelled', 'info')} />
            ) : (
              <button type="button" className={`${styles.spin} ${busy ? styles.spinning : ''}`} onClick={onSpinClick} disabled={busy || gated || booting || sourcePending}
                aria-label={t('deck.spin')} aria-describedby="cz-spin-cost" data-locked={busy || undefined} data-testid="cezeri-spin">
                <span className={styles.spinFace}><SpinSigil /></span>
                {busy && <span className={styles.spinLock} aria-hidden="true"><LockIcon /></span>}
              </button>
            )}
            <span id="cz-spin-cost" className="sr-only">{busy ? t('deck.spinLocked') : t('deck.spinCost', { cost: format.demo(spinCost) })}</span>
          </div>
          <button type="button" className={`${styles.tool} ${styles.areaAuto}`} onClick={() => { sound.click(); setModal('autoplay'); }} disabled={locked} aria-haspopup="dialog">
            <LoopIcon /><span>{t('deck.auto')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaInfo}`} onClick={() => openInfo()} aria-haspopup="dialog" aria-label={t('deck.infoAria')}>
            <InfoIcon /><span>{t('deck.info')}</span>
          </button>
          <button type="button" role="switch" aria-checked={ante} className={`${styles.feature} ${styles.areaAnte} ${ante ? styles.featureOn : ''}`} onClick={toggleAnte} disabled={locked}
            aria-label={tc('modes.ante')} aria-describedby="cz-ante-desc">
            <span className={styles.featureTitle}>{tc('modes.ante')}</span>
            <span className={styles.featureState}>{ante ? t('deck.on') : t('deck.off')}<span className={styles.featureFactor}> · {format.factor(CEZERI_COST_MODES.ante.num, CEZERI_COST_MODES.ante.den)}</span></span>
            <span id="cz-ante-desc" className={styles.featureDesc}>{t('deck.anteDesc')}</span>
          </button>
          <button type="button" className={`${styles.feature} ${styles.featureBuy} ${styles.areaBuy}`} aria-disabled={buyReason ? true : undefined}
            onClick={() => { if (buyReason) sound.denied(); else sound.click(); setModal('buy'); }} aria-haspopup="dialog" aria-describedby="cz-buy-desc">
            <span className={styles.featureTitle}>{t('deck.buy')}</span>
            <span className={styles.featureState}>{format.amount(buyPrice, { trimZeros: true })} DEMO</span>
            <span id="cz-buy-desc" className={styles.featureDesc}>{buyReason ?? t('deck.buyDesc', { spins: 10, rtp: cezeriRtp(CEZERI_RTP.buy.rtp, loc) })}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSet}`} onClick={() => { sound.click(); setModal('settings'); }} aria-haspopup="dialog" aria-label={tk('settings.title')}>
            <GearIcon /><span>{tk('settings.title')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSpeed} ${speedIndex > 0 ? styles.toolOn : ''}`} onClick={cycleSpeed} aria-label={t('deck.speedAria', { speed: tk(SPEED_KEY[settings.spinSpeed]) })}>
            <SpeedGears count={speedIndex + 1} /><span>{tk(SPEED_KEY[settings.spinSpeed])}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSound} ${!settings.muted ? styles.toolOn : ''}`} onClick={toggleSound} aria-pressed={!settings.muted} aria-label={t('deck.sound')}>
            <SoundIcon on={!settings.muted} /><span>{t('deck.sound')}</span>
          </button>
          <div className={styles.areaMsg}>
            {soundLoad.started && !soundLoad.ready && !settings.muted && <p className={styles.msgHint} role="status">{t('deck.soundLoading', { percent: soundLoad.percent })}</p>}
            {error ? <p className={styles.msgError} role="alert">{error}</p>
              : outOfCredit ? <p className={styles.msgHint}>{t('deck.outOfCredit')} <button type="button" className={styles.inlineLink} onClick={refill}>{t('deck.refill')}</button></p>
              : <p className={styles.msgHint}>{lastWin && !busy ? (lastWin.payout > 0 ? richText(t, 'deck.lastWin', { money: cezeriMoney(lastWin.payout, loc), times: cezeriTimes(lastWin.total, loc) }) : t('deck.lastNone')) : settings.spaceToSpin ? t('deck.hintSpace') : t('deck.hintFixed')}</p>}
          </div>
        </div>
      )}
    />
  );

  return (
    <div className={`game-page ${styles.page}`}>
      <CezeriSymbolSprites />
      <GameHeading title={t('title')} subtitle={t('subtitle')} mode={mode} setMode={setMode} active={busy || auto !== null}
        badge={remote ? rgs.source('remote') : sourcePending ? t('badge.checking') : rgs.source('local')} />
      <section ref={tableRef} className={`game-table ${styles.table}`} aria-label={t('table')} data-free={free || undefined}>
        <div className={styles.layout}>
          <div ref={stageRef} className={styles.stage} data-phase={phase} data-celebrate={celebrating || undefined}>
            <MemoScene ref={scene} mood={mood} className={styles.scene} corners />
            <div className={styles.column}>
              <div className={styles.top}>
                <div className={styles.logo}><CezeriLogo /></div>
              </div>
              <div className={styles.hud}>
                {freeInfo ? (
                  <div className={styles.freeCounter} aria-label={t('hud.freeAria', { number: freeInfo.number, left: freeInfo.left })} data-testid="cezeri-free-counter">
                    <span className={styles.freeTag}>{freeInfo.number > 0 ? t('hud.freeSpin', { n: freeInfo.number }) : t('hud.freeTitle')}</span>
                    <span className={styles.freeLeft}><small>{t('hud.left')}</small><strong key={freeInfo.left}>{freeInfo.left}</strong></span>
                  </div>
                ) : <span className={styles.hudSpacer} />}
                <div className={`${styles.chain} ${chain ? styles.chainOn : ''}`} data-testid="cezeri-chain" aria-hidden={chain ? undefined : true}
                  aria-label={chain ? t('hud.chainAria', { round: chain.round, max: CEZERI_MAX_RESPINS }) : undefined} role={chain ? 'status' : undefined}>
                  <small>{t('hud.chain')}</small>
                  <span className={styles.chainPips}>{Array.from({ length: CEZERI_MAX_RESPINS }, (_, i) => <i key={i} data-on={chain && i < chain.round ? '' : undefined} />)}</span>
                </div>
                <div className={`${styles.hubPill} ${free ? styles.hubFree : ''}`} data-tier={hubTier} data-testid="cezeri-hub" aria-label={t('hud.hubAria', { hub, kept: free ? 'yes' : 'no' })}>
                  <small>{free ? t('hud.hubKept') : t('hud.hub')}</small>
                  <strong key={hubPunch} className={styles.hubValue}>×{hub}</strong>
                </div>
              </div>
              <div className={styles.boardRow}>
                <div className={`${styles.reservoir} ${free ? styles.reservoirOn : ''}`} aria-hidden={free ? undefined : true} data-testid="cezeri-reservoir" data-level={reservoir}>
                  <CezeriReservoir level={reservoir} />
                </div>
                <div className={styles.boardWrap}>{boardElement}</div>
              </div>
              {/* One cumulative meter: never resets inside a round (respins, scatter pay, every free spin add up). */}
              <div ref={meterRef} className={`${styles.meter} ${free ? styles.meterFree : ''}`} data-testid="cezeri-meter">
                {phase === 'idle' ? (
                  <div className={styles.meterIdle}><span>{richText(t, 'meter.idleA')}</span><span aria-hidden="true">·</span><span>{richText(t, 'meter.idleB')}</span></div>
                ) : (
                  <div className={styles.meterPart}>
                    <small>{free || phase === 'done' ? t('meter.total') : t('meter.win')}</small>
                    <strong data-testid="cezeri-meter-total"><CountUp cents={amountCents(meter.total)} duration={meterDur} locale={loc} /><em> DEMO</em></strong>
                  </div>
                )}
                {flourish > 0 && phase !== 'idle' && <span key={flourish} className={styles.meterShine} aria-hidden="true" />}
              </div>
            </div>
            <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />
            <div ref={layerRef} className={styles.fxLayer} aria-hidden="true" />
            {replayInfo && <div className={styles.replayRibbon} data-testid="cezeri-replay"><Icon name="history" size={15} /><span>{replayInfo}</span></div>}
            {auto && !replayInfo && <div className={styles.autoRibbon} aria-hidden="true"><LoopIcon /><span>{t('auto.ribbon', { spins: auto.spinsRemaining })}</span></div>}
            {toast && (
              <div key={`toast-${toast.key}`} className={`${styles.toast} ${toast.tone === 'warn' ? styles.toastWarn : ''}`} data-testid="cezeri-toast">
                <span>{toast.text}</span>
                <button type="button" className={styles.toastClose} onClick={() => setToast(null)} aria-label={t('toast.close')}><svg {...svg} width={16} height={16}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
              </div>
            )}
            {banner && <div key={`banner-${banner.key}`} className={`${styles.banner} ${banner.tone === 'water' ? styles.bannerWater : ''}`} data-testid="cezeri-banner" aria-hidden="true">{banner.text}</div>}
            {callout && (
              <div key={`callout-${callout.key}`} className={styles.callout} data-tier={callout.tier} style={{ animationDuration: `${callout.life}ms` }} aria-hidden="true" data-testid="cezeri-callout" data-key={callout.key}>
                <span className={styles.calloutGlow} />
                {callout.tier >= 1 && <span className={styles.calloutTag}>{callout.free ? t('callout.free', { tag: t(CALLOUT_KEY[callout.tier]) }) : t(CALLOUT_KEY[callout.tier])}</span>}
                <span className={styles.calloutText} data-text={`×${callout.value}`}><span className={styles.calloutFill}>×{callout.value}</span></span>
              </div>
            )}
            {card?.kind === 'intro' && <CezeriFreeIntro key={`intro-${card.at}`} awarded={card.awarded} dur={card.dur} reducedMotion={reducedMotion} onTap={advanceHold} />}
            {card?.kind === 'outro' && (
              <CezeriFeatureTotal key={`outro-${card.at}`} spins={card.spins} totalHundredths={card.total} topHub={card.topHub} falconVisits={card.falconVisits} wilds={card.wilds} betCents={card.bet}
                celebration={card.celebration} capped={card.capped} dur={card.dur} elapsed={cardElapsed} reducedMotion={reducedMotion} onTap={advanceHold} />
            )}
            {card?.kind === 'big' && (
              <CezeriCelebration key={`big-${card.at}`} schedule={card.schedule} betCents={card.bet} elapsed={cardElapsed} reducedMotion={reducedMotion}
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
          <div className={styles.side}>{deck}</div>
        </div>
        {boot.phase !== 'done' && (
          <div className={styles.splash} data-testid="cezeri-splash">
            <div className={styles.splashCard}>
              <div className={styles.splashLogo}><CezeriLogo /></div>
              <ul className={styles.splashFeatures}>
                <li><span aria-hidden="true"><CezeriSymbolArt symbol="h1" size="100%" /></span><strong>{t('splash.gearLock.title')}</strong><small>{t('splash.gearLock.text')}</small></li>
                <li><span aria-hidden="true"><CezeriSymbolArt symbol="vessel" size="100%" /></span><strong>{t('splash.elephant.title')}</strong><small>{t('splash.elephant.text')}</small></li>
                <li><span aria-hidden="true"><CezeriSymbolArt symbol="gear" size="100%" /></span><strong>{t('splash.max.title', { max: format.number(10000, 0) })}</strong><small>{t('splash.max.text')}</small></li>
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
              <p className={styles.splashNote}>{t('splash.note', { rtp: cezeriRtp(CEZERI_RTP.standard.rtp, loc) })}</p>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <SessionBar className={styles.sessionBar} nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <CezeriHistory onReplay={replay} replayDisabled={busy || auto !== null || booting} replayingId={replaying?.recordId ?? null} onShare={remote ? shareRound : undefined} />
      <StaticFooter remote={remote !== null} />

      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title={tk('settings.title')} size="md">
        <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
        <p className={styles.modalNote} role="status">{soundLoad.ready ? t('settings.soundReady') : soundLoad.started ? t('settings.soundLoading', { percent: soundLoad.percent }) : t('settings.soundIdle')}</p>
        <section className={styles.demoBox} aria-labelledby="cz-demo-title">
          <h3 id="cz-demo-title">{t('settings.demoTitle')}</h3>
          <p>{t('settings.demoText', { balance: format.demo(balance), remote: remote ? 'yes' : 'no', start: format.number(DEMO_START_CENTS / 100) })}</p>
          <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={refill} disabled={busy || auto !== null || gated}>{t('deck.refill')}</button>
        </section>
      </Modal>
      <GameInfo open={modal === 'info'} onClose={() => setModal(null)} pages={infoPages} title={t('info.title')} initialPageId={infoPage} />
      <Modal open={modal === 'autoplay'} onClose={() => setModal(null)} title={t('autoplay.title')} size="md">
        <AutoplayPanel onStart={startAutoplay} spinCostCents={spinCost} balanceCents={balance} disabled={busy || gated} />
        <p className={styles.modalNote}>{t('autoplay.note', { cost: format.demo(spinCost), ante: ante ? 'yes' : 'no' })}</p>
      </Modal>
      <BuyFeatureDialog
        open={modal === 'buy'}
        onClose={() => setModal(null)}
        onConfirm={confirmBuy}
        featureName={t('buy.feature', { bet: format.demo(bet) })}
        priceCents={buyPrice}
        balanceCents={balance}
        rtpText={t('buy.rtp', { buy: cezeriRtp(CEZERI_RTP.buy.rtp, loc), standard: cezeriRtp(CEZERI_RTP.standard.rtp, loc) })}
        description={richText(t, 'buy.text', { bet: format.demo(bet), max: format.demo(bet * 10_000) })}
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
