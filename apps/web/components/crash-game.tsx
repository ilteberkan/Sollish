'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_MAX_BET_CENTS, crashAt, demoNumber, grossPayout, multiplierLabel, parseDemoAmount, randomUnit, sampleCrash } from '@/lib/demo';
import { useProduct } from './providers';
import { DemoBalance, DemoNotice, GameHeading, GameHistory, Rules, type Mode } from './game-common';
import { Icon, BrandMark } from './icons';
import { useFormat, useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import { GameInfoStrip } from '@/components/game-info-strip';
import { AutoplayPanel, AutoplayStopButton } from './slot-kit';
import { BetAmountField, BetPanel, OriginalsInfo, OriginalsPage, OriginalsRow, OriginalsTable, ProfitReadout, originalsStyles as o, type BetTab } from './originals';
import { useInstantAutoplay, autoplayNet } from './originals/use-instant-autoplay';
import { CRASH_TARGET_PRESETS, centsToInput, crashTargetOutcome, doubleCents, halveCents, parseCrashTarget, profitCents } from '@/lib/originals';
/** `target`: automatic cash-out in hundredths (null = manual only), frozen when the round is admitted. */
type Round = { id: string; stake: number; startAt: number; point: number; target: number | null; balanceBefore: number };
type Phase = 'ready' | 'countdown' | 'running' | 'won' | 'lost';
type ErrorKey = Extract<MessageKey<'common'>, `game.errors.${string}`>;
const MIN_CENTS = 100;
const hundredthsOf = (value: number) => Math.round(value * 100);
/* Sollish Originals page (components/originals). The round lifecycle is the original local practice: reserve → 2,4 s
   countdown → the curve → manual cash-out or crash; unmount settles once (refund before the crash, loss after it).
   New here: an optional automatic cash-out target. It is decided by the crash point alone (crashTargetOutcome: point ≥
   target pays exactly the target), never by frame timing, so a hidden tab or a slow device cannot change the result. */
export function CrashGame() {
  const { reserveDemo, settleDemo, setActiveDemo, demoBalance } = useProduct();
  const t = useT('crash');
  const tc = useT('common');
  const tk = useT('slotKit');
  const format = useFormat();
  const { locale } = useLocale();
  const money = (cents: number) => demoNumber(cents, locale);
  const times = (value: number) => multiplierLabel(value, locale);
  const [mode, setMode] = useState<Mode>('demo');
  const [tab, setTab] = useState<BetTab>('manual');
  const [amount, setAmount] = useState('');
  const [targetText, setTargetText] = useState('');
  const [error, setError] = useState<ErrorKey | ''>('');
  const [phase, setPhase] = useState<Phase>('ready');
  const [multiplier, setMultiplier] = useState(1);
  const [countdown, setCountdown] = useState(3);
  const [payout, setPayout] = useState(0);
  const [stake, setStake] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [autoNote, setAutoNote] = useState('');
  const round = useRef<Round | null>(null);
  const frame = useRef(0);
  const recordAuto = useRef<(round: { costCents: number; payoutCents: number; balanceAfterCents: number }) => void>(() => undefined);
  const active = phase === 'running' || phase === 'countdown';
  const finish = useCallback((current: Round, cashout: boolean, value: number) => {
    if (round.current?.id !== current.id) return;
    round.current = null;
    cancelAnimationFrame(frame.current);
    const gross = cashout ? grossPayout(current.stake, value) : 0;
    setMultiplier(value); setPayout(gross); setPhase(cashout ? 'won' : 'lost'); setActiveDemo(false);
    settleDemo({ id: current.id, game: 'Crash', stake: current.stake, payout: gross, detail: cashout ? `${multiplierLabel(value)} çıkış` : `${multiplierLabel(value)} tur sonu`, at: Date.now() });
    recordAuto.current({ costCents: current.stake, payoutCents: gross, balanceAfterCents: current.balanceBefore - current.stake + gross });
  }, [setActiveDemo, settleDemo]);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    const current = round.current;
    if (current) {
      const now = performance.now();
      const reached = now >= current.startAt ? crashAt(now - current.startAt, current.point) : null;
      // A target the curve has already passed was cashed out at that moment (point ≥ target); otherwise as before:
      // a crashed round is a loss, an unfinished one is refunded.
      const targetHit = current.target !== null && reached !== null && crashTargetOutcome(hundredthsOf(current.point), current.target).cashout && (reached.crashed || hundredthsOf(reached.multiplier) >= current.target);
      const expired = reached?.crashed ?? false;
      round.current = null;
      const paid = targetHit ? grossPayout(current.stake, current.target! / 100) : expired ? 0 : current.stake;
      settleDemo({ id: current.id, game: 'Crash', stake: current.stake, payout: paid, detail: targetHit ? `${multiplierLabel(current.target! / 100)} çıkış` : expired ? `${multiplierLabel(current.point)} tur sonu` : 'Demo iptal edildi', at: Date.now() });
      setActiveDemo(false);
    }
  }, [settleDemo, setActiveDemo]);
  const parsedTarget = parseCrashTarget(targetText);
  const targetInvalid = targetText.trim() !== '' && parsedTarget === null;
  /** One normal local round at the current bet (and target). True when it started. */
  function start(): boolean {
    if (round.current || mode !== 'demo') return false;
    const parsed = parseDemoAmount(amount);
    if (parsed === null) { setError('game.errors.amountRange'); return false; }
    if (targetInvalid) return false;
    let point: number;
    try { point = sampleCrash(randomUnit()); }
    catch { setError('game.errors.noRandomness'); return false; }
    const balanceBefore = demoBalance;
    let id: string | null;
    try { id = reserveDemo(parsed); }
    catch { setError('game.errors.noRandomness'); return false; }
    if (!id) { setError('game.errors.noCredit'); return false; }
    setError(''); setPhase('countdown'); setActiveDemo(true); setStake(parsed); setPayout(0); setMultiplier(1); setElapsed(0); setCountdown(3);
    const current: Round = { id, stake: parsed, startAt: performance.now() + 2400, point, target: parsedTarget, balanceBefore };
    round.current = current;
    let lastPaint = 0;
    const tick = (now: number) => {
      if (round.current?.id !== id) return;
      const time = now - current.startAt;
      if (time < 0) { setCountdown(Math.ceil(-time / 800)); }
      else {
        const value = crashAt(time, current.point);
        if (current.target !== null && (value.crashed || hundredthsOf(value.multiplier) >= current.target)) {
          const outcome = crashTargetOutcome(hundredthsOf(current.point), current.target);
          finish(current, outcome.cashout, outcome.hundredths / 100); return;
        }
        if (value.crashed) { finish(current, false, current.point); return; }
        if (now - lastPaint > 40) { setPhase('running'); setMultiplier(value.multiplier); setElapsed(time); lastPaint = now; }
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return true;
  }
  function cashout() {
    const current = round.current;
    if (!current || performance.now() < current.startAt) return;
    const value = crashAt(performance.now() - current.startAt, current.point);
    finish(current, !value.crashed, value.multiplier);
  }
  const parsed = parseDemoAmount(amount);
  const live = mode === 'live';
  const auto = useInstantAutoplay({
    ready: !active && !live, play: () => parsedTarget !== null && start(), balanceCents: demoBalance, costCents: parsed,
    onStopped: (code, state) => setAutoNote(tk('originals.autoStopped', { reason: tk(`autoplay.reasons.${code}`), rounds: state.spinsDone, net: format.signedDemo(autoplayNet(state)) })),
  });
  recordAuto.current = auto.record;
  const running = auto.state !== null;
  const locked = active || live || running;
  const maxCents = Math.max(MIN_CENTS, Math.min(DEMO_MAX_BET_CENTS, demoBalance));
  const setCents = (cents: number) => { setAmount(centsToInput(cents, format.decimal)); setError(''); };
  const caption = t(`caption.${phase}`);
  const targetLabel = (h: number) => times(h / 100);
  const profit = phase === 'running' ? { value: format.signedDemo(grossPayout(stake, multiplier) - stake), note: tk('originals.profitLive'), up: true }
    : phase === 'won' || phase === 'lost' ? { value: format.signedDemo(payout - stake), note: tk('originals.profitLast'), up: payout > stake }
    : parsed && parsedTarget ? { value: format.signedDemo(profitCents(parsed, parsedTarget)), note: tk('originals.profitAtTarget', { target: targetLabel(parsedTarget) }), up: true }
    : { value: '—', note: tk('originals.profitIdle'), up: false };

  const shared = <>
    <BetAmountField id="bet-amount" value={amount} onChange={setAmount} disabled={locked} error={error ? tc(error) : ''} hint={tk('originals.amountHint')}
      onHalf={() => setCents(halveCents(parsed, MIN_CENTS))} onDouble={() => setCents(doubleCents(parsed, MIN_CENTS, maxCents))} />
    <div className={o.field}>
      <div className={o.label}><label htmlFor="crash-target">{tk('originals.target')}</label><small aria-hidden="true">{parsedTarget ? targetLabel(parsedTarget) : tk('originals.targetOff')}</small></div>
      <div className={o.amount} data-invalid={targetInvalid ? '' : undefined}>
        <input id="crash-target" inputMode="decimal" autoComplete="off" placeholder={tk('originals.targetPlaceholder')} value={targetText} onChange={event => setTargetText(event.target.value)}
          disabled={locked} aria-invalid={targetInvalid} aria-describedby={targetInvalid ? 'crash-target-error' : 'crash-target-hint'} />
        <span className={o.unit} aria-hidden="true">×</span>
      </div>
      <div className={o.chips} role="group" aria-label={tk('originals.target')}>
        {CRASH_TARGET_PRESETS.map(h => <button key={h} type="button" className={o.chip} aria-pressed={parsedTarget === h} disabled={locked} onClick={() => setTargetText(centsToInput(h, format.decimal))} aria-label={tk('originals.targetPreset', { target: targetLabel(h) })}>{targetLabel(h)}</button>)}
        <button type="button" className={o.chip} aria-pressed={targetText.trim() === ''} disabled={locked} onClick={() => setTargetText('')}>{tk('originals.targetOff')}</button>
      </div>
      {targetInvalid ? <p id="crash-target-error" className={o.error} role="alert">{tk('originals.targetInvalid')}</p> : <p id="crash-target-hint" className={o.hint}>{tk('originals.targetHint')}</p>}
    </div>
    <ProfitReadout value={profit.value} note={profit.note} up={profit.up} />
  </>;
  const manual = <div className={`${o.actionSlot} ${active ? "mobile-sticky-action" : ""}`}>
    <button className={`${o.action} ${phase === 'running' ? 'cashout-button' : ''}`} disabled={live || phase === 'countdown' || (running && phase !== 'running') || (!active && targetInvalid)} onClick={phase === 'running' ? cashout : () => { start(); }}>{phase === 'running' ? <><span>{t('action.cashout')}</span><strong>{money(grossPayout(stake, multiplier))} <small>DEMO</small></strong></> : phase === 'countdown' ? t('action.starting') : <><span>{t('action.start')}</span><Icon name="arrow"/></>}</button>
    <p>{phase === 'running' ? t('hint.running') : t('hint.default')}</p>
  </div>;
  const autoTab = running && auto.state
    ? <div className={o.actionSlot}><AutoplayStopButton remaining={auto.state.spinsRemaining} onStop={() => auto.stop('cancelled')} /><p role="status">{tk('originals.autoNote', { cost: parsed ? format.demo(parsed) : '—' })}</p></div>
    : <>{parsedTarget === null && <p className={o.hint} role="note">{tk('originals.targetRequired')}</p>}
      <AutoplayPanel instant onStart={config => { setAutoNote(''); auto.start(config); }} spinCostCents={parsed ?? undefined} balanceCents={demoBalance} disabled={active || !parsed || parsedTarget === null} countLabel={tk('originals.autoCount')} />
      <p className={o.hint}>{tk('originals.autoNote', { cost: parsed ? format.demo(parsed) : '—' })}</p>
      {autoNote && <p className={o.hint} role="status">{autoNote}</p>}</>;

  return <OriginalsPage><GameHeading title="Crash" subtitle={t('subtitle')} mode={mode} setMode={setMode} active={active || running}/>
    <OriginalsTable label={t('tableLabel')} className={`crash-table phase-${phase}`}
      panel={<BetPanel tab={tab} onTabChange={setTab} shared={live ? undefined : shared} manual={live ? <div className={o.actionSlot}><button className={o.action} disabled><Icon name="lock" size={16}/>{t('action.liveClosed')}</button><p>{t('hint.live')}</p></div> : manual} auto={autoTab} />}
      stage={<>
        <div className="table-topline"><span className="table-status"><span className={`status-dot ${phase === 'running' ? 'running' : ''}`}/>{live ? t('status.live') : active ? t('status.active') : t('status.ready')}</span>{!live && <DemoBalance/>}</div>
        <div className="crash-stage">
          <CrashChart multiplier={multiplier} elapsed={elapsed} phase={live ? 'ready' : phase}/>
          {live ? <div className="stage-readout gated-readout"><span className="stage-lock"><Icon name="lock" size={27}/></span><h2>{t('gate.title')}</h2><p>{t('gate.text')}</p><button className="text-button" onClick={() => setMode('demo')}>{t('gate.tryDemo')}<Icon name="arrow" size={17}/></button></div> : <div className="stage-readout"><span className="stage-caption">{caption}</span>{phase === 'countdown' ? <strong className="crash-value countdown">{countdown}</strong> : <strong className={`crash-value ${phase === 'lost' ? 'lost-value' : ''}`}>{times(multiplier)}</strong>}<span className="stage-subtext">{phase === 'ready' ? t('readout.ready') : phase === 'running' ? t('readout.running', { seconds: (elapsed / 1000).toFixed(1).replace('.', format.decimal) }) : phase === 'won' ? t('readout.won', { amount: money(payout) }) : phase === 'lost' ? t('readout.lost', { amount: money(stake) }) : t('readout.countdown')}</span></div>}
          <div className="stage-bottom"><span><BrandMark/>{t('bottom.local')}</span><span>{t('bottom.manual')}<Icon name="exit" size={14}/></span></div>
        </div>
        <div className="sr-only" role="status" aria-live="polite">{phase === 'running' ? t('sr.running') : phase === 'won' ? t('sr.won', { amount: money(payout) }) : phase === 'lost' ? t('sr.lost', { multiplier: times(multiplier) }) : phase === 'countdown' ? t('sr.countdown') : ''}</div>
      </>} />
    <OriginalsInfo gameId="crash" onTry={() => { start(); }} tryDisabled={locked || targetInvalid} tryHint={tk('originals.strip.tryCrash')} />
    <OriginalsRow current="crash"/>
    <GameInfoStrip id="crash"/><DemoNotice/><GameHistory game="Crash"/><Rules game="Crash"/>
  </OriginalsPage>;
}
function CrashChart({ multiplier, elapsed, phase }: { multiplier: number; elapsed: number; phase: Phase }) {
  const t = useT('crash');
  const points = Array.from({ length: 35 }, (_, i) => { const t = i / 34; return `${50 + t * Math.min(760, 120 + elapsed / 45)},${306 - (Math.pow(multiplier, t) - 1) / Math.max(4, multiplier - 1) * 240}`; }).join(' ');
  const visible = phase !== 'ready' && phase !== 'countdown';
  return <svg className="crash-chart" viewBox="0 0 880 350" preserveAspectRatio="none" aria-hidden="true"><g className="chart-grid"><path d="M50 65H838M50 145H838M50 225H838M50 305H838"/><path d="M50 42V305M247 42V305M444 42V305M641 42V305M838 42V305"/></g><path className="chart-baseline" d="M50 305H838"/>{visible && <><polyline points={points} className={`chart-trail ${phase === 'lost' ? 'trail-lost' : ''}`}/><circle cx={50 + Math.min(760, 120 + elapsed / 45)} cy={306 - (multiplier - 1) / Math.max(4, multiplier - 1) * 240} r="5" className={phase === 'lost' ? 'chart-dot lost-dot' : 'chart-dot'}/></>}<g className="chart-axis-labels"><text x="50" y="330">{t('chart.zero')}</text><text x="838" y="330" textAnchor="end">{t('chart.time')}</text><text x="30" y="310" textAnchor="end">1×</text></g></svg>;
}
