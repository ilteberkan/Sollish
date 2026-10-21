'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { DAMLA_PAYTABLES, DAMLA_RISKS, DAMLA_ROWS, playDamlaRound, type DamlaMode, type DamlaRisk, type DamlaRound, type DamlaRows } from '@sollish/protocol';
import { DEMO_START_CENTS } from '@/lib/demo';
import { useFormat, useT } from '@/lib/i18n/client';
import { useRgsText } from '@/lib/use-rgs-text';
import { richText } from '../game-rich';
import {
  DAMLA_AUTOPLAY_GAP, DAMLA_BET_LADDER, DAMLA_DEFAULT_BET_CENTS, DAMLA_DEFAULT_RISK, DAMLA_DEFAULT_ROWS, DAMLA_MAX_BET_CENTS, DAMLA_MIN_BET_CENTS, DAMLA_RAIN_COUNTS,
  DAMLA_RAIN_GAP, DAMLA_REMOTE_MIN_GAP_MS, damlaAffordable, damlaAutoplayAfterRound, damlaAutoplayBeforeDrop, damlaCap, damlaCost, damlaDropLocked, damlaLedgerLimits,
  damlaMode, damlaModeFacts, damlaModeLocked, damlaMultiplierText, damlaPercent, damlaRoundId, damlaSettleReady, damlaShownBalance, isDamlaRisk, isDamlaRows, parseDamlaMode,
} from '@/lib/damla-controls';
import { DAMLA_TIER_INFO, buildDamlaTimeline, damlaCelebration, damlaHistoryDetail, damlaLatticeXs, damlaTier, type DamlaEvent } from '@/lib/damla-timeline';
import type { CelebrationLevel } from '@/lib/slot-kit/win-tiers';
import { autoplayNetLossCents, createAutoplay, type AutoplayConfig, type AutoplayState, type AutoplayStopCode } from '@/lib/slot-kit/autoplay';
import { SPIN_SPEEDS, type SpinSpeed } from '@/lib/slot-kit/settings';
import { markRoundShown, type RemoteReceipt, type RemoteRoundSource, type SlotMode } from '@/lib/rgs-client';
import { DAMLA_ENGINE } from '@/lib/slot-engines/damla';
import { localSourceFor, useRoundSource } from '@/lib/use-round-source';
import { useDamlaSound } from '@/lib/slot-audio/use-damla-sound';
import { useProduct, type DemoRecord } from '../providers';
import { DemoNotice, GameHeading, type Mode } from '../game-common';
import { Icon } from '../icons';
import { AutoplayPanel, AutoplayStopButton, BetSelector, GameInfo, Modal, RealityCheckDialog, SessionBar, SettingsPanel, useSession, useSlotSettings } from '../slot-kit';
import kit from '../slot-kit/kit.module.css';
import { DamlaBoard, type BoardPool, type DamlaBoardHandle } from './board';
import { DamlaHistory } from './damla-history';
import { damlaInfoPages } from './damla-info-pages';
import { DamlaDropGlyph, DamlaLogo } from './logo';
import styles from './damla-game.module.css';

/* Lifecycle (the RGS model, lib/damla-controls.ts): a press admits its drops — each its own engine round (seed, nonce) that
   is resolved AND settled at once (local: one DemoLedger reserve + settle; remote: the server). The board then presents
   each drop following round.path exactly; the animation decides nothing. Until a drop has landed on screen its payout is
   held back from the shown balance, its history row stays hidden and session/autobet counters ignore it; drops of one rain
   settle on screen strictly in admission order. Drop / Rain / Space stay locked until every drop of the press has landed
   (game-standards §6); risk, terraces and bet are locked while anything is in flight. A history replay is ledger-free. */

type Flight = {
  seq: number; batch: number; recordId: string | null; round: DamlaRound; mode: DamlaMode; bet: number; cost: number; balanceBefore: number;
  remote: { receipt: RemoteReceipt; balanceAfter: number } | null; replay: boolean; landed: boolean; settled: boolean;
};
type StripItem = { key: number; hundredths: number; tier: number; edge: boolean };
type Callout = { key: number; level: CelebrationLevel; hundredths: number; payout: number; life: number; gold: boolean };
type Toast = { key: number; text: string; tone: 'info' | 'warn' };
type ModalId = 'settings' | 'info' | 'autoplay' | null;
type Boot = { phase: 'loading' | 'ready' | 'done'; progress: number };
type StopCode = AutoplayStopCode | 'server-failed' | 'drop-failed' | 'quit';

const SPEED_KEY = { normal: 'settings.speedNormal', quick: 'settings.speedQuick', turbo: 'settings.speedTurbo' } as const satisfies Record<SpinSpeed, string>;
const RISK_KEY = { low: 'risk.low', medium: 'risk.medium', high: 'risk.high' } as const satisfies Record<DamlaRisk, string>;
const BET_KEY = 'sollish:damla:bet';
const MODE_KEY = 'sollish:damla:mode';
const STRIP_MAX = 14;
const localRoundSource = localSourceFor(DAMLA_ENGINE);
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
  const value = (window as unknown as { __damlaRealityMs?: unknown }).__damlaRealityMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? value : undefined;
}

/* ------------------------------------------------------------------ icons (original, inline) */
const svg = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, focusable: false } as const;
function SoundIcon({ on }: { on: boolean }) {
  return <svg {...svg}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{on ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /> : <path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />}</svg>;
}
function GearIcon() { return <svg {...svg}><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function InfoIcon() { return <svg {...svg}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.9" /><path d="M12 11v6M12 7.4h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; }
function LoopIcon() { return <svg {...svg}><path d="M17 3.5 20 6.5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5 4 17.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 12.5v1a4 4 0 0 1-4 4H4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>; }
function RefillIcon() { return <svg {...svg} width={16} height={16}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SpeedDrops({ count }: { count: number }) {
  return <span className={styles.speedDrops} aria-hidden="true">{[0, 1, 2].map(i => <svg key={i} viewBox="0 0 12 14" width={9} height={11} data-on={i < count || undefined}><path d="M6 1C7.6 4 11 6.5 11 9a5 5 0 0 1-10 0C1 6.5 4.4 4 6 1Z" fill="currentColor" /></svg>)}</span>;
}
function RainIcon() { return <svg {...svg}><path d="M7 3c1 1.8 2.4 3 2.4 4.4a2.4 2.4 0 0 1-4.8 0C4.6 6 6 4.8 7 3ZM16.5 6c1 1.8 2.4 3 2.4 4.4a2.4 2.4 0 0 1-4.8 0c0-1.4 1.4-2.6 2.4-4.4ZM11 12c1 1.8 2.4 3 2.4 4.4a2.4 2.4 0 0 1-4.8 0c0-1.4 1.4-2.6 2.4-4.4Z" fill="currentColor" /></svg>; }

const Footer = memo(function Footer({ remote, rules }: { remote: boolean; rules: { summary: string; lines: string[]; access: string } }) {
  return (
    <>
      <DemoNotice remote={remote} />
      <details className="rules"><summary><Icon name="shield" size={17} /><span>{rules.summary}</span><Icon name="chevron" size={16} /></summary><div>{rules.lines.map((line, i) => <p key={i}>{line}</p>)}<p>{rules.access}</p></div></details>
    </>
  );
});

export function DamlaGame() {
  const { reserveDemo, settleDemo, recordRemote, setActiveDemo, demoBalance, resetDemoBalance } = useProduct();
  const router = useRouter();
  const t = useT('damla');
  const tk = useT('slotKit');
  const tc = useT('common');
  const format = useFormat();
  const rgs = useRgsText();
  const loc = format.locale;
  const { settings, update: updateSettings, reset: resetSettings } = useSlotSettings('damla');
  const [realityMs] = useState(realityIntervalOverride);
  const session = useSession(realityMs ? { realityIntervalMs: realityMs } : {});
  const recordSession = session.recordRound;
  const { sound, loadState: soundLoad } = useDamlaSound(settings);
  const [mode, setMode] = useState<Mode>('demo');
  const [bet, setBet] = useState(DAMLA_DEFAULT_BET_CENTS);
  const [risk, setRisk] = useState<DamlaRisk>(DAMLA_DEFAULT_RISK);
  const [rows, setRows] = useState<DamlaRows>(DAMLA_DEFAULT_ROWS);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [strip, setStrip] = useState<StripItem[]>([]);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [goldBanner, setGoldBanner] = useState(0);
  const [lastWin, setLastWin] = useState<{ payout: number; hundredths: number; batchTotal: number; batchCount: number; replay: boolean } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [auto, setAuto] = useState<AutoplayState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [modal, setModal] = useState<ModalId>(null);
  const [infoPage, setInfoPage] = useState('how');
  const [replaying, setReplaying] = useState<{ recordId: string | null; seed: string } | null>(null);
  const [boot, setBoot] = useState<Boot>(() => ({ phase: bootedOnce ? 'done' : 'loading', progress: 0 }));
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const sourceView = useRoundSource(DAMLA_ENGINE);
  const remote: RemoteRoundSource | null = sourceView.status === 'remote' ? sourceView.source : null;
  const sourcePending = sourceView.status === 'pending';
  const [remoteBalance, setRemoteBalance] = useState<number | null>(null);
  useEffect(() => { if (sourceView.status === 'remote') setRemoteBalance(sourceView.balanceCents); }, [sourceView]);

  const board = useRef<DamlaBoardHandle>(null);
  const flights = useRef(new Map<number, Flight>());
  const seq = useRef(0);
  const batchRef = useRef(0);
  const batchSum = useRef({ batch: 0, total: 0, count: 0 });
  const stripKey = useRef(0);
  const calloutKey = useRef(0);
  const toastKey = useRef(0);
  const pendingRemote = useRef(false);
  const lastLaunch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const autoRef = useRef<AutoplayState | null>(null);
  autoRef.current = auto;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const currentMode = damlaMode(risk, rows);
  const authoritative = remote ? (remoteBalance ?? 0) : demoBalance;
  const unseen = useMemo(() => [...flights.current.values()].filter(f => !f.replay && !f.settled).map(f => ({ costCents: f.cost, payoutCents: f.round.payoutCents })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);
  const balance = damlaShownBalance(authoritative, unseen);
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const inFlight = flights.current.size;
  const hiddenIds = useMemo(() => new Set([...flights.current.values()].filter(f => !f.settled && f.recordId && !f.remote).map(f => f.recordId!)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]);
  const bump = useCallback(() => setVersion(v => v + 1), []);

  /* ---------------------------------------------------------------- persisted choices */
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(BET_KEY));
      if (DAMLA_BET_LADDER.includes(stored)) setBet(stored);
      const m = parseDamlaMode(window.localStorage.getItem(MODE_KEY) ?? '');
      if (m) { setRisk(m.risk); setRows(m.rows); }
    } catch { /* storage blocked: defaults */ }
  }, []);
  const remember = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* not remembered */ } };
  const chooseBet = useCallback((cents: number) => {
    setBet(prev => { if (cents !== prev) sound.betChange(cents > prev ? 1 : -1); return cents; });
    remember(BET_KEY, String(cents));
  }, [sound]);

  /* ---------------------------------------------------------------- boot, sound unlock, toasts */
  useEffect(() => {
    let cancelled = false;
    sound.scene('base');
    if (bootedOnce) return;
    let progress = 0.12;
    setBoot({ phase: 'loading', progress });
    const ticker = window.setInterval(() => { progress = Math.min(1, progress + 0.16); if (!cancelled) setBoot(b => (b.phase === 'loading' ? { ...b, progress } : b)); }, 100);
    const timer = window.setTimeout(() => {
      window.clearInterval(ticker);
      if (cancelled) return;
      bootedOnce = true;
      setBoot({ phase: settingsRef.current.introScreen ? 'ready' : 'done', progress: 1 });
    }, 700);
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
    const timer = window.setTimeout(() => setToast(x => (x?.key === toast.key ? null : x)), toast.tone === 'warn' ? 7000 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!callout) return;
    const timer = window.setTimeout(() => setCallout(c => (c?.key === callout.key ? null : c)), callout.life);
    return () => window.clearTimeout(timer);
  }, [callout]);

  /* ---------------------------------------------------------------- autoplay stop */
  const stopAutoplay = useCallback((code: StopCode, tone: Toast['tone'] = 'warn') => {
    const state = autoRef.current;
    if (!state) return;
    autoRef.current = null;
    setAuto(null);
    const net = -autoplayNetLossCents(state);
    const reason = code === 'server-failed' ? t('autoplay.serverFailed') : code === 'drop-failed' ? t('autoplay.dropFailed') : code === 'quit' ? t('autoplay.quit') : tk(`autoplay.reasons.${code}`);
    showToast(t('toast.autoplayStopped', { reason, drops: state.spinsDone, net: format.signedDemo(net) }), tone);
    setAnnounce(t('toast.autoplayStoppedShort', { reason }));
  }, [showToast, t, tk, format]);

  /* ---------------------------------------------------------------- settlement on screen (in order) */
  const present = useCallback((f: Flight) => {
    f.settled = true;
    const { round } = f;
    const hundredths = round.multiplierHundredths;
    if (f.replay) {
      setReplaying(null);
      setLastWin({ payout: round.payoutCents, hundredths, batchTotal: round.payoutCents, batchCount: 1, replay: true });
      setAnnounce(t('announce.replayDone', { pool: round.slot + 1, multiplier: damlaMultiplierText(hundredths, loc), amount: format.number(round.payoutCents / 100) }));
    } else {
      if (f.remote) {
        const { receipt } = f.remote;
        const record: DemoRecord = { id: `remote:${receipt.roundId}`, game: 'Damla', stake: f.cost, payout: round.payoutCents, detail: damlaHistoryDetail(round), at: receipt.at, kind: 'round',
          damla: { engine: round.engine, seedHex: round.seedHex, betCents: f.bet, mode: f.mode, costCents: f.cost }, remote: { roundId: receipt.roundId, nonce: receipt.fair.nonce, serverSeedHash: receipt.fair.serverSeedHash, clientSeed: receipt.fair.clientSeed } };
        recordRemote(record);
        markRoundShown('damla', receipt.roundId);
      }
      recordSession({ costCents: f.cost, payoutCents: round.payoutCents });
      setStrip(s => [{ key: ++stripKey.current, hundredths, tier: damlaTier(hundredths), edge: round.slot === 0 || round.slot === round.rows }, ...s].slice(0, STRIP_MAX));
      if (batchSum.current.batch !== f.batch) batchSum.current = { batch: f.batch, total: 0, count: 0 };
      batchSum.current.total += round.payoutCents; batchSum.current.count++;
      setLastWin({ payout: round.payoutCents, hundredths, batchTotal: batchSum.current.total, batchCount: batchSum.current.count, replay: false });
      const state = autoRef.current;
      if (state) { const next = damlaAutoplayAfterRound(state, { costCents: f.cost, payoutCents: round.payoutCents, balanceBeforeCents: f.balanceBefore }); autoRef.current = next; setAuto(next); }
      setAnnounce(t('announce.landed', { pool: round.slot + 1, multiplier: damlaMultiplierText(hundredths, loc), amount: format.number(round.payoutCents / 100) }));
    }
    flights.current.delete(f.seq);
    if (flights.current.size === 0 && !pendingRemote.current) setActiveDemo(false);
    bump();
  }, [bump, format, loc, recordRemote, recordSession, setActiveDemo, t]);

  const settleReady = useCallback(() => {
    const queue = [...flights.current.values()].map(f => ({ seq: f.seq, landed: f.landed, settled: f.settled }));
    for (const s of damlaSettleReady(queue)) { const f = flights.current.get(s); if (f) present(f); }
  }, [present]);

  /* ---------------------------------------------------------------- board events */
  const onEvent = useCallback((f: Flight, event: DamlaEvent) => {
    switch (event.type) {
      case 'splash': sound.plink(event.terrace, f.round.rows); break;
      case 'land': {
        sound.land(event.tier, event.edge);
        const level = damlaCelebration(event.multiplierHundredths, f.round.capped);
        if (event.signature) { board.current?.gold(); sound.gold(); setGoldBanner(k => k + 1); setAnnounce(t('announce.gold')); }
        if (level !== null && (level >= 1)) {
          const speed = settingsRef.current.spinSpeed;
          setCallout({ key: ++calloutKey.current, level, hundredths: event.multiplierHundredths, payout: event.payoutCents, life: (event.signature ? 2600 : speed === 'turbo' ? 1100 : speed === 'quick' ? 1500 : 1900), gold: event.signature });
        }
        break;
      }
      case 'settle': f.landed = true; settleReady(); break;
      default: break;
    }
  }, [settleReady, sound, t]);

  const launch = useCallback((f: Flight, delay: number) => {
    flights.current.set(f.seq, f);
    const s = settingsRef.current;
    const timeline = buildDamlaTimeline(f.round, { speed: s.spinSpeed, reducedMotion });
    board.current?.launch({ key: f.seq, timeline, xs: damlaLatticeXs(f.round), delay, ghost: f.replay, onEvent: event => onEvent(f, event) });
    lastLaunch.current = performance.now() + delay;
  }, [onEvent, reducedMotion]);

  // Leaving mid-flight: remote drops the server already settled still get their history line (local ones already have it).
  const presentRef = useRef(present); presentRef.current = present;
  useEffect(() => () => {
    board.current?.clear();
    for (const f of flights.current.values()) {
      if (f.settled || f.replay || !f.remote) continue;
      const { receipt } = f.remote;
      recordRemote({ id: `remote:${receipt.roundId}`, game: 'Damla', stake: f.cost, payout: f.round.payoutCents, detail: damlaHistoryDetail(f.round), at: receipt.at, kind: 'round', damla: { engine: f.round.engine, seedHex: f.round.seedHex, betCents: f.bet, mode: f.mode, costCents: f.cost }, remote: { roundId: receipt.roundId, nonce: receipt.fair.nonce, serverSeedHash: receipt.fair.serverSeedHash, clientSeed: receipt.fair.clientSeed } });
      markRoundShown('damla', receipt.roundId);
    }
    flights.current.clear();
    setActiveDemo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- admitting drops */
  const gated = mode === 'live';
  const booting = boot.phase !== 'done';
  const lockState = { inFlight, autoplay: auto !== null, replaying: replaying !== null, pending, gated, booting: booting || sourcePending };
  const modeLocked = damlaModeLocked(lockState);
  const dropLocked = damlaDropLocked({ ...lockState, autoplay: false });

  /** Local: resolve + settle in the DEMO ledger now; presentation follows. */
  const admitLocal = useCallback((roundMode: DamlaMode, betCents: number, batch: number, balanceBefore: number): Flight | null => {
    let round: DamlaRound;
    try { round = localRoundSource.resolve('damla', betCents, roundMode as unknown as SlotMode); } catch { setError(t('errors.entropy')); return null; }
    const cost = damlaCost(betCents);
    let id: string | null;
    try { id = reserveDemo(cost, damlaLedgerLimits(roundMode)); } catch { setError(t('errors.entropy')); return null; }
    if (!id) { setError(t('errors.noCredit')); sound.denied(); return null; }
    settleDemo({ id, game: 'Damla', stake: cost, payout: round.payoutCents, detail: damlaHistoryDetail(round), at: Date.now(), kind: 'round', damla: { engine: round.engine, seedHex: round.seedHex, betCents, mode: roundMode, costCents: cost } });
    return { seq: ++seq.current, batch, recordId: id, round, mode: roundMode, bet: betCents, cost, balanceBefore, remote: null, replay: false, landed: false, settled: false };
  }, [reserveDemo, settleDemo, sound, t]);

  /** Remote: one request at a time (the RGS allows one in flight and ≤ 4 rounds/s); each drop launches when its round arrives. */
  const admitRemote = useCallback(async (source: RemoteRoundSource, roundMode: DamlaMode, betCents: number, count: number, batch: number) => {
    pendingRemote.current = true; setPending(true); setActiveDemo(true); setError('');
    const cost = damlaCost(betCents);
    for (let i = 0; i < count; i++) {
      if (!mounted.current) break;
      const before = balanceRef.current;
      setRemoteBalance(b => (b ?? 0) - cost);
      const asked = performance.now();
      try {
        const play = await source.client.play('damla', betCents, roundMode as unknown as SlotMode);
        if (!mounted.current) break;
        const f: Flight = { seq: ++seq.current, batch, recordId: null, round: play.round, mode: roundMode, bet: betCents, cost: play.receipt.costCents, balanceBefore: before, remote: { receipt: play.receipt, balanceAfter: play.receipt.balanceCents }, replay: false, landed: false, settled: false };
        setRemoteBalance(play.receipt.balanceCents);
        const gap = DAMLA_RAIN_GAP[settingsRef.current.spinSpeed];
        launch(f, Math.max(0, lastLaunch.current + (i === 0 ? 0 : gap) - performance.now()));
        bump();
      } catch (failure) {
        if (!mounted.current) break;
        setError(rgs.error(failure)); sound.denied();
        if (autoRef.current) stopAutoplay('server-failed');
        source.client.state().then(state => { if (mounted.current) setRemoteBalance(state.balanceCents); }, () => undefined);
        break;
      }
      if (i < count - 1) { const wait = DAMLA_REMOTE_MIN_GAP_MS - (performance.now() - asked); if (wait > 0) await new Promise(r => setTimeout(r, wait)); }
    }
    pendingRemote.current = false; setPending(false);
    if (flights.current.size === 0) setActiveDemo(false);
    bump();
  }, [bump, launch, rgs, setActiveDemo, sound, stopAutoplay]);

  /** Drop `count` drops (1 = Drop, 5/10 = Rain). Returns false when nothing was admitted. */
  const startDrops = useCallback((count: number, opts: { fromAuto?: boolean } = {}): boolean => {
    if (flights.current.size > 0 || pendingRemote.current || gated || booting || sourcePending || (replaying && !opts.fromAuto)) return false;
    const cost = damlaCost(bet);
    const shown = balanceRef.current;
    if (!damlaAffordable(shown, cost, count)) {
      setError(t('errors.insufficient', { count, cost: format.demo(cost * count) }));
      sound.denied();
      return false;
    }
    setError(''); setReplaying(null);
    const batch = ++batchRef.current;
    const roundMode = currentMode;
    sound.unlock();
    if (remote) { void admitRemote(remote, roundMode, bet, count, batch); setAnnounce(t('announce.sentToServer', { count, amount: format.number((cost * count) / 100) })); return true; }
    const gap = DAMLA_RAIN_GAP[settingsRef.current.spinSpeed];
    let admitted = 0;
    for (let i = 0; i < count; i++) {
      const f = admitLocal(roundMode, bet, batch, shown - i * cost);
      if (!f) break;
      launch(f, i * gap);
      admitted++;
    }
    if (!admitted) return false;
    setActiveDemo(true);
    bump();
    setAnnounce(t('announce.dropped', { count: admitted, amount: format.number((cost * admitted) / 100) }));
    return true;
  }, [admitLocal, admitRemote, bet, booting, bump, currentMode, format, gated, launch, remote, replaying, setActiveDemo, sound, sourcePending, t]);
  const startRef = useRef(startDrops); startRef.current = startDrops;

  // Reload recovery (remote): the last unseen server drop of this game is presented again exactly as resolved.
  const recoveredOnce = useRef(false);
  useEffect(() => {
    if (sourceView.status !== 'remote' || !sourceView.recovered || recoveredOnce.current || booting || flights.current.size || pendingRemote.current) return;
    recoveredOnce.current = true;
    const { receipt, round } = sourceView.recovered;
    const after = sourceView.recoveredBalanceCents ?? receipt.balanceCents;
    const f: Flight = { seq: ++seq.current, batch: ++batchRef.current, recordId: null, round, mode: round.mode, bet: receipt.betCents, cost: receipt.costCents, balanceBefore: after + receipt.costCents - receipt.payoutCents, remote: { receipt, balanceAfter: after }, replay: false, landed: false, settled: false };
    setActiveDemo(true);
    setRemoteBalance(after);
    launch(f, 0);
    bump();
    setAnnounce(t('announce.recovered', { amount: format.number(receipt.payoutCents / 100) }));
  }, [sourceView, booting, bump, launch, setActiveDemo, t, format]);

  /* ---------------------------------------------------------------- history replay and share */
  const presentReplay = useCallback((round: DamlaRound, recordId: string | null, text: string) => {
    const p = { risk: round.risk, rows: round.rows };
    setRisk(p.risk); setRows(p.rows);
    setReplaying({ recordId, seed: round.seedHex });
    const f: Flight = { seq: ++seq.current, batch: ++batchRef.current, recordId: null, round, mode: round.mode, bet: round.betCents, cost: round.costCents, balanceBefore: balanceRef.current, remote: null, replay: true, landed: false, settled: false };
    // the board re-lays out for the replay's terraces first (one frame), then the drop falls
    window.requestAnimationFrame(() => { if (mounted.current) { launch(f, 120); bump(); } });
    setAnnounce(text);
  }, [bump, launch]);
  const replay = useCallback((record: DemoRecord) => {
    const meta = record.damla;
    if (!meta || flights.current.size || pendingRemote.current || autoRef.current || booting) return;
    let round: DamlaRound;
    try { round = playDamlaRound(meta.seedHex, meta.betCents, meta.mode as DamlaMode); } catch { showToast(t('toast.replayFailed'), 'warn'); return; }
    if (round.payoutCents !== record.payout || round.costCents !== meta.costCents) { showToast(t('toast.replayMismatch'), 'warn'); return; }
    board.current?.element?.scrollIntoView({ block: 'nearest' });
    presentReplay(round, record.id, t('announce.replaying', { id: damlaRoundId(meta.seedHex) }));
  }, [booting, presentReplay, showToast, t]);
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

  /* Development-only preview (visual QA): a ledger-free engine round from a seed, presented exactly like a history replay. */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const win = window as unknown as { __damlaPreview?: unknown };
    win.__damlaPreview = {
      play: (seedHex: string, roundMode: DamlaMode = 'medium-12', betCents = 100) => {
        if (flights.current.size || autoRef.current) return false;
        presentReplay(playDamlaRound(seedHex, betCents, roundMode), null, t('announce.preview'));
        return true;
      },
      inFlight: () => flights.current.size,
    };
    return () => { delete win.__damlaPreview; };
  }, [presentReplay, t]);

  /* ---------------------------------------------------------------- autobet */
  const startAutoplay = useCallback((config: AutoplayConfig) => {
    if (flights.current.size || gated) return;
    const state = createAutoplay(config, balanceRef.current);
    autoRef.current = state;
    setAuto(state);
    setModal(null);
    sound.unlock();
    showToast(t('toast.autoplayStarted', { drops: config.spins, limit: format.demo(config.lossLimitCents) }));
  }, [gated, showToast, sound, t, format]);
  const realityDue = session.realityDue;
  useEffect(() => {
    if (!auto || inFlight > 0 || pending || modal !== null || realityDue || booting || gated) return;
    const gap = DAMLA_AUTOPLAY_GAP[settingsRef.current.spinSpeed];
    const timer = window.setTimeout(() => {
      const state = autoRef.current; if (!state) return;
      const decision = damlaAutoplayBeforeDrop(state, { balanceCents: balanceRef.current, betCents: bet, tabHidden: document.hidden });
      if (!decision.continue) { stopAutoplay(decision.code, decision.code === 'completed' ? 'info' : 'warn'); return; }
      if (!startRef.current(1, { fromAuto: true })) stopAutoplay('drop-failed');
    }, state0(auto) ? 0 : gap);
    return () => window.clearTimeout(timer);
  }, [auto, inFlight, pending, modal, realityDue, booting, gated, bet, stopAutoplay]);
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
      if (target?.closest('input, textarea, select, button, a, summary, [contenteditable="true"], dialog, [role="switch"], [role="radio"]')) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.key === ' ' && !settingsRef.current.spaceToSpin) return;
      event.preventDefault();
      if (!autoRef.current) startRef.current(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------------------------------------------------------- derived view */
  const pools: BoardPool[] = useMemo(() => DAMLA_PAYTABLES[currentMode].map((h, k) => ({ text: damlaMultiplierText(h, loc), aria: t('board.pool', { n: k + 1, multiplier: damlaMultiplierText(h, loc) }) })), [currentMode, loc, t]);
  const facts = damlaModeFacts(currentMode);
  const infoPages = useMemo(() => damlaInfoPages({ betCents: bet, mode: currentMode, t, tk, format }), [bet, currentMode, t, tk, format]);
  const outOfCredit = inFlight === 0 && balance < DAMLA_MIN_BET_CENTS;
  const speedIndex = SPIN_SPEEDS.indexOf(settings.spinSpeed);
  const cost = damlaCost(bet);
  const winShown = lastWin ? (lastWin.batchCount > 1 ? lastWin.batchTotal : lastWin.payout) : 0;
  const replayInfo = replaying ? t('replay.ribbon', { id: damlaRoundId(replaying.seed) }) : null;
  const rules = useMemo(() => ({ summary: t('rules.summary'), lines: [t('rules.play'), t('rules.pay', { max: format.number(1000, 0) }), t('rules.fair')], access: tc('game.rulesAccess') }), [t, tc, format]);

  const openInfo = (page = 'how') => { setInfoPage(page); setModal('info'); sound.click(); };
  const refill = () => {
    if (inFlight || auto || pending) return;
    if (remote) {
      remote.client.resetBalance().then(cents => {
        setRemoteBalance(cents);
        const at = Date.now();
        recordRemote({ id: `remote-reset:${at}`, game: 'Damla', stake: 0, payout: 0, detail: 'Bakiye yenilendi (sunucu)', at, kind: 'reset' });
        showToast(t('toast.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); setError('');
      }, (failure: unknown) => showToast(rgs.error(failure), 'warn'));
      return;
    }
    if (resetDemoBalance('Damla')) { showToast(t('toast.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); setError(''); setAnnounce(t('announce.refilled', { amount: format.number(DEMO_START_CENTS / 100) })); }
  };
  const toggleSound = () => { const muted = !settings.muted; updateSettings({ muted }); if (!muted) sound.unlock(); };
  const cycleSpeed = () => {
    const next = SPIN_SPEEDS[(speedIndex + 1) % SPIN_SPEEDS.length]!;
    updateSettings({ spinSpeed: next }); sound.click();
    setAnnounce(t('announce.speed', { speed: tk(SPEED_KEY[next]) }));
  };
  const chooseRisk = (next: DamlaRisk) => {
    if (modeLocked || next === risk || !isDamlaRisk(next)) return;
    setRisk(next); remember(MODE_KEY, damlaMode(next, rows)); sound.click();
    setAnnounce(t('announce.mode', { risk: t(RISK_KEY[next]), rows }));
  };
  const chooseRows = (next: DamlaRows) => {
    if (modeLocked || next === rows || !isDamlaRows(next)) return;
    setRows(next); remember(MODE_KEY, damlaMode(risk, next)); sound.click();
    setAnnounce(t('announce.mode', { risk: t(RISK_KEY[risk]), rows: next }));
  };

  const deck = (
    <BetSelector ladder={DAMLA_BET_LADDER} valueCents={bet} onChange={chooseBet} balanceCents={balance} maxBetCents={DAMLA_MAX_BET_CENTS} disabled={modeLocked}
      classNames={{ minus: styles.stepBtn, plus: styles.stepBtn, value: styles.betValue, max: styles.maxChip }}
      render={parts => (
        <div className={`${kit.kit} ${styles.deck}`} role="group" aria-label={t('deck.group')} data-auto={auto ? '' : undefined}>
          <div className={styles.money}>
            <div className={styles.cell}>
              <span className={styles.cellLabel}>{t('deck.balance')}</span>
              <strong className={styles.cellValue} data-testid="damla-balance">{format.amount(balance)}<small> DEMO</small></strong>
            </div>
            <div className={styles.cell}>
              <span className={styles.cellLabel}>{lastWin && lastWin.batchCount > 1 ? t('deck.rainWin', { count: lastWin.batchCount }) : lastWin?.replay ? t('deck.winReplay') : t('deck.win')}</span>
              <strong className={`${styles.cellValue} ${winShown > 0 ? styles.cellWin : ''}`} data-testid="damla-win">{format.amount(winShown)}<small> DEMO</small></strong>
            </div>
            <button type="button" className={styles.refill} onClick={refill} disabled={inFlight > 0 || auto !== null || pending || gated} aria-label={t('deck.refill')} title={t('deck.refill')}><RefillIcon /></button>
          </div>
          <div className={styles.betRow}>
            {parts.label}
            <div className={styles.betControls} {...parts.groupProps}>{parts.minus}{parts.value}{parts.plus}{parts.max}</div>
          </div>
          <fieldset className={styles.choice} disabled={modeLocked} data-testid="damla-risk">
            <legend>{t('deck.risk')}{modeLocked && inFlight > 0 && <span className={styles.lockNote}> · {t('deck.locked')}</span>}</legend>
            <div className={styles.segments} role="radiogroup" aria-label={t('deck.risk')}>
              {DAMLA_RISKS.map(r => (
                <button key={r} type="button" role="radio" aria-checked={risk === r} className={styles.segment} data-risk={r} onClick={() => chooseRisk(r)} disabled={modeLocked}>{t(RISK_KEY[r])}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.choice} disabled={modeLocked} data-testid="damla-rows">
            <legend>{t('deck.rows')}</legend>
            <div className={styles.segments} role="radiogroup" aria-label={t('deck.rows')}>
              {DAMLA_ROWS.map(r => (
                <button key={r} type="button" role="radio" aria-checked={rows === r} className={styles.segment} onClick={() => chooseRows(r)} disabled={modeLocked} aria-label={t('deck.rowsAria', { rows: r })}>{r}</button>
              ))}
            </div>
          </fieldset>
          <div className={styles.actions}>
            {auto ? (
              <AutoplayStopButton className={styles.stop} remaining={auto.spinsRemaining} onStop={() => stopAutoplay('cancelled', 'info')} />
            ) : (
              <button type="button" className={styles.drop} onClick={() => startDrops(1)} disabled={dropLocked} data-locked={inFlight > 0 || undefined} data-testid="damla-drop"
                aria-label={t('deck.drop')} aria-describedby="dm-drop-cost">
                <DamlaDropGlyph className={styles.dropGlyph} />
                <span className={styles.dropText}><strong>{t('deck.drop')}</strong><small>{format.demo(cost)}</small></span>
              </button>
            )}
            <span id="dm-drop-cost" className="sr-only">{inFlight > 0 ? t('deck.dropLocked') : t('deck.dropCost', { cost: format.demo(cost) })}</span>
            <div className={styles.rain} role="group" aria-label={t('deck.rain')}>
              <span className={styles.rainLabel}><RainIcon />{t('deck.rain')}</span>
              {DAMLA_RAIN_COUNTS.map(n => (
                <button key={n} type="button" className={styles.rainBtn} onClick={() => startDrops(n)} disabled={dropLocked || auto !== null} data-testid={`damla-rain-${n}`}
                  aria-label={t('deck.rainAria', { count: n, cost: format.demo(cost * n) })}>×{n}</button>
              ))}
            </div>
          </div>
          <div className={styles.tools}>
            <button type="button" className={styles.tool} onClick={() => { sound.click(); setModal('autoplay'); }} disabled={modeLocked} aria-haspopup="dialog"><LoopIcon /><span>{t('deck.auto')}</span></button>
            <button type="button" className={`${styles.tool} ${speedIndex > 0 ? styles.toolOn : ''}`} onClick={cycleSpeed} aria-label={t('deck.speedAria', { speed: tk(SPEED_KEY[settings.spinSpeed]) })}><SpeedDrops count={speedIndex + 1} /><span>{tk(SPEED_KEY[settings.spinSpeed])}</span></button>
            <button type="button" className={`${styles.tool} ${!settings.muted ? styles.toolOn : ''}`} onClick={toggleSound} aria-pressed={!settings.muted} aria-label={t('deck.sound')}><SoundIcon on={!settings.muted} /><span>{t('deck.sound')}</span></button>
            <button type="button" className={styles.tool} onClick={() => openInfo()} aria-haspopup="dialog" aria-label={t('deck.infoAria')}><InfoIcon /><span>{t('deck.info')}</span></button>
            <button type="button" className={styles.tool} onClick={() => { sound.click(); setModal('settings'); }} aria-haspopup="dialog" aria-label={tk('settings.title')}><GearIcon /><span>{tk('settings.title')}</span></button>
          </div>
          <div className={styles.msg}>
            {soundLoad.started && !soundLoad.ready && !settings.muted && <p className={styles.msgHint} role="status">{t('deck.soundLoading', { percent: soundLoad.percent })}</p>}
            {error ? <p className={styles.msgError} role="alert">{error}</p>
              : outOfCredit ? <p className={styles.msgHint}>{t('deck.outOfCredit')} <button type="button" className={styles.inlineLink} onClick={refill}>{t('deck.refill')}</button></p>
              : <p className={styles.msgHint}>{inFlight > 0 ? t('deck.inFlight', { count: inFlight }) : lastWin && !lastWin.replay ? richText(t, 'deck.lastWin', { multiplier: damlaMultiplierText(lastWin.hundredths, loc), money: format.demo(lastWin.payout) }) : settings.spaceToSpin ? richText(t, 'deck.hintSpace') : t('deck.hintFixed')}</p>}
          </div>
        </div>
      )}
    />
  );

  return (
    <div className={`game-page ${styles.page}`}>
      <GameHeading title={t('title')} subtitle={t('subtitle')} mode={mode} setMode={setMode} active={inFlight > 0 || auto !== null || pending}
        badge={remote ? rgs.source('remote') : sourcePending ? t('badge.checking') : rgs.source('local')} />
      <section className={`game-table ${styles.table}`} aria-label={t('table')} data-risk={risk}>
        <div className={styles.layout}>
          <div className={styles.stage} data-replay={replayInfo ? '' : undefined}>
            <div className={styles.stageTop}>
              <DamlaLogo compact className={styles.logo} />
              <div className={styles.modeTag} aria-live="off"><span>{t(RISK_KEY[risk])}</span><span aria-hidden="true">·</span><span>{t('deck.rowsShort', { rows })}</span><span aria-hidden="true">·</span><span>{t('deck.maxWin', { max: damlaMultiplierText(damlaCap(currentMode), loc) })}</span></div>
              <ol className={styles.strip} aria-label={t('strip.label')} data-testid="damla-strip">
                {strip.map(item => <li key={item.key} data-tier={item.tier} data-edge={item.edge || undefined}>×{damlaMultiplierText(item.hundredths, loc)}</li>)}
              </ol>
            </div>
            <div className={styles.boardWrap}>
              <DamlaBoard ref={board} rows={rows} pools={pools} goldEdge={risk === 'high'} reduced={reducedMotion} lite={reducedMotion || settings.reducedEffects}
                label={t('board.label', { rows, pools: rows + 1, risk: t(RISK_KEY[risk]) })} poolsLabel={t('board.pools')} />
              {replayInfo && <div className={styles.replayRibbon} data-testid="damla-replay"><Icon name="history" size={15} /><span>{replayInfo}</span></div>}
              {auto && !replayInfo && <div className={styles.autoRibbon} aria-hidden="true"><LoopIcon /><span>{t('auto.ribbon', { drops: auto.spinsRemaining })}</span></div>}
              {callout && (
                <div key={callout.key} className={styles.callout} data-level={callout.level} data-gold={callout.gold || undefined} style={{ animationDuration: `${callout.life}ms` } as CSSProperties} data-testid="damla-callout" aria-hidden="true">
                  <span className={styles.calloutTag}>{tk(`winTier.${DAMLA_TIER_INFO[callout.level].id}.title`)}</span>
                  <span className={styles.calloutValue}>×{damlaMultiplierText(callout.hundredths, loc)}</span>
                  <span className={styles.calloutAmount}>+{format.demo(callout.payout)}</span>
                </div>
              )}
              {goldBanner > 0 && <div key={`gold-${goldBanner}`} className={styles.goldBanner} aria-hidden="true" data-testid="damla-gold">{t('gold.banner')}</div>}
              {toast && (
                <div key={`toast-${toast.key}`} className={`${styles.toast} ${toast.tone === 'warn' ? styles.toastWarn : ''}`} data-testid="damla-toast">
                  <span>{toast.text}</span>
                  <button type="button" className={styles.toastClose} onClick={() => setToast(null)} aria-label={t('toast.close')}><svg {...svg} width={16} height={16}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
                </div>
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
          <div className={styles.side}>{deck}</div>
        </div>
        {boot.phase !== 'done' && (
          <div className={styles.splash} data-testid="damla-splash">
            <div className={styles.splashCard}>
              <DamlaLogo className={styles.splashLogo} place={t('logo.place')} />
              <span className={styles.originalTag}>{t('splash.original')}</span>
              <ul className={styles.splashFeatures}>
                <li><strong>{t('splash.terraces.title')}</strong><small>{t('splash.terraces.text')}</small></li>
                <li><strong>{t('splash.rain.title')}</strong><small>{t('splash.rain.text')}</small></li>
                <li><strong>{t('splash.gold.title', { max: format.number(1000, 0) })}</strong><small>{t('splash.gold.text')}</small></li>
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
              <p className={styles.splashNote}>{t('splash.note', { rtp: damlaPercent(facts.exact, loc) })}</p>
            </div>
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <SessionBar className={styles.sessionBar} nowMs={session.nowMs} elapsedMs={session.elapsedMs} netCents={session.netCents} />
      <DamlaHistory hiddenIds={hiddenIds} onReplay={replay} replayDisabled={inFlight > 0 || pending || auto !== null || booting} replayingId={replaying?.recordId ?? null} onShare={remote ? shareRound : undefined} />
      <Footer remote={remote !== null} rules={rules} />

      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title={tk('settings.title')} size="md">
        <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} showVoice={false} />
        <p className={styles.modalNote} role="status">{soundLoad.ready ? t('settings.soundReady') : soundLoad.started ? t('settings.soundLoading', { percent: soundLoad.percent }) : t('settings.soundIdle')}</p>
        <section className={styles.demoBox} aria-labelledby="dm-demo-title">
          <h3 id="dm-demo-title">{t('settings.demoTitle')}</h3>
          <p>{t('settings.demoText', { balance: format.demo(balance), remote: remote ? 'yes' : 'no', start: format.number(DEMO_START_CENTS / 100) })}</p>
          <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={refill} disabled={inFlight > 0 || auto !== null || gated}>{t('deck.refill')}</button>
        </section>
      </Modal>
      <GameInfo open={modal === 'info'} onClose={() => setModal(null)} pages={infoPages} title={t('info.title')} initialPageId={infoPage} />
      <Modal open={modal === 'autoplay'} onClose={() => setModal(null)} title={t('autoplay.title')} size="md">
        <AutoplayPanel onStart={startAutoplay} spinCostCents={cost} balanceCents={balance} disabled={inFlight > 0 || gated} instant countLabel={t('autoplay.drops')} />
        <p className={styles.modalNote}>{t('autoplay.note', { cost: format.demo(cost), mode: `${t(RISK_KEY[risk])} · ${t('deck.rowsShort', { rows })}` })}</p>
      </Modal>
      <RealityCheckDialog open={realityDue && modal === null} elapsedMs={session.elapsedMs} netCents={session.netCents}
        onContinue={() => session.acknowledge()} onQuit={() => { stopAutoplay('quit', 'info'); session.acknowledge(); router.push('/games'); }} />
    </div>
  );
}
/** First autobet drop starts at once; later ones wait for the speed's gap. */
function state0(state: AutoplayState): boolean { return state.spinsDone === 0; }
