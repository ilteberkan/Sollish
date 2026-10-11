'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { CASCADE2_RTP, cascadeSeedFromEntropy, playCascade2Round, type Cascade2Round, type CascadeMode } from '@sollish/protocol';
import { demoNumber } from '@/lib/demo';
import { buildCascadeTimeline, cascadeHistoryDetail, centsFor, finalState, moneyText, multiplierText, winAnnouncement, type CascadeTimeline, type Meter, type TimelineEvent } from '@/lib/cascade-timeline';
import { TimelinePlayer, type EventInfo } from '@/lib/cascade-player';
import { AUTOPLAY_STOP_REASONS, autoplayNetLossCents, cancelAutoplay, createAutoplay, type AutoplayConfig, type AutoplayState } from '@/lib/slot-kit/autoplay';
import { formatAmount, formatDemo, formatSignedDemo } from '@/lib/slot-kit/bet';
import { SPIN_SPEEDS, type SpinSpeed } from '@/lib/slot-kit/settings';
import {
  CASCADE_AUTOPLAY_GAP, CASCADE_BET_LADDER, CASCADE_COST_MODES, CASCADE_DEFAULT_BET_CENTS, CASCADE_MAX_BET_CENTS, CASCADE_MIN_BET_CENTS,
  autoplayAfterRound, autoplayBeforeSpin, buyBlockReason, cascadeCost, cascadeLedgerLimits, cascadeTimelineOptions, formatRtp, shortRoundId,
} from '@/lib/cascade-controls';
import { useProduct, type DemoRecord } from '../providers';
import { DemoNotice, GameHeading, Rules, type Mode } from '../game-common';
import { Icon } from '../icons';
import {
  AutoplayPanel, AutoplayStopButton, BetSelector, BuyFeatureDialog, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, useSession, useSlotSettings,
} from '../slot-kit';
import kit from '../slot-kit/kit.module.css';
import { CascadeBackdrop, BoardFrame } from './backdrop';
import { CascadeBoard, type BoardHandle } from './cascade-board';
import { CascadeHistory } from './cascade-history';
import { CascadeFx, SYMBOL_COLORS } from './fx';
import { cascadeInfoPages } from './info-pages';
import { SYMBOL_LABELS, SymbolArt } from './symbols';
import { useCascadeSound } from './use-cascade-sound';
import styles from './cascade-game.module.css';

/* Lifecycle: entropy -> engine v2 resolves the whole round (bet + mode) -> one reservation of the mode cost ->
   the timeline replays it -> exactly one settlement with the engine payout (at the end, on "Atla", or on
   unmount). A replay from the history uses the same engine call and never touches the ledger. */

type LiveRound = {
  /** Ledger reservation id; null for a history replay. */
  id: string | null; replayOf: string | null;
  bet: number; cost: number; mode: CascadeMode; balanceBefore: number;
  round: Cascade2Round; timeline: CascadeTimeline; prefix: string; reduced: boolean; lite: boolean; settled: boolean; startedAt: number;
};
type Phase = 'idle' | 'playing' | 'done';
type Card =
  | { kind: 'intro'; awarded: number; at: number; dur: number }
  | { kind: 'outro'; spins: number; total: number; at: number; dur: number }
  | { kind: 'max'; at: number; dur: number }
  | { kind: 'big'; tier: 1 | 2 | 3; total: number; countUp: number; at: number; dur: number; instant: boolean };
type Banner = { key: number; text: string; tone: 'gold' | 'pink' };
type Badge = { parts: number[]; sum: number | null };
type Toast = { key: number; text: string; tone: 'info' | 'warn' };
type ModalId = 'settings' | 'info' | 'autoplay' | 'buy' | null;
type Boot = { phase: 'loading' | 'ready' | 'done'; progress: number };

const ENTROPY_ERROR = 'Güvenli yerel rastgelelik kullanılamıyor. Demo başlatılmadı.';
const BIG_TITLES = { 1: 'Büyük kazanç', 2: 'Süper kazanç', 3: 'Efsane kazanç' } as const;
const SPEED_LABELS: Record<SpinSpeed, string> = { normal: 'Normal', quick: 'Hızlı', turbo: 'Turbo' };
const ZERO: Meter = { spin: 0, total: 0 };
const BET_KEY = 'sollish:cascade:bet';
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
function CountUp({ cents, duration, instant, className, from }: { cents: number; duration: number; instant?: boolean; className?: string; from?: number }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(from ?? cents);
  const [initial] = useState(() => moneyText(from ?? cents));
  useEffect(() => {
    const el = node.current; if (!el) return;
    const from = shown.current, to = cents;
    if (instant || duration <= 0 || from === to || typeof requestAnimationFrame === 'undefined') { shown.current = to; el.textContent = moneyText(to); return; }
    const start = performance.now(); let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      shown.current = Math.round(from + (to - from) * eased);
      el.textContent = moneyText(shown.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); shown.current = to; el.textContent = moneyText(to); };
  }, [cents, duration, instant]);
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
function SkipIcon() { return <svg {...svg} width={34} height={34}><path d="M4.5 6l7 6-7 6zM11.5 6l7 6-7 6z" fill="currentColor" /><path d="M20 6v12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; }
function GearIcon() { return <svg {...svg}><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function InfoIcon() { return <svg {...svg}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M12 11v6M12 7.4h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; }
function LoopIcon() { return <svg {...svg}><path d="M17 3.5 20 6.5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5 4 17.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 12.5v1a4 4 0 0 1-4 4H4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>; }
function RefillIcon() { return <svg {...svg} width={16} height={16}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

/* Heavy static subtrees are memoised so meter/announcement updates never re-render them. */
const StaticBackdrop = memo(CascadeBackdrop);
const StaticFooter = memo(function StaticFooter() { return <><DemoNotice /><Rules game="Cascade" /></>; });

export function CascadeGame() {
  const { reserveDemo, settleDemo, setActiveDemo, demoBalance, resetDemoBalance } = useProduct();
  const router = useRouter();
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

  const board = useRef<BoardHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
  const autoRef = useRef<AutoplayState | null>(null);
  autoRef.current = auto;
  const balanceRef = useRef(demoBalance);
  balanceRef.current = demoBalance;
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
    settleDemo({
      id: current.id, game: 'Cascade', stake: current.cost, payout: round.payoutCents, detail: cascadeHistoryDetail(round), at: Date.now(), kind: 'round',
      cascade: { engine: round.engine, seedHex: round.seedHex, betCents: current.bet, mode: current.mode, costCents: current.cost },
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

  const finishRound = useCallback((current: LiveRound, skipped: boolean) => {
    settle(current);
    setPhase('done');
    sound.countUp(false);
    const { round } = current;
    setLastWin({ payout: round.payoutCents, total: round.totalHundredths, replay: current.id === null });
    if (current.id === null) {
      setReplaying(null);
      setAnnounce(`Tekrar bitti: ${demoNumber(round.payoutCents)} DEMO, ${multiplierText(round.totalHundredths)}×. Bakiye değişmedi.`);
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
    const total = demoNumber(round.payoutCents);
    setAnnounce(round.payoutCents > 0 ? `Tur bitti${skipped ? ' (atlandı)' : ''}. Toplam kazanç ${total} DEMO, ${multiplierText(round.totalHundredths)}×.` : 'Tur bitti. Kazanç yok.');
  }, [settle, sound]);

  /* ---------------------------------------------------------------- presentation events */
  const centre = useCallback((x: number, y: number) => {
    const stage = stageRef.current, cells = stage?.querySelector('[data-cells]');
    if (!stage || !cells) return { x: 0, y: 0, cell: 60 };
    const a = cells.getBoundingClientRect(), b = stage.getBoundingClientRect();
    return { x: a.left - b.left + (x / 6) * a.width, y: a.top - b.top + (y / 5) * a.height, cell: a.width / 6 };
  }, []);

  const shake = useCallback((strength: number) => {
    shakeRef.current?.animate([
      { transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-strength}px, ${strength * 0.6}px, 0)` }, { transform: `translate3d(${strength}px, ${-strength * 0.4}px, 0)` },
      { transform: `translate3d(${-strength * 0.6}px, ${strength * 0.3}px, 0)` }, { transform: 'translate3d(0,0,0)' },
    ], { duration: 360, easing: 'ease-out' });
  }, []);

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
        setAnnounce(event.wins.map(w => winAnnouncement(w, SYMBOL_LABELS)).join('; '));
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
          f.label(c.x, c.y, `+${moneyText(centsFor(betCents, win.payHundredths))}`, styles.floatLabel, reduced ? 700 : 1200);
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
        setAnnounce(`Çarpan kristalleri toplanıyor: toplam ${event.sum}×.`);
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
        setMeterDur(Math.min(700, event.dur)); setMeter(event.meter);
        const m = meterRef.current;
        if (!reduced) m?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.25 }, { transform: 'scale(.97)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 560, easing: 'ease-out' });
        if (!lite) {
          shake(7);
          if (f && m) { const p = f.point(m); f.sparkle(p.x, p.y, p.w * 0.35, 14); f.burst(p.x, p.y - p.h * 0.2, SYMBOL_COLORS.crystal!, p.h, 18); }
        }
        if (f && m) { const p = f.point(m); f.label(p.x, p.y - p.h * 1.15, `×${event.sum}`, styles.floatBig, reduced ? 800 : 1300); }
        sound.multiplierApply(event.sum, event.meter.spin / 100);
        setAnnounce(`${multiplierText(event.baseHundredths)}× kazanç ${event.sum} ile çarpıldı.`);
        break;
      }
      case 'scatter-pay': {
        setMeterDur(500); setMeter(event.meter);
        setBanner({ key: ++bannerKey.current, text: `${event.count} yıldız · +${moneyText(centsFor(betCents, event.hundredths))} DEMO`, tone: 'gold' });
        sound.scatter(event.count);
        break;
      }
      case 'scatter-trigger': {
        b?.dim(true); b?.flare(event.ids, event.dur, reduced);
        sound.scatter(event.count);
        if (f && !lite) for (const id of event.ids) { const el = b?.symbolOf(id); if (el) { const p = f.point(el); f.sparkle(p.x, p.y, p.w * 0.6, 10, '#ffe7a3'); f.ring(p.x, p.y, p.w * 0.7, '#ffd36b', 0.7); } }
        if (event.retrigger) {
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          setBanner({ key: ++bannerKey.current, text: `+${event.awarded} bedava dönüş`, tone: 'pink' });
          setAnnounce(`${event.count} yıldız: ${event.awarded} bedava dönüş eklendi.`);
        } else setAnnounce(`${event.count} yıldız: bedava dönüş kazanıldı.`);
        break;
      }
      case 'free-intro':
        setCard({ kind: 'intro', awarded: event.awarded, at: event.at, dur: event.dur });
        sound.freeSpinsIntro(); sound.scene('feature');
        setAnnounce(`${event.awarded} bedava dönüş kazandın.`);
        break;
      case 'free-mode':
        setCard(null); b?.dim(false); setFree(event.on); setFreeInfo({ number: 0, left: 10 });
        break;
      case 'spin-end': {
        b?.dim(false);
        sound.scatterTease(false);
        setMeterDur(300); setMeter(event.meter);
        if (event.kind === 'free') setAnnounce(event.winHundredths > 0 ? `Bedava dönüş ${multiplierText(event.winHundredths)}× kazandırdı.` : 'Bedava dönüşte kazanç yok.');
        else if (event.winHundredths === 0) setAnnounce('Kazanç yok.');
        break;
      }
      case 'max-win':
        setCard({ kind: 'max', at: event.at, dur: event.dur });
        sound.maxWin();
        if (f && !lite) f.confetti(3);
        setAnnounce('Azami kazanca ulaşıldı: bahsin 5.000 katı.');
        break;
      case 'free-outro':
        setCard({ kind: 'outro', spins: event.spins, total: event.totalHundredths, at: event.at, dur: event.dur });
        sound.featureOutro(); sound.scene('base');
        setAnnounce(`Bedava dönüş bitti. Toplam kazanç ${demoNumber(centsFor(betCents, event.totalHundredths))} DEMO, ${event.spins} dönüş.`);
        break;
      case 'big-win':
        setCard({ kind: 'big', tier: event.tier, total: event.totalHundredths, countUp: event.countUp, at: event.at, dur: event.dur, instant: false });
        sound.bigWin(event.tier); sound.countUp(true);
        if (f && !lite) f.confetti(event.tier);
        if (!lite) shake(5 + event.tier * 2);
        setAnnounce(`${BIG_TITLES[event.tier]}: ${demoNumber(centsFor(betCents, event.totalHundredths))} DEMO.`);
        break;
      case 'end':
        setCard(null); setBanner(null); setBadge(null);
        player.current = null;
        finishRound(current, false);
        break;
    }
  }, [centre, finishRound, shake, sound]);

  /* ---------------------------------------------------------------- starting rounds */
  const begin = useCallback((current: LiveRound, text: string) => {
    live.current = current;
    setError(''); setPhase('playing'); setRoundBet(current.bet);
    setFree(false); setFreeInfo(null); setMeterDur(0); setMeter(ZERO); setBadge(null); setCard(null); setBanner(null);
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

  /** Real round (standard/ante spin or a confirmed buy). Returns false when nothing started. */
  const startRound = useCallback((kind: 'spin' | 'buy'): boolean => {
    if ((live.current && !live.current.settled) || gated || booting) return false;
    const roundMode: CascadeMode = kind === 'buy' ? 'buy' : ante ? 'ante' : 'standard';
    if (kind === 'buy' && ante) return false;
    const cost = cascadeCost(bet, roundMode);
    const balanceBefore = balanceRef.current;
    if (cost > balanceBefore) {
      setError(`Bakiye yetersiz: bu ${roundMode === 'buy' ? 'satın alma' : 'dönüş'} ${formatDemo(cost)}. Bahsi düşür veya bakiyeyi yenile.`);
      sound.denied();
      return false;
    }
    let round: Cascade2Round;
    try {
      const words = new Uint32Array(4);
      crypto.getRandomValues(words);
      round = playCascade2Round(cascadeSeedFromEntropy(words), bet, roundMode);
    } catch { setError(ENTROPY_ERROR); return false; }
    let id: string | null;
    try { id = reserveDemo(cost, cascadeLedgerLimits(bet, roundMode)); } catch { setError(ENTROPY_ERROR); return false; }
    if (!id) { setError('Yeterli demo kredin yok veya devam eden bir demo var.'); sound.denied(); return false; }
    setActiveDemo(true);
    const s = settingsRef.current;
    const lite = reducedMotion || s.reducedEffects;
    const timeline = buildCascadeTimeline(round, cascadeTimelineOptions(s, reducedMotion));
    const current: LiveRound = { id, replayOf: null, bet, cost, mode: roundMode, balanceBefore, round, timeline, prefix: `r${++sequence.current}`, reduced: reducedMotion, lite, settled: false, startedAt: performance.now() };
    setReplaying(null);
    begin(current, roundMode === 'buy' ? `Bonus satın alındı, ${demoNumber(cost)} DEMO. Bedava dönüşler başlıyor.` : `Dönüş başladı, ${demoNumber(cost)} DEMO.`);
    return true;
  }, [ante, bet, begin, booting, gated, reducedMotion, reserveDemo, setActiveDemo, sound]);
  const startRef = useRef(startRound); startRef.current = startRound;

  const replay = useCallback((record: DemoRecord) => {
    const meta = record.cascade;
    if (!meta || (live.current && !live.current.settled) || autoRef.current || booting) return;
    let round: Cascade2Round;
    try { round = playCascade2Round(meta.seedHex, meta.betCents, meta.mode); } catch { showToast('Bu tur tekrar oynatılamadı.', 'warn'); return; }
    if (round.payoutCents !== record.payout || round.costCents !== meta.costCents) { showToast('Tekrar doğrulanamadı: kayıt motorla uyuşmuyor.', 'warn'); return; }
    const s = settingsRef.current;
    const timeline = buildCascadeTimeline(round, cascadeTimelineOptions(s, reducedMotion));
    const current: LiveRound = { id: null, replayOf: record.id, bet: meta.betCents, cost: meta.costCents, mode: meta.mode, balanceBefore: balanceRef.current, round, timeline, prefix: `r${++sequence.current}`, reduced: reducedMotion, lite: reducedMotion || s.reducedEffects, settled: false, startedAt: performance.now() };
    setReplaying({ recordId: record.id, seed: meta.seedHex });
    stageRef.current?.scrollIntoView({ block: 'start' });
    begin(current, `Tekrar oynatılıyor: tur ${shortRoundId(meta.seedHex)}. Bakiye değişmez.`);
  }, [begin, booting, reducedMotion, showToast]);

  function skip() {
    const current = live.current;
    if (!current || current.settled) return;
    if (performance.now() - current.startedAt < 350) return; // a double tap on the spin button is not a skip
    player.current?.stop(); player.current = null;
    fx.current?.clear();
    const fin = finalState(current.round);
    board.current?.showFinal(current.prefix, fin.cells);
    setMeterDur(0); setMeter(fin.meter); setFree(fin.free); setFreeInfo(fin.free ? { number: fin.freeSpinsPlayed, left: 0 } : null);
    setBadge(null); setCard(null); setBanner(null);
    finishRound(current, true);
  }

  /** Tap on a hold card: finish the count-up first, then continue. */
  const advanceHold = useCallback(() => {
    const p = player.current; if (!p) return;
    const hold = p.currentHold(); if (!hold) return;
    if (hold.type === 'big-win' && p.time < hold.at + hold.countUp - 1) {
      p.jumpTo(hold.at + hold.countUp);
      sound.countUp(false);
      setCard(c => (c && c.kind === 'big' ? { ...c, instant: true } : c));
      return;
    }
    p.jumpTo(hold.at + hold.dur);
  }, [sound]);

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
    const gap = CASCADE_AUTOPLAY_GAP[settingsRef.current.spinSpeed];
    const timer = window.setTimeout(() => {
      const state = autoRef.current; if (!state) return;
      const decision = autoplayBeforeSpin(state, { balanceCents: balanceRef.current, betCents: bet, ante, tabHidden: document.hidden });
      if (!decision.continue) { stopAutoplay(decision.reason, decision.code === 'completed' ? 'info' : 'warn'); return; }
      if (!startRef.current('spin')) stopAutoplay('Dönüş başlatılamadı');
    }, phase === 'idle' ? 0 : gap);
    return () => window.clearTimeout(timer);
  }, [auto, phase, modal, realityDue, booting, gated, bet, ante, stopAutoplay]);

  // Autoplay never runs in a hidden tab.
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
      if (player.current?.active) advanceHold();
      else if (!autoRef.current) startRef.current('spin');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advanceHold]);

  /* ---------------------------------------------------------------- derived view */
  const roundMode: CascadeMode = ante ? 'ante' : 'standard';
  const spinCost = cascadeCost(bet, roundMode);
  const buyPrice = cascadeCost(bet, 'buy');
  const buyReason = buyBlockReason({ betCents: bet, balanceCents: demoBalance, ante, autoplay: auto !== null, busy, gated });
  const locked = busy || auto !== null || gated || booting;
  const amountCents = (h: number) => (roundBet === null ? 0 : centsFor(roundBet, h));
  const boardLabel = free ? 'Candy Cascade bedava dönüş ızgarası, 6 sütun, 5 satır' : 'Candy Cascade ızgarası, 6 sütun, 5 satır';
  const boardElement = useMemo(() => <BoardFrame><CascadeBoard ref={board} label={boardLabel} free={free} /></BoardFrame>, [boardLabel, free]);
  const stageClass = [styles.stage, free ? styles.stageFree : '', card ? styles.stageCard : ''].join(' ');
  const cardTier = card?.kind === 'big' ? card.tier : 3;
  const infoPages = useMemo(() => cascadeInfoPages(bet), [bet]);
  const outOfCredit = !busy && demoBalance < CASCADE_MIN_BET_CENTS;
  const deckWin = busy ? amountCents(meter.total) : (lastWin?.payout ?? 0);
  const speedIndex = SPIN_SPEEDS.indexOf(settings.spinSpeed);
  const replayInfo = replaying ? `Tekrar — bakiye değişmez · tur ${shortRoundId(replaying.seed)}` : null;

  const openInfo = (page = 'how') => { setInfoPage(page); setModal('info'); sound.click(); };
  const refill = () => {
    if (busy || auto) return;
    if (resetDemoBalance('Cascade')) { showToast('Bakiye yenilendi: 1.000 DEMO.'); setError(''); setAnnounce('DEMO bakiyesi 1.000 DEMO olarak yenilendi.'); }
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
    setAnnounce(`Dönüş hızı: ${SPEED_LABELS[next]}.`);
  };
  const toggleAnte = () => {
    if (locked) return;
    const next = !ante;
    setAnte(next);
    sound.click();
    const text = next ? `Şans ×2 açık: bedava dönüş şansı ≈2 kat, maliyet ${formatDemo(cascadeCost(bet, 'ante'))}.` : `Şans ×2 kapalı: maliyet ${formatDemo(bet)}.`;
    setAnnounce(text);
  };
  const onSpinClick = () => {
    if (busy) { skip(); return; }
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
      balanceCents={demoBalance}
      maxBetCents={CASCADE_MAX_BET_CENTS}
      costMode={CASCADE_COST_MODES[roundMode]}
      modeLabel={ante ? 'Şans ×2' : undefined}
      disabled={locked}
      classNames={{ minus: styles.stepBtn, plus: styles.stepBtn, value: styles.betValue, max: styles.maxChip }}
      render={parts => (
        <div className={`${kit.kit} ${styles.deck}`} data-auto={auto ? '' : undefined} role="group" aria-label="Oyun kontrolleri">
          <div className={styles.cellBalance}>
            <span className={styles.cellLabel}>Bakiye</span>
            <strong className={styles.cellValue} data-testid="cascade-balance">{formatAmount(demoBalance)}<small> DEMO</small></strong>
            <button type="button" className={styles.refill} onClick={refill} disabled={busy || auto !== null || gated}><RefillIcon /><span>Bakiyeyi yenile</span></button>
          </div>
          <div className={styles.cellBet}>
            {parts.label}
            {parts.value}
            <span className={styles.costLine} data-testid="cascade-cost">Maliyet <strong>{formatAmount(spinCost)} DEMO</strong>{ante && <em> · ×1,25</em>}</span>
          </div>
          <div className={styles.cellWin}>
            <span className={styles.cellLabel}>{busy ? (replaying ? 'Tekrar' : 'Kazanç') : lastWin?.replay ? 'Tekrar kazancı' : 'Son kazanç'}</span>
            <strong className={`${styles.cellValue} ${deckWin > 0 ? styles.cellWinOn : ''}`}>{formatAmount(deckWin)}<small> DEMO</small></strong>
          </div>
          <div className={styles.areaMinus}>{parts.minus}</div>
          <div className={styles.areaPlus}>{parts.plus}</div>
          <div className={styles.areaMax}>{parts.max}</div>
          <div className={styles.areaSpin}>
            {auto ? (
              <AutoplayStopButton className={styles.stop} remaining={auto.spinsRemaining} onStop={() => stopAutoplay(AUTOPLAY_STOP_REASONS.cancelled, 'info')} />
            ) : (
              <button type="button" className={`${styles.spin} ${busy ? styles.spinning : ''}`} onClick={onSpinClick} disabled={gated || booting}
                aria-label={busy ? 'Atla' : 'Çevir'} aria-describedby="cc-spin-cost">
                <span className={styles.spinFace}>{busy ? <SkipIcon /> : <SwirlIcon />}</span>
              </button>
            )}
            <span id="cc-spin-cost" className="sr-only">{busy ? 'Animasyonu atlar; sonuç değişmez.' : `Maliyet ${formatDemo(spinCost)}`}</span>
          </div>
          <button type="button" className={`${styles.tool} ${styles.areaAuto}`} onClick={() => { sound.click(); setModal('autoplay'); }} disabled={locked} aria-haspopup="dialog">
            <LoopIcon /><span>Otomatik</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaInfo}`} onClick={() => openInfo()} aria-haspopup="dialog" aria-label="Oyun bilgisi">
            <InfoIcon /><span>Bilgi</span>
          </button>
          <button type="button" role="switch" aria-checked={ante} className={`${styles.feature} ${styles.areaAnte} ${ante ? styles.featureOn : ''}`} onClick={toggleAnte} disabled={locked}
            aria-label="Şans ×2" aria-describedby="cc-ante-desc">
            <span className={styles.featureTitle}>Şans ×2</span>
            <span className={styles.featureState}>{ante ? 'Açık' : 'Kapalı'}<span className={styles.featureFactor}> · ×1,25</span></span>
            <span id="cc-ante-desc" className={styles.featureDesc}>Bedava dönüş şansı ≈2 kat</span>
          </button>
          <button type="button" className={`${styles.feature} ${styles.featureBuy} ${styles.areaBuy}`} aria-disabled={buyReason ? true : undefined}
            onClick={() => { if (buyReason) sound.denied(); else sound.click(); setModal('buy'); }} aria-haspopup="dialog" aria-describedby="cc-buy-desc">
            <span className={styles.featureTitle}>Bonus satın al</span>
            <span className={styles.featureState}>{formatAmount(buyPrice, { trimZeros: true })} DEMO</span>
            <span id="cc-buy-desc" className={styles.featureDesc}>{buyReason ?? `10 bedava dönüş · ${formatRtp(CASCADE2_RTP.buy.rtp)}`}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSet}`} onClick={() => { sound.click(); setModal('settings'); }} aria-haspopup="dialog" aria-label="Ayarlar">
            <GearIcon /><span>Ayarlar</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSpeed} ${speedIndex > 0 ? styles.toolOn : ''}`} onClick={cycleSpeed}
            aria-label={`Dönüş hızı: ${SPEED_LABELS[settings.spinSpeed]}`}>
            <BoltIcons count={speedIndex + 1} /><span>{SPEED_LABELS[settings.spinSpeed]}</span>
          </button>
          <button type="button" className={`${styles.tool} ${styles.areaSound} ${!settings.muted ? styles.toolOn : ''}`} onClick={toggleSound} aria-pressed={!settings.muted} aria-label="Ses">
            <SoundIcon on={!settings.muted} /><span>Ses</span>
          </button>
          <div className={styles.areaMsg}>
            {soundLoad.started && !soundLoad.ready && !settings.muted && <p className={styles.msgHint} role="status">Ses yükleniyor %{soundLoad.percent}</p>}
            {error ? <p className={styles.msgError} role="alert">{error}</p>
              : outOfCredit ? <p className={styles.msgHint}>DEMO bakiyen bitti. <button type="button" className={styles.inlineLink} onClick={refill}>Bakiyeyi yenile</button></p>
              : <p className={styles.msgHint}>{lastWin && !busy ? (lastWin.payout > 0 ? <>Son tur <strong>+{moneyText(lastWin.payout)} DEMO</strong> · {multiplierText(lastWin.total)}×</> : <>Son tur kazançsız.</>) : settings.spaceToSpin ? <>Boşluk tuşu ile de çevirebilirsin.</> : <>Sonuç dönüşten önce belirlenir.</>}</p>}
          </div>
        </div>
      )}
    />
  );

  return (
    <div className={`game-page ${styles.page}`}>
      <GameHeading title="Candy Cascade" subtitle="Sekiz eşleşmede patlat, düşen şekerlerle zincir kur." mode={mode} setMode={setMode} active={busy || auto !== null} />
      <section className={`game-table ${styles.table}`} aria-label="Candy Cascade oyun masası">
        <div ref={stageRef} className={stageClass} data-phase={phase}>
          <StaticBackdrop />
          <div className={styles.freeTint} aria-hidden="true" />
          <div ref={shakeRef} className={styles.shake}>
            <div className={styles.hud}>
              {freeInfo ? (
                <div className={styles.freeCounter} aria-label={`Bedava dönüş ${freeInfo.number}, kalan dönüş ${freeInfo.left}`}>
                  <span className={styles.freeTag}><span className={styles.tagLong}>Bedava dönüş{freeInfo.number > 0 ? ` ${freeInfo.number}` : ''}</span><span className={styles.tagShort}>{freeInfo.number > 0 ? `${freeInfo.number}. dönüş` : 'Bedava'}</span></span>
                  <span className={styles.freeLeft}><small>Kalan dönüş</small><strong key={freeInfo.left}>{freeInfo.left}</strong></span>
                </div>
              ) : (
                <div className={styles.logo} aria-hidden="true"><span>Candy</span><span>Cascade</span></div>
              )}
              <div ref={badgeRef} className={`${styles.badge} ${badge ? styles.badgeOn : ''} ${badge?.sum ? styles.badgeSum : ''}`} aria-hidden={badge ? undefined : true}>
                <small>Çarpan</small>
                <strong>{badge ? (badge.parts.length ? badge.parts.map(v => `×${v}`).join(' + ') : '×…') : '×'}{badge?.sum && badge.parts.length > 1 ? ` = ×${badge.sum}` : ''}</strong>
              </div>
            </div>
            <div className={styles.boardWrap}>{boardElement}</div>
            <div ref={meterRef} className={`${styles.meter} ${free ? styles.meterFree : ''}`}>
              {free ? (
                <>
                  <div className={styles.meterPart}><small>Bu dönüş</small><strong><CountUp cents={amountCents(meter.spin)} duration={meterDur} /><em> DEMO</em></strong></div>
                  <div className={`${styles.meterPart} ${styles.meterTotal}`}><small>Toplam kazanç</small><strong><CountUp cents={amountCents(meter.total)} duration={meterDur} /><em> DEMO</em></strong></div>
                </>
              ) : phase === 'idle' ? (
                <div className={styles.meterIdle}><span>Her yerde <strong>8+</strong> aynı şeker öder</span><span aria-hidden="true">·</span><span><strong>4</strong> yıldız = <strong>10</strong> bedava dönüş</span></div>
              ) : (
                <div className={styles.meterPart}><small>Kazanç</small><strong><CountUp cents={amountCents(meter.total)} duration={meterDur} /><em> DEMO</em></strong></div>
              )}
            </div>
          </div>
          <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />
          <div ref={layerRef} className={styles.fxLayer} aria-hidden="true" />
          {replayInfo && <div className={styles.replayRibbon} data-testid="cascade-replay"><Icon name="history" size={15} /><span>{replayInfo}</span></div>}
          {auto && !replayInfo && <div className={styles.autoRibbon} aria-hidden="true"><LoopIcon /><span>Otomatik · {auto.spinsRemaining} tur kaldı</span></div>}
          {toast && (
            <div key={toast.key} className={`${styles.toast} ${toast.tone === 'warn' ? styles.toastWarn : ''}`} data-testid="cascade-toast">
              <span>{toast.text}</span>
              <button type="button" className={styles.toastClose} onClick={() => setToast(null)} aria-label="Bildirimi kapat"><svg {...svg} width={16} height={16}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
            </div>
          )}
          {banner && <div key={banner.key} className={`${styles.banner} ${banner.tone === 'pink' ? styles.bannerPink : ''}`} aria-hidden="true">{banner.text}</div>}
          {card?.kind === 'intro' && (
            <div className={styles.overlay} onClick={advanceHold}>
              <div className={styles.introCard} role="dialog" aria-modal="false" aria-labelledby="cc-intro-title">
                <div className={styles.introStars} aria-hidden="true">
                  <SymbolArt symbol="star" size="100%" /><SymbolArt symbol="star" size="100%" /><SymbolArt symbol="star" size="100%" />
                </div>
                <h2 id="cc-intro-title" className={styles.introTitle}>Bedava dönüş</h2>
                <p className={styles.introCount}><strong>{card.awarded}</strong><span>bedava dönüş</span></p>
                <p className={styles.introText}>Çarpan kristalleri yalnız bu turda düşer ve dönüş sonunda toplanır.</p>
                <button type="button" className={styles.introButton} onClick={event => { event.stopPropagation(); advanceHold(); }}>Başla</button>
                <span className={styles.introTimer} style={{ '--hold': `${card.dur}ms` } as CSSProperties} aria-hidden="true" />
              </div>
            </div>
          )}
          {card?.kind === 'outro' && (
            <div className={styles.overlay} onClick={advanceHold}>
              <div className={`${styles.introCard} ${styles.outroCard}`} role="dialog" aria-modal="false" aria-labelledby="cc-outro-title" data-testid="cascade-outro">
                <div className={styles.outroCrystals} aria-hidden="true">
                  <SymbolArt symbol="crystal" multiplier={5} size="100%" /><SymbolArt symbol="star" size="100%" /><SymbolArt symbol="crystal" multiplier={25} size="100%" />
                </div>
                <h2 id="cc-outro-title" className={styles.introTitle}>Bedava dönüş bitti</h2>
                <p className={styles.outroLabel}>Toplam kazanç</p>
                <p className={styles.outroAmount}><CountUp key={card.at} from={0} cents={amountCents(card.total)} duration={Math.min(1400, Math.round(card.dur * 0.55))} instant={reducedMotion} /><small> DEMO</small></p>
                <p className={styles.outroMeta}><span>{card.spins} dönüş</span><span aria-hidden="true">·</span><span>{multiplierText(card.total)}×</span></p>
                <button type="button" className={styles.introButton} onClick={event => { event.stopPropagation(); advanceHold(); }}>Devam</button>
                <span className={styles.introTimer} style={{ '--hold': `${card.dur}ms` } as CSSProperties} aria-hidden="true" />
              </div>
            </div>
          )}
          {card?.kind === 'max' && (
            <div className={`${styles.overlay} ${styles.overlayBig} ${styles.tier3}`} onClick={advanceHold}>
              {!reducedMotion && <div className={styles.rays} aria-hidden="true" />}
              <div className={styles.bigCard}>
                <p className={styles.bigTitle}>Azami kazanç</p>
                <p className={styles.bigAmount}>5.000×</p>
                <p className={styles.bigHint}>Tur tavana ulaştı; kalan dönüşler oynanmaz.</p>
              </div>
            </div>
          )}
          {card?.kind === 'big' && (
            <div className={`${styles.overlay} ${styles.overlayBig} ${styles[`tier${cardTier}`]}`} onClick={advanceHold}>
              {!reducedMotion && <div className={styles.rays} aria-hidden="true" />}
              <div className={styles.bigCard}>
                <p className={styles.bigTitle}>{BIG_TITLES[card.tier]}</p>
                <p className={styles.bigAmount}><CountUp key={card.at} from={0} cents={amountCents(card.total)} duration={card.countUp} instant={card.instant} /><small> DEMO</small></p>
                <p className={styles.bigMult}>{multiplierText(card.total)}×</p>
                <button type="button" className={styles.bigHint} onClick={event => { event.stopPropagation(); advanceHold(); }}>Geçmek için dokun</button>
              </div>
            </div>
          )}
          {gated && (
            <div className={`${styles.overlay} ${styles.gated}`}>
              <div className={styles.gatedCard}>
                <Icon name="lock" size={26} />
                <h2>Zincir üstü Candy Cascade yok.</h2>
                <p>Bu oyun yalnız DEMO kredisiyle oynanır; gerçek bahis kabul edilmez.</p>
                <button className="text-button" onClick={() => setMode('demo')}>Yerel demoya dön<Icon name="arrow" size={17} /></button>
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
                <li><span aria-hidden="true"><SymbolArt symbol="crown" size="100%" /></span><strong>8+ her yerde</strong><small>Aynı şekerden 8 tane, ızgaranın her yerinde öder</small></li>
                <li><span aria-hidden="true"><SymbolArt symbol="crystal" multiplier={100} size="100%" /></span><strong>100× kristal</strong><small>Bedava dönüşte çarpanlar toplanır</small></li>
                <li><span aria-hidden="true"><SymbolArt symbol="star" size="100%" /></span><strong>5.000× azami</strong><small>4 yıldız 10 bedava dönüş açar</small></li>
              </ul>
              {boot.phase === 'loading' ? (
                <div className={styles.loadBar} role="progressbar" aria-label="Oyun yükleniyor" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(boot.progress * 100)}>
                  <span style={{ transform: `scaleX(${boot.progress})` }} />
                </div>
              ) : (
                <div className={styles.splashActions}>
                  <button type="button" className={styles.introButton} autoFocus onClick={() => { sound.unlock(); sound.click(); setBoot(b => ({ ...b, phase: 'done' })); }}>Oyna</button>
                  <button type="button" className={styles.splashSkip} onClick={() => { updateSettings({ introScreen: false }); setBoot(b => ({ ...b, phase: 'done' })); }}>Açılış ekranını bir daha gösterme</button>
                </div>
              )}
              <p className={styles.splashNote}>DEMO kredisi değersizdir · Sonuç dönüşten önce belirlenir · Sertifikasız simülasyon RTP ≈ {formatRtp(CASCADE2_RTP.standard.rtp)}</p>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <SessionBar className={styles.sessionBar} nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <CascadeHistory onReplay={replay} replayDisabled={busy || auto !== null || booting} replayingId={replaying?.recordId ?? null} />
      <StaticFooter />

      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title="Ayarlar" size="md">
        <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
        <p className={styles.modalNote} role="status">{soundLoad.ready ? 'Ses hazır: müzik ve efektler bu cihazda oluşturuldu.' : soundLoad.started ? `Ses yükleniyor %${soundLoad.percent} (bu sırada basit efektler çalar).` : 'Ses ilk dokunuşta yüklenir.'}</p>
        <section className={styles.demoBox} aria-labelledby="cc-demo-title">
          <h3 id="cc-demo-title">DEMO bakiyesi</h3>
          <p>Bakiye {formatDemo(demoBalance)}. Yenilemek bakiyeyi 1.000 DEMO yapar ve geçmişe "Bakiye yenilendi" satırı ekler; tur veya otomatik oyun sürerken yapılamaz.</p>
          <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={refill} disabled={busy || auto !== null || gated}>Bakiyeyi yenile</button>
        </section>
      </Modal>
      <GameInfo open={modal === 'info'} onClose={() => setModal(null)} pages={infoPages} title="Candy Cascade · Oyun bilgisi" initialPageId={infoPage} />
      <Modal open={modal === 'autoplay'} onClose={() => setModal(null)} title="Otomatik oyun" size="md">
        <AutoplayPanel onStart={startAutoplay} spinCostCents={spinCost} balanceCents={demoBalance} disabled={busy || gated} />
        <p className={styles.modalNote}>Her tur {formatDemo(spinCost)} ({ante ? 'Şans ×2 açık' : 'standart'}). Otomatik oyun bonus satın almaz; sekme gizlenince veya 30 dakikalık hatırlatmada durur.</p>
      </Modal>
      <BuyFeatureDialog
        open={modal === 'buy'}
        onClose={() => setModal(null)}
        onConfirm={confirmBuy}
        featureName={`10 bedava dönüş · bahis ${formatDemo(bet)}`}
        priceCents={buyPrice}
        balanceCents={demoBalance}
        rtpText={`Satın alma RTP ${formatRtp(CASCADE2_RTP.buy.rtp)} · standart ${formatRtp(CASCADE2_RTP.standard.rtp)} (simülasyon, sertifikasız)`}
        description={<>Bahsin <strong>100 katı</strong>. Tur en az 4 yıldızla başlar ve 10 bedava dönüş garantilidir; kazançlar {formatDemo(bet)} bahse göre ödenir, azami {formatDemo(bet * 5000)}.</>}
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
