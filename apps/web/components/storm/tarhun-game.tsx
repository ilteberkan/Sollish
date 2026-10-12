'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { STORM_RTP, playStormRound, stormSeedFromEntropy, type StormMode, type StormRound } from '@sollish/protocol';
import { demoNumber } from '@/lib/demo';
import {
  STORM_FULL_WINDUP_MS, buildStormTimeline, stormCalloutTier, stormCents, stormHistoryDetail, stormMoney, stormTimes, stormWinAnnouncement,
  type StormCalloutTier, type StormEvent, type StormHeroPose, type StormMeter, type StormTimeline,
} from '@/lib/storm-timeline';
import { WIN_TIER_INFO, countUpSchedule, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { TimelinePlayer } from '@/lib/slot-kit/timeline-player';
import { AUTOPLAY_STOP_REASONS, autoplayNetLossCents, createAutoplay, type AutoplayConfig, type AutoplayState } from '@/lib/slot-kit/autoplay';
import { formatAmount, formatDemo, formatSignedDemo } from '@/lib/slot-kit/bet';
import { SPIN_SPEEDS, type SpinSpeed } from '@/lib/slot-kit/settings';
import {
  STORM_AUTOPLAY_GAP, STORM_BET_LADDER, STORM_COST_MODES, STORM_DEFAULT_BET_CENTS, STORM_MAX_BET_CENTS, STORM_MIN_BET_CENTS,
  stormAutoplayAfterRound, stormAutoplayBeforeSpin, stormBuyBlockReason, stormCost, stormLedgerLimits, stormRoundId, stormRtp, stormTimelineOptions,
} from '@/lib/storm-controls';
import { useProduct, type DemoRecord } from '../providers';
import { DemoNotice, GameHeading, Rules, type Mode } from '../game-common';
import { Icon } from '../icons';
import {
  AutoplayPanel, AutoplayStopButton, BetSelector, BuyFeatureDialog, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, useSession, useSlotSettings,
} from '../slot-kit';
import kit from '../slot-kit/kit.module.css';
import { StormCharacter, type StormCharacterHandle, type StormPose } from './character';
import { StormFrame } from './frame';
import { StormLogo } from './logo';
import { StormScene, type StormMood, type StormSceneHandle } from './scene';
import { StormBoard, type StormBoardHandle } from './storm-board';
import { StormCelebration, StormFeatureTotal, StormFreeIntro } from './storm-celebration';
import { StormFx, STORM_SYMBOL_COLORS } from './storm-fx';
import { StormHistory } from './storm-history';
import { stormInfoPages } from './storm-info-pages';
import { STORM_SYMBOL_LABELS, StormSymbolArt, StormSymbolSprites, orbTier } from './symbols';
import { useStormSound } from './use-storm-sound';
import styles from './tarhun-game.module.css';

/* Lifecycle: entropy -> engine storm-throne-1 resolves the whole round (bet + mode) -> one reservation of the mode
   cost -> the timeline replays it -> exactly one settlement with the engine payout (at the end, or on unmount).
   Spin lock (game-standards §6): once a round starts the spin button and Space stay locked until the whole round,
   every tumble, orb strike and free spin included, has played; there is no skip. Speed comes from the quick/turbo
   setting; only the hold screens may be tapped (that moves the presentation clock, never a result). A replay from
   the history uses the same engine call and never touches the ledger. */

type LiveRound = {
  id: string | null; replayOf: string | null;
  bet: number; cost: number; mode: StormMode; balanceBefore: number;
  round: StormRound; timeline: StormTimeline; prefix: string; reduced: boolean; lite: boolean; settled: boolean;
};
type Phase = 'idle' | 'playing' | 'done';
type Card =
  | { kind: 'intro'; awarded: number; at: number; dur: number }
  | { kind: 'outro'; spins: number; total: number; totalMultiplier: number; strikes: number; celebration: boolean; capped: boolean; bet: number; at: number; dur: number }
  | { kind: 'big'; schedule: CountUpSchedule; bet: number; at: number; dur: number };
type Callout = { key: number; value: number; tier: StormCalloutTier; free: boolean; x: number; y: number; life: number };
type Banner = { key: number; text: string; tone: 'gold' | 'storm' };
type Toast = { key: number; text: string; tone: 'info' | 'warn' };
/** Multiplier meter: base = this spin's orb parts; free = the persistent total. */
type MultMeter = { mode: 'base' | 'free'; parts: number[]; value: number; settled: boolean } | null;
type ModalId = 'settings' | 'info' | 'autoplay' | 'buy' | null;
type Boot = { phase: 'loading' | 'ready' | 'done'; progress: number };

const ENTROPY_ERROR = 'Güvenli yerel rastgelelik kullanılamıyor. Demo başlatılmadı.';
const CALLOUT_TAGS: Record<StormCalloutTier, string> = { 0: 'Çarpan', 1: 'Güçlü çarpan', 2: 'Gürleyen çarpan', 3: 'Yıkıcı çarpan', 4: 'Efsane çarpan', 5: 'Gök gürültüsü', 6: 'Tanrısal çarpan' };
const SPEED_LABELS: Record<SpinSpeed, string> = { normal: 'Normal', quick: 'Hızlı', turbo: 'Turbo' };
const ZERO: StormMeter = { spin: 0, total: 0 };
const BET_KEY = 'sollish:tarhun:bet';
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
  const value = (window as unknown as { __tarhunRealityMs?: unknown }).__tarhunRealityMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? value : undefined;
}

/** Count-up number that writes its own text node (no React re-render per frame). */
function CountUp({ cents, duration }: { cents: number; duration: number }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(cents);
  const [initial] = useState(() => stormMoney(cents));
  useEffect(() => {
    const el = node.current; if (!el) return;
    const from = shown.current, to = cents;
    if (duration <= 0 || from === to || typeof requestAnimationFrame === 'undefined') { shown.current = to; el.textContent = stormMoney(to); return; }
    const start = performance.now(); let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      shown.current = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
      el.textContent = stormMoney(shown.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); shown.current = to; el.textContent = stormMoney(to); };
  }, [cents, duration]);
  return <span ref={node}>{initial}</span>;
}

/* ------------------------------------------------------------------ icons (original, inline) */
const svg = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, focusable: false } as const;
/** Spin sigil: a forked lightning bolt inside a ring of eight wedge notches (Tarhun's storm seal). */
function SpinSigil() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="tzSpinBolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".5" stopColor="#d8f6ff" /><stop offset="1" stopColor="#7fd2ff" /></linearGradient>
      </defs>
      <g className={styles.sigilRing}>
        {Array.from({ length: 8 }, (_, i) => <path key={i} d="M50 6 55 15H45Z" transform={`rotate(${i * 45} 50 50)`} fill="#3a1d06" opacity=".55" />)}
        <circle cx="50" cy="50" r="33" fill="none" stroke="#3a1d06" strokeOpacity=".45" strokeWidth="3" strokeDasharray="4 6" />
      </g>
      <path d="M56 14 34 54h14l-8 32 28-42H54l9-30Z" fill="#20314a" opacity=".55" transform="translate(2 3)" />
      <path d="M56 14 34 54h14l-8 32 28-42H54l9-30Z" fill="url(#tzSpinBolt)" stroke="#0e2440" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
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

const StaticFooter = memo(function StaticFooter() { return <><DemoNotice /><Rules game="Tarhun" /></>; });
const HeroFigure = memo(StormCharacter);
const MemoFrame = memo(StormFrame);

export function TarhunGame() {
  const { reserveDemo, settleDemo, setActiveDemo, demoBalance, resetDemoBalance } = useProduct();
  const router = useRouter();
  const { settings, update: updateSettings, reset: resetSettings } = useSlotSettings('tarhun');
  const [realityMs] = useState(realityIntervalOverride);
  const session = useSession(realityMs ? { realityIntervalMs: realityMs } : {});
  const recordSession = session.recordRound;
  const { sound, loadState: soundLoad } = useStormSound(settings);
  const [mode, setMode] = useState<Mode>('demo');
  const [bet, setBet] = useState(STORM_DEFAULT_BET_CENTS);
  const [ante, setAnte] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [free, setFree] = useState(false);
  const [freeInfo, setFreeInfo] = useState<{ number: number; left: number } | null>(null);
  const [meter, setMeter] = useState<StormMeter>(ZERO);
  const [meterDur, setMeterDur] = useState(0);
  const [roundBet, setRoundBet] = useState<number | null>(null);
  const [mult, setMult] = useState<MultMeter>(null);
  const [multPunch, setMultPunch] = useState(0);
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
  const [heroPose, setHeroPose] = useState<StormPose>('idle');
  const [mood, setMood] = useState<StormMood>('base');
  const reducedMotion = usePrefersReducedMotion();

  const scene = useRef<StormSceneHandle>(null);
  const hero = useRef<StormCharacterHandle>(null);
  const board = useRef<StormBoardHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const multRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const fx = useRef<StormFx | null>(null);
  const player = useRef<TimelinePlayer<StormEvent> | null>(null);
  const live = useRef<LiveRound | null>(null);
  const settledIds = useRef(new Set<string>());
  const sequence = useRef(0);
  const bannerKey = useRef(0);
  const toastKey = useRef(0);
  const calloutKey = useRef(0);
  /** Orbs whose bolt is drawn when the character's strike promise resolves (full wind-up). */
  const promisedBolts = useRef(new Set<number>());
  const celebrateFx = useRef({ reduced: false, lite: false });
  const autoRef = useRef<AutoplayState | null>(null);
  autoRef.current = auto;
  const balanceRef = useRef(demoBalance);
  balanceRef.current = demoBalance;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------------------------------------------------------------- setup */
  useEffect(() => {
    const stage = stageRef.current, canvas = canvasRef.current, layer = layerRef.current;
    if (stage && canvas && layer) fx.current = new StormFx(canvas, layer, stage);
    return () => { fx.current?.dispose(); fx.current = null; };
  }, []);
  useEffect(() => { if (fx.current) fx.current.lite = reducedMotion || settings.reducedEffects; }, [reducedMotion, settings.reducedEffects]);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(BET_KEY));
      if (STORM_BET_LADDER.includes(stored)) setBet(stored);
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
    settleDemo({
      id: current.id, game: 'Tarhun', stake: current.cost, payout: round.payoutCents, detail: stormHistoryDetail(round), at: Date.now(), kind: 'round',
      storm: { engine: round.engine, seedHex: round.seedHex, betCents: current.bet, mode: current.mode, costCents: current.cost },
    });
    recordSession({ costCents: current.cost, payoutCents: round.payoutCents });
    setActiveDemo(false);
  }, [settleDemo, setActiveDemo, recordSession]);

  // Leaving the page mid-show still closes the round once, with the full engine payout.
  const settleRef = useRef(settle); settleRef.current = settle;
  useEffect(() => () => {
    player.current?.stop(); player.current = null;
    const current = live.current;
    if (current && !current.settled) settleRef.current(current);
  }, []);

  const stopAutoplay = useCallback((reason: string, tone: Toast['tone'] = 'warn') => {
    const state = autoRef.current;
    if (!state) return;
    autoRef.current = null;
    setAuto(null);
    sound.autoplay(false);
    const net = -autoplayNetLossCents(state);
    showToast(`Otomatik oyun durdu: ${reason}. ${state.spinsDone} tur, net ${formatSignedDemo(net)}.`, tone);
    setAnnounce(`Otomatik oyun durdu: ${reason}.`);
  }, [showToast, sound]);

  const finishRound = useCallback((current: LiveRound) => {
    settle(current);
    setPhase('done');
    sound.countUp(false);
    setMood('base');
    const { round } = current;
    setLastWin({ payout: round.payoutCents, total: round.totalHundredths, replay: current.id === null });
    sound.scene('base');
    if (current.id === null) {
      setReplaying(null);
      setAnnounce(`Tekrar bitti: ${demoNumber(round.payoutCents)} DEMO, ${stormTimes(round.totalHundredths)}×. Bakiye değişmedi.`);
      return;
    }
    const state = autoRef.current;
    if (state) {
      const next = stormAutoplayAfterRound(state, { costCents: current.cost, payoutCents: round.payoutCents, featureTriggered: round.freeSpinsTriggered, balanceBeforeCents: current.balanceBefore });
      autoRef.current = next;
      setAuto(next);
    }
    setAnnounce(round.payoutCents > 0 ? `Tur bitti. Toplam kazanç ${demoNumber(round.payoutCents)} DEMO, ${stormTimes(round.totalHundredths)}×.` : 'Tur bitti. Kazanç yok.');
  }, [settle, sound]);

  /* ---------------------------------------------------------------- presentation helpers */
  /** Board centre / cell size relative to the stage. */
  const boardCentre = useCallback(() => {
    const stage = stageRef.current, cells = stage?.querySelector('[data-cells]');
    if (!stage || !cells) return { x: 0, y: 0, cell: 60 };
    const a = cells.getBoundingClientRect(), b = stage.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2, cell: a.width / 6 };
  }, []);
  const cellPoint = useCallback((x: number, y: number) => {
    const stage = stageRef.current, cells = stage?.querySelector('[data-cells]');
    if (!stage || !cells) return { x: 0, y: 0, cell: 60 };
    const a = cells.getBoundingClientRect(), b = stage.getBoundingClientRect();
    return { x: a.left - b.left + (x / 6) * a.width, y: a.top - b.top + (y / 5) * a.height, cell: a.width / 6 };
  }, []);
  const clientCentre = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  const shake = useCallback((strength: number, duration = 360) => {
    const frames: Keyframe[] = [
      { transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-strength}px, ${strength * 0.6}px, 0)` }, { transform: `translate3d(${strength}px, ${-strength * 0.4}px, 0)` },
      { transform: `translate3d(${-strength * 0.7}px, ${-strength * 0.5}px, 0)` }, { transform: `translate3d(${strength * 0.5}px, ${strength * 0.3}px, 0)` },
      { transform: `translate3d(${-strength * 0.3}px, ${strength * 0.15}px, 0)` }, { transform: 'translate3d(0,0,0)' },
    ];
    shakeRef.current?.animate(frames, { duration, easing: 'ease-out' });
    stageRef.current?.querySelectorAll('[data-shake]').forEach(el => el.animate(frames, { duration, easing: 'ease-out' }));
  }, []);

  /** Big multiplier announcement over the board (game-standards §6), with its own sound and voice line. */
  const showCallout = useCallback((value: number, isFree: boolean, reduced: boolean, lite: boolean, life = 1900) => {
    const tier = stormCalloutTier(value);
    const c = boardCentre(), f = fx.current;
    setCallout({ key: ++calloutKey.current, value, tier, free: isFree, x: c.x, y: c.y, life });
    sound.multiplierCallout(value);
    if (tier >= 2) scene.current?.skyStrike(Math.min(1, 0.5 + tier * 0.1));
    if (lite || !f) return;
    f.sparks(c.x, c.y, c.cell * (1 + tier * 0.4), 14 + tier * 8, tier >= 4 ? '#ffe6a3' : '#bff3ff');
    f.glints(c.x, c.y, c.cell * (1.2 + tier * 0.4), 8 + tier * 6, tier >= 4 ? '#fff4c8' : '#e6f8ff');
    if (tier >= 1) f.ring(c.x, c.y, c.cell * (1.4 + tier * 0.3), '#bff3ff', 0.6);
    if (tier >= 3) f.ring(c.x, c.y, c.cell * 2.6, tier >= 5 ? '#ffd36b' : '#c7a2ff', 0.85);
    if (tier >= 4) f.fountain(Math.min(5, tier - 1));
    if (!reduced) shake(tier === 0 ? 4 : 5 + tier * 2.5, 360 + tier * 60);
  }, [boardCentre, shake, sound]);

  const openCelebration = useCallback((schedule: CountUpSchedule, betCents: number, at: number, dur: number, reduced: boolean, lite: boolean) => {
    celebrateFx.current = { reduced, lite };
    setCard({ kind: 'big', schedule, bet: betCents, at, dur });
    setMood('bigwin');
    sound.scene('bigwin');
    setAnnounce(`${WIN_TIER_INFO[schedule.finalLevel].title}: ${demoNumber(stormCents(betCents, schedule.totalHundredths))} DEMO, ${stormTimes(schedule.totalHundredths)}×.`);
  }, [sound]);
  const onCelebrationLevel = useCallback((level: CelebrationLevel, first: boolean, remainingMs: number) => {
    const { reduced, lite } = celebrateFx.current, f = fx.current;
    if (level === 5) sound.maxWin(); else sound.bigWin(level);
    if (first) sound.countUp(true);
    if (!lite) scene.current?.celebrate(0.6 + level * 0.25);
    if (f && !lite) { f.rain(level, remainingMs / 1000); f.fountain(level); }
    if (!lite && !reduced) { shake(first ? 5 : 6 + level * 2.5, first ? 380 : 560); scene.current?.skyStrike(1); }
  }, [shake, sound]);
  const onCelebrationCounted = useCallback(() => { sound.countUp(false); }, [sound]);

  /* ---------------------------------------------------------------- timeline events */
  const handle = useCallback((event: StormEvent) => {
    const current = live.current; if (!current) return;
    const reduced = current.reduced, lite = current.lite, b = board.current, f = fx.current;
    const betCents = current.bet;
    switch (event.type) {
      case 'spin-start':
        setMult(prev => (event.kind === 'free' ? { mode: 'free', parts: [], value: event.totalMultiplier, settled: true } : prev?.mode === 'free' ? prev : null));
        if (event.kind === 'free') { setFreeInfo({ number: event.freeSpinNumber, left: event.freeSpinsLeft }); setMeterDur(0); setMeter(event.meter); sound.spinStart(); }
        promisedBolts.current.clear();
        break;
      case 'hero': setHeroPose(event.pose as StormHeroPose); if (event.pose === 'laugh') sound.laugh(); break;
      case 'clear': b?.clear(event.ids, event.dur, reduced); break;
      case 'drop': b?.drop(current.prefix, event.cells, reduced); break;
      case 'land': sound.land(event.col); break;
      case 'orb-land': {
        sound.orbLand(event.value);
        const el = b?.symbolOf(event.id);
        if (f && el && !lite) { const p = f.point(el); f.sparks(p.x, p.y, p.w * 0.5, 8, '#bff3ff'); }
        break;
      }
      case 'scatter-land': sound.scatterLand(event.count); break;
      case 'scatter-tease': b?.tease(event.ids); sound.scatterTease(true); break;
      case 'highlight':
        b?.highlight(event.wins.flatMap(w => w.ids), event.dur, reduced);
        sound.winHighlight(event.stepHundredths / 100);
        setAnnounce(event.wins.map(w => stormWinAnnouncement(w, STORM_SYMBOL_LABELS)).join('; '));
        break;
      case 'shatter': {
        const ids = event.wins.flatMap(w => w.ids);
        if (f && !lite) for (const win of event.wins) for (const id of win.ids) {
          const el = b?.symbolOf(id); if (!el) continue;
          const p = f.point(el);
          f.shatter(p.x, p.y, STORM_SYMBOL_COLORS[win.symbol] ?? ['#ccc', '#fff', '#fff'], p.w);
        }
        b?.shatter(ids, event.dur, reduced);
        if (f) for (const win of event.wins) {
          const c = cellPoint(win.centroid.x, win.centroid.y);
          f.label(c.x, c.y, `+${stormMoney(stormCents(betCents, win.payHundredths))}`, styles.floatLabel, reduced ? 700 : 1200);
        }
        setMeterDur(Math.min(520, event.dur + 160)); setMeter(event.meter);
        sound.shatter(ids.length, Math.max(...event.wins.map(w => (w.count >= 12 ? 2 : w.count >= 10 ? 1 : 0))));
        break;
      }
      case 'tumble': b?.tumble(current.prefix, event.cells, event.removed, reduced); sound.tumble(); break;
      case 'orb-charge':
        b?.charge(event.ids);
        setMult(prev => (event.kind === 'free' ? { mode: 'free', parts: [], value: prev?.value ?? 0, settled: false } : { mode: 'base', parts: [], value: 0, settled: false }));
        sound.orbCollect();
        setAnnounce(event.kind === 'free' ? 'Tarhun Fırtına Taşlarına yıldırım atıyor: değerler toplam çarpana eklenecek.' : 'Tarhun Fırtına Taşlarına yıldırım atıyor.');
        break;
      case 'orb-strike': {
        const el = b?.symbolOf(event.id), h = hero.current;
        if (!el || !h) break;
        const to = clientCentre(el);
        if (event.dur >= STORM_FULL_WINDUP_MS && !reduced) {
          promisedBolts.current.add(event.id);
          void h.strike(to).then(from => {
            if (live.current !== current || !from) return;
            scene.current?.strike(from, clientCentre(el), orbTier(event.value) === 'blue' ? 0.8 : 1.2);
          });
        } else h.setPose('strike');
        break;
      }
      case 'orb-hit': {
        const el = b?.symbolOf(event.id), h = hero.current;
        if (el && !promisedBolts.current.has(event.id)) {
          const to = clientCentre(el);
          const from = h?.getBoltPoint() ?? { x: to.x - 200, y: to.y - 240 };
          scene.current?.strike(from, to, 1);
        }
        sound.lightningStrike(event.col);
        const target = multRef.current;
        if (f && el && !lite) { const p = f.point(el); f.sparks(p.x, p.y, p.w * 0.7, 16); f.ring(p.x, p.y, p.w * 0.6, '#bff3ff', 0.4); }
        if (f && el && target) { const art = el.firstElementChild; if (art) f.fly(art, f.point(el), f.point(target), event.dur, styles.flyOrb); }
        b?.hit(event.id, reduced);
        break;
      }
      case 'orb-arrive': {
        setMult({ mode: event.kind, parts: event.parts, value: event.multiplier, settled: false });
        setMultPunch(k => k + 1);
        sound.orbArrive(event.value);
        if (event.kind === 'free') sound.totalMultiplier(event.multiplier);
        const target = multRef.current;
        if (f && target && !lite) { const p = f.point(target); f.glints(p.x, p.y, p.w * 0.35, 7); f.ring(p.x, p.y, p.h * 0.8, '#bff3ff', 0.45); }
        setAnnounce(event.kind === 'free' ? `Fırtına Taşı ×${event.value}: toplam çarpan ×${event.multiplier}.` : `Fırtına Taşı ×${event.value}: çarpan ×${event.multiplier}.`);
        break;
      }
      case 'orb-fizzle': b?.fizzle(event.ids); break;
      case 'multiply': {
        setMult(prev => ({ mode: event.kind, parts: prev?.parts ?? [], value: event.multiplier, settled: true }));
        setMeterDur(Math.min(900, event.dur)); setMeter(event.meter);
        const m = meterRef.current;
        if (!reduced) m?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.25 }, { transform: 'scale(.97)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 560, easing: 'ease-out' });
        if (f && m && !lite) { const p = f.point(m); f.glints(p.x, p.y, p.w * 0.35, 12); }
        showCallout(event.multiplier, event.kind === 'free', reduced, lite, Math.max(1000, Math.min(2300, Math.round(event.dur * 1.5))));
        setAnnounce(`Çarpan ×${event.multiplier}: ${stormTimes(event.baseHundredths)}× kazanç ${event.multiplier} ile çarpıldı.`);
        break;
      }
      case 'scatter-pay':
        setMeterDur(500); setMeter(event.meter);
        setBanner({ key: ++bannerKey.current, text: `${event.count} Şimşek Mührü · +${stormMoney(stormCents(betCents, event.hundredths))} DEMO`, tone: 'gold' });
        break;
      case 'scatter-trigger': {
        b?.dim(true); b?.flare(event.ids, event.dur, reduced);
        scene.current?.skyStrike(1);
        if (f && !lite) for (const id of event.ids) { const el = b?.symbolOf(id); if (el) { const p = f.point(el); f.sparks(p.x, p.y, p.w * 0.6, 12, '#ffe7a3'); f.ring(p.x, p.y, p.w * 0.7, '#ffd36b', 0.7); } }
        if (event.retrigger) {
          sound.retrigger();
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          setBanner({ key: ++bannerKey.current, text: `+${event.awarded} bedava dönüş`, tone: 'storm' });
          setAnnounce(`${event.count} Şimşek Mührü: ${event.awarded} bedava dönüş eklendi.`);
        } else {
          sound.featureTrigger();
          setAnnounce(`${event.count} Şimşek Mührü: bedava dönüş kazanıldı.`);
        }
        break;
      }
      case 'free-intro':
        setCard({ kind: 'intro', awarded: event.awarded, at: event.at, dur: event.dur });
        sound.freeSpinsIntro();
        setMood('feature');
        setAnnounce(`Fırtına başlıyor: ${event.awarded} bedava dönüş kazandın.`);
        break;
      case 'free-mode':
        setCard(null); b?.dim(false); setFree(event.on); setFreeInfo({ number: 0, left: event.freeSpinsLeft });
        setMult({ mode: 'free', parts: [], value: 0, settled: true });
        sound.scene('feature');
        break;
      case 'spin-end': {
        b?.dim(false);
        sound.scatterTease(false);
        setMeterDur(300); setMeter(event.meter);
        if (event.kind === 'free') {
          const m = meterRef.current;
          if (f && m && event.winHundredths > 0) { const p = f.point(m); f.label(p.x, p.y - p.h * 1.05, `+${stormMoney(stormCents(betCents, event.winHundredths))}`, styles.floatSpin, reduced ? 900 : 1400); }
          setAnnounce(event.winHundredths > 0 ? `Bedava dönüş ${stormTimes(event.winHundredths)}× kazandırdı. Toplam ${stormTimes(event.meter.total)}×, toplam çarpan ×${event.totalMultiplier}.` : 'Bedava dönüşte kazanç yok.');
        } else {
          if (event.winHundredths === 0) setAnnounce('Kazanç yok.');
          else if (event.winHundredths >= 300 && event.winHundredths < 1000) sound.nice();
        }
        break;
      }
      case 'total-win': {
        setFlourish(k => k + 1);
        sound.totalWinFanfare();
        const m = meterRef.current;
        if (!reduced) m?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.3 }, { transform: 'scale(.98)', offset: 0.65 }, { transform: 'scale(1)' }], { duration: 620, easing: 'ease-out' });
        if (f && m && !lite) { const p = f.point(m); f.glints(p.x, p.y, p.w * 0.5, 14); f.ring(p.x, p.y, p.h * 1.3, '#ffe09a', 0.55); }
        setAnnounce(`Toplam kazanç ${demoNumber(stormCents(betCents, event.totalHundredths))} DEMO, ${stormTimes(event.totalHundredths)}×.`);
        break;
      }
      case 'free-outro':
        setCard({ kind: 'outro', spins: event.spins, total: event.totalHundredths, totalMultiplier: event.totalMultiplier, strikes: event.strikes, celebration: event.celebration, capped: event.capped, bet: betCents, at: event.at, dur: event.dur });
        sound.featureOutro();
        setMood('base');
        if (!lite) scene.current?.celebrate(0.8);
        setAnnounce(`Fırtına dindi. Toplam: ${demoNumber(stormCents(betCents, event.totalHundredths))} DEMO, ${event.spins} dönüş, toplam çarpan ×${event.totalMultiplier}.`);
        break;
      case 'big-win':
        openCelebration(event.schedule, betCents, event.at, event.dur, reduced, lite);
        break;
      case 'end':
        setCard(null); setBanner(null); setFree(false); setFreeInfo(null);
        setMult(prev => (prev?.mode === 'free' ? null : prev));
        fx.current?.stopRain();
        player.current = null;
        finishRound(current);
        break;
    }
  }, [cellPoint, finishRound, openCelebration, showCallout, sound]);

  /* ---------------------------------------------------------------- starting rounds */
  const begin = useCallback((current: LiveRound, text: string) => {
    live.current = current;
    setError(''); setPhase('playing'); setRoundBet(current.bet);
    setFree(false); setFreeInfo(null); setMeterDur(0); setMeter(ZERO); setMult(null); setCard(null); setBanner(null); setCallout(null); setFlourish(0); setMood('base');
    setAnnounce(text);
    fx.current?.clear();
    sound.unlock();
    sound.scene('base');
    sound.spinStart();
    const next = new TimelinePlayer<StormEvent>(current.timeline, event => { if (live.current === current) handle(event); });
    player.current = next;
    next.start();
  }, [handle, sound]);

  const gated = mode === 'live';
  const busy = phase === 'playing';
  const booting = boot.phase !== 'done';

  const startRound = useCallback((kind: 'spin' | 'buy'): boolean => {
    if ((live.current && !live.current.settled) || gated || booting) return false;
    const roundMode: StormMode = kind === 'buy' ? 'buy' : ante ? 'ante' : 'standard';
    if (kind === 'buy' && ante) return false;
    const cost = stormCost(bet, roundMode);
    const balanceBefore = balanceRef.current;
    if (cost > balanceBefore) {
      setError(`Bakiye yetersiz: bu ${roundMode === 'buy' ? 'satın alma' : 'dönüş'} ${formatDemo(cost)}. Bahsi düşür veya bakiyeyi yenile.`);
      sound.denied();
      return false;
    }
    let round: StormRound;
    try {
      const words = new Uint32Array(4);
      crypto.getRandomValues(words);
      round = playStormRound(stormSeedFromEntropy(words), bet, roundMode);
    } catch { setError(ENTROPY_ERROR); return false; }
    let id: string | null;
    try { id = reserveDemo(cost, stormLedgerLimits(bet, roundMode)); } catch { setError(ENTROPY_ERROR); return false; }
    if (!id) { setError('Yeterli demo kredin yok veya devam eden bir demo var.'); sound.denied(); return false; }
    setActiveDemo(true);
    const s = settingsRef.current;
    const timeline = buildStormTimeline(round, stormTimelineOptions(s, reducedMotion));
    const current: LiveRound = { id, replayOf: null, bet, cost, mode: roundMode, balanceBefore, round, timeline, prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects, settled: false };
    setReplaying(null);
    begin(current, roundMode === 'buy' ? `Bonus satın alındı, ${demoNumber(cost)} DEMO. Bedava dönüşler başlıyor.` : `Dönüş başladı, ${demoNumber(cost)} DEMO.`);
    return true;
  }, [ante, bet, begin, booting, gated, reducedMotion, reserveDemo, setActiveDemo, sound]);
  const startRef = useRef(startRound); startRef.current = startRound;

  const replay = useCallback((record: DemoRecord) => {
    const meta = record.storm;
    if (!meta || (live.current && !live.current.settled) || autoRef.current || booting) return;
    let round: StormRound;
    try { round = playStormRound(meta.seedHex, meta.betCents, meta.mode); } catch { showToast('Bu tur tekrar oynatılamadı.', 'warn'); return; }
    if (round.payoutCents !== record.payout || round.costCents !== meta.costCents) { showToast('Tekrar doğrulanamadı: kayıt motorla uyuşmuyor.', 'warn'); return; }
    const s = settingsRef.current;
    const timeline = buildStormTimeline(round, stormTimelineOptions(s, reducedMotion));
    const current: LiveRound = { id: null, replayOf: record.id, bet: meta.betCents, cost: meta.costCents, mode: meta.mode, balanceBefore: balanceRef.current, round, timeline, prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects, settled: false };
    setReplaying({ recordId: record.id, seed: meta.seedHex });
    stageRef.current?.scrollIntoView({ block: 'start' });
    begin(current, `Tekrar oynatılıyor: tur ${stormRoundId(meta.seedHex)}. Bakiye değişmez.`);
  }, [begin, booting, reducedMotion, showToast]);

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

  /* Development-only preview of the celebration screens, callouts and feature cards (visual QA). It never builds
     a round, reserves or settles anything; production builds drop it (NODE_ENV is inlined). */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as { __tarhunPreview?: unknown };
    const idle = () => !(live.current && !live.current.settled) && !player.current;
    w.__tarhunPreview = {
      celebrate: (totalHundredths: number, capped = false, betCents = 1000) => {
        if (!idle()) return false;
        const s = settingsRef.current, opts = stormTimelineOptions(s, reducedMotion);
        const schedule = countUpSchedule(totalHundredths, capped, opts);
        const dur = schedule.countUp + schedule.hold;
        const timeline = { events: [
          { type: 'big-win', at: 0, dur, tier: schedule.finalLevel, totalHundredths, capped, countUp: schedule.countUp, schedule, hold: true } as StormEvent,
          { type: 'end', at: dur, dur: 0, totalHundredths, payoutCents: stormCents(betCents, totalHundredths), capped } as StormEvent,
        ] };
        const preview = new TimelinePlayer<StormEvent>(timeline, event => {
          if (event.type === 'big-win') { setHeroPose('triumph'); openCelebration(event.schedule, betCents, event.at, event.dur, reducedMotion, reducedMotion || s.reducedEffects); }
          else if (event.type === 'end') { setCard(null); setMood('base'); setHeroPose('idle'); fx.current?.stopRain(); sound.countUp(false); player.current = null; }
        });
        player.current = preview;
        preview.start();
        return true;
      },
      callout: (value: number, isFree = false) => { showCallout(value, isFree, reducedMotion, reducedMotion || settingsRef.current.reducedEffects); return true; },
      pose: (pose: StormPose) => { setHeroPose(pose); return true; },
    };
    return () => { delete w.__tarhunPreview; };
  }, [openCelebration, reducedMotion, showCallout, sound]);

  /* ---------------------------------------------------------------- autoplay */
  const startAutoplay = useCallback((config: AutoplayConfig) => {
    if (busy || gated) return;
    const state = createAutoplay(config, balanceRef.current);
    autoRef.current = state;
    setAuto(state);
    setModal(null);
    sound.unlock(); sound.autoplay(true);
    showToast(`Otomatik oyun: ${config.spins} tur, kayıp limiti ${formatDemo(config.lossLimitCents)}.`);
  }, [busy, gated, showToast, sound]);

  const realityDue = session.realityDue;
  useEffect(() => {
    if (!auto || phase === 'playing' || modal !== null || realityDue || booting || gated) return;
    const gap = STORM_AUTOPLAY_GAP[settingsRef.current.spinSpeed];
    const timer = window.setTimeout(() => {
      const state = autoRef.current; if (!state) return;
      const decision = stormAutoplayBeforeSpin(state, { balanceCents: balanceRef.current, betCents: bet, ante, tabHidden: document.hidden });
      if (!decision.continue) { stopAutoplay(decision.reason, decision.code === 'completed' ? 'info' : 'warn'); return; }
      if (!startRef.current('spin')) stopAutoplay('Dönüş başlatılamadı');
    }, phase === 'idle' ? 0 : gap);
    return () => window.clearTimeout(timer);
  }, [auto, phase, modal, realityDue, booting, gated, bet, ante, stopAutoplay]);

  useEffect(() => {
    const onVisibility = () => { if (document.hidden && autoRef.current) stopAutoplay(AUTOPLAY_STOP_REASONS['tab-hidden']); };
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
  const roundMode: StormMode = ante ? 'ante' : 'standard';
  const spinCost = stormCost(bet, roundMode);
  const buyPrice = stormCost(bet, 'buy');
  const buyReason = stormBuyBlockReason({ betCents: bet, balanceCents: demoBalance, ante, autoplay: auto !== null, busy, gated });
  const locked = busy || auto !== null || gated || booting;
  const amountCents = (h: number) => (roundBet === null ? 0 : stormCents(roundBet, h));
  const boardLabel = free ? 'Tarhun bedava dönüş ızgarası, 6 sütun, 5 satır' : 'Tarhun ızgarası, 6 sütun, 5 satır';
  const boardElement = useMemo(() => <MemoFrame mood={free ? 'feature' : 'base'}><StormBoard ref={board} label={boardLabel} /></MemoFrame>, [boardLabel, free]);
  const celebrating = card?.kind === 'big' || card?.kind === 'outro' || card?.kind === 'intro';
  const infoPages = useMemo(() => stormInfoPages(bet), [bet]);
  const outOfCredit = !busy && demoBalance < STORM_MIN_BET_CENTS;
  const deckWin = busy ? amountCents(meter.total) : (lastWin?.payout ?? 0);
  const speedIndex = SPIN_SPEEDS.indexOf(settings.spinSpeed);
  const replayInfo = replaying ? `Tekrar — bakiye değişmez · tur ${stormRoundId(replaying.seed)}` : null;
  const multVisible = free || (mult !== null && mult.mode === 'base');

  const openInfo = (page = 'how') => { setInfoPage(page); setModal('info'); sound.click(); };
  const refill = () => {
    if (busy || auto) return;
    if (resetDemoBalance('Tarhun')) { showToast('Bakiye yenilendi: 1.000 DEMO.'); setError(''); setAnnounce('DEMO bakiyesi 1.000 DEMO olarak yenilendi.'); }
  };
  const toggleSound = () => { const muted = !settings.muted; updateSettings({ muted }); if (!muted) sound.unlock(); };
  const cycleSpeed = () => {
    const next = SPIN_SPEEDS[(speedIndex + 1) % SPIN_SPEEDS.length]!;
    updateSettings({ spinSpeed: next });
    sound.click();
    setAnnounce(`Dönüş hızı: ${SPEED_LABELS[next]}.`);
  };
  const toggleAnte = () => {
    if (locked) return;
    const next = !ante;
    setAnte(next);
    sound.click();
    setAnnounce(next ? `Şans ×2 açık: bedava dönüş şansı ≈2 kat, maliyet ${formatDemo(stormCost(bet, 'ante'))}.` : `Şans ×2 kapalı: maliyet ${formatDemo(bet)}.`);
  };
  const onSpinClick = () => { if (busy) return; startRound('spin'); };
  const confirmBuy = () => { if (buyReason) return; setModal(null); startRound('buy'); };

  const deck = (
    <BetSelector
      ladder={STORM_BET_LADDER}
      valueCents={bet}
      onChange={chooseBet}
      balanceCents={demoBalance}
      maxBetCents={STORM_MAX_BET_CENTS}
      costMode={STORM_COST_MODES[roundMode]}
      modeLabel={ante ? 'Şans ×2' : undefined}
      disabled={locked}
      classNames={{ minus: styles.stepBtn, plus: styles.stepBtn, value: styles.betValue, max: styles.maxChip }}
      render={parts => (
        <div className={`${kit.kit} ${styles.deck}`} data-auto={auto ? '' : undefined} role="group" aria-label="Oyun kontrolleri">
          <div className={styles.cellBalance}>
            <span className={styles.cellLabel}>Bakiye</span>
            <strong className={styles.cellValue} data-testid="tarhun-balance">{formatAmount(demoBalance)}<small> DEMO</small></strong>
            <button type="button" className={styles.refill} onClick={refill} disabled={busy || auto !== null || gated} aria-label="Bakiyeyi yenile"><RefillIcon /><span aria-hidden="true">Bakiyeyi yenile</span></button>
          </div>
          <div className={styles.cellWin}>
            <span className={styles.cellLabel}>{busy ? (replaying ? 'Tekrar' : 'Kazanç') : lastWin?.replay ? 'Tekrar kazancı' : 'Son kazanç'}</span>
            <strong className={`${styles.cellValue} ${deckWin > 0 ? styles.cellWinOn : ''}`}>{formatAmount(deckWin)}<small> DEMO</small></strong>
          </div>
          <div className={styles.cellBet}>
            {parts.label}
            {parts.value}
            <span className={styles.costLine} data-testid="tarhun-cost">Maliyet <strong>{formatAmount(spinCost)} DEMO</strong>{ante && <em> · ×1,25</em>}</span>
          </div>
          <div className={styles.areaMinus}>{parts.minus}</div>
          <div className={styles.areaPlus}>{parts.plus}</div>
          <div className={styles.areaMax}>{parts.max}</div>
          <div className={styles.areaSpin}>
            {auto ? (
              <AutoplayStopButton className={styles.stop} remaining={auto.spinsRemaining} onStop={() => stopAutoplay(AUTOPLAY_STOP_REASONS.cancelled, 'info')} />
            ) : (
              <button type="button" className={`${styles.spin} ${busy ? styles.spinning : ''}`} onClick={onSpinClick} disabled={busy || gated || booting}
                aria-label="Çevir" aria-describedby="tz-spin-cost" data-locked={busy || undefined} data-testid="tarhun-spin">
                <span className={styles.spinFace}><SpinSigil /></span>
                {busy && <span className={styles.spinLock} aria-hidden="true"><LockIcon /></span>}
              </button>
            )}
            <span id="tz-spin-cost" className="sr-only">{busy ? 'Tur sürüyor; bütün düşmeler, yıldırımlar ve bedava dönüşler bitene kadar kilitli.' : `Maliyet ${formatDemo(spinCost)}`}</span>
          </div>
          <button type="button" className={`${styles.tool} ${styles.areaAuto}`} onClick={() => { sound.click(); setModal('autoplay'); }} disabled={locked} aria-haspopup="dialog">
            <LoopIcon /><span>Otomatik</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaInfo}`} onClick={() => openInfo()} aria-haspopup="dialog" aria-label="Oyun bilgisi">
            <InfoIcon /><span>Bilgi</span>
          </button>
          <button type="button" role="switch" aria-checked={ante} className={`${styles.feature} ${styles.areaAnte} ${ante ? styles.featureOn : ''}`} onClick={toggleAnte} disabled={locked}
            aria-label="Şans ×2" aria-describedby="tz-ante-desc">
            <span className={styles.featureTitle}>Şans ×2</span>
            <span className={styles.featureState}>{ante ? 'Açık' : 'Kapalı'}<span className={styles.featureFactor}> · ×1,25</span></span>
            <span id="tz-ante-desc" className={styles.featureDesc}>Bedava dönüş şansı ≈2 kat</span>
          </button>
          <button type="button" className={`${styles.feature} ${styles.featureBuy} ${styles.areaBuy}`} aria-disabled={buyReason ? true : undefined}
            onClick={() => { if (buyReason) sound.denied(); else sound.click(); setModal('buy'); }} aria-haspopup="dialog" aria-describedby="tz-buy-desc">
            <span className={styles.featureTitle}>Bonus satın al</span>
            <span className={styles.featureState}>{formatAmount(buyPrice, { trimZeros: true })} DEMO</span>
            <span id="tz-buy-desc" className={styles.featureDesc}>{buyReason ?? `15 bedava dönüş · ${stormRtp(STORM_RTP.buy.rtp)}`}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSet}`} onClick={() => { sound.click(); setModal('settings'); }} aria-haspopup="dialog" aria-label="Ayarlar">
            <GearIcon /><span>Ayarlar</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSpeed} ${speedIndex > 0 ? styles.toolOn : ''}`} onClick={cycleSpeed} aria-label={`Dönüş hızı: ${SPEED_LABELS[settings.spinSpeed]}`}>
            <BoltIcons count={speedIndex + 1} /><span>{SPEED_LABELS[settings.spinSpeed]}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSound} ${!settings.muted ? styles.toolOn : ''}`} onClick={toggleSound} aria-pressed={!settings.muted} aria-label="Ses">
            <SoundIcon on={!settings.muted} /><span>Ses</span>
          </button>
          <div className={styles.areaMsg}>
            {soundLoad.started && !soundLoad.ready && !settings.muted && <p className={styles.msgHint} role="status">Ses yükleniyor %{soundLoad.percent}</p>}
            {error ? <p className={styles.msgError} role="alert">{error}</p>
              : outOfCredit ? <p className={styles.msgHint}>DEMO bakiyen bitti. <button type="button" className={styles.inlineLink} onClick={refill}>Bakiyeyi yenile</button></p>
              : <p className={styles.msgHint}>{lastWin && !busy ? (lastWin.payout > 0 ? <>Son tur <strong>+{stormMoney(lastWin.payout)} DEMO</strong> · {stormTimes(lastWin.total)}×</> : <>Son tur kazançsız.</>) : settings.spaceToSpin ? <>Boşluk tuşu ile de çevirebilirsin.</> : <>Sonuç dönüşten önce belirlenir.</>}</p>}
          </div>
        </div>
      )}
    />
  );

  const multText = mult ? (mult.mode === 'free' ? `×${mult.value}` : mult.parts.length ? `${mult.parts.map(v => `×${v}`).join(' + ')}${mult.parts.length > 1 && mult.settled ? ` = ×${mult.value}` : ''}` : '×…') : '×0';
  const sceneMood: StormMood = mood;

  return (
    <div className={`game-page ${styles.page}`}>
      <StormSymbolSprites />
      <GameHeading title="Tarhun: Fırtına Tahtı" subtitle="Fırtına tanrısı taşlara yıldırım atar; çarpanlar bedava dönüşte birikir." mode={mode} setMode={setMode} active={busy || auto !== null} />
      <section className={`game-table ${styles.table}`} aria-label="Tarhun oyun masası" data-free={free || undefined}>
        <StormScene ref={scene} mood={sceneMood} className={styles.scene}>
          <div className={styles.layout}>
            <div ref={stageRef} className={styles.stage} data-phase={phase} data-celebrate={celebrating || undefined}>
              <div className={styles.hero} data-pose={heroPose}>
                <HeroFigure ref={hero} pose={heroPose} framing="auto" strikeHoldMs={520} />
              </div>
              <div ref={shakeRef} className={styles.column}>
                <div className={styles.top}>
                  <div className={styles.logo}><StormLogo size="100%" variant="compact" title="Tarhun: Fırtına Tahtı" /></div>
                </div>
                <div className={styles.hud}>
                  {freeInfo ? (
                    <div className={styles.freeCounter} aria-label={`Bedava dönüş ${freeInfo.number}, kalan dönüş ${freeInfo.left}`} data-testid="tarhun-free-counter">
                      <span className={styles.freeTag}>{freeInfo.number > 0 ? `${freeInfo.number}. dönüş` : 'Bedava dönüş'}</span>
                      <span className={styles.freeLeft}><small>Kalan</small><strong key={freeInfo.left}>{freeInfo.left}</strong></span>
                    </div>
                  ) : <span className={styles.hudSpacer} />}
                  <div ref={multRef} className={`${styles.mult} ${multVisible ? styles.multOn : ''} ${free ? styles.multFree : ''}`} data-tier={mult ? Math.min(6, stormCalloutTier(mult.value)) : 0}
                    aria-hidden={multVisible ? undefined : true} data-testid="tarhun-multiplier">
                    <small>{free ? 'Toplam çarpan' : 'Çarpan'}</small>
                    <strong key={multPunch} className={styles.multValue}>{multText}</strong>
                  </div>
                </div>
                <div ref={boardWrapRef} className={styles.boardWrap}>{boardElement}</div>
                {/* One cumulative meter: never resets inside a round (tumbles, orbs, every free spin add up). */}
                <div ref={meterRef} className={`${styles.meter} ${free ? styles.meterFree : ''}`} data-testid="tarhun-meter">
                  {phase === 'idle' ? (
                    <div className={styles.meterIdle}><span>Her yerde <strong>8+</strong> aynı sembol öder</span><span aria-hidden="true">·</span><span><strong>×500</strong>’e kadar Fırtına Taşı</span></div>
                  ) : (
                    <div className={styles.meterPart}>
                      <small>{free || phase === 'done' ? 'Toplam kazanç' : 'Kazanç'}</small>
                      <strong data-testid="tarhun-meter-total"><CountUp cents={amountCents(meter.total)} duration={meterDur} /><em> DEMO</em></strong>
                    </div>
                  )}
                  {flourish > 0 && phase !== 'idle' && <span key={flourish} className={styles.meterShine} aria-hidden="true" />}
                </div>
              </div>
              <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />
              <div ref={layerRef} className={styles.fxLayer} aria-hidden="true" />
              {replayInfo && <div className={styles.replayRibbon} data-testid="tarhun-replay"><Icon name="history" size={15} /><span>{replayInfo}</span></div>}
              {auto && !replayInfo && <div className={styles.autoRibbon} aria-hidden="true"><LoopIcon /><span>Otomatik · {auto.spinsRemaining} tur kaldı</span></div>}
              {toast && (
                <div key={`toast-${toast.key}`} className={`${styles.toast} ${toast.tone === 'warn' ? styles.toastWarn : ''}`} data-testid="tarhun-toast">
                  <span>{toast.text}</span>
                  <button type="button" className={styles.toastClose} onClick={() => setToast(null)} aria-label="Bildirimi kapat"><svg {...svg} width={16} height={16}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
                </div>
              )}
              {banner && <div key={`banner-${banner.key}`} className={`${styles.banner} ${banner.tone === 'storm' ? styles.bannerStorm : ''}`} data-testid="tarhun-banner" aria-hidden="true">{banner.text}</div>}
              {callout && (
                <div key={`callout-${callout.key}`} className={styles.callout} data-tier={callout.tier} style={{ left: `${callout.x}px`, top: `${callout.y}px`, animationDuration: `${callout.life}ms` }} aria-hidden="true" data-testid="tarhun-callout" data-key={callout.key}>
                  <span className={styles.calloutGlow} />
                  {callout.tier >= 1 && <span className={styles.calloutTag}>{callout.free ? `Toplam · ${CALLOUT_TAGS[callout.tier]}` : CALLOUT_TAGS[callout.tier]}</span>}
                  <span className={styles.calloutText} data-text={`×${callout.value}`}><span className={styles.calloutFill}>×{callout.value}</span></span>
                </div>
              )}
              {card?.kind === 'intro' && <StormFreeIntro key={`intro-${card.at}`} awarded={card.awarded} dur={card.dur} reducedMotion={reducedMotion} onTap={advanceHold} />}
              {card?.kind === 'outro' && (
                <StormFeatureTotal key={`outro-${card.at}`} spins={card.spins} totalHundredths={card.total} totalMultiplier={card.totalMultiplier} strikes={card.strikes} betCents={card.bet}
                  celebration={card.celebration} capped={card.capped} dur={card.dur} elapsed={cardElapsed} reducedMotion={reducedMotion} onTap={advanceHold} />
              )}
              {card?.kind === 'big' && (
                <StormCelebration key={`big-${card.at}`} schedule={card.schedule} betCents={card.bet} elapsed={cardElapsed} reducedMotion={reducedMotion}
                  onLevel={onCelebrationLevel} onCountDone={onCelebrationCounted} onTap={advanceHold} />
              )}
              {gated && (
                <div className={styles.gated}>
                  <div className={styles.gatedCard}>
                    <Icon name="lock" size={26} />
                    <h2>Zincir üstü Tarhun yok.</h2>
                    <p>Bu oyun yalnız DEMO kredisiyle oynanır; gerçek bahis kabul edilmez.</p>
                    <button className="text-button" onClick={() => setMode('demo')}>Yerel demoya dön<Icon name="arrow" size={17} /></button>
                  </div>
                </div>
              )}
            </div>
            <div className={styles.side}>{deck}</div>
          </div>
        </StormScene>
        {boot.phase !== 'done' && (
          <div className={styles.splash} data-testid="tarhun-splash">
            <div className={styles.splashCard}>
              <div className={styles.splashLogo}><StormLogo size="100%" title="Tarhun: Fırtına Tahtı" /></div>
              <ul className={styles.splashFeatures}>
                <li><span aria-hidden="true"><StormSymbolArt symbol="h1" size="100%" /></span><strong>8+ her yerde</strong><small>Aynı sembolden 8 tane, ızgaranın her yerinde öder</small></li>
                <li><span aria-hidden="true"><StormSymbolArt symbol="orb" multiplier={500} size="100%" /></span><strong>×500 Fırtına Taşı</strong><small>Yıldırımla toplanır; bedava dönüşte çarpan birikir</small></li>
                <li><span aria-hidden="true"><StormSymbolArt symbol="scatter" size="100%" /></span><strong>5.000× azami</strong><small>4 Şimşek Mührü 15 bedava dönüş açar</small></li>
              </ul>
              {boot.phase === 'loading' ? (
                <div className={styles.loadBar} role="progressbar" aria-label="Oyun yükleniyor" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(boot.progress * 100)}>
                  <span style={{ transform: `scaleX(${boot.progress})` } as CSSProperties} />
                </div>
              ) : (
                <div className={styles.splashActions}>
                  <button type="button" className={styles.playButton} autoFocus onClick={() => { sound.unlock(); sound.click(); setBoot(b => ({ ...b, phase: 'done' })); }}>Oyna</button>
                  <button type="button" className={styles.splashSkip} onClick={() => { updateSettings({ introScreen: false }); setBoot(b => ({ ...b, phase: 'done' })); }}>Açılış ekranını bir daha gösterme</button>
                </div>
              )}
              <p className={styles.splashNote}>DEMO kredisi değersizdir · Sonuç dönüşten önce belirlenir · Sertifikasız simülasyon RTP ≈ {stormRtp(STORM_RTP.standard.rtp)}</p>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <SessionBar className={styles.sessionBar} nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <StormHistory onReplay={replay} replayDisabled={busy || auto !== null || booting} replayingId={replaying?.recordId ?? null} />
      <StaticFooter />

      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title="Ayarlar" size="md">
        <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
        <p className={styles.modalNote} role="status">{soundLoad.ready ? 'Ses hazır: müzik, efektler ve seslendirme bu cihazda hazırlandı.' : soundLoad.started ? `Ses yükleniyor %${soundLoad.percent} (bu sırada oyun sessiz veya basit efektlerle sürer).` : 'Ses ilk dokunuşta yüklenir.'}</p>
        <section className={styles.demoBox} aria-labelledby="tz-demo-title">
          <h3 id="tz-demo-title">DEMO bakiyesi</h3>
          <p>Bakiye {formatDemo(demoBalance)}. Yenilemek bakiyeyi 1.000 DEMO yapar ve geçmişe "Bakiye yenilendi" satırı ekler; tur veya otomatik oyun sürerken yapılamaz.</p>
          <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={refill} disabled={busy || auto !== null || gated}>Bakiyeyi yenile</button>
        </section>
      </Modal>
      <GameInfo open={modal === 'info'} onClose={() => setModal(null)} pages={infoPages} title="Tarhun · Oyun bilgisi" initialPageId={infoPage} />
      <Modal open={modal === 'autoplay'} onClose={() => setModal(null)} title="Otomatik oyun" size="md">
        <AutoplayPanel onStart={startAutoplay} spinCostCents={spinCost} balanceCents={demoBalance} disabled={busy || gated} />
        <p className={styles.modalNote}>Tur başı {formatDemo(spinCost)}{ante ? ' (Şans ×2)' : ''} · bonus satın almaz · sekme gizlenince durur.</p>
      </Modal>
      <BuyFeatureDialog
        open={modal === 'buy'}
        onClose={() => setModal(null)}
        onConfirm={confirmBuy}
        featureName={`15 bedava dönüş · bahis ${formatDemo(bet)}`}
        priceCents={buyPrice}
        balanceCents={demoBalance}
        rtpText={`Satın alma RTP ${stormRtp(STORM_RTP.buy.rtp)} · standart ${stormRtp(STORM_RTP.standard.rtp)} (simülasyon, sertifikasız)`}
        description={<>Bahsin <strong>100 katı</strong>. Tur en az 4 Şimşek Mührüyle başlar ve 15 bedava dönüş garantilidir; toplam çarpan ×0’dan başlayıp kazanan her dönüşte büyür. Kazançlar {formatDemo(bet)} bahse göre ödenir, azami {formatDemo(bet * 5000)}.</>}
        disabledReason={buyReason ?? undefined}
      />
      <RealityCheckDialog
        open={realityDue && modal === null}
        elapsedMs={session.elapsedMs}
        netCents={session.netCents}
        onContinue={() => session.acknowledge()}
        onQuit={() => { stopAutoplay('Oturumdan çıkıldı', 'info'); session.acknowledge(); router.push('/games'); }}
      />
    </div>
  );
}
