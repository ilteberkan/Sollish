'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { ASENA_RTP, playAsenaRound, type AsenaMode, type AsenaRound } from '@sollish/protocol';
import { DEMO_START_CENTS } from '@/lib/demo';
import { useFormat, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import type { MessageKey } from '@/lib/i18n/catalog';
import { useRgsText } from '@/lib/use-rgs-text';
import { richText } from '../game-rich';
import {
  asenaCalloutTier, asenaCents, asenaErgenekonLevel, asenaHistoryDetail, asenaMoney, asenaTimes, buildAsenaTimeline,
  type AsenaCalloutTier, type AsenaEvent, type AsenaMeter, type AsenaTimeline,
} from '@/lib/asena-timeline';
import { WIN_TIER_INFO, countUpSchedule, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { TimelinePlayer } from '@/lib/slot-kit/timeline-player';
import { autoplayNetLossCents, createAutoplay, type AutoplayConfig, type AutoplayState, type AutoplayStopCode } from '@/lib/slot-kit/autoplay';
import { SPIN_SPEEDS, type SpinSpeed } from '@/lib/slot-kit/settings';
import {
  ASENA_AUTOPLAY_GAP, ASENA_BET_LADDER, ASENA_COST_MODES, ASENA_DEFAULT_BET_CENTS, ASENA_MAX_BET_CENTS, ASENA_MIN_BET_CENTS,
  asenaAutoplayAfterRound, asenaAutoplayBeforeSpin, asenaBuyBlock, asenaCost, asenaLedgerLimits, asenaRoundId, asenaRtp, asenaTimelineOptions,
} from '@/lib/asena-controls';
import { markRoundShown, type RemoteReceipt, type RemoteRoundSource } from '@/lib/rgs-client';
import { ASENA_ENGINE } from '@/lib/slot-engines/asena';
import { localSourceFor, useRoundSource } from '@/lib/use-round-source';
import { useAsenaSound } from '@/lib/slot-audio/use-asena-sound';
import { useProduct, type DemoRecord } from '../providers';
import { DemoNotice, GameHeading, Rules, type Mode } from '../game-common';
import { Icon } from '../icons';
import {
  AutoplayPanel, AutoplayStopButton, BetSelector, BuyFeatureDialog, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, useSession, useSlotSettings,
} from '../slot-kit';
import kit from '../slot-kit/kit.module.css';
import { AsenaBoard, type AsenaBoardHandle } from './board';
import { AsenaCelebration, AsenaErgenekonBurst, AsenaFeatureTotal, AsenaFreeIntro } from './asena-celebration';
import { AsenaHistory } from './asena-history';
import { asenaInfoPages } from './asena-info-pages';
import { AsenaFrame } from './frame';
import { AsenaFx, type AsenaMood } from './fx';
import { AsenaLogo } from './logo';
import { AsenaScene, type AsenaSceneHandle } from './scene';
import { AsenaSkyMap, type AsenaSkyMapHandle } from './sky-map';
import { ASENA_SYMBOL_GLOW, AsenaSymbolArt, AsenaSymbolSprites, asSparkle, useAsenaSymbolLabels } from './symbols';
import { AsenaTemplateGlyph } from './template-glyph';
import styles from './asena-game.module.css';

/* Lifecycle: entropy -> engine asena-stars-1 resolves the whole round (bet + mode) -> one reservation of the mode cost ->
   the timeline replays it -> exactly one settlement with the engine payout (at the end, or on unmount).
   Spin lock (game-standards §6): once a round starts the spin button and Space stay locked until the whole round —
   every tumble, constellation, wolf walk and free spin — has played; there is no skip. Speed comes from the quick/turbo
   setting; only the hold screens may be tapped (that moves the presentation clock, never a result). A replay from the
   history uses the same engine call and never touches the ledger.
   Remote (RGS) mode, lib/rgs-client.ts: the server resolves AND settles the round before the browser sees it; the game
   presents the returned round, records it in the history and shows the server balance. It never reserves or settles
   locally, so leaving mid-round needs nothing; a reload re-presents the last unseen server round.
   The board, the canvas FX (front + sky echo), the scene and the sound are all driven from the same timeline event, so
   the constellation's star-by-star trace, its sky echo and its motif start together, and the wolf howls when the sound
   says the howl starts (sound.constellation returns that delay). Their own timers only decorate. */

type LiveRound = {
  id: string | null; replayOf: string | null;
  bet: number; cost: number; mode: AsenaMode; balanceBefore: number;
  round: AsenaRound; timeline: AsenaTimeline; prefix: string; reduced: boolean; lite: boolean; settled: boolean;
  remote: { receipt: RemoteReceipt; balanceAfter: number } | null;
};
type Phase = 'idle' | 'playing' | 'done';
type Card =
  | { kind: 'intro'; awarded: number; at: number; dur: number }
  | { kind: 'outro'; spins: number; total: number; constellations: number; distinct: number; globalMultiplier: number; wolfSteps: number; celebration: boolean; capped: boolean; bet: number; at: number; dur: number }
  | { kind: 'big'; schedule: CountUpSchedule; bet: number; at: number; dur: number };
type Callout = { key: number; value: number; tier: AsenaCalloutTier; life: number };
type Burst = { key: number; level: 1 | 2 | 3; multiplier: number; life: number };
type Banner = { key: number; text: string; tone: 'gold' | 'ice' | 'aurora' };
type Toast = { key: number; text: string; tone: 'info' | 'warn' };
type ModalId = 'settings' | 'info' | 'autoplay' | 'buy' | null;
type Boot = { phase: 'loading' | 'ready' | 'done'; progress: number };

const CALLOUT_KEY = { 0: 'callout.tier0', 1: 'callout.tier1', 2: 'callout.tier2', 3: 'callout.tier3', 4: 'callout.tier4', 5: 'callout.tier5' } as const satisfies Record<AsenaCalloutTier, string>;
const SPEED_KEY = { normal: 'settings.speedNormal', quick: 'settings.speedQuick', turbo: 'settings.speedTurbo' } as const satisfies Record<SpinSpeed, string>;
type StopCode = AutoplayStopCode | 'server-failed' | 'spin-failed' | 'quit';
const ZERO: AsenaMeter = { spin: 0, total: 0 };
const NO_PIECES = [0, 0, 0, 0, 0, 0];
const BET_KEY = 'sollish:asena:bet';
/** The local DEMO source over asena's engine only (lib/slot-engines/asena.ts); the other games' engines are not in this route. */
const localRoundSource = localSourceFor(ASENA_ENGINE);
/** Sky map as a row: phones / portrait, and mid-width desktops where the map sits above the board. */
const NARROW_QUERY = '(max-width: 1240px), (max-aspect-ratio: 4 / 5)';
const PHONE_QUERY = '(max-width: 760px), (max-aspect-ratio: 4 / 5)';
/** Largest clock step per frame. The board and the FX run on the wall clock (WAAPI / canvas), so on a slow device the
 * timeline must keep near wall-clock pace or a constellation trace, its sound and the next step drift apart; a hidden tab
 * gets no frames at all, and the first frame after it is still capped. Presentation only. */
const ASENA_PLAYER_MAX_STEP_MS = 250;
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
function useMedia(media: string) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(media);
    const update = () => setNarrow(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [media]);
  return narrow;
}
function realityIntervalOverride(): number | undefined {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return undefined;
  const value = (window as unknown as { __asenaRealityMs?: unknown }).__asenaRealityMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? value : undefined;
}

/** Count-up number that writes its own text node (no React re-render per frame). */
function CountUp({ cents, duration, locale }: { cents: number; duration: number; locale: Locale }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(cents);
  const [initial] = useState(() => asenaMoney(cents, locale));
  useEffect(() => {
    const el = node.current; if (!el) return;
    const from = shown.current, to = cents;
    if (duration <= 0 || from === to || typeof requestAnimationFrame === 'undefined') { shown.current = to; el.textContent = asenaMoney(to, locale); return; }
    const start = performance.now(); let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      shown.current = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
      el.textContent = asenaMoney(shown.current, locale);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); shown.current = to; el.textContent = asenaMoney(to, locale); };
  }, [cents, duration, locale]);
  return <span ref={node}>{initial}</span>;
}

/* ------------------------------------------------------------------ icons (original, inline) */
const svg = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, focusable: false } as const;
/** Spin seal: a night disc with a seven-star constellation (the Kurt Başı shape) inside a ring of star rays. */
function SpinSeal() {
  const nodes: Array<[number, number]> = [[36, 30], [64, 30], [36, 46], [50, 46], [64, 46], [50, 60], [50, 74]];
  const edges: Array<[number, number]> = [[6, 5], [5, 3], [3, 2], [3, 4], [2, 0], [4, 1]];
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="asSpinNight" cx=".45" cy=".35" r=".7"><stop offset="0" stopColor="#3a4cb0" /><stop offset=".6" stopColor="#141c5a" /><stop offset="1" stopColor="#060a26" /></radialGradient>
      </defs>
      <g className={styles.sealRays}>
        {Array.from({ length: 16 }, (_, i) => <rect key={i} x="49" y="3" width="2" height={i % 2 ? 6 : 10} rx="1" transform={`rotate(${i * 22.5} 50 50)`} fill="#2a1406" opacity=".55" />)}
      </g>
      <circle cx="50" cy="52" r="34" fill="url(#asSpinNight)" stroke="#2a1406" strokeWidth="3" />
      <path d={edges.map(([a, b]) => `M${nodes[a]![0]} ${nodes[a]![1]}L${nodes[b]![0]} ${nodes[b]![1]}`).join('')} stroke="#cfe8ff" strokeWidth="2.2" strokeLinecap="round" opacity=".9" />
      {nodes.map(([x, y], i) => <path key={i} d={asSparkle(x, y, i === 6 ? 7.5 : 5.2, 0.22)} fill={i === 6 ? '#ffe7a0' : '#ffffff'} />)}
      <path d="M30 40Q34 28 46 24" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity=".35" />
    </svg>
  );
}
function SpeedStars({ count }: { count: number }) {
  return (
    <span className={styles.stars} aria-hidden="true">
      {[0, 1, 2].map(i => <svg key={i} {...svg} width={12} height={12} viewBox="0 0 12 12" data-on={i < count || undefined}><path d={asSparkle(6, 6, 5.6, 0.24)} fill="currentColor" /></svg>)}
    </span>
  );
}
function MoonPip() { return <svg {...svg} width={18} height={18}><path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5Z" fill="currentColor" /></svg>; }
function SoundIcon({ on }: { on: boolean }) {
  return <svg {...svg}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{on ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /> : <path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />}</svg>;
}
function LockIcon() { return <svg {...svg} width={14} height={14}><rect x="5" y="10.5" width="14" height="10" rx="2.6" fill="currentColor" /><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>; }
function GearIcon() { return <svg {...svg}><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function InfoIcon() { return <svg {...svg}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M12 11v6M12 7.4h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; }
function LoopIcon() { return <svg {...svg}><path d="M17 3.5 20 6.5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5 4 17.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 12.5v1a4 4 0 0 1-4 4H4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>; }
function RefillIcon() { return <svg {...svg} width={16} height={16}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

const StaticFooter = memo(function StaticFooter({ remote }: { remote: boolean }) { return <><DemoNotice remote={remote} /><Rules game="Asena" /></>; });

export function AsenaGame() {
  const { reserveDemo, settleDemo, recordRemote, setActiveDemo, demoBalance, resetDemoBalance } = useProduct();
  const router = useRouter();
  const t = useT('asena');
  const tk = useT('slotKit');
  const tc = useT('common');
  const format = useFormat();
  const rgs = useRgsText();
  const loc = format.locale;
  const symbolLabels = useAsenaSymbolLabels();
  const { settings, update: updateSettings, reset: resetSettings } = useSlotSettings('asena');
  const [realityMs] = useState(realityIntervalOverride);
  const session = useSession(realityMs ? { realityIntervalMs: realityMs } : {});
  const recordSession = session.recordRound;
  const { sound, loadState: soundLoad } = useAsenaSound(settings);
  const [mode, setMode] = useState<Mode>('demo');
  const [bet, setBet] = useState(ASENA_DEFAULT_BET_CENTS);
  const [ante, setAnte] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [free, setFree] = useState(false);
  const [freeInfo, setFreeInfo] = useState<{ number: number; left: number } | null>(null);
  const [pieces, setPieces] = useState<number[]>(NO_PIECES);
  const [globalMult, setGlobalMult] = useState(1);
  const [meter, setMeter] = useState<AsenaMeter>(ZERO);
  const [meterDur, setMeterDur] = useState(0);
  const [roundBet, setRoundBet] = useState<number | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);
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
  const [mood, setMood] = useState<AsenaMood>('base');
  const reducedMotion = usePrefersReducedMotion();
  const narrow = useMedia(NARROW_QUERY);
  const phone = useMedia(PHONE_QUERY);
  const sourceView = useRoundSource(ASENA_ENGINE);
  const remote: RemoteRoundSource | null = sourceView.status === 'remote' ? sourceView.source : null;
  const sourcePending = sourceView.status === 'pending';
  const [remoteBalance, setRemoteBalance] = useState<number | null>(null);
  useEffect(() => { if (sourceView.status === 'remote') setRemoteBalance(sourceView.balanceCents); }, [sourceView]);
  const balance = remote ? (remoteBalance ?? 0) : demoBalance;
  const pendingRemote = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const scene = useRef<AsenaSceneHandle>(null);
  const board = useRef<AsenaBoardHandle>(null);
  const skyMap = useRef<AsenaSkyMapHandle>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const fx = useRef<AsenaFx | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const player = useRef<TimelinePlayer<AsenaEvent> | null>(null);
  const live = useRef<LiveRound | null>(null);
  const settledIds = useRef(new Set<string>());
  const sequence = useRef(0);
  const bannerKey = useRef(0);
  const toastKey = useRef(0);
  const calloutKey = useRef(0);
  const burstKey = useRef(0);
  /** Presentation timers (star flights, the howl after the sound's delay); cleared when a round ends or unmounts. */
  const timers = useRef(new Set<number>());
  const howled = useRef(new Set<string>());
  const celebrateFx = useRef({ reduced: false, lite: false });
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
    const root = scene.current?.element, front = frontRef.current;
    if (!root || !front) return;
    const f = new AsenaFx({ root, front, sky: scene.current?.skyCanvas ?? null, echo: scene.current?.echoCanvas ?? null, board: board.current?.element ?? null, mood: 'base' });
    fx.current = f;
    return () => { f.destroy(); fx.current = null; };
  }, []);
  useEffect(() => { fx.current?.setMood(mood); }, [mood]);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(BET_KEY));
      if (ASENA_BET_LADDER.includes(stored)) setBet(stored);
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
      id: current.id, game: 'Asena', stake: current.cost, payout: round.payoutCents, detail: asenaHistoryDetail(round), at: Date.now(), kind: 'round',
      asena: { engine: round.engine, seedHex: round.seedHex, betCents: current.bet, mode: current.mode, costCents: current.cost },
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
    if (current.remote) markRoundShown('asena', current.remote.receipt.roundId);
    setPhase('done');
    sound.countUp(false);
    setMood('base');
    const { round } = current;
    setLastWin({ payout: round.payoutCents, total: round.totalHundredths, replay: current.id === null });
    sound.scene('base');
    if (current.id === null) {
      setReplaying(null);
      setAnnounce(t('announce.replayDone', { amount: format.number(round.payoutCents / 100), times: asenaTimes(round.totalHundredths, loc) }));
      return;
    }
    const state = autoRef.current;
    if (state) {
      const next = asenaAutoplayAfterRound(state, { costCents: current.cost, payoutCents: round.payoutCents, featureTriggered: round.freeSpinsTriggered, balanceBeforeCents: current.balanceBefore });
      autoRef.current = next;
      setAuto(next);
    }
    setAnnounce(round.payoutCents > 0 ? t('announce.roundEnd', { amount: format.number(round.payoutCents / 100), times: asenaTimes(round.totalHundredths, loc) }) : t('announce.roundEndNone'));
  }, [settle, sound, t, format, loc]);

  /* ---------------------------------------------------------------- presentation helpers */
  /** A point in cell units (col + 0.5 = cell centre) relative to the stage, plus the cell size. */
  const cellPoint = useCallback((x: number, y: number) => {
    const stage = stageRef.current, cells = board.current?.element;
    if (!stage || !cells) return { x: 0, y: 0, cell: 60 };
    const a = cells.getBoundingClientRect(), b = stage.getBoundingClientRect();
    return { x: a.left - b.left + (x / 6) * a.width, y: a.top - b.top + (y / 6) * a.height, cell: a.width / 6 };
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
  }, []);
  /** The wolf's muzzle when it is visible (not under the board or the deck); otherwise the FX default above the board. */
  const howlPoint = useCallback(() => {
    const p = scene.current?.wolfPoint() ?? null, root = scene.current?.element;
    if (!p || !root) return null;
    const o = root.getBoundingClientRect();
    const covered = [board.current?.element, sideRef.current].some(el => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return p.x + o.left >= r.left && p.x + o.left <= r.right && p.y + o.top >= r.top && p.y + o.top <= r.bottom;
    });
    return covered ? null : p;
  }, []);
  const doHowl = useCallback((reduced: boolean, power = 1) => {
    scene.current?.howl();
    if (!reduced) void fx.current?.howl(howlPoint(), { power });
  }, [howlPoint]);

  /** Big multiplier announcement over the board (game-standards §6), with its own sound and voice line. */
  const showCallout = useCallback((value: number, reduced: boolean, life = 1500) => {
    const tier = asenaCalloutTier(value);
    setCallout({ key: ++calloutKey.current, value, tier, life });
    sound.multiplierCallout(value);
    fx.current?.pulse(0.6 + tier * 0.15);
    if (!reduced) shake(tier <= 1 ? 4 : 4 + tier * 2.2, 360 + tier * 60);
  }, [shake, sound]);

  const openCelebration = useCallback((schedule: CountUpSchedule, betCents: number, at: number, dur: number, reduced: boolean, lite: boolean) => {
    celebrateFx.current = { reduced, lite };
    setCard({ kind: 'big', schedule, bet: betCents, at, dur });
    setMood('bigwin');
    sound.scene('bigwin');
    board.current?.dim(true);
    scene.current?.howl();
    if (!lite) void fx.current?.skyGate(Math.min(1.6, 0.7 + schedule.totalHundredths / 12_000), { howlAt: howlPoint(), duration: Math.min(4200, Math.max(1800, schedule.countUp)) });
    setAnnounce(t('announce.celebration', { title: tk(`winTier.${WIN_TIER_INFO[schedule.finalLevel].id}.title`), amount: format.number(asenaCents(betCents, schedule.totalHundredths) / 100), times: asenaTimes(schedule.totalHundredths, loc) }));
  }, [howlPoint, sound, t, tk, format, loc]);
  const onCelebrationLevel = useCallback((level: CelebrationLevel, first: boolean) => {
    const { reduced, lite } = celebrateFx.current;
    if (level === 5) sound.maxWin(); else sound.bigWin(level);
    if (first) sound.countUp(true);
    fx.current?.pulse(0.8 + level * 0.15, 2600);
    if (!lite && !first && level >= 3) void fx.current?.skyGate(Math.min(1.6, 0.8 + level * 0.18), { howlAt: howlPoint(), duration: 2600 });
    if (!lite && !reduced) shake(first ? 5 : 6 + level * 2.2, first ? 380 : 540);
  }, [howlPoint, shake, sound]);
  const onCelebrationCounted = useCallback(() => { sound.countUp(false); }, [sound]);

  /* ---------------------------------------------------------------- timeline events */
  const handle = useCallback((event: AsenaEvent) => {
    const current = live.current; if (!current) return;
    const reduced = current.reduced, lite = current.lite, b = board.current, f = fx.current;
    const betCents = current.bet;
    if (event.type !== 'land' && event.type !== 'moon-land') stageRef.current?.setAttribute('data-beat', event.type);
    switch (event.type) {
      case 'spin-start':
        setPieces(event.pieces); setGlobalMult(event.globalMultiplier);
        if (event.kind === 'free') { setFreeInfo({ number: event.freeSpinNumber, left: event.freeSpinsLeft }); setMeterDur(0); setMeter(event.meter); sound.spinStart(); }
        break;
      case 'drop-in':
        b?.moons(null); f?.clearMoons();
        void b?.dropIn(event.grid, { speed: event.speed });
        break;
      case 'land': sound.dropIn(event.col); break;
      case 'moon-land':
        sound.moonLand(event.n);
        if (!lite) { const p = cellPoint(event.col + 0.5, event.row + 0.3); floatLabel(p.x, p.y, '✦', styles.sparkLabel, 700, reduced); }
        break;
      case 'moon-tease':
        b?.moons(event.cells, 'tease');
        void f?.moons(event.cells, { tease: true, hold: 1600 });
        setAnnounce(t('announce.moonTease'));
        break;
      case 'grid': b?.setGrid(event.grid); break;
      case 'highlight': {
        b?.highlight(event.clusters.map(cl => ({ symbol: cl.symbol, cells: cl.ids })));
        if (!lite) f?.clusterWin(event.clusters.flatMap(cl => cl.positions), ASENA_SYMBOL_GLOW[event.clusters[0]!.symbol], event.stepHundredths / 100);
        for (const cl of event.clusters) sound.clusterWin(cl.symbol, cl.size);
        sound.winHighlight(event.stepHundredths / 100);
        setAnnounce(event.clusters.map(cl => {
          const label = symbolLabels[cl.symbol as keyof typeof symbolLabels] ?? cl.symbol;
          return t('announce.cluster', { size: cl.size, name: loc === 'tr' ? label.toLocaleLowerCase('tr-TR') : label, template: cl.templateId ? 'yes' : 'none', templateName: cl.templateId ? t(`templates.${cl.templateId}` as MessageKey<'asena'>) : '', templateMultiplier: cl.templateMultiplier ?? 0, times: asenaTimes(cl.winHundredths, loc) });
        }).join('; '));
        break;
      }
      case 'constellation': {
        const plan = event.plan;
        void b?.constellation(plan);
        const planName = t(`templates.${plan.templateId}`);
        void f?.constellation(plan, { persist: event.persist, name: planName.toLocaleUpperCase(format.intl) });
        const key = `${current.prefix}:${event.spin}:${event.step}:${event.index}`;
        const seconds = sound.constellation(plan);
        // The wolf howls exactly when the sound's howl starts; without sound the timeline's own howl event does it.
        if (seconds > 0) { howled.current.add(key); later(seconds * 1000, () => { if (live.current === current) doHowl(reduced); }); }
        setBanner({ key: ++bannerKey.current, text: t('banner.constellation', { name: planName, multiplier: plan.multiplier }), tone: plan.multiplier >= 6 ? 'gold' : 'ice' });
        setAnnounce(t('announce.constellation', { name: planName, multiplier: plan.multiplier }));
        break;
      }
      case 'howl': {
        const key = `${current.prefix}:${event.spin}:${event.step}:${event.index}`;
        if (!howled.current.delete(key)) doHowl(reduced);
        if (event.callout) showCallout(event.callout.value, reduced, Math.max(1100, Math.round(event.callout.tier >= 3 ? 1800 : 1500)));
        break;
      }
      case 'map': {
        for (const u of event.unlocked) {
          later(u.delay, () => {
            if (live.current !== current) return;
            sound.mapPiece(u.template, u.count);
            const to = f?.centerOf(skyMap.current?.tile(u.template) ?? null);
            const arrive = () => setPieces(p => { const n = p.slice(); n[u.template] = Math.max(n[u.template] ?? 0, u.count); return n; });
            if (f && to) void f.flyStar(u.from ? f.toPx(u.from) : [2, 2], to, { onArrive: arrive }); else arrive();
          });
        }
        later(event.dur, () => { if (live.current === current) setPieces(event.pieces); });
        setAnnounce(t('announce.map', { distinct: event.distinct }));
        break;
      }
      case 'ergenekon': {
        setGlobalMult(event.after);
        scene.current?.ergenekon(event.level);
        const level = event.level as 1 | 2 | 3;
        setBurst({ key: ++burstKey.current, level, multiplier: event.after, life: event.dur });
        sound.globalMultiplier(event.after);
        if (f) {
          const at = f.centerOf(b?.element ?? null);
          if (at && !lite) void f.ergenekon({ x: at.x, y: at.y + (f.boardSize * 0.04) }, level);
          const emblem = f.centerOf(skyMap.current?.emblem() ?? null);
          if (emblem) void f.ergenekon(emblem, level, { scale: 0.45 });
        }
        if (!reduced) shake(4 + level * 3, 420 + level * 80);
        setAnnounce(t('announce.ergenekon', { distinct: event.distinct, after: event.after }));
        break;
      }
      case 'map-spins':
        setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
        sound.mapSpins(event.awarded);
        f?.announce(`+${event.awarded}`, null, { sub: t('fx.spins'), tone: 'ice' });
        setBanner({ key: ++bannerKey.current, text: t('banner.mapSpins', { awarded: event.awarded }), tone: 'aurora' });
        setAnnounce(t('announce.mapSpins', { awarded: event.awarded }));
        break;
      case 'burst': {
        b?.clearConstellations(); b?.clearHighlight();
        void b?.burst(event.ids, { speed: event.speed });
        if (!lite) void f?.burst(event.positions);
        for (const cl of event.clusters) {
          sound.starBurst(cl.symbol, cl.size);
          const p = cellPoint(cl.centroid.x, cl.centroid.y);
          floatLabel(p.x, p.y, `+${asenaMoney(asenaCents(betCents, cl.winHundredths), loc)}`, styles.floatLabel, reduced ? 800 : 1300, reduced);
        }
        setMeterDur(Math.min(520, event.dur + 160)); setMeter(event.meter);
        break;
      }
      case 'fall': void b?.fall(event.fall, { speed: event.speed }); sound.fall(); break;
      case 'wolf-walk': {
        const w = event.walk;
        void b?.wolfWalk(w, { speed: event.speed });
        if (!lite) void f?.wolfWalk(w.from, w.to, { duration: event.ms });
        sound.wolfWalk(event.ms);
        setAnnounce(t('announce.wolfWalk', { fromCol: w.from[0] + 1, fromRow: w.from[1] + 1, toCol: w.to[0] + 1, toRow: w.to[1] + 1 }));
        break;
      }
      case 'moons':
        b?.moons(event.cells, 'land');
        void f?.moons(event.cells, { hold: Math.max(900, event.dur) });
        setAnnounce(t('announce.moons', { count: event.count }));
        break;
      case 'scatter-pay':
        setMeterDur(500); setMeter(event.meter);
        setBanner({ key: ++bannerKey.current, text: t('banner.scatterPay', { count: event.count, money: asenaMoney(asenaCents(betCents, event.hundredths), loc) }), tone: 'gold' });
        break;
      case 'scatter-trigger':
        if (event.retrigger) {
          sound.retrigger();
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          setBanner({ key: ++bannerKey.current, text: t('banner.extraSpins', { awarded: event.awarded }), tone: 'aurora' });
          f?.announce(`+${event.awarded}`, null, { sub: t('fx.extraSpins'), tone: 'ice' });
          setAnnounce(t('announce.retrigger', { count: event.count, awarded: event.awarded }));
        } else {
          b?.dim(true);
          sound.featureTrigger();
          f?.announce(`+${event.awarded}`, null, { sub: t('fx.freeSpins'), tone: 'ice', life: 1800 });
          scene.current?.howl();
          setAnnounce(t('announce.trigger', { count: event.count }));
        }
        break;
      case 'free-intro':
        setCard({ kind: 'intro', awarded: event.awarded, at: event.at, dur: event.dur });
        sound.freeSpinsIntro();
        setMood('feature');
        setAnnounce(t('announce.freeIntro', { awarded: event.awarded }));
        break;
      case 'free-mode':
        setCard(null); b?.dim(false); setFree(event.on); setFreeInfo({ number: 0, left: event.freeSpinsLeft });
        setPieces(NO_PIECES); setGlobalMult(1);
        scene.current?.ergenekon(0);
        sound.scene('feature');
        break;
      case 'spin-end': {
        b?.moons(null); f?.clearMoons();
        sound.moonTease(false);
        setMeterDur(300); setMeter(event.meter);
        if (event.kind === 'free') {
          setPieces(event.pieces); setGlobalMult(event.globalMultiplier);
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          const m = meterRef.current, s = stageRef.current;
          if (m && s && event.winHundredths > 0) { const a = m.getBoundingClientRect(), o = s.getBoundingClientRect(); floatLabel(a.left - o.left + a.width / 2, a.top - o.top - 6, `+${asenaMoney(asenaCents(betCents, event.winHundredths), loc)}`, styles.floatSpin, reduced ? 900 : 1400, reduced); }
          setAnnounce(event.winHundredths > 0 ? t('announce.freeSpinWin', { times: asenaTimes(event.winHundredths, loc), total: asenaTimes(event.meter.total, loc) }) : t('announce.freeSpinNone'));
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
        f?.pulse(0.6);
        setAnnounce(t('announce.totalWin', { amount: format.number(asenaCents(betCents, event.totalHundredths) / 100), times: asenaTimes(event.totalHundredths, loc) }));
        break;
      }
      case 'free-outro':
        setCard({ kind: 'outro', spins: event.spins, total: event.totalHundredths, constellations: event.constellations, distinct: event.distinct, globalMultiplier: event.globalMultiplier, wolfSteps: event.wolfSteps, celebration: event.celebration, capped: event.capped, bet: betCents, at: event.at, dur: event.dur });
        sound.totalWinFanfare();
        sound.featureOutro();
        sound.scene('base');
        f?.clearEcho();
        scene.current?.ergenekon(0);
        setMood('base');
        setAnnounce(t('announce.freeOutro', { amount: format.number(asenaCents(betCents, event.totalHundredths) / 100), spins: event.spins, constellations: event.constellations, multiplier: event.globalMultiplier }));
        break;
      case 'big-win':
        openCelebration(event.schedule, betCents, event.at, event.dur, reduced, lite);
        break;
      case 'end':
        b?.dim(false); b?.clearConstellations(); b?.clearHighlight();
        setCard(null); setBanner(null); setBurst(null); setFree(false); setFreeInfo(null); setPieces(NO_PIECES); setGlobalMult(1);
        howled.current.clear();
        player.current = null;
        finishRound(current);
        break;
    }
  }, [cellPoint, doHowl, finishRound, floatLabel, later, openCelebration, shake, showCallout, sound, t, format, loc, symbolLabels]);

  /* ---------------------------------------------------------------- starting rounds */
  const begin = useCallback((current: LiveRound, text: string) => {
    clearTimers();
    live.current = current;
    setError(''); setPhase('playing'); setRoundBet(current.bet);
    setFree(false); setFreeInfo(null); setMeterDur(0); setMeter(ZERO); setCard(null); setBanner(null); setCallout(null); setBurst(null); setFlourish(0); setMood('base');
    setPieces(NO_PIECES); setGlobalMult(1);
    fx.current?.clearEcho(); scene.current?.ergenekon(0);
    setAnnounce(text);
    sound.unlock();
    sound.scene('base');
    sound.spinStart();
    const next = new TimelinePlayer<AsenaEvent>(current.timeline, event => { if (live.current === current) handle(event); }, undefined, ASENA_PLAYER_MAX_STEP_MS);
    player.current = next;
    next.start();
  }, [clearTimers, handle, sound]);

  const gated = mode === 'live';
  const busy = phase === 'playing';
  const booting = boot.phase !== 'done';

  const makeLive = useCallback((fields: Omit<LiveRound, 'timeline' | 'prefix' | 'reduced' | 'lite' | 'settled'>): LiveRound => {
    const s = settingsRef.current;
    return { ...fields, timeline: buildAsenaTimeline(fields.round, asenaTimelineOptions(s, reducedMotion)), prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects, settled: false };
  }, [reducedMotion]);

  /** Remote round: the server resolves and settles it; the spin stays locked until its round has been presented. */
  const startRemote = useCallback((source: RemoteRoundSource, roundMode: AsenaMode, cost: number, balanceBefore: number) => {
    const betCents = bet;
    pendingRemote.current = true;
    setError(''); setPhase('playing'); setActiveDemo(true); setReplaying(null);
    setRemoteBalance(balanceBefore - cost);
    setAnnounce(t('announce.sentToServer', { amount: format.number(cost / 100) }));
    source.client.play('asena', betCents, roundMode).then(play => {
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
    const roundMode: AsenaMode = kind === 'buy' ? 'buy' : ante ? 'ante' : 'standard';
    if (kind === 'buy' && ante) return false;
    const cost = asenaCost(bet, roundMode);
    const balanceBefore = balanceRef.current;
    if (cost > balanceBefore) {
      setError(t('errors.insufficient', { kind: roundMode, cost: format.demo(cost) }));
      sound.denied();
      return false;
    }
    if (remote) { startRemote(remote, roundMode, cost, balanceBefore); return true; }
    let round: AsenaRound;
    try { round = localRoundSource.resolve('asena', bet, roundMode); } catch { setError(t('errors.entropy')); return false; }
    let id: string | null;
    try { id = reserveDemo(cost, asenaLedgerLimits(bet, roundMode)); } catch { setError(t('errors.entropy')); return false; }
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
    const current = makeLive({ id: `remote:${receipt.roundId}`, replayOf: null, bet: receipt.betCents, cost: receipt.costCents, mode: receipt.mode, balanceBefore: after + receipt.costCents - receipt.payoutCents, round, remote: { receipt, balanceAfter: after } });
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
  const presentReplay = useCallback((round: AsenaRound, recordId: string | null, text: string) => {
    const current = makeLive({ id: null, replayOf: recordId, bet: round.betCents, cost: round.costCents, mode: round.mode, balanceBefore: balanceRef.current, round, remote: null });
    setReplaying({ recordId, seed: round.seedHex });
    begin(current, text);
  }, [begin, makeLive]);
  const replay = useCallback((record: DemoRecord) => {
    const meta = record.asena;
    if (!meta || (live.current && !live.current.settled) || autoRef.current || booting) return;
    let round: AsenaRound;
    try { round = playAsenaRound(meta.seedHex, meta.betCents, meta.mode); } catch { showToast(t('toast.replayFailed'), 'warn'); return; }
    if (round.payoutCents !== record.payout || round.costCents !== meta.costCents) { showToast(t('toast.replayMismatch'), 'warn'); return; }
    stageRef.current?.scrollIntoView({ block: 'start' });
    presentReplay(round, record.id, t('announce.replaying', { id: asenaRoundId(meta.seedHex) }));
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
    const timer = window.setTimeout(() => setCallout(c => (c?.key === callout.key ? null : c)), callout.life);
    return () => window.clearTimeout(timer);
  }, [callout]);
  useEffect(() => {
    if (!burst) return;
    const timer = window.setTimeout(() => setBurst(c => (c?.key === burst.key ? null : c)), burst.life + 60);
    return () => window.clearTimeout(timer);
  }, [burst]);
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(x => (x?.key === banner.key ? null : x)), 2200);
    return () => window.clearTimeout(timer);
  }, [banner]);

  /* Development-only previews (visual QA): celebration screens, callouts, the Ergenekon burst and a ledger-free engine
     round from a seed (presented exactly like a history replay). They never reserve or settle anything; production
     builds drop them (NODE_ENV is inlined). */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const win = window as unknown as { __asenaPreview?: unknown };
    const idle = () => !(live.current && !live.current.settled) && !player.current;
    win.__asenaPreview = {
      celebrate: (totalHundredths: number, capped = false, betCents = 1000) => {
        if (!idle()) return false;
        const s = settingsRef.current, opts = asenaTimelineOptions(s, reducedMotion);
        const schedule = countUpSchedule(totalHundredths, capped, opts);
        const dur = schedule.countUp + schedule.hold;
        const timeline = { events: [
          { type: 'big-win', at: 0, dur, tier: schedule.finalLevel, totalHundredths, capped, countUp: schedule.countUp, schedule, hold: true } as AsenaEvent,
          { type: 'end', at: dur, dur: 0, totalHundredths, payoutCents: asenaCents(betCents, totalHundredths), capped } as AsenaEvent,
        ] };
        const preview = new TimelinePlayer<AsenaEvent>(timeline, event => {
          if (event.type === 'big-win') openCelebration(event.schedule, betCents, event.at, event.dur, reducedMotion, reducedMotion || s.reducedEffects);
          else if (event.type === 'end') { setCard(null); setMood('base'); board.current?.dim(false); sound.countUp(false); player.current = null; }
        });
        player.current = preview;
        preview.start();
        return true;
      },
      callout: (value: number) => { showCallout(value, reducedMotion); return true; },
      ergenekon: (level: 1 | 2 | 3) => { setBurst({ key: ++burstKey.current, level, multiplier: [1, 2, 3, 5][level]!, life: 1500 }); scene.current?.ergenekon(level); return true; },
      play: (seedHex: string, mode: AsenaMode = 'standard', betCents = 1000) => {
        if (!idle() || autoRef.current) return false;
        presentReplay(playAsenaRound(seedHex, betCents, mode), null, 'Önizleme turu: bakiye değişmez.');
        return true;
      },
      time: () => player.current?.time ?? null,
    };
    return () => { delete win.__asenaPreview; };
  }, [openCelebration, presentReplay, reducedMotion, showCallout, sound]);

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
    const gap = ASENA_AUTOPLAY_GAP[settingsRef.current.spinSpeed];
    const timer = window.setTimeout(() => {
      const state = autoRef.current; if (!state) return;
      const decision = asenaAutoplayBeforeSpin(state, { balanceCents: balanceRef.current, betCents: bet, ante, tabHidden: document.hidden });
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
  const roundMode: AsenaMode = ante ? 'ante' : 'standard';
  const spinCost = asenaCost(bet, roundMode);
  const buyPrice = asenaCost(bet, 'buy');
  const buyBlock = asenaBuyBlock({ betCents: bet, balanceCents: balance, ante, autoplay: auto !== null, busy, gated });
  const buyReason = buyBlock ? t(`buy.block.${buyBlock.code}`, { price: format.demo(buyPrice) }) : null;
  const locked = busy || auto !== null || gated || booting || sourcePending;
  const amountCents = (h: number) => (roundBet === null ? 0 : asenaCents(roundBet, h));
  const boardLabel = free ? t('board.labelFree') : t('board.labelPlay');
  const boardMood = free ? 'feature' : 'base';
  const boardElement = useMemo(() => (
    <AsenaFrame mood={boardMood}>
      <AsenaBoard ref={board} mood={boardMood} label={boardLabel} />
    </AsenaFrame>
  ), [boardLabel, boardMood]);
  const celebrating = card?.kind === 'big' || card?.kind === 'outro' || card?.kind === 'intro';
  const infoPages = useMemo(() => asenaInfoPages(bet, { t, tk, tc, format }), [bet, t, tk, tc, format]);
  const outOfCredit = !busy && balance < ASENA_MIN_BET_CENTS;
  const deckWin = busy ? amountCents(meter.total) : (lastWin?.payout ?? 0);
  const speedIndex = SPIN_SPEEDS.indexOf(settings.spinSpeed);
  const replayInfo = replaying ? t('replay.ribbon', { id: asenaRoundId(replaying.seed) }) : null;
  const distinct = pieces.filter(p => p > 0).length;

  const openInfo = (page = 'how') => { setInfoPage(page); setModal('info'); sound.click(); };
  const refill = () => {
    if (busy || auto) return;
    if (remote) {
      if (pendingRemote.current) return;
      remote.client.resetBalance().then(cents => {
        setRemoteBalance(cents);
        const at = Date.now();
        recordRemote({ id: `remote-reset:${at}`, game: 'Asena', stake: 0, payout: 0, detail: 'Bakiye yenilendi (sunucu)', at, kind: 'reset' });
        showToast(t('toast.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); setError(''); setAnnounce(t('announce.refilledRemote', { amount: format.number(DEMO_START_CENTS / 100) }));
      }, (failure: unknown) => showToast(rgs.error(failure), 'warn'));
      return;
    }
    if (resetDemoBalance('Asena')) { showToast(t('toast.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); setError(''); setAnnounce(t('announce.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); }
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
    setAnnounce(next ? t('announce.anteOn', { cost: format.demo(asenaCost(bet, 'ante')) }) : t('announce.anteOff', { cost: format.demo(bet) }));
  };
  const onSpinClick = () => { if (busy) return; startRound('spin'); };
  const confirmBuy = () => { if (buyReason) return; setModal(null); startRound('buy'); };

  const deck = (
    <BetSelector
      ladder={ASENA_BET_LADDER}
      valueCents={bet}
      onChange={chooseBet}
      balanceCents={balance}
      maxBetCents={ASENA_MAX_BET_CENTS}
      costMode={ASENA_COST_MODES[roundMode]}
      modeLabel={ante ? tc('modes.ante') : undefined}
      disabled={locked}
      classNames={{ minus: styles.stepBtn, plus: styles.stepBtn, value: styles.betValue, max: styles.maxChip }}
      render={parts => (
        <div className={`${kit.kit} ${styles.deck}`} data-auto={auto ? '' : undefined} role="group" aria-label={t('deck.group')}>
          <div className={styles.cellBalance}>
            <span className={styles.cellLabel}>{t('deck.balance')}</span>
            <strong className={styles.cellValue} data-testid="asena-balance">{format.amount(balance)}<small> DEMO</small></strong>
            <button type="button" className={styles.refill} onClick={refill} disabled={busy || auto !== null || gated} aria-label={t('deck.refill')}><RefillIcon /><span aria-hidden="true">{t('deck.refill')}</span></button>
          </div>
          <div className={styles.cellWin}>
            <span className={styles.cellLabel}>{busy ? (replaying ? t('deck.winReplay') : t('deck.win')) : lastWin?.replay ? t('deck.winReplayLast') : t('deck.winLast')}</span>
            <strong className={`${styles.cellValue} ${deckWin > 0 ? styles.cellWinOn : ''}`}>{format.amount(deckWin)}<small> DEMO</small></strong>
          </div>
          <div className={styles.cellBet}>
            {parts.label}
            {parts.value}
            <span className={styles.costLine} data-testid="asena-cost">{t('deck.cost')} <strong>{format.amount(spinCost)} DEMO</strong>{ante && <em> · {format.factor(ASENA_COST_MODES.ante.num, ASENA_COST_MODES.ante.den)}</em>}</span>
          </div>
          <div className={styles.areaMinus}>{parts.minus}</div>
          <div className={styles.areaPlus}>{parts.plus}</div>
          <div className={styles.areaMax}>{parts.max}</div>
          <div className={styles.areaSpin}>
            {auto ? (
              <AutoplayStopButton className={styles.stop} remaining={auto.spinsRemaining} onStop={() => stopAutoplay('cancelled', 'info')} />
            ) : (
              <button type="button" className={`${styles.spin} ${busy ? styles.spinning : ''}`} onClick={onSpinClick} disabled={busy || gated || booting || sourcePending}
                aria-label={t('deck.spin')} aria-describedby="as-spin-cost" data-locked={busy || undefined} data-testid="asena-spin">
                <span className={styles.spinFace}><SpinSeal /></span>
                {busy && <span className={styles.spinLock} aria-hidden="true"><LockIcon /></span>}
              </button>
            )}
            <span id="as-spin-cost" className="sr-only">{busy ? t('deck.spinLocked') : t('deck.spinCost', { cost: format.demo(spinCost) })}</span>
          </div>
          <button type="button" className={`${styles.tool} ${styles.areaAuto}`} onClick={() => { sound.click(); setModal('autoplay'); }} disabled={locked} aria-haspopup="dialog">
            <LoopIcon /><span>{t('deck.auto')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaInfo}`} onClick={() => openInfo()} aria-haspopup="dialog" aria-label={t('deck.infoAria')}>
            <InfoIcon /><span>{t('deck.info')}</span>
          </button>
          <button type="button" role="switch" aria-checked={ante} className={`${styles.feature} ${styles.areaAnte} ${ante ? styles.featureOn : ''}`} onClick={toggleAnte} disabled={locked}
            aria-label={tc('modes.ante')} aria-describedby="as-ante-desc">
            <span className={styles.featureTitle}>{tc('modes.ante')}</span>
            <span className={styles.featureState}>{ante ? t('deck.on') : t('deck.off')}<span className={styles.featureFactor}> · {format.factor(ASENA_COST_MODES.ante.num, ASENA_COST_MODES.ante.den)}</span></span>
            <span id="as-ante-desc" className={styles.featureDesc}>{t('deck.anteDesc')}</span>
          </button>
          <button type="button" className={`${styles.feature} ${styles.featureBuy} ${styles.areaBuy}`} aria-disabled={buyReason ? true : undefined}
            onClick={() => { if (buyReason) sound.denied(); else sound.click(); setModal('buy'); }} aria-haspopup="dialog" aria-describedby="as-buy-desc">
            <span className={styles.featureTitle}>{t('deck.buy')}</span>
            <span className={styles.featureState}>{format.amount(buyPrice, { trimZeros: true })} DEMO</span>
            <span id="as-buy-desc" className={styles.featureDesc}>{buyReason ?? t('deck.buyDesc', { spins: 10, rtp: asenaRtp(ASENA_RTP.buy.rtp, loc) })}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSet}`} onClick={() => { sound.click(); setModal('settings'); }} aria-haspopup="dialog" aria-label={tk('settings.title')}>
            <GearIcon /><span>{tk('settings.title')}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSpeed} ${speedIndex > 0 ? styles.toolOn : ''}`} onClick={cycleSpeed} aria-label={t('deck.speedAria', { speed: tk(SPEED_KEY[settings.spinSpeed]) })}>
            <SpeedStars count={speedIndex + 1} /><span>{tk(SPEED_KEY[settings.spinSpeed])}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSound} ${!settings.muted ? styles.toolOn : ''}`} onClick={toggleSound} aria-pressed={!settings.muted} aria-label={t('deck.sound')}>
            <SoundIcon on={!settings.muted} /><span>{t('deck.sound')}</span>
          </button>
          <div className={styles.areaMsg}>
            {soundLoad.started && !soundLoad.ready && !settings.muted && <p className={styles.msgHint} role="status">{t('deck.soundLoading', { percent: soundLoad.percent })}</p>}
            {error ? <p className={styles.msgError} role="alert">{error}</p>
              : outOfCredit ? <p className={styles.msgHint}>{t('deck.outOfCredit')} <button type="button" className={styles.inlineLink} onClick={refill}>{t('deck.refill')}</button></p>
              : <p className={styles.msgHint}>{lastWin && !busy ? (lastWin.payout > 0 ? richText(t, 'deck.lastWin', { money: asenaMoney(lastWin.payout, loc), times: asenaTimes(lastWin.total, loc) }) : t('deck.lastNone')) : settings.spaceToSpin ? t('deck.hintSpace') : t('deck.hintFixed')}</p>}
          </div>
        </div>
      )}
    />
  );

  return (
    <div className={`game-page ${styles.page}`}>
      <AsenaSymbolSprites />
      <GameHeading title={t('title')} subtitle={t('subtitle')} mode={mode} setMode={setMode} active={busy || auto !== null}
        badge={remote ? rgs.source('remote') : sourcePending ? t('badge.checking') : rgs.source('local')} />
      <section className={`game-table ${styles.table}`} aria-label={t('table')} data-free={free || undefined}>
        <AsenaScene ref={scene} mood={mood} className={styles.scene}>
          <div className={styles.layout}>
            <div className={styles.left}>
              <div className={styles.leftLogo}><AsenaLogo subtitle={!phone} /></div>
              <div className={styles.mapWrap} data-active={free || undefined}>
                <AsenaSkyMap ref={skyMap} pieces={pieces} multiplier={globalMult} inactive={!free} orientation={narrow ? 'row' : 'column'} />
              </div>
            </div>
            <div ref={stageRef} className={styles.stage} data-phase={phase} data-celebrate={celebrating || undefined} data-replay={replayInfo ? '' : undefined}>
              <div ref={shakeRef} className={styles.column}>
                <div className={styles.hud}>
                  {freeInfo ? (
                    <div className={styles.freeCounter} aria-label={t('hud.freeAria', { number: freeInfo.number, left: freeInfo.left })} data-testid="asena-free-counter">
                      <span className={styles.freeTag}>{freeInfo.number > 0 ? t('hud.freeSpin', { n: freeInfo.number }) : t('hud.free')}</span>
                      <span className={styles.freeLeft}><small>{t('hud.left')}</small><strong key={freeInfo.left}>{freeInfo.left}</strong></span>
                    </div>
                  ) : (
                    <div className={styles.chip} aria-label={t('hud.moonAria')}><span className={styles.chipArt} aria-hidden="true"><AsenaSymbolArt symbol="moon" size="100%" /></span><span><span className={styles.wideOnly}>{richText(t, 'hud.moonLong')}</span><span className={styles.narrowOnly}>{richText(t, 'hud.moonShort')}</span></span></div>
                  )}
                  {free ? (
                    <div key={globalMult} className={styles.globalChip} data-level={asenaErgenekonLevel(globalMult)} data-testid="asena-global" aria-label={t('hud.globalAria', { multiplier: globalMult, distinct })}>
                      <span><small>{t('hud.global')}</small><strong>×{globalMult}</strong></span>
                      <span><small>{t('hud.map')}</small><strong>{distinct}/6</strong></span>
                    </div>
                  ) : freeInfo ? null : (
                    <div className={`${styles.chip} ${styles.chipSide}`} aria-hidden="true"><span className={styles.wideOnly}><AsenaTemplateGlyph id="kurt-basi" className={styles.chipGlyph} /></span><span>{richText(t, 'hud.templateChip', { multiplier: 10, max: format.number(5000, 0) })}</span></div>
                  )}
                </div>
                <div className={styles.boardWrap}>{boardElement}</div>
                {/* One cumulative meter: never resets inside a round (tumbles, constellations, every free spin add up). */}
                <div ref={meterRef} className={`${styles.meter} ${free ? styles.meterFree : ''}`} data-testid="asena-meter">
                  {phase === 'idle' ? (
                    <div className={styles.meterIdle}><span>{richText(t, 'meter.idleA')}</span><span aria-hidden="true" className={styles.wideOnly}>·</span><span className={styles.wideOnly}>{t('meter.idleB')}</span><span aria-hidden="true">·</span><span>{richText(t, 'meter.idleC')}</span></div>
                  ) : (
                    <div className={styles.meterPart}>
                      <small>{free || phase === 'done' ? t('meter.total') : t('meter.win')}</small>
                      <strong data-testid="asena-meter-total"><CountUp cents={amountCents(meter.total)} duration={meterDur} locale={loc} /><em> DEMO</em></strong>
                    </div>
                  )}
                  {flourish > 0 && phase !== 'idle' && <span key={flourish} className={styles.meterShine} aria-hidden="true" />}
                </div>
              </div>
              <div ref={layerRef} className={styles.fxLayer} aria-hidden="true" />
              {replayInfo && <div className={styles.replayRibbon} data-testid="asena-replay"><Icon name="history" size={15} /><span>{replayInfo}</span></div>}
              {auto && !replayInfo && <div className={styles.autoRibbon} aria-hidden="true"><LoopIcon /><span>{t('auto.ribbon', { spins: auto.spinsRemaining })}</span></div>}
              {toast && (
                <div key={`toast-${toast.key}`} className={`${styles.toast} ${toast.tone === 'warn' ? styles.toastWarn : ''}`} data-testid="asena-toast">
                  <span>{toast.text}</span>
                  <button type="button" className={styles.toastClose} onClick={() => setToast(null)} aria-label={t('toast.close')}><svg {...svg} width={16} height={16}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
                </div>
              )}
              {banner && <div key={`banner-${banner.key}`} className={`${styles.banner} ${banner.tone === 'ice' ? styles.bannerIce : banner.tone === 'aurora' ? styles.bannerAurora : ''}`} data-testid="asena-banner" data-key={banner.key} aria-hidden="true">{banner.text}</div>}
              {callout && (
                <div key={`callout-${callout.key}`} className={styles.callout} data-tier={callout.tier} style={{ animationDuration: `${callout.life}ms` }} aria-hidden="true" data-testid="asena-callout" data-key={callout.key}>
                  <span className={styles.calloutGlow} />
                  <span className={styles.calloutTag}>{t(CALLOUT_KEY[callout.tier])}</span>
                  <span className={styles.calloutText} data-text={`×${callout.value}`}><span className={styles.calloutFill}>×{callout.value}</span></span>
                </div>
              )}
              {burst && <AsenaErgenekonBurst key={`erg-${burst.key}`} level={burst.level} multiplier={burst.multiplier} life={burst.life} reducedMotion={reducedMotion} />}
            </div>
            <div ref={sideRef} className={styles.side}>
              {deck}
            </div>
            <canvas ref={frontRef} className={styles.front} aria-hidden="true" />
            {/* Hold screens sit over the stage and above the FX canvas (the sky gate and star showers stay behind them). */}
            <div className={styles.cards} data-active={celebrating || gated || undefined}>
                {card?.kind === 'intro' && <AsenaFreeIntro key={`intro-${card.at}`} awarded={card.awarded} dur={card.dur} reducedMotion={reducedMotion} onTap={advanceHold} />}
                {card?.kind === 'outro' && (
                  <AsenaFeatureTotal key={`outro-${card.at}`} spins={card.spins} totalHundredths={card.total} constellations={card.constellations} distinct={card.distinct} globalMultiplier={card.globalMultiplier} wolfSteps={card.wolfSteps} betCents={card.bet}
                    celebration={card.celebration} capped={card.capped} dur={card.dur} elapsed={cardElapsed} reducedMotion={reducedMotion} onTap={advanceHold} />
                )}
                {card?.kind === 'big' && (
                  <AsenaCelebration key={`big-${card.at}`} schedule={card.schedule} betCents={card.bet} elapsed={cardElapsed} reducedMotion={reducedMotion}
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
        </AsenaScene>
        {boot.phase !== 'done' && (
          <div className={styles.splash} data-testid="asena-splash">
            <div className={styles.splashCard}>
              <div className={styles.splashLogo}><AsenaLogo /></div>
              <ul className={styles.splashFeatures}>
                <li><span aria-hidden="true"><AsenaTemplateGlyph id="kurt-basi" /></span><strong>{t('splash.constellation.title')}</strong><small>{t('splash.constellation.text')}</small></li>
                <li><span aria-hidden="true"><AsenaSymbolArt symbol="wolf" size="100%" /></span><strong>{t('splash.wolf.title')}</strong><small>{t('splash.wolf.text')}</small></li>
                <li><span aria-hidden="true"><AsenaSymbolArt symbol="moon" size="100%" /></span><strong>{t('splash.ergenekon.title', { max: format.number(5000, 0) })}</strong><small>{t('splash.ergenekon.text')}</small></li>
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
              <p className={styles.splashNote}>{t('splash.note', { rtp: asenaRtp(ASENA_RTP.standard.rtp, loc) })}</p>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <SessionBar className={styles.sessionBar} nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <AsenaHistory onReplay={replay} replayDisabled={busy || auto !== null || booting} replayingId={replaying?.recordId ?? null} onShare={remote ? shareRound : undefined} />
      <StaticFooter remote={remote !== null} />

      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title={tk('settings.title')} size="md">
        <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
        <p className={styles.modalNote} role="status">{soundLoad.ready ? t('settings.soundReady') : soundLoad.started ? t('settings.soundLoading', { percent: soundLoad.percent }) : t('settings.soundIdle')}</p>
        <section className={styles.demoBox} aria-labelledby="as-demo-title">
          <h3 id="as-demo-title">{t('settings.demoTitle')}</h3>
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
        rtpText={t('buy.rtp', { buy: asenaRtp(ASENA_RTP.buy.rtp, loc), standard: asenaRtp(ASENA_RTP.standard.rtp, loc) })}
        description={richText(t, 'buy.text', { bet: format.demo(bet), max: format.demo(bet * 5000) })}
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
