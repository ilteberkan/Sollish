'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cascadeSeedFromEntropy, playCascadeRound, type CascadeRound } from '@sollish/protocol';
import { demoNumber, parseDemoAmount } from '@/lib/demo';
import { createCascadeAudio, type CascadeAudio } from '@/lib/cascade-audio';
import { buildCascadeTimeline, cascadeHistoryDetail, centsFor, finalState, moneyText, multiplierText, winAnnouncement, type CascadeTimeline, type Meter, type TimelineEvent } from '@/lib/cascade-timeline';
import { TimelinePlayer, type EventInfo } from '@/lib/cascade-player';
import { useProduct } from '../providers';
import { AmountControl, DemoBalance, DemoNotice, GameHeading, GameHistory, Rules, type Mode } from '../game-common';
import { Icon } from '../icons';
import { CascadeBackdrop, BoardFrame } from './backdrop';
import { CascadeBoard, type BoardHandle } from './cascade-board';
import { CascadeFx, SYMBOL_COLORS } from './fx';
import { Paytable } from './paytable';
import { SYMBOL_LABELS, SymbolArt } from './symbols';
import styles from './cascade-game.module.css';

/* Lifecycle: entropy -> engine resolves the whole round -> one reservation -> the timeline replays it
   -> exactly one settlement with the engine payout (at the end, on "Atla", or on unmount). */

type LiveRound = { id: string; stake: number; round: CascadeRound; timeline: CascadeTimeline; prefix: string; reduced: boolean; settled: boolean };
type Phase = 'idle' | 'playing' | 'done';
type Card =
  | { kind: 'intro'; awarded: number; at: number; dur: number }
  | { kind: 'max'; at: number; dur: number }
  | { kind: 'big'; tier: 1 | 2 | 3; total: number; countUp: number; at: number; dur: number; instant: boolean };
type Banner = { key: number; text: string; tone: 'gold' | 'pink' };
type Badge = { parts: number[]; sum: number | null };

const ENTROPY_ERROR = 'Güvenli yerel rastgelelik kullanılamıyor. Demo başlatılmadı.';
const BIG_TITLES = { 1: 'Büyük kazanç', 2: 'Süper kazanç', 3: 'Efsane kazanç' } as const;
const ZERO: Meter = { spin: 0, total: 0 };

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
function BoltIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M13.5 2 5 13.5h6L9.8 22 19 9.8h-6.2z" fill="currentColor" /></svg>; }
function SoundIcon({ on }: { on: boolean }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />{on ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /> : <path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />}</svg>;
}
function SkipIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 6l7 6-7 6zM12 6l7 6-7 6z" fill="currentColor" /><path d="M20 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>; }
function TableIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M4 9.5h16M4 14.5h16M10 9.5V20" stroke="currentColor" strokeWidth="1.6" /></svg>; }

/* Heavy static subtrees are memoised so meter/announcement updates never re-render them. */
const StaticBackdrop = memo(CascadeBackdrop);
const StaticPaytable = memo(Paytable);
const StaticHistory = memo(function StaticHistory() { return <><DemoNotice /><GameHistory game="Cascade" /><Rules game="Cascade" /></>; });

export function CascadeGame() {
  const { reserveDemo, settleDemo, setActiveDemo } = useProduct();
  const [mode, setMode] = useState<Mode>('demo');
  const [amount, setAmount] = useState('10');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [turbo, setTurbo] = useState(false);
  const [sound, setSound] = useState(false);
  const [free, setFree] = useState(false);
  const [freeInfo, setFreeInfo] = useState<{ number: number; left: number } | null>(null);
  const [meter, setMeter] = useState<Meter>(ZERO);
  const [meterDur, setMeterDur] = useState(0);
  const [stake, setStake] = useState<number | null>(null);
  const [badge, setBadge] = useState<Badge | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [announce, setAnnounce] = useState('');
  const [result, setResult] = useState<{ payout: number; stake: number; total: number; skipped: boolean } | null>(null);
  const [paytable, setPaytable] = useState(false);
  const [session, setSession] = useState({ rounds: 0, best: 0, free: 0 });
  const reducedMotion = usePrefersReducedMotion();

  const board = useRef<BoardHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const fx = useRef<CascadeFx | null>(null);
  const audio = useRef<CascadeAudio | null>(null);
  const player = useRef<TimelinePlayer | null>(null);
  const live = useRef<LiveRound | null>(null);
  const settledIds = useRef(new Set<string>());
  const sequence = useRef(0);
  const bannerKey = useRef(0);

  useEffect(() => {
    const stage = stageRef.current, canvas = canvasRef.current, layer = layerRef.current;
    if (stage && canvas && layer) fx.current = new CascadeFx(canvas, layer, stage);
    audio.current = createCascadeAudio();
    return () => { fx.current?.dispose(); fx.current = null; audio.current?.dispose(); audio.current = null; };
  }, []);

  const settle = useCallback((current: LiveRound) => {
    if (current.settled || settledIds.current.has(current.id)) return;
    current.settled = true; settledIds.current.add(current.id);
    settleDemo({ id: current.id, game: 'Cascade', stake: current.stake, payout: current.round.payoutCents, detail: cascadeHistoryDetail(current.round), at: Date.now() });
    setActiveDemo(false);
  }, [settleDemo, setActiveDemo]);

  // Leaving the page mid-show still closes the round once, with the full engine payout.
  useEffect(() => () => {
    player.current?.stop(); player.current = null;
    const current = live.current;
    if (current && !current.settled) settle(current);
  }, [settle]);

  const finishRound = useCallback((current: LiveRound, skipped: boolean) => {
    settle(current);
    setPhase('done');
    setResult({ payout: current.round.payoutCents, stake: current.stake, total: current.round.totalHundredths, skipped });
    setSession(prev => ({ rounds: prev.rounds + 1, best: Math.max(prev.best, current.round.totalHundredths), free: prev.free + (current.round.freeSpinsTriggered ? 1 : 0) }));
    const total = demoNumber(current.round.payoutCents);
    setAnnounce(current.round.payoutCents > 0 ? `Tur bitti. Toplam kazanç ${total} DEMO, ${multiplierText(current.round.totalHundredths)}×.` : 'Tur bitti. Kazanç yok.');
  }, [settle]);

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
    const reduced = current.reduced, b = board.current, f = fx.current, sfx = audio.current;
    switch (event.type) {
      case 'spin-start':
        setBadge(null);
        if (event.kind === 'free') { setFreeInfo({ number: event.freeSpinNumber, left: event.freeSpinsLeft }); setMeterDur(0); setMeter(event.meter); sfx?.spinStart(); }
        break;
      case 'clear': b?.clear(event.ids, event.dur, reduced); break;
      case 'drop': b?.drop(current.prefix, event.cells, reduced); break;
      case 'land': sfx?.land(event.col); if (event.crystal) sfx?.crystal(2); break;
      case 'scatter-tease': b?.tease(event.ids); sfx?.scatter(event.count); break;
      case 'highlight': {
        b?.highlight(event.wins.flatMap(w => w.ids), event.dur, reduced);
        setAnnounce(event.wins.map(w => winAnnouncement(w, SYMBOL_LABELS)).join('; '));
        break;
      }
      case 'pop': {
        const ids = event.wins.flatMap(w => w.ids);
        if (f && !reduced) {
          for (const win of event.wins) for (const id of win.ids) {
            const el = b?.symbolOf(id); if (!el) continue;
            const p = f.point(el);
            f.burst(p.x, p.y, SYMBOL_COLORS[win.symbol] ?? ['#fff'], p.w, 12);
          }
        }
        b?.pop(ids, event.dur, reduced);
        if (f) for (const win of event.wins) {
          const c = centre(win.centroid.x, win.centroid.y);
          f.label(c.x, c.y, `+${moneyText(centsFor(current.stake, win.payHundredths))}`, styles.floatLabel, reduced ? 700 : 1200);
        }
        setMeterDur(Math.min(520, event.dur + 160)); setMeter(event.meter);
        const tier = Math.max(...event.wins.map(w => (w.count >= 12 ? 2 : w.count >= 10 ? 1 : 0)));
        sfx?.pop(ids.length, tier); sfx?.win(event.stepHundredths / 100);
        break;
      }
      case 'tumble': b?.tumble(current.prefix, event.cells, event.removed, reduced); break;
      case 'crystal-collect': {
        setBadge({ parts: [], sum: null });
        sfx?.collect();
        const target = badgeRef.current;
        if (f && target && !reduced) {
          const to = f.point(target);
          for (const crystal of event.crystals) {
            const el = b?.symbolOf(crystal.id); const svg = el?.firstElementChild;
            if (!el || !svg) continue;
            f.fly(svg, f.point(el), to, crystal.delay, crystal.fly, styles.flyCrystal);
          }
        }
        setAnnounce(`Çarpan kristalleri toplanıyor: toplam ${event.sum}×.`);
        break;
      }
      case 'crystal-arrive': {
        b?.spend(event.id);
        setBadge({ parts: event.parts, sum: null });
        sfx?.crystal(event.value);
        const target = badgeRef.current;
        if (f && target && !reduced) { const p = f.point(target); f.sparkle(p.x, p.y, p.w * 0.4, 7); f.ring(p.x, p.y, p.h * 0.7, '#ffe09a', 0.45); }
        break;
      }
      case 'multiply': {
        setBadge(prev => ({ parts: prev?.parts ?? [], sum: event.sum }));
        setMeterDur(Math.min(700, event.dur)); setMeter(event.meter);
        const m = meterRef.current;
        if (!reduced) {
          m?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.25 }, { transform: 'scale(.97)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 560, easing: 'ease-out' });
          shake(7);
          if (f && m) { const p = f.point(m); f.sparkle(p.x, p.y, p.w * 0.35, 14); f.burst(p.x, p.y - p.h * 0.2, SYMBOL_COLORS.crystal!, p.h, 18); }
        }
        if (f && m) { const p = f.point(m); f.label(p.x, p.y - p.h * 1.15, `×${event.sum}`, styles.floatBig, reduced ? 800 : 1300); }
        sfx?.win(event.meter.spin / 100);
        setAnnounce(`${multiplierText(event.baseHundredths)}× kazanç ${event.sum} ile çarpıldı.`);
        break;
      }
      case 'scatter-pay': {
        setMeterDur(500); setMeter(event.meter);
        setBanner({ key: ++bannerKey.current, text: `${event.count} yıldız · +${moneyText(centsFor(current.stake, event.hundredths))} DEMO`, tone: 'gold' });
        sfx?.scatter(event.count);
        break;
      }
      case 'scatter-trigger': {
        b?.dim(true); b?.flare(event.ids, event.dur, reduced);
        sfx?.scatter(event.count);
        if (f && !reduced) for (const id of event.ids) { const el = b?.symbolOf(id); if (el) { const p = f.point(el); f.sparkle(p.x, p.y, p.w * 0.6, 10, '#ffe7a3'); f.ring(p.x, p.y, p.w * 0.7, '#ffd36b', 0.7); } }
        if (event.retrigger) {
          setFreeInfo(prev => (prev ? { ...prev, left: event.freeSpinsLeft } : prev));
          setBanner({ key: ++bannerKey.current, text: `+${event.awarded} bedava dönüş`, tone: 'pink' });
          setAnnounce(`${event.count} yıldız: ${event.awarded} bedava dönüş eklendi.`);
        } else setAnnounce(`${event.count} yıldız: bedava dönüş kazanıldı.`);
        break;
      }
      case 'free-intro':
        setCard({ kind: 'intro', awarded: event.awarded, at: event.at, dur: event.dur });
        sfx?.freeSpinsIntro();
        setAnnounce(`${event.awarded} bedava dönüş kazandın.`);
        break;
      case 'free-mode':
        setCard(null); b?.dim(false); setFree(event.on); setFreeInfo({ number: 0, left: 10 });
        break;
      case 'spin-end': {
        b?.dim(false);
        setMeterDur(300); setMeter(event.meter);
        if (event.kind === 'free') setAnnounce(event.winHundredths > 0 ? `Bedava dönüş ${multiplierText(event.winHundredths)}× kazandırdı.` : 'Bedava dönüşte kazanç yok.');
        else if (event.winHundredths === 0) setAnnounce('Kazanç yok.');
        break;
      }
      case 'max-win':
        setCard({ kind: 'max', at: event.at, dur: event.dur });
        sfx?.bigWin(3);
        if (f && !reduced) f.confetti(3);
        setAnnounce('Azami kazanca ulaşıldı: bahsin 5.000 katı.');
        break;
      case 'big-win':
        setCard({ kind: 'big', tier: event.tier, total: event.totalHundredths, countUp: event.countUp, at: event.at, dur: event.dur, instant: false });
        sfx?.bigWin(event.tier);
        if (f && !reduced) f.confetti(event.tier);
        if (!reduced) shake(5 + event.tier * 2);
        setAnnounce(`${BIG_TITLES[event.tier]}: ${demoNumber(centsFor(current.stake, event.totalHundredths))} DEMO.`);
        break;
      case 'end':
        setCard(null); setBanner(null); setBadge(null);
        player.current = null;
        finishRound(current, false);
        break;
    }
  }, [centre, finishRound, shake]);

  function start() {
    if ((live.current && !live.current.settled) || mode !== 'demo') return;
    const parsed = parseDemoAmount(amount);
    if (parsed === null) { setError('1–500 DEMO arasında, en çok iki ondalıklı miktar gir.'); return; }
    let round: CascadeRound;
    try {
      const words = new Uint32Array(4);
      crypto.getRandomValues(words);
      round = playCascadeRound(cascadeSeedFromEntropy(words), parsed);
    } catch { setError(ENTROPY_ERROR); return; }
    let id: string | null;
    try { id = reserveDemo(parsed, 5000); } catch { setError(ENTROPY_ERROR); return; }
    if (!id) { setError('Yeterli demo kredin yok veya devam eden bir demo var.'); return; }
    const timeline = buildCascadeTimeline(round, { turbo, reducedMotion });
    const current: LiveRound = { id, stake: parsed, round, timeline, prefix: `r${++sequence.current}`, reduced: reducedMotion, settled: false };
    live.current = current;
    setError(''); setPhase('playing'); setActiveDemo(true); setStake(parsed);
    setFree(false); setFreeInfo(null); setMeterDur(0); setMeter(ZERO); setBadge(null); setCard(null); setBanner(null); setResult(null);
    setAnnounce(`Dönüş başladı, ${demoNumber(parsed)} DEMO.`);
    fx.current?.clear();
    audio.current?.spinStart();
    const next = new TimelinePlayer(timeline, (event, info) => { if (live.current === current) handle(event, info); });
    player.current = next;
    next.start();
  }

  function skip() {
    const current = live.current;
    if (!current || current.settled) return;
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
      setCard(c => (c && c.kind === 'big' ? { ...c, instant: true } : c));
      return;
    }
    p.jumpTo(hold.at + hold.dur);
  }, []);

  const startRef = useRef(start); startRef.current = start;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, summary, [contenteditable="true"], dialog')) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (player.current?.active) advanceHold(); else startRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advanceHold]);

  function toggleSound() {
    const next = !sound; setSound(next);
    const a = audio.current; if (!a) return;
    if (next) void a.resume();
    a.setEnabled(next);
  }

  const playing = phase === 'playing';
  const gated = mode === 'live';
  const stakeCents = stake ?? parseDemoAmount(amount);
  const amountCents = (h: number) => (stake === null ? 0 : centsFor(stake, h));
  const boardLabel = free ? 'Candy Cascade bedava dönüş ızgarası, 6 sütun, 5 satır' : 'Candy Cascade ızgarası, 6 sütun, 5 satır';
  const boardElement = useMemo(() => <BoardFrame><CascadeBoard ref={board} label={boardLabel} free={free} /></BoardFrame>, [boardLabel, free]);
  const closePaytable = useCallback(() => setPaytable(false), []);
  const stageClass = [styles.stage, free ? styles.stageFree : '', card ? styles.stageCard : ''].join(' ');
  const cardTier = card?.kind === 'big' ? card.tier : 3;

  return (
    <div className="game-page">
      <GameHeading title="Candy Cascade" subtitle="Sekiz eşleşmede patlat, düşen şekerlerle zincir kur." mode={mode} setMode={setMode} active={playing} />
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
        <div className={styles.side}>
          <div className={styles.sideTop}><DemoBalance /></div>
          <AmountControl amount={amount} setAmount={setAmount} disabled={playing || gated} error={error} />
          <div className={styles.spinCluster}>
            <button type="button" className={`${styles.pill} ${turbo ? styles.pillOn : ''}`} aria-pressed={turbo} onClick={() => setTurbo(t => !t)} disabled={gated}><BoltIcon /><span>Hızlı</span></button>
            <button type="button" className={`${styles.spin} ${playing ? styles.spinning : ''}`} onClick={start} disabled={playing || gated} aria-label={playing ? 'Dönüş sürüyor' : 'Çevir'}>
              <span className={styles.spinFace}><SwirlIcon /></span>
            </button>
            <button type="button" className={`${styles.pill} ${sound ? styles.pillOn : ''}`} aria-pressed={sound} onClick={toggleSound}><SoundIcon on={sound} /><span>Ses</span></button>
          </div>
          <div className={styles.sideActions}>
            {playing
              ? <button type="button" className={styles.skip} onClick={skip}><SkipIcon /><span>Atla</span></button>
              : <p className={styles.hint}>{result ? (result.payout > 0 ? <>Son tur <strong>+{moneyText(result.payout)} DEMO</strong> · {multiplierText(result.total)}×</> : <>Son tur kazançsız. Tekrar dene.</>) : <>Boşluk veya Enter ile de çevirebilirsin.</>}</p>}
            <button type="button" className={styles.tableButton} onClick={() => setPaytable(true)}><TableIcon /><span>Ödeme tablosu</span></button>
          </div>
          <dl className={styles.stats} aria-label="Bu oturum">
            <div><dt>Tur</dt><dd>{session.rounds}</dd></div>
            <div><dt>En iyi</dt><dd>{session.rounds ? `${multiplierText(session.best)}×` : '—'}</dd></div>
            <div><dt>Bedava tur</dt><dd>{session.free}</dd></div>
          </dl>
          <p className={styles.sideNote}>Bahis {stakeCents ? `${demoNumber(stakeCents)} DEMO` : '—'} · Azami kazanç 5.000× · Sonuç dönüşten önce belirlenir.</p>
        </div>
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </section>
      <StaticHistory />
      <StaticPaytable open={paytable} onClose={closePaytable} stakeCents={stakeCents} />
    </div>
  );
}
