'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { GOREME_MAX_WIN_MULTIPLIER, GOREME_RTP, GOREME_SCATTER_AWARDS, playGoremeRound, type GoremeMode, type GoremeRound, type GoremeSymbol as EngineSymbol } from '@sollish/protocol';
import { DEMO_START_CENTS } from '@/lib/demo';
import { useFormat, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { useRgsText } from '@/lib/use-rgs-text';
import { richText } from '../game-rich';
import { buildGoremeTimeline, goremeCents, goremeHistoryDetail, goremeMoney, goremeTimes, type GoremeEvent, type GoremeMeter, type GoremeMoored, type GoremeTimeline } from '@/lib/goreme-timeline';
import { WIN_TIER_INFO, countUpSchedule, type CelebrationLevel, type CountUpSchedule, type WinTier } from '@/lib/slot-kit/win-tiers';
import { TimelinePlayer } from '@/lib/slot-kit/timeline-player';
import { autoplayNetLossCents, createAutoplay, type AutoplayConfig, type AutoplayState, type AutoplayStopCode } from '@/lib/slot-kit/autoplay';
import { SPIN_SPEEDS, type SpinSpeed } from '@/lib/slot-kit/settings';
import {
  GOREME_AUTOPLAY_GAP, GOREME_BET_LADDER, GOREME_COST_MODES, GOREME_DEFAULT_BET_CENTS, GOREME_MAX_BET_CENTS, GOREME_MIN_BET_CENTS,
  goremeAutoplayAfterRound, goremeAutoplayBeforeSpin, goremeBuyBlock, goremeCost, goremeLedgerLimits, goremeRoundId, goremeRtp, goremeTimelineOptions,
} from '@/lib/goreme-controls';
import { markRoundShown, type RemoteReceipt, type RemoteRoundSource } from '@/lib/rgs-client';
import { GOREME_ENGINE } from '@/lib/slot-engines/goreme';
import { localSourceFor, useRoundSource } from '@/lib/use-round-source';
import { useGoremeSound } from '@/lib/slot-audio/use-goreme-sound';
import { useProduct, type DemoRecord } from '../providers';
import { DemoNotice, GameHeading, type Mode } from '../game-common';
import { Icon } from '../icons';
import {
  AutoplayPanel, AutoplayStopButton, BetSelector, BuyFeatureDialog, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, useSession, useSlotSettings,
} from '../slot-kit';
import kit from '../slot-kit/kit.module.css';
import { GoremeBoard, type GoremeBoardHandle } from './board';
import { GoremeCelebration, GoremeFeatureTotal, GoremeFreeIntro } from './goreme-celebration';
import { GoremeHistory } from './goreme-history';
import { goremeInfoPages } from './goreme-info-pages';
import { GoremeFrame, GOREME_FRAME_INSET } from './frame';
import { GoremeFx, goremePointOf } from './fx';
import { GoremeLogo } from './logo';
import { GoremeScene, type GoremeMood, type GoremeSceneHandle } from './scene';
import { GoremeSkyBand } from './sky-band';
import { GR_PALETTE, GoremeSymbol, GoremeSymbolSprites, useGoremeSymbolLabels } from './symbols-i18n';
import styles from './goreme-game.module.css';

/* Lifecycle: entropy -> engine goreme-balloons-1 resolves the whole round (bet + mode) -> one reservation of the mode cost
   -> the timeline replays it -> exactly one settlement with the engine payout (at the end, or on unmount).
   Spin lock (game-standards §6): once a round starts the spin button and Space stay locked until the whole round — every
   lift, respin and free spin — has played; there is no skip. Speed comes from the quick/turbo setting; only the hold
   screens may be tapped (that moves the presentation clock, never a result). A history replay uses the same engine call
   and never touches the ledger.
   Remote (RGS) mode, lib/rgs-client.ts: the server resolves AND settles the round before the browser sees it; the game
   presents the returned round, records it in the history and shows the server balance. It never reserves or settles
   locally; a reload re-presents the last unseen server round.
   The board, the canvas FX, the sky band and the sound are all driven from the same timeline event. */

type LiveRound = {
  id: string | null; replayOf: string | null;
  bet: number; cost: number; mode: GoremeMode; balanceBefore: number;
  round: GoremeRound; timeline: GoremeTimeline; prefix: string; reduced: boolean; lite: boolean; settled: boolean;
  remote: { receipt: RemoteReceipt; balanceAfter: number } | null;
};
type Phase = 'idle' | 'playing' | 'done';
type Card =
  | { kind: 'intro'; awarded: number; at: number; dur: number }
  | { kind: 'outro'; spins: number; total: number; sky: number; moored: number; celebration: boolean; capped: boolean; bet: number; at: number; dur: number }
  | { kind: 'big'; schedule: CountUpSchedule; bet: number; at: number; dur: number };
type Callout = { key: number; value: number; tier: WinTier; source: 'ways' | 'sky'; life: number };
type Banner = { key: number; text: string; tone: 'gold' | 'rose' | 'sky' };
type Toast = { key: number; text: string; tone: 'info' | 'warn' };
type ModalId = 'settings' | 'info' | 'autoplay' | 'buy' | null;
type Boot = { phase: 'loading' | 'ready' | 'done'; progress: number };

const CALLOUT_KEY = { 0: 'callout.tier1', 1: 'callout.tier1', 2: 'callout.tier2', 3: 'callout.tier3', 4: 'callout.tier4' } as const satisfies Record<WinTier, string>;
const SPEED_KEY = { normal: 'settings.speedNormal', quick: 'settings.speedQuick', turbo: 'settings.speedTurbo' } as const satisfies Record<SpinSpeed, string>;
const WIND_KEY = { left: 'wind.left', calm: 'wind.calm', right: 'wind.right' } as const;
type StopCode = AutoplayStopCode | 'server-failed' | 'spin-failed' | 'quit';
const ZERO: GoremeMeter = { spin: 0, total: 0 };
const BET_KEY = 'sollish:goreme:bet';
/** The local DEMO source over goreme's engine only (lib/slot-engines/goreme.ts). */
const localRoundSource = localSourceFor(GOREME_ENGINE);
const PHONE_QUERY = '(max-width: 760px), (max-aspect-ratio: 4 / 5)';
/** Largest clock step per frame: board and FX run on the wall clock, so the timeline keeps near wall-clock pace. */
const GOREME_PLAYER_MAX_STEP_MS = 250;
let bootedOnce = false;

function useMedia(media: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(media);
    const update = () => setMatch(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [media]);
  return match;
}
function realityIntervalOverride(): number | undefined {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return undefined;
  const value = (window as unknown as { __goremeRealityMs?: unknown }).__goremeRealityMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? value : undefined;
}

/** Count-up number that writes its own text node (no React re-render per frame). */
function CountUp({ cents, duration, locale }: { cents: number; duration: number; locale: Locale }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(cents);
  const [initial] = useState(() => goremeMoney(cents, locale));
  useEffect(() => {
    const el = node.current; if (!el) return;
    const from = shown.current, to = cents;
    if (duration <= 0 || from === to || typeof requestAnimationFrame === 'undefined') { shown.current = to; el.textContent = goremeMoney(to, locale); return; }
    const start = performance.now(); let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      shown.current = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
      el.textContent = goremeMoney(shown.current, locale);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); shown.current = to; el.textContent = goremeMoney(to, locale); };
  }, [cents, duration, locale]);
  return <span ref={node}>{initial}</span>;
}

/* ------------------------------------------------------------------ icons (original, inline) */
const svg = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, focusable: false } as const;
/** Spin seal: a dawn disc with a rising sun behind a ridge of fairy chimneys and one balloon. */
function SpinSeal() {
  const P = GR_PALETTE;
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="grSpinSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5b4a9c" /><stop offset=".55" stopColor="#e79fa6" /><stop offset="1" stopColor="#ffdc92" /></linearGradient>
        <clipPath id="grSpinClip"><circle cx="50" cy="52" r="34" /></clipPath>
      </defs>
      <g className={styles.sealRays}>
        {Array.from({ length: 16 }, (_, i) => <rect key={i} x="49" y="3" width="2" height={i % 2 ? 6 : 10} rx="1" transform={`rotate(${i * 22.5} 50 50)`} fill={P.ink} opacity=".5" />)}
      </g>
      <circle cx="50" cy="52" r="34" fill="url(#grSpinSky)" stroke={P.ink} strokeWidth="3" />
      <g clipPath="url(#grSpinClip)">
        <circle cx="50" cy="74" r="15" fill="#fff6d0" />
        <path d="M14 90L24 66L28 62L32 66L38 80L44 70L48 66L52 70L58 84L66 64L70 60L74 64L86 90Z" fill={P.tuff.deep} stroke={P.ink} strokeWidth="1.6" />
        <path d="M22 70a6 4 0 0 1 12 0zM44 70a6 4 0 0 1 12 0zM64 64a6 4 0 0 1 12 0z" fill={P.basalt.base} />
      </g>
      <g className={styles.sealBalloon}>
        <path d="M50 24c8 0 13 5 13 12 0 6-5 10-9 13h-8c-4-3-9-7-9-13 0-7 5-12 13-12z" fill={P.madder.base} stroke={P.ink} strokeWidth="1.8" />
        <path d="M38 34h24" stroke={P.saffron.light} strokeWidth="2.4" />
        <rect x="46" y="51" width="8" height="5" rx="1.2" fill={P.basalt.light} stroke={P.ink} strokeWidth="1.4" />
      </g>
    </svg>
  );
}
function SpeedPips({ count }: { count: number }) {
  return (
    <span className={styles.pips} aria-hidden="true">
      {[0, 1, 2].map(i => <svg key={i} {...svg} width={12} height={12} viewBox="0 0 12 12" data-on={i < count || undefined}><path d="M6 1L11 6L6 11L1 6Z" fill="currentColor" /></svg>)}
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
function WindArrow({ dir }: { dir: 'left' | 'calm' | 'right' }) {
  return <svg {...svg} width={22} height={22}>{dir === 'calm' ? <path d="M4 9h11M4 15h8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /> : <path d={dir === 'right' ? 'M3 8h12l-3-3M3 12h15M3 16h10l-3 3' : 'M21 8H9l3-3M21 12H6M21 16H11l3 3'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}</svg>;
}

const StaticFooter = memo(function StaticFooter({ remote }: { remote: boolean }) {
  const t = useT('goreme');
  const tc = useT('common');
  return (
    <>
      <DemoNotice remote={remote} />
      <details className="rules"><summary><Icon name="shield" size={17} /><span>{tc('game.rulesSummary')}</span><Icon name="chevron" size={16} /></summary>
        <div><p>{t('rules.board')}</p><p>{t('rules.features')}</p><p>{t('rules.fixed')}</p><p>{tc('game.rulesAccess')}</p></div>
      </details>
    </>
  );
});

export function GoremeGame() {
  const { reserveDemo, settleDemo, recordRemote, setActiveDemo, demoBalance, resetDemoBalance } = useProduct();
  const router = useRouter();
  const t = useT('goreme');
  const tk = useT('slotKit');
  const tc = useT('common');
  const format = useFormat();
  const rgs = useRgsText();
  const loc = format.locale;
  const symbolLabels = useGoremeSymbolLabels();
  const { settings, update: updateSettings, reset: resetSettings } = useSlotSettings('goreme');
  const [realityMs] = useState(realityIntervalOverride);
  const session = useSession(realityMs ? { realityIntervalMs: realityMs } : {});
  const recordSession = session.recordRound;
  const { sound, loadState: soundLoad } = useGoremeSound(settings);
  const [mode, setMode] = useState<Mode>('demo');
  const [bet, setBet] = useState(GOREME_DEFAULT_BET_CENTS);
  const [ante, setAnte] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [free, setFree] = useState(false);
  const [freeInfo, setFreeInfo] = useState<{ number: number; left: number } | null>(null);
  const [sky, setSky] = useState(1);
  const [moored, setMoored] = useState<GoremeMoored[]>([]);
  const [meter, setMeter] = useState<GoremeMeter>(ZERO);
  const [meterDur, setMeterDur] = useState(0);
  const [roundBet, setRoundBet] = useState<number | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [wind, setWind] = useState<{ key: number; dir: 'left' | 'calm' | 'right' } | null>(null);
  const [flourish, setFlourish] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [announce, setAnnounce] = useState('');
  const [lastWin, setLastWin] = useState<{ payout: number; total: number; replay: boolean } | null>(null);
  const [auto, setAuto] = useState<AutoplayState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [modal, setModal] = useState<ModalId>(null);
  const [infoPage, setInfoPage] = useState('how');
  const [replaying, setReplaying] = useState<{ recordId: string | null; seed: string } | null>(null);
  const [boot, setBoot] = useState<Boot>(() => ({ phase: bootedOnce ? 'done' : 'loading', progress: 0 }));
  const [mood, setMood] = useState<GoremeMood>('base');
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const phone = useMedia(PHONE_QUERY);
  const sourceView = useRoundSource(GOREME_ENGINE);
  const remote: RemoteRoundSource | null = sourceView.status === 'remote' ? sourceView.source : null;
  const sourcePending = sourceView.status === 'pending';
  const [remoteBalance, setRemoteBalance] = useState<number | null>(null);
  useEffect(() => { if (sourceView.status === 'remote') setRemoteBalance(sourceView.balanceCents); }, [sourceView]);
  const balance = remote ? (remoteBalance ?? 0) : demoBalance;
  const pendingRemote = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const scene = useRef<GoremeSceneHandle>(null);
  const board = useRef<GoremeBoardHandle>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const fx = useRef<GoremeFx | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const player = useRef<TimelinePlayer<GoremeEvent> | null>(null);
  const live = useRef<LiveRound | null>(null);
  const settledIds = useRef(new Set<string>());
  const sequence = useRef(0);
  const keys = useRef({ banner: 0, toast: 0, callout: 0, wind: 0 });
  const timers = useRef(new Set<number>());
  const celebrateFx = useRef({ reduced: false, lite: false });
  const balloonAt = useRef(new Map<number, [number, number]>());
  const autoRef = useRef<AutoplayState | null>(null);
  autoRef.current = auto;
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, Math.max(0, ms));
    timers.current.add(id);
  }, []);
  const clearTimers = useCallback(() => { for (const id of timers.current) window.clearTimeout(id); timers.current.clear(); }, []);

  /* ---------------------------------------------------------------- setup */
  useEffect(() => {
    const root = layoutRef.current, canvas = canvasRef.current;
    if (!root || !canvas) return;
    const f = new GoremeFx({ root, canvas });
    fx.current = f;
    return () => { f.destroy(); fx.current = null; };
  }, []);
  useEffect(() => { fx.current?.setReducedMotion(reducedMotion || settings.reducedEffects); }, [reducedMotion, settings.reducedEffects]);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(BET_KEY));
      if (GOREME_BET_LADDER.includes(stored)) setBet(stored);
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

  const showToast = useCallback((text: string, tone: Toast['tone'] = 'info') => setToast({ key: ++keys.current.toast, text, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(x => (x?.key === toast.key ? null : x)), toast.tone === 'warn' ? 7000 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* ---------------------------------------------------------------- settlement */
  const settle = useCallback((current: LiveRound) => {
    if (current.id === null) { current.settled = true; return; }
    if (current.settled || settledIds.current.has(current.id)) return;
    current.settled = true; settledIds.current.add(current.id);
    const { round } = current;
    const record: DemoRecord = {
      id: current.id, game: 'Göreme', stake: current.cost, payout: round.payoutCents, detail: goremeHistoryDetail(round), at: Date.now(), kind: 'round',
      goreme: { engine: round.engine, seedHex: round.seedHex, betCents: current.bet, mode: current.mode, costCents: current.cost },
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
    for (const id of timers.current) window.clearTimeout(id);
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
    if (current.remote) markRoundShown('goreme', current.remote.receipt.roundId);
    setPhase('done');
    sound.countUp(false);
    setMood('base');
    const { round } = current;
    setLastWin({ payout: round.payoutCents, total: round.totalHundredths, replay: current.id === null });
    sound.scene('base');
    if (current.id === null) {
      setReplaying(null);
      setAnnounce(t('announce.replayDone', { amount: format.number(round.payoutCents / 100), times: goremeTimes(round.totalHundredths, loc) }));
      return;
    }
    const state = autoRef.current;
    if (state) {
      const next = goremeAutoplayAfterRound(state, { costCents: current.cost, payoutCents: round.payoutCents, featureTriggered: round.freeSpinsTriggered, balanceBeforeCents: current.balanceBefore });
      autoRef.current = next;
      setAuto(next);
    }
    setAnnounce(round.payoutCents > 0 ? t('announce.roundEnd', { amount: format.number(round.payoutCents / 100), times: goremeTimes(round.totalHundredths, loc) }) : t('announce.roundEndNone'));
  }, [settle, sound, t, format, loc]);

  /* ---------------------------------------------------------------- presentation helpers */
  /** Centre of cell (col, row) relative to the FX root (the layout), at height fraction fy of the cell. */
  const cellPoint = useCallback((col: number, row: number, fy = 0.5) => {
    const root = layoutRef.current, el = board.current?.element;
    if (!root || !el) return { x: 0, y: 0, cell: 60 };
    const p = goremePointOf(root, el, (col + 0.5) / 6, (row + fy) / 5);
    return { ...p, cell: el.getBoundingClientRect().width / 6 };
  }, []);
  const floatLabel = useCallback((x: number, y: number, text: string, className: string, life: number, reduced: boolean) => {
    const layer = layerRef.current, root = layoutRef.current, stage = stageRef.current; if (!layer || !root || !stage) return;
    const a = root.getBoundingClientRect(), b = stage.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = className; el.textContent = text;
    el.style.left = `${x + a.left - b.left}px`; el.style.top = `${y + a.top - b.top}px`;
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
  }, []);
  const sunRays = useCallback((intensity: number, duration = 1800) => {
    const root = layoutRef.current, sceneRoot = scene.current?.element, p = scene.current?.sunPoint();
    if (!root || !sceneRoot || !p) return;
    const a = sceneRoot.getBoundingClientRect(), b = root.getBoundingClientRect();
    void fx.current?.sunRays(p.x + a.left - b.left, p.y + a.top - b.top, { intensity, duration });
  }, []);

  const showCallout = useCallback((value: number, tier: WinTier, source: 'ways' | 'sky', reduced: boolean, life = 1500) => {
    setCallout({ key: ++keys.current.callout, value, tier, source, life });
    sound.multiplierCallout(value);
    if (!reduced) shake(tier <= 1 ? 4 : 4 + tier * 2.2, 360 + tier * 60);
  }, [shake, sound]);

  const openCelebration = useCallback((schedule: CountUpSchedule, betCents: number, at: number, dur: number, reduced: boolean, lite: boolean) => {
    celebrateFx.current = { reduced, lite };
    setCard({ kind: 'big', schedule, bet: betCents, at, dur });
    setMood('bigwin');
    sound.scene('bigwin');
    board.current?.dim(true);
    if (!lite) sunRays(Math.min(2.2, 1 + schedule.totalHundredths / 10_000), Math.min(4200, Math.max(1800, schedule.countUp)));
    setAnnounce(t('announce.celebration', { title: tk(`winTier.${WIN_TIER_INFO[schedule.finalLevel].id}.title`), amount: format.number(goremeCents(betCents, schedule.totalHundredths) / 100), times: goremeTimes(schedule.totalHundredths, loc) }));
  }, [sound, sunRays, t, tk, format, loc]);
  const onCelebrationLevel = useCallback((level: CelebrationLevel, first: boolean) => {
    const { reduced, lite } = celebrateFx.current;
    if (level === 5) sound.maxWin(); else sound.bigWin(level as 1 | 2 | 3 | 4);
    if (first) sound.countUp(true);
    if (!lite && !first) sunRays(1.2 + level * 0.25, 2400);
    if (!lite && !reduced) shake(first ? 5 : 6 + level * 2.2, first ? 380 : 540);
  }, [shake, sound, sunRays]);
  const onCelebrationCounted = useCallback(() => { sound.countUp(false); }, [sound]);

  const nameOf = useCallback((symbol: EngineSymbol) => symbolLabels[symbol], [symbolLabels]);

  /* ---------------------------------------------------------------- timeline events */
  const handle = useCallback((event: GoremeEvent) => {
    const current = live.current; if (!current) return;
    const reduced = current.reduced, lite = current.lite, b = board.current, f = lite ? null : fx.current;
    const betCents = current.bet;
    if (event.type !== 'reel-stop' && event.type !== 'balloon-land' && event.type !== 'sun-land') stageRef.current?.setAttribute('data-beat', event.type);
    switch (event.type) {
      case 'spin-start':
        setSky(event.sky);
        if (event.kind === 'free') { setFreeInfo({ number: event.freeSpinNumber, left: event.freeSpinsLeft }); setMeterDur(0); setMeter(event.meter); sound.spinStart(); }
        break;
      case 'spin':
        balloonAt.current.clear();
        for (let c = 0; c < 6; c++) for (let r = 0; r < 5; r++) { const cell = event.grid[c]![r]!; if (cell.symbol === 'balloon') balloonAt.current.set(cell.id, [c, r]); }
        b?.spin(event.grid, { stops: event.stops, dropMs: event.dropMs, teaseFrom: event.tease });
        break;
      case 'reel-stop': sound.reelStop(event.reel); break;
      case 'balloon-land': {
        sound.balloonLand(event.multiplier, event.col);
        balloonAt.current.set(event.id, [event.col, event.row]);
        const p = cellPoint(event.col, event.row, 0.4);
        floatLabel(p.x, p.y, `×${event.multiplier}`, styles.multLabel, reduced ? 700 : 1100, reduced);
        break;
      }
      case 'sun-land': sound.sunLand(event.n); break;
      case 'sun-tease':
        sound.sunTease(event.on);
        if (event.on) setAnnounce(t('announce.sunTease'));
        break;
      case 'win': {
        b?.highlight(event.cells);
        sound.waysWin(event.best, event.stepHundredths / 100);
        setMeterDur(Math.min(600, event.dur)); setMeter(event.meter);
        const p = cellPoint(2.5, 2);
        floatLabel(p.x, p.y, `+${goremeMoney(goremeCents(betCents, event.stepHundredths), loc)}`, styles.floatLabel, reduced ? 800 : 1300, reduced);
        const top = event.wins.reduce((m, w) => (w.payTenThousandths > m.payTenThousandths ? w : m));
        setBanner({ key: ++keys.current.banner, text: t('banner.ways', { name: nameOf(top.symbol), length: top.length, ways: format.number(top.ways, 0), more: event.wins.length - 1, sky: event.sky }), tone: event.sky > 1 ? 'sky' : 'gold' });
        setAnnounce(event.wins.map(w => t('announce.way', { name: nameOf(w.symbol), length: w.length, ways: w.ways, multiplier: w.multiplierProduct })).join('; ') + '. ' + t('announce.boardWin', { times: goremeTimes(event.stepHundredths, loc) }));
        break;
      }
      case 'callout':
        showCallout(event.value, event.tier, event.source, reduced, Math.max(1100, event.dur));
        break;
      case 'scatter': {
        b?.highlight(event.cells);
        if (!lite) sunRays(event.retrigger ? 1.2 : 1.6);
        if (event.payHundredths > 0) { setMeterDur(500); setMeter(event.meter); }
        setBanner({ key: ++keys.current.banner, text: event.retrigger ? t('banner.retrigger', { count: event.count, spins: event.freeSpins }) : t('banner.scatter', { count: event.count, money: goremeMoney(goremeCents(betCents, event.payHundredths), loc), spins: event.freeSpins }), tone: 'gold' });
        if (event.retrigger) sound.retrigger();
        setAnnounce(event.retrigger ? t('announce.retrigger', { count: event.count, spins: event.freeSpins }) : t('announce.scatter', { count: event.count, spins: event.freeSpins }));
        break;
      }
      case 'lift': {
        b?.burn();
        sound.burner(Math.min(2, 1 + event.balloons.length * 0.15));
        sound.wind(event.wind);
        setWind({ key: ++keys.current.wind, dir: event.wind });
        if (f) for (const bl of event.balloons) { const p = cellPoint(bl.col, bl.row, 0.8); void f.flame(p.x, p.y, { power: bl.multiplier >= 6 ? 1.6 : 1 }); }
        setAnnounce(t('announce.lift', { n: event.balloons.length, wind: t(WIND_KEY[event.wind]) }));
        break;
      }
      case 'lift-move': {
        b?.move(event.moves, event.exits, event.ms);
        for (const m of event.moves) balloonAt.current.set(m.id, m.to);
        if (event.exits.length) {
          const moorings = event.exits.filter(e => e.moored);
          later(Math.round(event.ms * 0.5), () => { if (live.current !== current) return; if (moorings.length) sound.moor(); if (moorings.length < event.exits.length) sound.flyAway(); });
          if (moorings.length < event.exits.length) setAnnounce(t('announce.flyAway', { n: event.exits.length - moorings.length }));
        }
        break;
      }
      case 'merge': {
        b?.merge(event.merges, event.ms);
        for (const m of event.merges) {
          sound.merge(m.multiplier);
          const p = cellPoint(m.at[0], m.at[1], 0.45);
          void f?.mergeBurst(p.x, p.y, { multiplier: m.multiplier, scale: p.cell / 70 });
          setBanner({ key: ++keys.current.banner, text: t('banner.merge', { multiplier: m.multiplier }), tone: 'rose' });
          setAnnounce(t('announce.merge', { multiplier: m.multiplier }));
        }
        break;
      }
      case 'sky': {
        setMoored(list => [...list, ...event.moored]);
        setSky(event.after);
        sound.skyMultiplier(event.before, event.after);
        const band = bandRef.current, root = layoutRef.current;
        if (f && band && root) { const p = goremePointOf(root, band, 0.5, 0.5); void f.moorSparkle(p.x, p.y, { scale: 1.4 }); }
        setAnnounce(t('announce.sky', { n: event.moored.length, after: event.after }));
        break;
      }
      case 'respin':
        b?.respin(event.grid, { drops: event.drops, delays: event.delays, dropMs: event.dropMs });
        sound.respin();
        break;
      case 'trigger':
        sound.featureTrigger();
        if (!lite) sunRays(2.2, 2400);
        setBanner({ key: ++keys.current.banner, text: t('banner.trigger', { spins: event.awarded }), tone: 'gold' });
        setAnnounce(t('announce.trigger', { count: event.count, spins: event.awarded }));
        break;
      case 'free-intro':
        setCard({ kind: 'intro', awarded: event.awarded, at: event.at, dur: event.dur });
        sound.freeSpinsIntro();
        setMood('feature');
        setAnnounce(t('announce.freeIntro', { spins: event.awarded }));
        break;
      case 'free-mode':
        setCard(null); b?.dim(false); setFree(event.on); setFreeInfo({ number: 0, left: event.freeSpinsLeft });
        setSky(1); setMoored([]);
        sound.scene('feature');
        break;
      case 'spin-end': {
        b?.highlight(null);
        sound.sunTease(false);
        setMeterDur(300); setMeter(event.meter);
        if (event.kind === 'free') {
          setSky(event.sky);
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          setAnnounce(event.winHundredths > 0 ? t('announce.freeSpinWin', { times: goremeTimes(event.winHundredths, loc), total: goremeTimes(event.meter.total, loc) }) : t('announce.freeSpinNone'));
        } else {
          if (event.winHundredths === 0) setAnnounce(t('announce.noWin'));
          else if (event.winHundredths >= 300 && event.winHundredths < 1000) sound.nice();
        }
        break;
      }
      case 'total-win': {
        setFlourish(x => x + 1);
        sound.totalWinFanfare();
        if (!reduced) meterRef.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.3 }, { transform: 'scale(.98)', offset: 0.65 }, { transform: 'scale(1)' }], { duration: 620, easing: 'ease-out' });
        setAnnounce(t('announce.totalWin', { amount: format.number(goremeCents(betCents, event.totalHundredths) / 100), times: goremeTimes(event.totalHundredths, loc) }));
        break;
      }
      case 'free-outro':
        setCard({ kind: 'outro', spins: event.spins, total: event.totalHundredths, sky: event.sky, moored: event.moored, celebration: event.celebration, capped: event.capped, bet: betCents, at: event.at, dur: event.dur });
        sound.totalWinFanfare();
        sound.featureOutro();
        sound.scene('base');
        setMood('base');
        setAnnounce(t('announce.freeOutro', { amount: format.number(goremeCents(betCents, event.totalHundredths) / 100), spins: event.spins, sky: event.sky }));
        break;
      case 'big-win':
        openCelebration(event.schedule, betCents, event.at, event.dur, reduced, lite);
        break;
      case 'end':
        b?.dim(false); b?.highlight(null);
        setCard(null); setBanner(null); setFree(false); setFreeInfo(null); setSky(1); setMoored([]); setWind(null);
        player.current = null;
        finishRound(current);
        break;
    }
  }, [cellPoint, finishRound, floatLabel, later, nameOf, openCelebration, showCallout, sound, sunRays, t, format, loc]);

  /* ---------------------------------------------------------------- starting rounds */
  const begin = useCallback((current: LiveRound, text: string) => {
    clearTimers();
    live.current = current;
    setError(''); setPhase('playing'); setRoundBet(current.bet);
    setFree(false); setFreeInfo(null); setMeterDur(0); setMeter(ZERO); setCard(null); setBanner(null); setCallout(null); setFlourish(0); setMood('base');
    setSky(1); setMoored([]); setWind(null);
    setAnnounce(text);
    sound.unlock();
    sound.scene('base');
    sound.spinStart();
    const next = new TimelinePlayer<GoremeEvent>(current.timeline, event => { if (live.current === current) handle(event); }, undefined, GOREME_PLAYER_MAX_STEP_MS);
    player.current = next;
    next.start();
  }, [clearTimers, handle, sound]);

  const gated = mode === 'live';
  const busy = phase === 'playing';
  const booting = boot.phase !== 'done';

  const makeLive = useCallback((fields: Omit<LiveRound, 'timeline' | 'prefix' | 'reduced' | 'lite' | 'settled'>): LiveRound => {
    const s = settingsRef.current;
    return { ...fields, timeline: buildGoremeTimeline(fields.round, goremeTimelineOptions(s, reducedMotion)), prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects, settled: false };
  }, [reducedMotion]);

  /** Remote round: the server resolves and settles it; the spin stays locked until its round has been presented. */
  const startRemote = useCallback((source: RemoteRoundSource, roundMode: GoremeMode, cost: number, balanceBefore: number) => {
    const betCents = bet;
    pendingRemote.current = true;
    setError(''); setPhase('playing'); setActiveDemo(true); setReplaying(null);
    setRemoteBalance(balanceBefore - cost);
    setAnnounce(t('announce.sentToServer', { amount: format.number(cost / 100) }));
    source.client.play('goreme', betCents, roundMode).then(play => {
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
    const roundMode: GoremeMode = kind === 'buy' ? 'buy' : ante ? 'ante' : 'standard';
    if (kind === 'buy' && ante) return false;
    const cost = goremeCost(bet, roundMode);
    const balanceBefore = balanceRef.current;
    if (cost > balanceBefore) {
      setError(t('errors.insufficient', { kind: roundMode, cost: format.demo(cost) }));
      sound.denied();
      return false;
    }
    if (remote) { startRemote(remote, roundMode, cost, balanceBefore); return true; }
    let round: GoremeRound;
    try { round = localRoundSource.resolve('goreme', bet, roundMode); } catch { setError(t('errors.entropy')); return false; }
    let id: string | null;
    try { id = reserveDemo(cost, goremeLedgerLimits(bet, roundMode)); } catch { setError(t('errors.entropy')); return false; }
    if (!id) { setError(t('errors.noCredit')); sound.denied(); return false; }
    setActiveDemo(true);
    const current = makeLive({ id, replayOf: null, bet, cost, mode: roundMode, balanceBefore, round, remote: null });
    setReplaying(null);
    begin(current, roundMode === 'buy' ? t('announce.bonusBought', { amount: format.number(cost / 100) }) : t('announce.spinStarted', { amount: format.number(cost / 100) }));
    return true;
  }, [ante, bet, begin, booting, gated, makeLive, reserveDemo, setActiveDemo, sound, remote, sourcePending, startRemote, t, format]);

  // Reload recovery (remote): the last unseen server round of this game is shown again exactly as resolved.
  const recoveredOnce = useRef(false);
  useEffect(() => {
    if (sourceView.status !== 'remote' || !sourceView.recovered || recoveredOnce.current || booting || live.current || pendingRemote.current) return;
    recoveredOnce.current = true;
    const { receipt, round } = sourceView.recovered;
    const after = sourceView.recoveredBalanceCents ?? receipt.balanceCents;
    const current = makeLive({ id: `remote:${receipt.roundId}`, replayOf: null, bet: receipt.betCents, cost: receipt.costCents, mode: receipt.mode as GoremeMode, balanceBefore: after + receipt.costCents - receipt.payoutCents, round, remote: { receipt, balanceAfter: after } });
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

  /** Ledger-free presentation of an engine round (history replay; dev preview). */
  const presentReplay = useCallback((round: GoremeRound, recordId: string | null, text: string) => {
    const current = makeLive({ id: null, replayOf: recordId, bet: round.betCents, cost: round.costCents, mode: round.mode, balanceBefore: balanceRef.current, round, remote: null });
    setReplaying({ recordId, seed: round.seedHex });
    begin(current, text);
  }, [begin, makeLive]);
  const replay = useCallback((record: DemoRecord) => {
    const meta = record.goreme;
    if (!meta || (live.current && !live.current.settled) || autoRef.current || booting) return;
    let round: GoremeRound;
    try { round = playGoremeRound(meta.seedHex, meta.betCents, meta.mode); } catch { showToast(t('toast.replayFailed'), 'warn'); return; }
    if (round.payoutCents !== record.payout || round.costCents !== meta.costCents) { showToast(t('toast.replayMismatch'), 'warn'); return; }
    stageRef.current?.scrollIntoView({ block: 'start' });
    presentReplay(round, record.id, t('announce.replaying', { id: goremeRoundId(meta.seedHex) }));
  }, [booting, presentReplay, showToast, t]);

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
    const timer = window.setTimeout(() => setCallout(x => (x?.key === callout.key ? null : x)), callout.life);
    return () => window.clearTimeout(timer);
  }, [callout]);
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(x => (x?.key === banner.key ? null : x)), 2200);
    return () => window.clearTimeout(timer);
  }, [banner]);
  useEffect(() => {
    if (!wind) return;
    const timer = window.setTimeout(() => setWind(x => (x?.key === wind.key ? null : x)), 1400);
    return () => window.clearTimeout(timer);
  }, [wind]);

  /* Development-only previews (visual QA): celebration screens, callouts and a ledger-free engine round from a seed
     (presented exactly like a history replay). They never reserve or settle anything; production builds drop them. */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const win = window as unknown as { __goremePreview?: unknown };
    const idle = () => !(live.current && !live.current.settled) && !player.current;
    win.__goremePreview = {
      celebrate: (totalHundredths: number, capped = false, betCents = 1000) => {
        if (!idle()) return false;
        const s = settingsRef.current, opts = goremeTimelineOptions(s, reducedMotion);
        const schedule = countUpSchedule(totalHundredths, capped, opts);
        const dur = schedule.countUp + schedule.hold;
        const timeline = { events: [
          { type: 'big-win', at: 0, dur, tier: schedule.finalLevel, totalHundredths, capped, countUp: schedule.countUp, schedule, hold: true } as GoremeEvent,
          { type: 'end', at: dur, dur: 0, totalHundredths, payoutCents: goremeCents(betCents, totalHundredths), capped } as GoremeEvent,
        ] };
        const preview = new TimelinePlayer<GoremeEvent>(timeline, event => {
          if (event.type === 'big-win') openCelebration(event.schedule, betCents, event.at, event.dur, reducedMotion, reducedMotion || s.reducedEffects);
          else if (event.type === 'end') { setCard(null); setMood('base'); board.current?.dim(false); sound.countUp(false); player.current = null; }
        });
        player.current = preview;
        preview.start();
        return true;
      },
      play: (seedHex: string, roundMode: GoremeMode = 'standard', betCents = 1000) => {
        if (!idle() || autoRef.current) return false;
        presentReplay(playGoremeRound(seedHex, betCents, roundMode), null, t('announce.preview'));
        return true;
      },
      time: () => player.current?.time ?? null,
    };
    return () => { delete win.__goremePreview; };
  }, [openCelebration, presentReplay, reducedMotion, sound, t]);

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
    const gap = GOREME_AUTOPLAY_GAP[settingsRef.current.spinSpeed];
    const timer = window.setTimeout(() => {
      const state = autoRef.current; if (!state) return;
      const decision = goremeAutoplayBeforeSpin(state, { balanceCents: balanceRef.current, betCents: bet, ante, tabHidden: document.hidden });
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
  const roundMode: GoremeMode = ante ? 'ante' : 'standard';
  const spinCost = goremeCost(bet, roundMode);
  const buyPrice = goremeCost(bet, 'buy');
  const buyBlock = goremeBuyBlock({ betCents: bet, balanceCents: balance, ante, autoplay: auto !== null, busy, gated });
  const buyReason = buyBlock ? t(`buy.block.${buyBlock.code}`, { price: format.demo(buyPrice) }) : null;
  const locked = busy || auto !== null || gated || booting || sourcePending;
  const amountCents = (h: number) => (roundBet === null ? 0 : goremeCents(roundBet, h));
  const boardLabel = free ? t('board.labelFree') : t('board.labelPlay');
  const boardMood = free ? 'feature' : 'base';
  const cellLabel = useCallback((symbol: EngineSymbol, col: number, row: number, multiplier: number) => (
    symbol === 'balloon' ? t('board.balloonCell', { multiplier, col: col + 1, row: row + 1 }) : t('board.cell', { name: symbolLabels[symbol], col: col + 1, row: row + 1 })
  ), [t, symbolLabels]);
  const boardElement = useMemo(() => (
    <GoremeFrame mood={boardMood}>
      <GoremeBoard ref={board} mood={boardMood} label={boardLabel} cellLabel={cellLabel} />
    </GoremeFrame>
  ), [boardLabel, boardMood, cellLabel]);
  const celebrating = card?.kind === 'big' || card?.kind === 'outro' || card?.kind === 'intro';
  const infoPages = useMemo(() => goremeInfoPages(bet, { t, tk, tc, format, labels: symbolLabels }), [bet, t, tk, tc, format, symbolLabels]);
  const outOfCredit = !busy && balance < GOREME_MIN_BET_CENTS;
  const deckWin = busy ? amountCents(meter.total) : (lastWin?.payout ?? 0);
  const speedIndex = SPIN_SPEEDS.indexOf(settings.spinSpeed);
  const replayInfo = replaying ? t('replay.ribbon', { id: goremeRoundId(replaying.seed) }) : null;
  const bandBalloons = useMemo(() => moored.map(m => ({ id: m.id, multiplier: m.multiplier })), [moored]);

  const openInfo = (page = 'how') => { setInfoPage(page); setModal('info'); sound.click(); };
  const refill = () => {
    if (busy || auto) return;
    if (remote) {
      if (pendingRemote.current) return;
      remote.client.resetBalance().then(cents => {
        setRemoteBalance(cents);
        const at = Date.now();
        recordRemote({ id: `remote-reset:${at}`, game: 'Göreme', stake: 0, payout: 0, detail: 'Bakiye yenilendi (sunucu)', at, kind: 'reset' });
        showToast(t('toast.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); setError(''); setAnnounce(t('announce.refilled', { amount: format.number(DEMO_START_CENTS / 100) }));
      }, (failure: unknown) => showToast(rgs.error(failure), 'warn'));
      return;
    }
    if (resetDemoBalance('Göreme')) { showToast(t('toast.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); setError(''); setAnnounce(t('announce.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); }
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
    setAnnounce(next ? t('announce.anteOn', { cost: format.demo(goremeCost(bet, 'ante')) }) : t('announce.anteOff', { cost: format.demo(bet) }));
  };
  const onSpinClick = () => { if (busy) return; startRound('spin'); };
  const confirmBuy = () => { if (buyReason) return; setModal(null); startRound('buy'); };

  const deck = (
    <BetSelector
      ladder={GOREME_BET_LADDER}
      valueCents={bet}
      onChange={chooseBet}
      balanceCents={balance}
      maxBetCents={GOREME_MAX_BET_CENTS}
      costMode={GOREME_COST_MODES[roundMode]}
      modeLabel={ante ? tc('modes.ante') : undefined}
      disabled={locked}
      classNames={{ minus: styles.stepBtn, plus: styles.stepBtn, value: styles.betValue, max: styles.maxChip }}
      render={parts => (
        <div className={`${kit.kit} ${styles.deck}`} data-auto={auto ? '' : undefined} role="group" aria-label={t('deck.group')}>
          <div className={styles.cellBalance}>
            <span className={styles.cellLabel}>{t('deck.balance')}</span>
            <strong className={styles.cellValue} data-testid="goreme-balance">{format.amount(balance)}<small> DEMO</small></strong>
            <button type="button" className={styles.refill} onClick={refill} disabled={busy || auto !== null || gated} aria-label={t('deck.refill')}><RefillIcon /><span aria-hidden="true">{t('deck.refill')}</span></button>
          </div>
          <div className={styles.cellWin}>
            <span className={styles.cellLabel}>{busy ? (replaying ? t('deck.winReplay') : t('deck.win')) : lastWin?.replay ? t('deck.winReplayLast') : t('deck.winLast')}</span>
            <strong className={`${styles.cellValue} ${deckWin > 0 ? styles.cellWinOn : ''}`}>{format.amount(deckWin)}<small> DEMO</small></strong>
          </div>
          <div className={styles.cellBet}>
            {parts.label}
            {parts.value}
            <span className={styles.costLine} data-testid="goreme-cost">{t('deck.cost')} <strong>{format.amount(spinCost)} DEMO</strong>{ante && <em> · {format.factor(GOREME_COST_MODES.ante.num, GOREME_COST_MODES.ante.den)}</em>}</span>
          </div>
          <div className={styles.areaMinus}>{parts.minus}</div>
          <div className={styles.areaPlus}>{parts.plus}</div>
          <div className={styles.areaMax}>{parts.max}</div>
          <div className={styles.areaSpin}>
            {auto ? (
              <AutoplayStopButton className={styles.stop} remaining={auto.spinsRemaining} onStop={() => stopAutoplay('cancelled', 'info')} />
            ) : (
              <button type="button" className={`${styles.spin} ${busy ? styles.spinning : ''}`} onClick={onSpinClick} disabled={busy || gated || booting || sourcePending}
                aria-label={t('deck.spin')} aria-describedby="gr-spin-cost" data-locked={busy || undefined} data-testid="goreme-spin">
                <span className={styles.spinFace}><SpinSeal /></span>
                {busy && <span className={styles.spinLock} aria-hidden="true"><LockIcon /></span>}
              </button>
            )}
            <span id="gr-spin-cost" className="sr-only">{busy ? t('deck.spinLocked') : t('deck.spinCost', { cost: format.demo(spinCost) })}</span>
          </div>
          <button type="button" className={`${styles.tool} ${styles.areaAuto}`} onClick={() => { sound.click(); setModal('autoplay'); }} disabled={locked} aria-haspopup="dialog">
            <LoopIcon /><span>{t('deck.auto')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaInfo}`} onClick={() => openInfo()} aria-haspopup="dialog" aria-label={t('deck.infoAria')}>
            <InfoIcon /><span>{t('deck.info')}</span>
          </button>
          <button type="button" role="switch" aria-checked={ante} className={`${styles.feature} ${styles.areaAnte} ${ante ? styles.featureOn : ''}`} onClick={toggleAnte} disabled={locked}
            aria-label={tc('modes.ante')} aria-describedby="gr-ante-desc">
            <span className={styles.featureTitle}>{tc('modes.ante')}</span>
            <span className={styles.featureState}>{ante ? t('deck.on') : t('deck.off')}<span className={styles.featureFactor}> · {format.factor(GOREME_COST_MODES.ante.num, GOREME_COST_MODES.ante.den)}</span></span>
            <span id="gr-ante-desc" className={styles.featureDesc}>{t('deck.anteDesc')}</span>
          </button>
          <button type="button" className={`${styles.feature} ${styles.featureBuy} ${styles.areaBuy}`} aria-disabled={buyReason ? true : undefined}
            onClick={() => { if (buyReason) sound.denied(); else sound.click(); setModal('buy'); }} aria-haspopup="dialog" aria-describedby="gr-buy-desc">
            <span className={styles.featureTitle}>{t('deck.buy')}</span>
            <span className={styles.featureState}>{format.amount(buyPrice, { trimZeros: true })} DEMO</span>
            <span id="gr-buy-desc" className={styles.featureDesc}>{buyReason ?? t('deck.buyDesc', { rtp: goremeRtp(GOREME_RTP.buy.rtp, loc) })}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSet}`} onClick={() => { sound.click(); setModal('settings'); }} aria-haspopup="dialog" aria-label={tk('settings.title')}>
            <GearIcon /><span>{tk('settings.title')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSpeed} ${speedIndex > 0 ? styles.toolOn : ''}`} onClick={cycleSpeed} aria-label={t('deck.speedAria', { speed: tk(SPEED_KEY[settings.spinSpeed]) })}>
            <SpeedPips count={speedIndex + 1} /><span>{tk(SPEED_KEY[settings.spinSpeed])}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSound} ${!settings.muted ? styles.toolOn : ''}`} onClick={toggleSound} aria-pressed={!settings.muted} aria-label={t('deck.sound')}>
            <SoundIcon on={!settings.muted} /><span>{t('deck.sound')}</span>
          </button>
          <div className={styles.areaMsg}>
            {soundLoad.started && !soundLoad.ready && !settings.muted && <p className={styles.msgHint} role="status">{t('deck.soundLoading', { percent: soundLoad.percent })}</p>}
            {error ? <p className={styles.msgError} role="alert">{error}</p>
              : outOfCredit ? <p className={styles.msgHint}>{t('deck.outOfCredit')} <button type="button" className={styles.inlineLink} onClick={refill}>{t('deck.refill')}</button></p>
              : <p className={styles.msgHint}>{lastWin && !busy ? (lastWin.payout > 0 ? richText(t, 'deck.lastWin', { money: goremeMoney(lastWin.payout, loc), times: goremeTimes(lastWin.total, loc) }) : t('deck.lastNone')) : settings.spaceToSpin ? t('deck.hintSpace') : t('deck.hintFixed')}</p>}
          </div>
        </div>
      )}
    />
  );

  return (
    <div className={`game-page ${styles.page}`}>
      <GoremeSymbolSprites />
      <GameHeading title={t('title')} subtitle={t('subtitle')} mode={mode} setMode={setMode} active={busy || auto !== null}
        badge={remote ? rgs.source('remote') : sourcePending ? t('badge.checking') : rgs.source('local')} />
      <section className={`game-table ${styles.table}`} aria-label={t('table')} data-free={free || undefined}>
        <GoremeScene ref={scene} mood={mood} className={styles.scene}>
          <div ref={layoutRef} className={styles.layout}>
            <div className={styles.left}>
              <div className={styles.leftLogo}><GoremeLogo subtitle={phone ? null : t('logoSub')} label={t('title')} /></div>
              <ul className={styles.facts} aria-label={t('facts.aria')}>
                <li><span className={styles.factArt} aria-hidden="true"><GoremeSymbol sprite symbol="balloon" multiplier={5} label={null} /></span><span>{richText(t, 'facts.balloon')}</span></li>
                <li><span className={styles.factArt} aria-hidden="true"><GoremeSymbol sprite symbol="sun" label={null} /></span><span>{richText(t, 'facts.sun')}</span></li>
                <li><span className={styles.factWays} aria-hidden="true">15.625</span><span>{richText(t, 'facts.ways', { max: format.number(GOREME_MAX_WIN_MULTIPLIER, 0) })}</span></li>
              </ul>
            </div>
            <div ref={stageRef} className={styles.stage} data-phase={phase} data-celebrate={celebrating || undefined} data-replay={replayInfo ? '' : undefined}>
              <div ref={shakeRef} className={styles.column}>
                <div className={styles.hud}>
                  {freeInfo ? (
                    <div className={styles.freeCounter} aria-label={t('hud.freeAria', { number: freeInfo.number, left: freeInfo.left })} data-testid="goreme-free-counter">
                      <span className={styles.freeTag}>{freeInfo.number > 0 ? t('hud.freeSpin', { n: freeInfo.number }) : t('hud.free')}</span>
                      <span className={styles.freeLeft}><small>{t('hud.left')}</small><strong key={freeInfo.left}>{freeInfo.left}</strong></span>
                    </div>
                  ) : (
                    <div className={styles.chip}><span className={styles.chipArt} aria-hidden="true"><GoremeSymbol sprite symbol="sun" label={null} /></span><span>{richText(t, 'hud.sunChip')}</span></div>
                  )}
                  {wind && <div key={wind.key} className={styles.wind} data-dir={wind.dir} aria-hidden="true"><WindArrow dir={wind.dir} /><span>{t(WIND_KEY[wind.dir])}</span></div>}
                </div>
                <div ref={bandRef} className={styles.band} data-active={free || undefined} data-testid="goreme-sky">
                  <GoremeSkyBand balloons={bandBalloons} multiplier={sky} active={free} label={t('sky.label')} />
                </div>
                <div className={styles.boardWrap} style={{ '--inset-x': `${GOREME_FRAME_INSET.x * 100}%` } as CSSProperties}>{boardElement}</div>
                {/* One cumulative meter: never resets inside a round (lifts, respins, every free spin add up). */}
                <div ref={meterRef} className={`${styles.meter} ${free ? styles.meterFree : ''}`} data-testid="goreme-meter">
                  {phase === 'idle' ? (
                    <div className={styles.meterIdle}><span>{richText(t, 'meter.idleA')}</span><span aria-hidden="true">·</span><span>{richText(t, 'meter.idleB', { max: format.number(GOREME_MAX_WIN_MULTIPLIER, 0) })}</span></div>
                  ) : (
                    <div className={styles.meterPart}>
                      <small>{free || phase === 'done' ? t('meter.total') : t('meter.win')}</small>
                      <strong data-testid="goreme-meter-total"><CountUp cents={amountCents(meter.total)} duration={meterDur} locale={loc} /><em> DEMO</em></strong>
                    </div>
                  )}
                  {flourish > 0 && phase !== 'idle' && <span key={flourish} className={styles.meterShine} aria-hidden="true" />}
                </div>
              </div>
              <div ref={layerRef} className={styles.fxLayer} aria-hidden="true" />
              {replayInfo && <div className={styles.replayRibbon} data-testid="goreme-replay"><Icon name="history" size={15} /><span>{replayInfo}</span></div>}
              {auto && !replayInfo && <div className={styles.autoRibbon} aria-hidden="true"><LoopIcon /><span>{t('auto.ribbon', { spins: auto.spinsRemaining })}</span></div>}
              {toast && (
                <div key={`toast-${toast.key}`} className={`${styles.toast} ${toast.tone === 'warn' ? styles.toastWarn : ''}`} data-testid="goreme-toast">
                  <span>{toast.text}</span>
                  <button type="button" className={styles.toastClose} onClick={() => setToast(null)} aria-label={t('toast.close')}><svg {...svg} width={16} height={16}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
                </div>
              )}
              {banner && <div key={`banner-${banner.key}`} className={`${styles.banner} ${banner.tone === 'rose' ? styles.bannerRose : banner.tone === 'sky' ? styles.bannerSky : ''}`} data-testid="goreme-banner" data-key={banner.key} aria-hidden="true">{banner.text}</div>}
              {callout && (
                <div key={`callout-${callout.key}`} className={styles.callout} data-tier={callout.tier} style={{ animationDuration: `${callout.life}ms` }} aria-hidden="true" data-testid="goreme-callout" data-key={callout.key}>
                  <span className={styles.calloutGlow} />
                  <span className={styles.calloutTag}>{callout.source === 'sky' ? t('callout.sky') : t(CALLOUT_KEY[callout.tier])}</span>
                  <span className={styles.calloutText} data-text={`×${callout.value}`}><span className={styles.calloutFill}>×{callout.value}</span></span>
                </div>
              )}
            </div>
            <div className={styles.side}>{deck}</div>
            <canvas ref={canvasRef} className={styles.front} aria-hidden="true" />
            <div className={styles.cards} data-active={celebrating || gated || undefined}>
              {card?.kind === 'intro' && <GoremeFreeIntro key={`intro-${card.at}`} awarded={card.awarded} dur={card.dur} reducedMotion={reducedMotion} onTap={advanceHold} />}
              {card?.kind === 'outro' && (
                <GoremeFeatureTotal key={`outro-${card.at}`} spins={card.spins} totalHundredths={card.total} sky={card.sky} moored={card.moored} betCents={card.bet}
                  celebration={card.celebration} capped={card.capped} dur={card.dur} elapsed={cardElapsed} reducedMotion={reducedMotion} onTap={advanceHold} />
              )}
              {card?.kind === 'big' && (
                <GoremeCelebration key={`big-${card.at}`} schedule={card.schedule} betCents={card.bet} elapsed={cardElapsed} reducedMotion={reducedMotion}
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
          </div>
        </GoremeScene>
        {boot.phase !== 'done' && (
          <div className={styles.splash} data-testid="goreme-splash">
            <div className={styles.splashCard}>
              <div className={styles.splashLogo}><GoremeLogo subtitle={t('logoSub')} label={t('title')} /></div>
              <ul className={styles.splashFeatures}>
                <li><span aria-hidden="true"><GoremeSymbol sprite symbol="balloon" multiplier={3} label={null} /></span><strong>{t('splash.lift.title')}</strong><small>{t('splash.lift.text')}</small></li>
                <li><span aria-hidden="true"><GoremeSymbol sprite symbol="balloon" multiplier={13} size={1.18} label={null} /></span><strong>{t('splash.merge.title')}</strong><small>{t('splash.merge.text')}</small></li>
                <li><span aria-hidden="true"><GoremeSymbol sprite symbol="sun" label={null} /></span><strong>{t('splash.sky.title', { max: format.number(GOREME_MAX_WIN_MULTIPLIER, 0) })}</strong><small>{t('splash.sky.text')}</small></li>
              </ul>
              {boot.phase === 'loading' ? (
                <div className={styles.loadBar} role="progressbar" aria-label={t('splash.loading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(boot.progress * 100)}>
                  <span style={{ transform: `scaleX(${boot.progress})` } as CSSProperties} />
                </div>
              ) : (
                <div className={styles.splashActions}>
                  <button type="button" className={styles.playButton} autoFocus onClick={() => { sound.unlock(); sound.click(); setBoot(x => ({ ...x, phase: 'done' })); }}>{t('splash.play')}</button>
                  <button type="button" className={styles.splashSkip} onClick={() => { updateSettings({ introScreen: false }); setBoot(x => ({ ...x, phase: 'done' })); }}>{t('splash.skip')}</button>
                </div>
              )}
              <p className={styles.splashNote}>{t('splash.note', { rtp: goremeRtp(GOREME_RTP.standard.rtp, loc) })}</p>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <SessionBar className={styles.sessionBar} nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <GoremeHistory onReplay={replay} replayDisabled={busy || auto !== null || booting} replayingId={replaying?.recordId ?? null} onShare={remote ? shareRound : undefined} />
      <StaticFooter remote={remote !== null} />

      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title={tk('settings.title')} size="md">
        <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
        <p className={styles.modalNote} role="status">{soundLoad.ready ? t('settings.soundReady') : soundLoad.started ? t('settings.soundLoading', { percent: soundLoad.percent }) : t('settings.soundIdle')}</p>
        <p className={styles.modalNote}>{t('settings.voiceNote')}</p>
        <section className={styles.demoBox} aria-labelledby="gr-demo-title">
          <h3 id="gr-demo-title">{t('settings.demoTitle')}</h3>
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
        rtpText={t('buy.rtp', { buy: goremeRtp(GOREME_RTP.buy.rtp, loc), standard: goremeRtp(GOREME_RTP.standard.rtp, loc) })}
        description={richText(t, 'buy.text', { bet: format.demo(bet), spins: GOREME_SCATTER_AWARDS[3].spins, max: format.demo(bet * GOREME_MAX_WIN_MULTIPLIER) })}
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
