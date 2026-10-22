'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_RTP, CASCADE_FREE_SPINS_TRIGGER, playCascade2Round, type Cascade2Round, type CascadeMode } from '@sollish/protocol';
import { DEMO_START_CENTS } from '@/lib/demo';
import { useFormat, useT } from '@/lib/i18n/client';
import { percentOf } from '@/lib/slot-kit/percent';
import { buildCascadeTimeline, cascadeHistoryDetail, centsFor, type CascadeTimeline, type Meter, type TimelineEvent } from '@/lib/cascade-timeline';
import { WIN_TIER_INFO, countUpSchedule, multiplierCalloutTier, type CelebrationLevel, type CountUpSchedule, type WinTier } from '@/lib/slot-kit/win-tiers';
import { TimelinePlayer, type EventInfo } from '@/lib/cascade-player';
import { autoplayNetLossCents, cancelAutoplay, createAutoplay, type AutoplayConfig, type AutoplayState, type AutoplayStopCode } from '@/lib/slot-kit/autoplay';
import { SPIN_SPEEDS, type SpinSpeed } from '@/lib/slot-kit/settings';
import {
  CASCADE_AUTOPLAY_GAP, CASCADE_BET_LADDER, CASCADE_COST_MODES, CASCADE_DEFAULT_BET_CENTS, CASCADE_MAX_BET_CENTS, CASCADE_MIN_BET_CENTS,
  autoplayAfterRound, autoplayBeforeSpin, buyBlock, cascadeCost, cascadeLedgerLimits, cascadeTimelineOptions, shortRoundId,
} from '@/lib/cascade-controls';
import { markRoundShown, rgsErrorMessage, type RemoteReceipt, type RemoteRoundSource } from '@/lib/rgs-client';
import { CASCADE_ENGINE } from '@/lib/slot-engines/cascade';
import { localSourceFor, useRoundSource } from '@/lib/use-round-source';
import { useProduct, type DemoRecord } from '../providers';
import { DemoNotice, GameHeading, Rules, type Mode } from '../game-common';
import { Icon } from '../icons';
import {
  AutoplayPanel, AutoplayStopButton, BetSelector, BuyFeatureDialog, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, useSession, useSlotSettings,
} from '../slot-kit';
import kit from '../slot-kit/kit.module.css';
import { useViewportTop } from '../slot-kit/use-viewport-top';
import { CascadeBackdrop, BoardFrame } from './backdrop';
import { CascadeBoard, type BoardHandle } from './cascade-board';
import { CascadeHistory } from './cascade-history';
import { CascadeFx, SYMBOL_COLORS } from './fx';
import { cascadeInfoPages } from './info-pages';
import { SymbolArt } from './symbols';
import { useSymbolNames } from './use-symbol-names';
import { useCascadeSound } from './use-cascade-sound';
import { FeatureTotal, WinCelebration } from './win-celebration';
import styles from './cascade-game.module.css';
import { GameInfoStrip } from '@/components/game-info-strip';

/* Lifecycle: entropy -> engine v2 resolves the whole round (bet + mode) -> one reservation of the mode cost ->
   the timeline replays it -> exactly one settlement with the engine payout (at the end, or on unmount).
   Spin lock (game-standards §6): once a round starts the spin button and Space stay locked until the whole
   round, every tumble and free spin included, has played; there is no skip. Speed comes from the quick/turbo
   setting; only the celebration overlays may be tapped (that moves the presentation clock, never a result).
   A replay from the history uses the same engine call and never touches the ledger.
   Remote (RGS) mode, lib/rgs-client.ts: the server resolves AND settles the round before the browser sees it; the game
   presents the returned round, records it in the history and shows the server balance. It never reserves or settles
   locally, so leaving mid-round needs nothing; a reload re-presents the last unseen server round. */

type LiveRound = {
  /** Ledger reservation id; null for a history replay. */
  id: string | null; replayOf: string | null;
  bet: number; cost: number; mode: CascadeMode; balanceBefore: number;
  round: Cascade2Round; timeline: CascadeTimeline; prefix: string; reduced: boolean; lite: boolean; settled: boolean; startedAt: number;
  /** Server round (already settled there): its receipt and the balance to show when the presentation ends. */
  remote: { receipt: RemoteReceipt; balanceAfter: number } | null;
};
type Phase = 'idle' | 'playing' | 'done';
type Card =
  | { kind: 'intro'; awarded: number; at: number; dur: number }
  | { kind: 'outro'; spins: number; total: number; multipliers: number[]; celebration: boolean; capped: boolean; bet: number; at: number; dur: number }
  | { kind: 'big'; schedule: CountUpSchedule; bet: number; at: number; dur: number };
type Callout = { key: number; sum: number; tier: WinTier; x: number; y: number };
type Banner = { key: number; text: string; tone: 'gold' | 'pink' };
type Badge = { parts: number[]; sum: number | null };
type Toast = { key: number; text: string; tone: 'info' | 'warn' };
type ModalId = 'settings' | 'info' | 'autoplay' | 'buy' | null;
type Boot = { phase: 'loading' | 'ready' | 'done'; progress: number };

/** Why autoplay stopped: a slot-kit code, or one of this game's own. The text is translated where it is shown. */
type StopCode = AutoplayStopCode | 'server-failed' | 'spin-failed' | 'quit';
const SPEED_KEYS = { normal: 'settings.speedNormal', quick: 'settings.speedQuick', turbo: 'settings.speedTurbo' } as const satisfies Record<SpinSpeed, string>;
const ZERO: Meter = { spin: 0, total: 0 };
const BET_KEY = 'sollish:cascade:bet';
/** The local DEMO source over cascade's engine only (lib/slot-engines/cascade.ts); the other games' engines are not in this route. */
const localRoundSource = localSourceFor(CASCADE_ENGINE);
/** The loading screen shows once per page load; returning through client navigation goes straight in. */
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

/** Development/test hook: a shorter reality-check interval (never in production builds). */
function realityIntervalOverride(): number | undefined {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return undefined;
  const value = (window as unknown as { __cascadeRealityMs?: unknown }).__cascadeRealityMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? value : undefined;
}

/** Count-up number that writes its own text node (no React re-render per frame). */
function CountUp({ cents, duration, instant, className, from, format }: { cents: number; duration: number; instant?: boolean; className?: string; from?: number; format: (cents: number) => string }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(from ?? cents);
  const [initial] = useState(() => format(from ?? cents));
  useEffect(() => {
    const el = node.current; if (!el) return;
    const from = shown.current, to = cents;
    if (instant || duration <= 0 || from === to || typeof requestAnimationFrame === 'undefined') { shown.current = to; el.textContent = format(to); return; }
    const start = performance.now(); let frame = 0;
    const step = (now: number) => {
      // rAF timestamps can precede `start` (frame start vs. effect time): clamp so the meter never dips below `from`.
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - (1 - p) ** 3;
      shown.current = Math.round(from + (to - from) * eased);
      el.textContent = format(shown.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); shown.current = to; el.textContent = format(to); };
  }, [cents, duration, instant, format]);
  return <span ref={node} className={className}>{initial}</span>;
}

/* ------------------------------------------------------------------ icons (original, inline) */
function SwirlIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ccSwirl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fffaf0" /><stop offset="1" stopColor="#ffe2b0" /></linearGradient>
      </defs>
      <path d="M32 10c12 0 22 9.6 22 21.6C54 42 45.6 50 35.6 50 27 50 20.4 43.6 20.4 35.6c0-6.8 5.4-12 12-12 5.6 0 9.8 4.2 9.8 9.4 0 4.4-3.4 7.8-7.6 7.8-3.6 0-6.2-2.6-6.2-5.8"
        fill="none" stroke="#7a3a0c" strokeWidth="9" strokeLinecap="round" opacity=".35" transform="translate(0 1.5)" />
      <path d="M32 10c12 0 22 9.6 22 21.6C54 42 45.6 50 35.6 50 27 50 20.4 43.6 20.4 35.6c0-6.8 5.4-12 12-12 5.6 0 9.8 4.2 9.8 9.4 0 4.4-3.4 7.8-7.6 7.8-3.6 0-6.2-2.6-6.2-5.8"
        fill="none" stroke="url(#ccSwirl)" strokeWidth="7" strokeLinecap="round" />
      <path d="M14 22c-2.6 4-4 8.6-4 13.4" fill="none" stroke="url(#ccSwirl)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
const svg = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, focusable: false } as const;
function BoltIcons({ count }: { count: number }) {
  return (
    <span className={styles.bolts} aria-hidden="true">
      {[0, 1, 2].map(i => <svg key={i} {...svg} width={11} height={16} viewBox="5 2 14 20" data-on={i < count || undefined}><path d="M13.5 2 5 13.5h6L9.8 22 19 9.8h-6.2z" fill="currentColor" /></svg>)}
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

/* Heavy static subtrees are memoised so meter/announcement updates never re-render them. */
const StaticBackdrop = memo(CascadeBackdrop);
const StaticFooter = memo(function StaticFooter({ remote }: { remote: boolean }) { return <><DemoNotice remote={remote} /><Rules game="Cascade" /></>; });

export function CascadeGame() {
  const { reserveDemo, settleDemo, recordRemote, setActiveDemo, demoBalance, resetDemoBalance } = useProduct();
  const router = useRouter();
  const t = useT('cascade');
  const tc = useT('common');
  const tk = useT('slotKit');
  const format = useFormat();
  const names = useSymbolNames();
  const money = format.amount;
  const gameTitle = tc('games.cascade');
  const { settings, update: updateSettings, reset: resetSettings } = useSlotSettings('cascade');
  const [realityMs] = useState(realityIntervalOverride);
  const session = useSession(realityMs ? { realityIntervalMs: realityMs } : {});
  const recordSession = session.recordRound;
  const { sound, loadState: soundLoad } = useCascadeSound(settings);
  const [mode, setMode] = useState<Mode>('demo');
  const [bet, setBet] = useState(CASCADE_DEFAULT_BET_CENTS);
  const [ante, setAnte] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [free, setFree] = useState(false);
  const [freeInfo, setFreeInfo] = useState<{ number: number; left: number } | null>(null);
  const [meter, setMeter] = useState<Meter>(ZERO);
  const [meterDur, setMeterDur] = useState(0);
  const [roundBet, setRoundBet] = useState<number | null>(null);
  const [badge, setBadge] = useState<Badge | null>(null);
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
  const reducedMotion = usePrefersReducedMotion();
  const sourceView = useRoundSource(CASCADE_ENGINE);
  const remote: RemoteRoundSource | null = sourceView.status === 'remote' ? sourceView.source : null;
  const sourcePending = sourceView.status === 'pending';
  /** Server balance in remote mode (display only; the server's response is the truth). */
  const [remoteBalance, setRemoteBalance] = useState<number | null>(null);
  useEffect(() => { if (sourceView.status === 'remote') setRemoteBalance(sourceView.balanceCents); }, [sourceView]);
  const balance = remote ? (remoteBalance ?? 0) : demoBalance;
  const pendingRemote = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const board = useRef<BoardHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLElement>(null);
  useViewportTop(tableRef);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const fx = useRef<CascadeFx | null>(null);
  const player = useRef<TimelinePlayer | null>(null);
  const live = useRef<LiveRound | null>(null);
  const settledIds = useRef(new Set<string>());
  const sequence = useRef(0);
  const bannerKey = useRef(0);
  const toastKey = useRef(0);
  const calloutKey = useRef(0);
  /** Effect mode of the celebration on screen (its round's reduced/lite flags). */
  const celebrateFx = useRef({ reduced: false, lite: false });
  const autoRef = useRef<AutoplayState | null>(null);
  autoRef.current = auto;
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------------------------------------------------------------- setup */
  useEffect(() => {
    const stage = stageRef.current, canvas = canvasRef.current, layer = layerRef.current;
    if (stage && canvas && layer) fx.current = new CascadeFx(canvas, layer, stage);
    return () => { fx.current?.dispose(); fx.current = null; };
  }, []);

  // Remembered bet (validated against the ladder).
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(BET_KEY));
      if (CASCADE_BET_LADDER.includes(stored)) setBet(stored);
    } catch { /* storage blocked: default bet */ }
  }, []);
  const chooseBet = useCallback((cents: number) => {
    setBet(prev => { if (cents !== prev) sound.betChange(cents > prev ? 1 : -1); return cents; });
    try { window.localStorage.setItem(BET_KEY, String(cents)); } catch { /* not remembered */ }
  }, [sound]);

  // Loading screen: a short branded beat while the board art and sprites settle (sound renders after the first
  // gesture, in the background). Shown once per page load.
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

  // First user gesture anywhere: resume audio and start rendering the sound bank.
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
      id: current.id, game: 'Cascade', stake: current.cost, payout: round.payoutCents, detail: cascadeHistoryDetail(round), at: Date.now(), kind: 'round',
      cascade: { engine: round.engine, seedHex: round.seedHex, betCents: current.bet, mode: current.mode, costCents: current.cost },
    };
    if (current.remote) {
      // Already settled on the server: only the history line and the server balance.
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
    if (current.remote) markRoundShown('cascade', current.remote.receipt.roundId);
    setPhase('done');
    sound.countUp(false);
    const { round } = current;
    setLastWin({ payout: round.payoutCents, total: round.totalHundredths, replay: current.id === null });
    if (current.id === null) {
      setReplaying(null);
      setAnnounce(t('announce.replayDone', { amount: format.demo(round.payoutCents), times: money(round.totalHundredths) }));
      sound.scene('base');
      return;
    }
    const state = autoRef.current;
    if (state) {
      const next = autoplayAfterRound(state, { costCents: current.cost, payoutCents: round.payoutCents, featureTriggered: round.freeSpinsTriggered, balanceBeforeCents: current.balanceBefore });
      autoRef.current = next;
      setAuto(next);
    }
    sound.scene('base');
    setAnnounce(round.payoutCents > 0 ? t('announce.roundEnd', { amount: format.demo(round.payoutCents), times: money(round.totalHundredths) }) : t('announce.roundEndNoWin'));
  }, [settle, sound, t, format, money]);

  /* ---------------------------------------------------------------- presentation events */
  const centre = useCallback((x: number, y: number) => {
    const stage = stageRef.current, cells = stage?.querySelector('[data-cells]');
    if (!stage || !cells) return { x: 0, y: 0, cell: 60 };
    const a = cells.getBoundingClientRect(), b = stage.getBoundingClientRect();
    return { x: a.left - b.left + (x / 6) * a.width, y: a.top - b.top + (y / 5) * a.height, cell: a.width / 6 };
  }, []);

  /** Shakes the board and anything else marked `data-shake` (the celebration lockup). */
  const shake = useCallback((strength: number, duration = 360) => {
    const frames: Keyframe[] = [
      { transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-strength}px, ${strength * 0.6}px, 0)` }, { transform: `translate3d(${strength}px, ${-strength * 0.4}px, 0)` },
      { transform: `translate3d(${-strength * 0.7}px, ${-strength * 0.5}px, 0)` }, { transform: `translate3d(${strength * 0.5}px, ${strength * 0.3}px, 0)` },
      { transform: `translate3d(${-strength * 0.3}px, ${strength * 0.15}px, 0)` }, { transform: 'translate3d(0,0,0)' },
    ];
    shakeRef.current?.animate(frames, { duration, easing: 'ease-out' });
    stageRef.current?.querySelectorAll('[data-shake]').forEach(el => el.animate(frames, { duration, easing: 'ease-out' }));
  }, []);

  /** Big multiplier announcement over the board (game-standards §6); the meter and badge still update. */
  const showCallout = useCallback((sum: number, reduced: boolean, lite: boolean) => {
    const tier = multiplierCalloutTier(sum);
    const c = centre(3, 2.5);
    setCallout({ key: ++calloutKey.current, sum, tier, x: c.x, y: c.y });
    sound.multiplierCallout(sum);
    const f = fx.current;
    if (lite || !f) return;
    f.burst(c.x, c.y, SYMBOL_COLORS.crystal!, c.cell * (1 + tier * 0.45), 16 + tier * 14);
    f.sparkle(c.x, c.y, c.cell * (1.2 + tier * 0.5), 10 + tier * 8, tier >= 3 ? '#e6f4ff' : '#fff4c8');
    if (tier >= 1) f.ring(c.x, c.y, c.cell * (1.4 + tier * 0.3), '#ffe09a', 0.6);
    if (tier >= 2) f.ring(c.x, c.y, c.cell * 2.4, tier >= 4 ? '#c9a8ff' : '#ff9ccc', 0.85);
    if (tier >= 3) f.fountain(tier);
    if (!reduced) shake(tier === 0 ? 5 : 6 + tier * 3, 360 + tier * 70);
  }, [centre, shake, sound]);

  /** Opens the escalating celebration for a schedule (from the timeline, or the dev preview). */
  const openCelebration = useCallback((schedule: CountUpSchedule, bet: number, at: number, dur: number, reduced: boolean, lite: boolean) => {
    celebrateFx.current = { reduced, lite };
    setCard({ kind: 'big', schedule, bet, at, dur });
    setAnnounce(t('announce.bigWin', { tier: tk(`winTier.${WIN_TIER_INFO[schedule.finalLevel].id}.title`), amount: format.demo(centsFor(bet, schedule.totalHundredths)), times: money(schedule.totalHundredths) }));
  }, [t, tk, format, money]);
  const onCelebrationLevel = useCallback((level: CelebrationLevel, first: boolean, remainingMs: number) => {
    const { reduced, lite } = celebrateFx.current, f = fx.current;
    if (level === 5) sound.maxWin(); else sound.bigWin(level);
    if (first) sound.countUp(true);
    if (f && !lite) {
      f.rain(level, remainingMs / 1000);
      f.fountain(level);
      if (!first) f.confetti(Math.min(3, level));
    }
    if (!lite && !reduced) shake(first ? 5 : 6 + level * 2.5, first ? 380 : 560);
  }, [shake, sound]);
  const onCelebrationCounted = useCallback(() => { sound.countUp(false); }, [sound]);

  const handle = useCallback((event: TimelineEvent, _info: EventInfo) => {
    const current = live.current; if (!current) return;
    const reduced = current.reduced, lite = current.lite, b = board.current, f = fx.current;
    const betCents = current.bet;
    switch (event.type) {
      case 'spin-start':
        setBadge(null);
        if (event.kind === 'free') { setFreeInfo({ number: event.freeSpinNumber, left: event.freeSpinsLeft }); setMeterDur(0); setMeter(event.meter); sound.spinStart(); }
        break;
      case 'clear': b?.clear(event.ids, event.dur, reduced); break;
      case 'drop': b?.drop(current.prefix, event.cells, reduced); break;
      case 'land': sound.land(event.col, event.crystal); break;
      case 'scatter-tease': b?.tease(event.ids); sound.scatterTease(true); break;
      case 'highlight': {
        b?.highlight(event.wins.flatMap(w => w.ids), event.dur, reduced);
        setAnnounce(event.wins.map(w => t('announce.cluster', { count: w.count, name: names.inline(w.symbol), times: money(w.payHundredths) })).join('; '));
        break;
      }
      case 'pop': {
        const ids = event.wins.flatMap(w => w.ids);
        if (f && !lite) {
          for (const win of event.wins) for (const id of win.ids) {
            const el = b?.symbolOf(id); if (!el) continue;
            const p = f.point(el);
            f.burst(p.x, p.y, SYMBOL_COLORS[win.symbol] ?? ['#fff'], p.w, 12);
          }
        }
        b?.pop(ids, event.dur, reduced);
        if (f) for (const win of event.wins) {
          const c = centre(win.centroid.x, win.centroid.y);
          f.label(c.x, c.y, `+${money(centsFor(betCents, win.payHundredths))}`, styles.floatLabel, reduced ? 700 : 1200);
        }
        setMeterDur(Math.min(520, event.dur + 160)); setMeter(event.meter);
        const tier = Math.max(...event.wins.map(w => (w.count >= 12 ? 2 : w.count >= 10 ? 1 : 0)));
        sound.pop(ids.length, tier, event.stepHundredths / 100);
        break;
      }
      case 'tumble': b?.tumble(current.prefix, event.cells, event.removed, reduced); sound.tumble(); break;
      case 'crystal-collect': {
        setBadge({ parts: [], sum: null });
        sound.collect();
        const target = badgeRef.current;
        if (f && target && !reduced) {
          const to = f.point(target);
          for (const crystal of event.crystals) {
            const el = b?.symbolOf(crystal.id); const art = el?.firstElementChild;
            if (!el || !art) continue;
            f.fly(art, f.point(el), to, crystal.delay, crystal.fly, styles.flyCrystal);
          }
        }
        setAnnounce(t('announce.crystals', { sum: String(event.sum) }));
        break;
      }
      case 'crystal-arrive': {
        b?.spend(event.id);
        setBadge({ parts: event.parts, sum: null });
        sound.crystalArrive(event.value);
        const target = badgeRef.current;
        if (f && target && !lite) { const p = f.point(target); f.sparkle(p.x, p.y, p.w * 0.4, 7); f.ring(p.x, p.y, p.h * 0.7, '#ffe09a', 0.45); }
        break;
      }
      case 'multiply': {
        setBadge(prev => ({ parts: prev?.parts ?? [], sum: event.sum }));
        setMeterDur(Math.min(900, event.dur)); setMeter(event.meter);
        const m = meterRef.current;
        if (!reduced) m?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.25 }, { transform: 'scale(.97)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 560, easing: 'ease-out' });
        if (f && m && !lite) { const p = f.point(m); f.sparkle(p.x, p.y, p.w * 0.35, 14); }
        sound.multiplierApply(event.sum, event.meter.spin / 100);
        showCallout(event.sum, reduced, lite);
        setAnnounce(t('announce.multiply', { sum: String(event.sum), base: money(event.baseHundredths) }));
        break;
      }
      case 'scatter-pay': {
        setMeterDur(500); setMeter(event.meter);
        setBanner({ key: ++bannerKey.current, text: t('banner.scatterPay', { count: event.count, amount: money(centsFor(betCents, event.hundredths)) }), tone: 'gold' });
        sound.scatter(event.count);
        break;
      }
      case 'scatter-trigger': {
        b?.dim(true); b?.flare(event.ids, event.dur, reduced);
        sound.scatter(event.count);
        if (f && !lite) for (const id of event.ids) { const el = b?.symbolOf(id); if (el) { const p = f.point(el); f.sparkle(p.x, p.y, p.w * 0.6, 10, '#ffe7a3'); f.ring(p.x, p.y, p.w * 0.7, '#ffd36b', 0.7); } }
        if (event.retrigger) {
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          setBanner({ key: ++bannerKey.current, text: t('banner.retrigger', { n: event.awarded }), tone: 'pink' });
          setAnnounce(t('announce.retrigger', { count: event.count, awarded: event.awarded }));
        } else setAnnounce(t('announce.trigger', { count: event.count }));
        break;
      }
      case 'free-intro':
        setCard({ kind: 'intro', awarded: event.awarded, at: event.at, dur: event.dur });
        sound.freeSpinsIntro(); sound.scene('feature');
        setAnnounce(t('announce.freeIntro', { awarded: event.awarded }));
        break;
      case 'free-mode':
        setCard(null); b?.dim(false); setFree(event.on); setFreeInfo({ number: 0, left: 10 });
        break;
      case 'spin-end': {
        b?.dim(false);
        sound.scatterTease(false);
        setMeterDur(300); setMeter(event.meter);
        if (event.kind === 'free') {
          // Transient "+X" for this spin; the main meter keeps the cumulative total.
          const m = meterRef.current;
          if (f && m && event.winHundredths > 0) { const p = f.point(m); f.label(p.x, p.y - p.h * 1.05, `+${money(centsFor(betCents, event.winHundredths))}`, styles.floatSpin, reduced ? 900 : 1400); }
          setAnnounce(event.winHundredths > 0 ? t('announce.freeSpinWin', { win: money(event.winHundredths), total: money(event.meter.total) }) : t('announce.freeSpinNoWin'));
        } else if (event.winHundredths === 0) setAnnounce(t('announce.noWin'));
        break;
      }
      case 'total-win': {
        // Below 10x: a short flourish on the meter, no full-screen takeover.
        setFlourish(k => k + 1);
        sound.totalWinFanfare();
        const m = meterRef.current;
        if (!reduced) m?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.3 }, { transform: 'scale(.98)', offset: 0.65 }, { transform: 'scale(1)' }], { duration: 620, easing: 'ease-out' });
        if (f && m && !lite) { const p = f.point(m); f.sparkle(p.x, p.y, p.w * 0.5, 14); f.ring(p.x, p.y, p.h * 1.3, '#ffe09a', 0.55); }
        setAnnounce(t('announce.totalWin', { amount: format.demo(centsFor(betCents, event.totalHundredths)), times: money(event.totalHundredths) }));
        break;
      }
      case 'free-outro':
        setCard({ kind: 'outro', spins: event.spins, total: event.totalHundredths, multipliers: event.multipliers, celebration: event.celebration, capped: event.capped, bet: betCents, at: event.at, dur: event.dur });
        sound.featureOutro(); sound.scene('base');
        if (f && !lite) f.confetti(1);
        setAnnounce(t('announce.freeOutro', { amount: format.demo(centsFor(betCents, event.totalHundredths)), spins: event.spins }));
        break;
      case 'big-win':
        openCelebration(event.schedule, betCents, event.at, event.dur, reduced, lite);
        break;
      case 'end':
        setCard(null); setBanner(null); setBadge(null);
        fx.current?.stopRain();
        player.current = null;
        finishRound(current);
        break;
    }
  }, [centre, finishRound, openCelebration, showCallout, sound, t, format, money, names]);

  /* ---------------------------------------------------------------- starting rounds */
  const begin = useCallback((current: LiveRound, text: string) => {
    live.current = current;
    setError(''); setPhase('playing'); setRoundBet(current.bet);
    setFree(false); setFreeInfo(null); setMeterDur(0); setMeter(ZERO); setBadge(null); setCard(null); setBanner(null); setCallout(null); setFlourish(0);
    setAnnounce(text);
    fx.current?.clear();
    sound.unlock();
    sound.scene('base');
    sound.spinStart();
    const next = new TimelinePlayer(current.timeline, (event, info) => { if (live.current === current) handle(event, info); });
    player.current = next;
    next.start();
  }, [handle, sound]);

  const gated = mode === 'live';
  const busy = phase === 'playing';
  const booting = boot.phase !== 'done';

  /** Remote round: the server resolves and settles it; the spin stays locked until its round has been presented. */
  const startRemote = useCallback((source: RemoteRoundSource, roundMode: CascadeMode, cost: number, balanceBefore: number) => {
    const betCents = bet;
    pendingRemote.current = true;
    setError(''); setPhase('playing'); setActiveDemo(true); setReplaying(null);
    setRemoteBalance(balanceBefore - cost);
    setAnnounce(t('announce.sent', { amount: format.demo(cost) }));
    source.client.play('cascade', betCents, roundMode).then(play => {
      pendingRemote.current = false;
      const s = settingsRef.current;
      const current: LiveRound = {
        id: `remote:${play.receipt.roundId}`, replayOf: null, bet: betCents, cost: play.receipt.costCents, mode: roundMode, balanceBefore, round: play.round,
        timeline: buildCascadeTimeline(play.round, cascadeTimelineOptions(s, reducedMotion)), prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects,
        settled: false, startedAt: performance.now(), remote: { receipt: play.receipt, balanceAfter: play.receipt.balanceCents },
      };
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
  }, [bet, begin, reducedMotion, setActiveDemo, sound, stopAutoplay, t, format]);

  /** Real round (standard/ante spin or a confirmed buy). Returns false when nothing started. */
  const startRound = useCallback((kind: 'spin' | 'buy'): boolean => {
    if ((live.current && !live.current.settled) || pendingRemote.current || gated || booting || sourcePending) return false;
    const roundMode: CascadeMode = kind === 'buy' ? 'buy' : ante ? 'ante' : 'standard';
    if (kind === 'buy' && ante) return false;
    const cost = cascadeCost(bet, roundMode);
    const balanceBefore = balanceRef.current;
    if (cost > balanceBefore) {
      setError(t(roundMode === 'buy' ? 'error.insufficientBuy' : 'error.insufficientSpin', { cost: format.demo(cost) }));
      sound.denied();
      return false;
    }
    if (remote) { startRemote(remote, roundMode, cost, balanceBefore); return true; }
    let round: Cascade2Round;
    try {
      round = localRoundSource.resolve('cascade', bet, roundMode);
    } catch { setError(t('error.entropy')); return false; }
    let id: string | null;
    try { id = reserveDemo(cost, cascadeLedgerLimits(bet, roundMode)); } catch { setError(t('error.entropy')); return false; }
    if (!id) { setError(t('error.noCredit')); sound.denied(); return false; }
    setActiveDemo(true);
    const s = settingsRef.current;
    const lite = reducedMotion || s.reducedEffects;
    const timeline = buildCascadeTimeline(round, cascadeTimelineOptions(s, reducedMotion));
    const current: LiveRound = { id, replayOf: null, bet, cost, mode: roundMode, balanceBefore, round, timeline, prefix: `r${++sequence.current}`, reduced: reducedMotion, lite, settled: false, startedAt: performance.now(), remote: null };
    setReplaying(null);
    begin(current, t(roundMode === 'buy' ? 'announce.buyStarted' : 'announce.spinStarted', { amount: format.demo(cost) }));
    return true;
  }, [ante, bet, begin, booting, gated, reducedMotion, reserveDemo, setActiveDemo, sound, remote, sourcePending, startRemote, t, format]);

  // Reload recovery (remote): the last server round of this game that this tab did not finish showing is shown again,
  // exactly as resolved. Nothing is debited or credited here; the server settled it when it was accepted.
  const recoveredOnce = useRef(false);
  useEffect(() => {
    if (sourceView.status !== 'remote' || !sourceView.recovered || recoveredOnce.current || booting || live.current || pendingRemote.current) return;
    recoveredOnce.current = true;
    const { receipt, round } = sourceView.recovered;
    const after = sourceView.recoveredBalanceCents ?? receipt.balanceCents, s = settingsRef.current;
    const current: LiveRound = {
      id: `remote:${receipt.roundId}`, replayOf: null, bet: receipt.betCents, cost: receipt.costCents, mode: receipt.mode, balanceBefore: after + receipt.costCents - receipt.payoutCents, round,
      timeline: buildCascadeTimeline(round, cascadeTimelineOptions(s, reducedMotion)), prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects,
      settled: false, startedAt: performance.now(), remote: { receipt, balanceAfter: after },
    };
    setActiveDemo(true);
    setRemoteBalance(current.balanceBefore - current.cost);
    begin(current, t('announce.recovered', { amount: format.demo(receipt.payoutCents) }));
  }, [sourceView, booting, begin, reducedMotion, setActiveDemo, t, format]);

  /** Remote only: publish the signed replay of a server round and hand out its link. */
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
    const meta = record.cascade;
    if (!meta || (live.current && !live.current.settled) || autoRef.current || booting) return;
    let round: Cascade2Round;
    try { round = playCascade2Round(meta.seedHex, meta.betCents, meta.mode); } catch { showToast(t('toast.replayFailed'), 'warn'); return; }
    if (round.payoutCents !== record.payout || round.costCents !== meta.costCents) { showToast(t('toast.replayMismatch'), 'warn'); return; }
    const s = settingsRef.current;
    const timeline = buildCascadeTimeline(round, cascadeTimelineOptions(s, reducedMotion));
    const current: LiveRound = { id: null, replayOf: record.id, bet: meta.betCents, cost: meta.costCents, mode: meta.mode, balanceBefore: balanceRef.current, round, timeline, prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects, settled: false, startedAt: performance.now(), remote: null };
    setReplaying({ recordId: record.id, seed: meta.seedHex });
    stageRef.current?.scrollIntoView({ block: 'start' });
    begin(current, t('announce.replaying', { id: shortRoundId(meta.seedHex) }));
  }, [begin, booting, reducedMotion, showToast, t]);

  /**
   * Tap on a hold screen (free-spin intro/total, celebration): the first tap on a celebration finishes the
   * count-up (the counter reads the player clock), the next one closes it. Never touches a result.
   */
  const advanceHold = useCallback(() => {
    const p = player.current; if (!p) return;
    const hold = p.currentHold(); if (!hold) return;
    if (hold.type === 'big-win' && p.time < hold.at + hold.countUp - 1) { p.jumpTo(hold.at + hold.countUp); return; }
    p.jumpTo(hold.at + hold.dur);
  }, []);
  /** Clock of the screen on display, in ms since it opened (the counters read it every frame). */
  const cardAt = card?.at ?? null;
  const cardElapsed = useCallback(() => {
    const p = player.current;
    return p && cardAt !== null ? p.time - cardAt : Number.POSITIVE_INFINITY;
  }, [cardAt]);

  // Multiplier callouts clear themselves after their animation.
  useEffect(() => {
    if (!callout) return;
    const timer = window.setTimeout(() => setCallout(c => (c?.key === callout.key ? null : c)), 1900 + callout.tier * 150);
    return () => window.clearTimeout(timer);
  }, [callout]);

  /* Development-only preview of the celebration screens and multiplier callouts (visual QA). It never builds a
     round, reserves or settles anything; production builds drop it (NODE_ENV is inlined). */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as { __cascadePreview?: unknown };
    w.__cascadePreview = {
      celebrate: (totalHundredths: number, capped = false, betCents = 1000) => {
        if ((live.current && !live.current.settled) || player.current) return false;
        const s = settingsRef.current, opts = cascadeTimelineOptions(s, reducedMotion);
        const schedule = countUpSchedule(totalHundredths, capped, opts);
        const dur = schedule.countUp + schedule.hold;
        const timeline: CascadeTimeline = {
          events: [
            { type: 'big-win', at: 0, dur, tier: schedule.finalLevel, totalHundredths, capped, countUp: schedule.countUp, schedule, hold: true },
            { type: 'end', at: dur, dur: 0, totalHundredths, payoutCents: centsFor(betCents, totalHundredths), capped },
          ],
          duration: dur, turbo: opts.speed === 'turbo', speed: opts.speed, skipScreens: !!opts.skipScreens, reducedMotion,
        };
        const preview = new TimelinePlayer(timeline, event => {
          if (event.type === 'big-win') openCelebration(event.schedule, betCents, event.at, event.dur, reducedMotion, reducedMotion || s.reducedEffects);
          else if (event.type === 'end') { setCard(null); fx.current?.stopRain(); sound.countUp(false); player.current = null; }
        });
        player.current = preview;
        preview.start();
        return true;
      },
      callout: (sum: number) => { showCallout(sum, reducedMotion, reducedMotion || settingsRef.current.reducedEffects); return true; },
    };
    return () => { delete w.__cascadePreview; };
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
    const gap = CASCADE_AUTOPLAY_GAP[settingsRef.current.spinSpeed];
    const timer = window.setTimeout(() => {
      const state = autoRef.current; if (!state) return;
      const decision = autoplayBeforeSpin(state, { balanceCents: balanceRef.current, betCents: bet, ante, tabHidden: document.hidden });
      if (!decision.continue) { stopAutoplay(decision.code, decision.code === 'completed' ? 'info' : 'warn'); return; }
      if (!startRef.current('spin')) stopAutoplay('spin-failed');
    }, phase === 'idle' ? 0 : gap);
    return () => window.clearTimeout(timer);
  }, [auto, phase, modal, realityDue, booting, gated, bet, ante, stopAutoplay]);

  // Autoplay never runs in a hidden tab.
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
  const roundMode: CascadeMode = ante ? 'ante' : 'standard';
  const spinCost = cascadeCost(bet, roundMode);
  const buyPrice = cascadeCost(bet, 'buy');
  const block = buyBlock({ betCents: bet, balanceCents: balance, ante, autoplay: auto !== null, busy, gated });
  const buyReason = block ? (block.code === 'balance' ? t('buyBlock.balance', { price: format.demo(block.priceCents) }) : t(`buyBlock.${block.code}`)) : null;
  const rtpOf = (ratio: number) => percentOf(format.intl, ratio);
  const locked = busy || auto !== null || gated || booting || sourcePending;
  const amountCents = (h: number) => (roundBet === null ? 0 : centsFor(roundBet, h));
  const boardLabel = t(free ? 'board.labelFree' : 'board.label');
  const boardElement = useMemo(() => <BoardFrame><CascadeBoard ref={board} label={boardLabel} free={free} /></BoardFrame>, [boardLabel, free]);
  const stageClass = [styles.stage, free ? styles.stageFree : '', card ? styles.stageCard : ''].join(' ');
  const celebrating = card?.kind === 'big' || card?.kind === 'outro';
  const infoPages = useMemo(() => cascadeInfoPages(bet, { t, tc, tk, format, symbol: names.label }), [bet, t, tc, tk, format, names]);
  const outOfCredit = !busy && balance < CASCADE_MIN_BET_CENTS;
  const deckWin = busy ? amountCents(meter.total) : (lastWin?.payout ?? 0);
  const speedIndex = SPIN_SPEEDS.indexOf(settings.spinSpeed);
  const replayInfo = replaying ? t('replay.ribbon', { id: shortRoundId(replaying.seed) }) : null;

  const openInfo = (page = 'how') => { setInfoPage(page); setModal('info'); sound.click(); };
  const refill = () => {
    if (busy || auto) return;
    if (remote) {
      if (pendingRemote.current) return;
      remote.client.resetBalance().then(cents => {
        setRemoteBalance(cents);
        const at = Date.now();
        recordRemote({ id: `remote-reset:${at}`, game: 'Cascade', stake: 0, payout: 0, detail: 'Bakiye yenilendi (sunucu)', at, kind: 'reset' });
        const amount = format.demo(DEMO_START_CENTS, { trimZeros: true });
        showToast(t('toast.refilled', { amount })); setError(''); setAnnounce(t('announce.refilledRemote', { amount }));
      }, (failure: unknown) => showToast(rgsErrorMessage(failure), 'warn'));
      return;
    }
    if (resetDemoBalance('Cascade')) { const amount = format.demo(DEMO_START_CENTS, { trimZeros: true }); showToast(t('toast.refilled', { amount })); setError(''); setAnnounce(t('announce.refilled', { amount })); }
  };
  const toggleSound = () => {
    const muted = !settings.muted;
    updateSettings({ muted });
    if (!muted) sound.unlock();
  };
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
    const text = next ? t('announce.anteOn', { cost: format.demo(cascadeCost(bet, 'ante')) }) : t('announce.anteOff', { cost: format.demo(bet) });
    setAnnounce(text);
  };
  const onSpinClick = () => {
    if (busy) return; // locked until the whole round has played
    startRound('spin');
  };
  const confirmBuy = () => {
    if (buyReason) return;
    setModal(null);
    startRound('buy');
  };

  const deck = (
    <BetSelector
      ladder={CASCADE_BET_LADDER}
      valueCents={bet}
      onChange={chooseBet}
      balanceCents={balance}
      maxBetCents={CASCADE_MAX_BET_CENTS}
      costMode={CASCADE_COST_MODES[roundMode]}
      modeLabel={ante ? tc('modes.ante') : undefined}
      disabled={locked}
      classNames={{ minus: styles.stepBtn, plus: styles.stepBtn, value: styles.betValue, max: styles.maxChip }}
      render={parts => (
        <div className={`${kit.kit} ${styles.deck}`} data-auto={auto ? '' : undefined} role="group" aria-label={t('deck.aria')}>
          <div className={styles.cellBalance}>
            <span className={styles.cellLabel}>{t('deck.balance')}</span>
            <strong className={styles.cellValue} data-testid="cascade-balance">{money(balance)}<small> DEMO</small></strong>
            <button type="button" className={styles.refill} onClick={refill} disabled={busy || auto !== null || gated}><RefillIcon /><span>{t('deck.refill')}</span></button>
          </div>
          <div className={styles.cellBet}>
            {parts.label}
            {parts.value}
            <span className={styles.costLine} data-testid="cascade-cost">{tk('bet.cost')} <strong>{money(spinCost)} DEMO</strong>{ante && <em> · {format.factor(CASCADE_COST_MODES.ante.num, CASCADE_COST_MODES.ante.den)}</em>}</span>
          </div>
          <div className={styles.cellWin}>
            <span className={styles.cellLabel}>{busy ? (replaying ? t('deck.replay') : t('deck.win')) : lastWin?.replay ? t('deck.replayWin') : t('deck.lastWin')}</span>
            <strong className={`${styles.cellValue} ${deckWin > 0 ? styles.cellWinOn : ''}`}>{money(deckWin)}<small> DEMO</small></strong>
          </div>
          <div className={styles.areaMinus}>{parts.minus}</div>
          <div className={styles.areaPlus}>{parts.plus}</div>
          <div className={styles.areaMax}>{parts.max}</div>
          <div className={styles.areaSpin}>
            {auto ? (
              <AutoplayStopButton className={styles.stop} remaining={auto.spinsRemaining} onStop={() => stopAutoplay('cancelled', 'info')} />
            ) : (
              <button type="button" className={`${styles.spin} ${busy ? styles.spinning : ''}`} onClick={onSpinClick} disabled={busy || gated || booting || sourcePending}
                aria-label={t('deck.spin')} aria-describedby="cc-spin-cost" data-locked={busy || undefined} data-testid="cascade-spin">
                <span className={styles.spinFace}><SwirlIcon /></span>
                {busy && <span className={styles.spinLock} aria-hidden="true"><LockIcon /></span>}
              </button>
            )}
            <span id="cc-spin-cost" className="sr-only">{busy ? t('deck.spinLocked') : `${tk('bet.cost')} ${format.demo(spinCost)}`}</span>
          </div>
          <button type="button" className={`${styles.tool} ${styles.areaAuto}`} onClick={() => { sound.click(); setModal('autoplay'); }} disabled={locked} aria-haspopup="dialog">
            <LoopIcon /><span>{t('deck.auto')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaInfo}`} onClick={() => openInfo()} aria-haspopup="dialog" aria-label={tk('info.title')}>
            <InfoIcon /><span>{t('deck.info')}</span>
          </button>
          <button type="button" role="switch" aria-checked={ante} className={`${styles.feature} ${styles.areaAnte} ${ante ? styles.featureOn : ''}`} onClick={toggleAnte} disabled={locked}
            aria-label={tc('modes.ante')} aria-describedby="cc-ante-desc">
            <span className={styles.featureTitle}>{tc('modes.ante')}</span>
            <span className={styles.featureState}>{ante ? t('deck.on') : t('deck.off')}<span className={styles.featureFactor}> · {format.factor(CASCADE_COST_MODES.ante.num, CASCADE_COST_MODES.ante.den)}</span></span>
            <span id="cc-ante-desc" className={styles.featureDesc}>{t('deck.anteDesc')}</span>
          </button>
          <button type="button" className={`${styles.feature} ${styles.featureBuy} ${styles.areaBuy}`} aria-disabled={buyReason ? true : undefined}
            onClick={() => { if (buyReason) sound.denied(); else sound.click(); setModal('buy'); }} aria-haspopup="dialog" aria-describedby="cc-buy-desc">
            <span className={styles.featureTitle}>{tk('buy.title')}</span>
            <span className={styles.featureState}>{format.amount(buyPrice, { trimZeros: true })} DEMO</span>
            <span id="cc-buy-desc" className={styles.featureDesc}>{buyReason ?? t('deck.buyDesc', { spins: CASCADE_FREE_SPINS_TRIGGER, rtp: rtpOf(CASCADE2_RTP.buy.rtp) })}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSet}`} onClick={() => { sound.click(); setModal('settings'); }} aria-haspopup="dialog" aria-label={tk('settings.title')}>
            <GearIcon /><span>{tk('settings.title')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSpeed} ${speedIndex > 0 ? styles.toolOn : ''}`} onClick={cycleSpeed}
            aria-label={t('deck.speed', { speed: tk(SPEED_KEYS[settings.spinSpeed]) })}>
            <BoltIcons count={speedIndex + 1} /><span>{tk(SPEED_KEYS[settings.spinSpeed])}</span>
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
      <GameHeading title={gameTitle} subtitle={t('subtitle')} mode={mode} setMode={setMode} active={busy || auto !== null}
        badge={remote ? tk('rgs.source.remote') : sourcePending ? t('badge.checking') : tk('rgs.source.local')} />
      <section ref={tableRef} className={`game-table ${styles.table}`} aria-label={t('table.aria')}>
        <div ref={stageRef} className={stageClass} data-phase={phase} data-celebrate={celebrating || undefined}>
          <StaticBackdrop />
          <div className={styles.freeTint} aria-hidden="true" />
          <div ref={shakeRef} className={styles.shake}>
            <div className={styles.hud}>
              {freeInfo ? (
                <div className={styles.freeCounter} aria-label={t('free.counterAria', { number: freeInfo.number, left: freeInfo.left })}>
                  <span className={styles.freeTag}><span className={styles.tagLong}>{freeInfo.number > 0 ? t('free.longN', { n: freeInfo.number }) : t('free.long')}</span><span className={styles.tagShort}>{freeInfo.number > 0 ? t('free.shortN', { n: freeInfo.number }) : t('free.short')}</span></span>
                  <span className={styles.freeLeft}><small>{t('free.left')}</small><strong key={freeInfo.left}>{freeInfo.left}</strong></span>
                </div>
              ) : (
                <div className={styles.logo} aria-hidden="true"><span>Candy</span><span>Cascade</span></div>
              )}
              <div ref={badgeRef} className={`${styles.badge} ${badge ? styles.badgeOn : ''} ${badge?.sum ? styles.badgeSum : ''}`} aria-hidden={badge ? undefined : true}>
                <small>{t('mult.label')}</small>
                <strong>{badge ? (badge.parts.length ? badge.parts.map(v => `×${v}`).join(' + ') : '×…') : '×'}{badge?.sum && badge.parts.length > 1 ? ` = ×${badge.sum}` : ''}</strong>
              </div>
            </div>
            <div className={styles.boardWrap}>{boardElement}</div>
            {/* One cumulative meter: it never resets inside a round (tumbles, multipliers, every free spin add up)
                and keeps the last round's total until the next spin starts. */}
            <div ref={meterRef} className={`${styles.meter} ${free ? styles.meterFree : ''}`} data-testid="cascade-meter">
              {phase === 'idle' ? (
                <div className={styles.meterIdle}><span>{t.rich('meter.idleA', { b: chunk => <strong key={chunk}>{chunk}</strong> })}</span><span aria-hidden="true">·</span><span>{t.rich('meter.idleB', { b: chunk => <strong key={chunk}>{chunk}</strong> })}</span></div>
              ) : (
                <div className={`${styles.meterPart} ${free ? styles.meterTotal : ''}`}>
                  <small>{free || phase === 'done' ? t('meter.totalWin') : t('meter.win')}</small>
                  <strong data-testid="cascade-meter-total"><CountUp cents={amountCents(meter.total)} duration={meterDur} format={money} /><em> DEMO</em></strong>
                </div>
              )}
              {flourish > 0 && phase !== 'idle' && <span key={flourish} className={styles.meterShine} aria-hidden="true" />}
            </div>
          </div>
          <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />
          <div ref={layerRef} className={styles.fxLayer} aria-hidden="true" />
          {replayInfo && <div className={styles.replayRibbon} data-testid="cascade-replay"><Icon name="history" size={15} /><span>{replayInfo}</span></div>}
          {auto && !replayInfo && <div className={styles.autoRibbon} aria-hidden="true"><LoopIcon /><span>{t('auto.ribbon', { n: auto.spinsRemaining })}</span></div>}
          {toast && (
            <div key={`toast-${toast.key}`} className={`${styles.toast} ${toast.tone === 'warn' ? styles.toastWarn : ''}`} data-testid="cascade-toast">
              <span>{toast.text}</span>
              <button type="button" className={styles.toastClose} onClick={() => setToast(null)} aria-label={t('toast.close')}><svg {...svg} width={16} height={16}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
            </div>
          )}
          {banner && <div key={`banner-${banner.key}`} className={`${styles.banner} ${banner.tone === 'pink' ? styles.bannerPink : ''}`} aria-hidden="true">{banner.text}</div>}
          {card?.kind === 'intro' && (
            <div className={styles.overlay} onClick={advanceHold}>
              <div className={styles.introCard} role="dialog" aria-modal="false" aria-labelledby="cc-intro-title">
                <div className={styles.introStars} aria-hidden="true">
                  <SymbolArt symbol="star" size="100%" /><SymbolArt symbol="star" size="100%" /><SymbolArt symbol="star" size="100%" />
                </div>
                <h2 id="cc-intro-title" className={styles.introTitle}>{t('intro.title')}</h2>
                <p className={styles.introCount}><strong>{card.awarded}</strong><span>{t('intro.count')}</span></p>
                <p className={styles.introText}>{t('intro.text')}</p>
                <button type="button" className={styles.introButton} onClick={event => { event.stopPropagation(); advanceHold(); }}>{t('intro.start')}</button>
                <span className={styles.introTimer} style={{ '--hold': `${card.dur}ms` } as CSSProperties} aria-hidden="true" />
              </div>
            </div>
          )}
          {callout && (
            <div key={`callout-${callout.key}`} className={styles.callout} data-tier={callout.tier} style={{ left: `${callout.x}px`, top: `${callout.y}px` }} aria-hidden="true" data-testid="cascade-callout" data-key={callout.key}>
              <span className={styles.calloutGlow} />
              {callout.tier >= 1 && <span className={styles.calloutTag}>{t(`callout.tags.${callout.tier}`)}</span>}
              <span className={styles.calloutText} data-text={`×${callout.sum}`}><span className={styles.calloutFill}>×{callout.sum}</span></span>
            </div>
          )}
          {card?.kind === 'outro' && (
            <FeatureTotal key={`outro-${card.at}`} spins={card.spins} totalHundredths={card.total} multipliers={card.multipliers} betCents={card.bet} celebration={card.celebration}
              capped={card.capped} dur={card.dur} elapsed={cardElapsed} reducedMotion={reducedMotion} onTap={advanceHold} />
          )}
          {card?.kind === 'big' && (
            <WinCelebration key={`big-${card.at}`} schedule={card.schedule} betCents={card.bet} elapsed={cardElapsed} reducedMotion={reducedMotion}
              onLevel={onCelebrationLevel} onCountDone={onCelebrationCounted} onTap={advanceHold} />
          )}
          {gated && (
            <div className={`${styles.overlay} ${styles.gated}`}>
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
        {boot.phase !== 'done' && (
          <div className={styles.splash} data-testid="cascade-splash">
            <div className={styles.splashCard}>
              <div className={styles.splashLogo} aria-hidden="true"><span>Candy</span><span>Cascade</span></div>
              <ul className={styles.splashFeatures}>
                <li><span aria-hidden="true"><SymbolArt symbol="crown" size="100%" /></span><strong>{t('splash.f1Title')}</strong><small>{t('splash.f1Text')}</small></li>
                <li><span aria-hidden="true"><SymbolArt symbol="crystal" multiplier={100} size="100%" /></span><strong>{t('splash.f2Title')}</strong><small>{t('splash.f2Text')}</small></li>
                <li><span aria-hidden="true"><SymbolArt symbol="star" size="100%" /></span><strong>{t('splash.f3Title', { max: format.number(CASCADE2_MAX_WIN_MULTIPLIER, 0) })}</strong><small>{t('splash.f3Text', { spins: CASCADE_FREE_SPINS_TRIGGER })}</small></li>
              </ul>
              {boot.phase === 'loading' ? (
                <div className={styles.loadBar} role="progressbar" aria-label={t('splash.loading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(boot.progress * 100)}>
                  <span style={{ transform: `scaleX(${boot.progress})` }} />
                </div>
              ) : (
                <div className={styles.splashActions}>
                  <button type="button" className={styles.introButton} autoFocus onClick={() => { sound.unlock(); sound.click(); setBoot(b => ({ ...b, phase: 'done' })); }}>{t('splash.play')}</button>
                  <button type="button" className={styles.splashSkip} onClick={() => { updateSettings({ introScreen: false }); setBoot(b => ({ ...b, phase: 'done' })); }}>{t('splash.skip')}</button>
                </div>
              )}
              <p className={styles.splashNote}>{t('splash.note', { rtp: rtpOf(CASCADE2_RTP.standard.rtp) })}</p>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <SessionBar className={styles.sessionBar} nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <GameInfoStrip id="cascade" />
      <CascadeHistory onReplay={replay} replayDisabled={busy || auto !== null || booting} replayingId={replaying?.recordId ?? null} onShare={remote ? shareRound : undefined} />
      <StaticFooter remote={remote !== null} />

      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title={tk('settings.title')} size="md">
        <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
        <p className={styles.modalNote} role="status">{soundLoad.ready ? t('settings.soundReady') : soundLoad.started ? t('settings.soundLoading', { percent: format.percent(soundLoad.percent / 100) }) : t('settings.soundOnTouch')}</p>
        <section className={styles.demoBox} aria-labelledby="cc-demo-title">
          <h3 id="cc-demo-title">{t('settings.demoTitle')}</h3>
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
        featureName={t('buy.feature', { spins: CASCADE_FREE_SPINS_TRIGGER, bet: format.demo(bet) })}
        priceCents={buyPrice}
        balanceCents={balance}
        rtpText={t('buy.rtp', { buy: rtpOf(CASCADE2_RTP.buy.rtp), standard: rtpOf(CASCADE2_RTP.standard.rtp) })}
        description={<>{t.rich('buy.description', { b: chunk => <strong key={chunk}>{chunk}</strong> }, { spins: CASCADE_FREE_SPINS_TRIGGER, bet: format.demo(bet), max: format.demo(bet * CASCADE2_MAX_WIN_MULTIPLIER) })}</>}
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
