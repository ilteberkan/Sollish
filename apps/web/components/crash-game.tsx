'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { crashAt, demoNumber, grossPayout, multiplierLabel, parseDemoAmount, randomUnit, sampleCrash } from '@/lib/demo';
import { useProduct } from './providers';
import { AmountControl, DemoBalance, DemoNotice, GameHeading, GameHistory, Rules, type Mode } from './game-common';
import { Icon, BrandMark } from './icons';
import { useFormat, useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import { GameInfoStrip } from '@/components/game-info-strip';
type Round = { id: string; stake: number; startAt: number; point: number };
type Phase = 'ready' | 'countdown' | 'running' | 'won' | 'lost';
type ErrorKey = Extract<MessageKey<'common'>, `game.errors.${string}`>;
export function CrashGame() {
  const { reserveDemo, settleDemo, setActiveDemo } = useProduct();
  const t = useT('crash');
  const tc = useT('common');
  const format = useFormat();
  const { locale } = useLocale();
  const money = (cents: number) => demoNumber(cents, locale);
  const times = (value: number) => multiplierLabel(value, locale);
  const [mode, setMode] = useState<Mode>('demo');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<ErrorKey | ''>('');
  const [phase, setPhase] = useState<Phase>('ready');
  const [multiplier, setMultiplier] = useState(1);
  const [countdown, setCountdown] = useState(3);
  const [payout, setPayout] = useState(0);
  const [stake, setStake] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const round = useRef<Round | null>(null);
  const frame = useRef(0);
  const active = phase === 'running' || phase === 'countdown';
  const finish = useCallback((current: Round, cashout: boolean, value: number) => {
    if (round.current?.id !== current.id) return;
    round.current = null;
    cancelAnimationFrame(frame.current);
    const gross = cashout ? grossPayout(current.stake, value) : 0;
    setMultiplier(value); setPayout(gross); setPhase(cashout ? 'won' : 'lost'); setActiveDemo(false);
    settleDemo({ id: current.id, game: 'Crash', stake: current.stake, payout: gross, detail: cashout ? `${multiplierLabel(value)} çıkış` : `${multiplierLabel(value)} tur sonu`, at: Date.now() });
  }, [setActiveDemo, settleDemo]);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    const current = round.current;
    if (current) {
      const now = performance.now();
      const expired = now >= current.startAt && crashAt(now - current.startAt, current.point).crashed;
      round.current = null;
      settleDemo({ id: current.id, game: 'Crash', stake: current.stake, payout: expired ? 0 : current.stake, detail: expired ? `${multiplierLabel(current.point)} tur sonu` : 'Demo iptal edildi', at: Date.now() });
      setActiveDemo(false);
    }
  }, [settleDemo, setActiveDemo]);
  function start() {
    if (round.current || mode !== 'demo') return;
    const parsed = parseDemoAmount(amount);
    if (parsed === null) { setError('game.errors.amountRange'); return; }
    let point: number;
    try { point = sampleCrash(randomUnit()); }
    catch { setError('game.errors.noRandomness'); return; }
    let id: string | null;
    try { id = reserveDemo(parsed); }
    catch { setError('game.errors.noRandomness'); return; }
    if (!id) { setError('game.errors.noCredit'); return; }
    setError(''); setPhase('countdown'); setActiveDemo(true); setStake(parsed); setPayout(0); setMultiplier(1); setElapsed(0); setCountdown(3);
    const current = { id, stake: parsed, startAt: performance.now() + 2400, point };
    round.current = current;
    let lastPaint = 0;
    const tick = (now: number) => {
      if (round.current?.id !== id) return;
      const time = now - current.startAt;
      if (time < 0) { setCountdown(Math.ceil(-time / 800)); }
      else {
        const value = crashAt(time, current.point);
        if (value.crashed) { finish(current, false, current.point); return; }
        if (now - lastPaint > 40) { setPhase('running'); setMultiplier(value.multiplier); setElapsed(time); lastPaint = now; }
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  function cashout() {
    const current = round.current;
    if (!current || performance.now() < current.startAt) return;
    const value = crashAt(performance.now() - current.startAt, current.point);
    finish(current, !value.crashed, value.multiplier);
  }
  const caption = t(`caption.${phase}`);
  const live = mode === 'live';
  return <div className="game-page"><GameHeading title="Crash" subtitle={t('subtitle')} mode={mode} setMode={setMode} active={active}/>
    <section className={`game-table crash-table phase-${phase}`} aria-label={t('tableLabel')}>
      <div className="table-topline"><span className="table-status"><span className={`status-dot ${phase === 'running' ? 'running' : ''}`}/>{live ? t('status.live') : active ? t('status.active') : t('status.ready')}</span>{!live && <DemoBalance/>}</div>
      <div className="crash-stage">
        <CrashChart multiplier={multiplier} elapsed={elapsed} phase={live ? 'ready' : phase}/>
        {live ? <div className="stage-readout gated-readout"><span className="stage-lock"><Icon name="lock" size={27}/></span><h2>{t('gate.title')}</h2><p>{t('gate.text')}</p><button className="text-button" onClick={() => setMode('demo')}>{t('gate.tryDemo')}<Icon name="arrow" size={17}/></button></div> : <div className="stage-readout"><span className="stage-caption">{caption}</span>{phase === 'countdown' ? <strong className="crash-value countdown">{countdown}</strong> : <strong className={`crash-value ${phase === 'lost' ? 'lost-value' : ''}`}>{times(multiplier)}</strong>}<span className="stage-subtext">{phase === 'ready' ? t('readout.ready') : phase === 'running' ? t('readout.running', { seconds: (elapsed / 1000).toFixed(1).replace('.', format.decimal) }) : phase === 'won' ? t('readout.won', { amount: money(payout) }) : phase === 'lost' ? t('readout.lost', { amount: money(stake) }) : t('readout.countdown')}</span></div>}
        <div className="stage-bottom"><span><BrandMark/>{t('bottom.local')}</span><span>{t('bottom.manual')}<Icon name="exit" size={14}/></span></div>
      </div>
      <div className="bet-controls"><AmountControl amount={amount} setAmount={setAmount} disabled={active || live} error={error ? tc(error) : ''}/><div className="payout-preview"><span>{phase === 'won' ? t('preview.won') : t('preview.cashout')}</span><strong>{phase === 'won' ? money(payout) : phase === 'running' ? money(grossPayout(stake, multiplier)) : '—'}<small> DEMO</small></strong><span className="small muted">{phase === 'won' ? t('preview.net', { amount: money(payout - stake) }) : t('preview.fee')}</span></div><div className={`action-slot ${active ? 'mobile-sticky-action' : ''}`}><button className={`button primary game-action ${phase === 'running' ? 'cashout-button' : ''}`} disabled={live || phase === 'countdown'} onClick={phase === 'running' ? cashout : start}>{phase === 'running' ? <><span>{t('action.cashout')}</span><strong>{money(grossPayout(stake, multiplier))} <small>DEMO</small></strong></> : phase === 'countdown' ? t('action.starting') : live ? <><Icon name="lock" size={16}/>{t('action.liveClosed')}</> : <><span>{t('action.start')}</span><Icon name="arrow"/></>}</button><p>{phase === 'running' ? t('hint.running') : live ? t('hint.live') : t('hint.default')}</p></div></div>
      <div className="sr-only" role="status" aria-live="polite">{phase === 'running' ? t('sr.running') : phase === 'won' ? t('sr.won', { amount: money(payout) }) : phase === 'lost' ? t('sr.lost', { multiplier: times(multiplier) }) : phase === 'countdown' ? t('sr.countdown') : ''}</div>
    </section><GameInfoStrip id="crash"/><DemoNotice/><GameHistory game="Crash"/><Rules game="Crash"/>
  </div>;
}
function CrashChart({ multiplier, elapsed, phase }: { multiplier: number; elapsed: number; phase: Phase }) {
  const t = useT('crash');
  const points = Array.from({ length: 35 }, (_, i) => { const t = i / 34; return `${50 + t * Math.min(760, 120 + elapsed / 45)},${306 - (Math.pow(multiplier, t) - 1) / Math.max(4, multiplier - 1) * 240}`; }).join(' ');
  const visible = phase !== 'ready' && phase !== 'countdown';
  return <svg className="crash-chart" viewBox="0 0 880 350" preserveAspectRatio="none" aria-hidden="true"><g className="chart-grid"><path d="M50 65H838M50 145H838M50 225H838M50 305H838"/><path d="M50 42V305M247 42V305M444 42V305M641 42V305M838 42V305"/></g><path className="chart-baseline" d="M50 305H838"/>{visible && <><polyline points={points} className={`chart-trail ${phase === 'lost' ? 'trail-lost' : ''}`}/><circle cx={50 + Math.min(760, 120 + elapsed / 45)} cy={306 - (multiplier - 1) / Math.max(4, multiplier - 1) * 240} r="5" className={phase === 'lost' ? 'chart-dot lost-dot' : 'chart-dot'}/></>}<g className="chart-axis-labels"><text x="50" y="330">{t('chart.zero')}</text><text x="838" y="330" textAnchor="end">{t('chart.time')}</text><text x="30" y="310" textAnchor="end">1×</text></g></svg>;
}
